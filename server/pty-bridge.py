#!/usr/bin/env python3
"""
PTY bridge for TmuxWeb.

Allocates a real pseudo-terminal, spawns `tmux attach -t <session>`,
and bridges stdin/stdout with the PTY. Server-side PTY kill handles
dedup — killing the bridge closes the master fd, detaching only that
specific tmux client without affecting other devices.

Resize protocol: when stdin contains \x00R followed by 4 bytes
(cols_hi, cols_lo, rows_hi, rows_lo), the PTY is resized via ioctl.

Usage: python3 pty-bridge.py <session> <cols> <rows>
"""

import sys
import os
import pty
import select
import signal
import struct
import fcntl
import termios

RESIZE_MARKER = b'\x00R'
RESIZE_CMD_LEN = 6  # \x00 R cols(2) rows(2)


def set_pty_size(fd, cols, rows):
    """Set the terminal size of a PTY file descriptor."""
    winsize = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def set_nonblock(fd):
    """Set a file descriptor to non-blocking mode."""
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)


def main():
    session = sys.argv[1] if len(sys.argv) > 1 else ''
    cols = int(sys.argv[2]) if len(sys.argv) > 2 else 80
    rows = int(sys.argv[3]) if len(sys.argv) > 3 else 24

    # Build tmux command
    if session:
        cmd = ['tmux', 'attach', '-t', session]
    else:
        cmd = ['tmux', 'attach']

    # Create PTY
    master_fd, slave_fd = pty.openpty()
    set_pty_size(master_fd, cols, rows)

    # Report slave TTY path to stderr so Node.js can use it for tmux commands
    try:
        slave_tty = os.ttyname(slave_fd)
        sys.stderr.write(f"PTY:{slave_tty}\n")
        sys.stderr.flush()
    except OSError:
        pass

    # Fork child
    pid = os.fork()
    if pid == 0:
        # Child: become session leader, set controlling terminal
        os.setsid()
        os.close(master_fd)

        # Set slave as stdin/stdout/stderr
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)

        os.environ['TERM'] = 'xterm-256color'
        os.execvp(cmd[0], cmd)
        sys.exit(1)

    # Parent: bridge stdin/stdout <-> master_fd
    os.close(slave_fd)

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()

    # Make all fds non-blocking so we can drain fully each iteration
    set_nonblock(stdin_fd)
    set_nonblock(stdout_fd)
    set_nonblock(master_fd)

    # Use bytearray for O(1) amortized appends instead of bytes O(n) copies
    stdin_buf = bytearray()
    output_buf = bytearray()

    def drain_stdout():
        """Drain output buffer to stdout pipe. Returns False on fatal error."""
        nonlocal output_buf
        while output_buf:
            try:
                written = os.write(stdout_fd, output_buf)
                del output_buf[:written]
            except BlockingIOError:
                break
            except OSError:
                return False
        return True

    def write_to_pty(data):
        """Write data to PTY master, handling non-blocking short writes."""
        mv = memoryview(data)
        offset = 0
        while offset < len(mv):
            try:
                written = os.write(master_fd, mv[offset:])
                offset += written
            except BlockingIOError:
                break
            except OSError:
                break
        return offset

    try:
        while True:
            read_fds = [master_fd, stdin_fd]
            write_fds = [stdout_fd] if output_buf else []

            try:
                rlist, wlist, _ = select.select(read_fds, write_fds, [], 0.1)
            except (select.error, ValueError):
                break

            # Drain output buffer to stdout when pipe has space
            if stdout_fd in wlist and output_buf:
                if not drain_stdout():
                    break

            # Drain ALL available tmux output from master_fd
            if master_fd in rlist:
                eof = False
                while True:
                    try:
                        data = os.read(master_fd, 65536)
                        if not data:
                            eof = True
                            break
                        output_buf.extend(data)
                    except BlockingIOError:
                        break
                    except OSError:
                        eof = True
                        break
                if eof:
                    break
                # Safety cap: if Node.js is very slow, don't eat all memory
                if len(output_buf) > 1048576:
                    del output_buf[:-524288]

                # Immediately try to drain new output to stdout (saves one
                # select iteration of latency for the common case)
                drain_stdout()

            # Read user input from stdin
            if stdin_fd in rlist:
                try:
                    data = os.read(stdin_fd, 65536)
                    if not data:
                        break
                except BlockingIOError:
                    data = None
                except OSError:
                    break

                if data:
                    stdin_buf.extend(data)
                    while stdin_buf:
                        idx = stdin_buf.find(b'\x00R')
                        if idx == -1:
                            written = write_to_pty(stdin_buf)
                            del stdin_buf[:written]
                            break
                        if idx > 0:
                            written = write_to_pty(memoryview(stdin_buf)[:idx])
                            del stdin_buf[:written]
                            if written < idx:
                                break  # PTY buffer full, retry next iteration
                            continue
                        # Check if we have a complete resize command
                        if len(stdin_buf) >= RESIZE_CMD_LEN:
                            new_cols = struct.unpack('>H', bytes(stdin_buf[2:4]))[0]
                            new_rows = struct.unpack('>H', bytes(stdin_buf[4:6]))[0]
                            set_pty_size(master_fd, new_cols, new_rows)
                            os.kill(pid, signal.SIGWINCH)
                            del stdin_buf[:RESIZE_CMD_LEN]
                        else:
                            break

            # Check if child is still alive
            result = os.waitpid(pid, os.WNOHANG)
            if result[0] != 0:
                break

    except KeyboardInterrupt:
        pass
    finally:
        if output_buf:
            try:
                os.write(stdout_fd, bytes(output_buf))
            except OSError:
                pass
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            os.close(master_fd)
        except OSError:
            pass


if __name__ == '__main__':
    main()
