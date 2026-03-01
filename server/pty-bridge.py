#!/usr/bin/env python3
"""
PTY bridge for TmuxWeb.

Allocates a real pseudo-terminal, spawns `tmux attach -t <session>`,
and bridges stdin/stdout with the PTY.

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

    # Make stdin non-blocking
    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()

    # Set stdin to raw-ish mode (non-blocking)
    old_flags = fcntl.fcntl(stdin_fd, fcntl.F_GETFL)
    fcntl.fcntl(stdin_fd, fcntl.F_SETFL, old_flags | os.O_NONBLOCK)

    # Buffer for detecting resize commands in stdin
    stdin_buf = b''

    try:
        while True:
            try:
                rlist, _, _ = select.select([master_fd, stdin_fd], [], [], 0.1)
            except (select.error, ValueError):
                break

            if master_fd in rlist:
                try:
                    data = os.read(master_fd, 65536)
                    if not data:
                        break
                    os.write(stdout_fd, data)
                except OSError:
                    break

            if stdin_fd in rlist:
                try:
                    data = os.read(stdin_fd, 65536)
                    if not data:
                        break
                except OSError:
                    break

                # Process data, looking for resize commands
                stdin_buf += data
                while stdin_buf:
                    idx = stdin_buf.find(b'\x00R')
                    if idx == -1:
                        # No resize marker — send everything to PTY
                        os.write(master_fd, stdin_buf)
                        stdin_buf = b''
                        break
                    if idx > 0:
                        # Send data before the marker to PTY
                        os.write(master_fd, stdin_buf[:idx])
                        stdin_buf = stdin_buf[idx:]
                    # Check if we have a complete resize command
                    if len(stdin_buf) >= RESIZE_CMD_LEN:
                        new_cols = struct.unpack('>H', stdin_buf[2:4])[0]
                        new_rows = struct.unpack('>H', stdin_buf[4:6])[0]
                        set_pty_size(master_fd, new_cols, new_rows)
                        # Send SIGWINCH to the child process group
                        os.kill(pid, signal.SIGWINCH)
                        stdin_buf = stdin_buf[RESIZE_CMD_LEN:]
                    else:
                        # Incomplete command, wait for more data
                        break

            # Check if child is still alive
            result = os.waitpid(pid, os.WNOHANG)
            if result[0] != 0:
                break

    except KeyboardInterrupt:
        pass
    finally:
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
