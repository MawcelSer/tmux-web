import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPty, RESIZE_PREFIX } from '../server/pty-manager.js';

// Mock child_process.spawn
function mockSpawn() {
  const stdinChunks = [];
  const dataCallbacks = [];
  const exitCallbacks = [];
  const child = {
    stdin: {
      write: vi.fn((data) => stdinChunks.push(data)),
      end: vi.fn(),
    },
    stdout: {
      on: vi.fn((event, cb) => {
        if (event === 'data') dataCallbacks.push(cb);
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event, cb) => {
      if (event === 'exit') exitCallbacks.push(cb);
    }),
    kill: vi.fn(),
    pid: 12345,
    _stdinChunks: stdinChunks,
    _emitData: (data) => dataCallbacks.forEach((cb) => cb(data)),
    _emitExit: (code) => exitCallbacks.forEach((cb) => cb(code)),
  };
  const spawnFn = vi.fn(() => child);
  return { spawnFn, child };
}

describe('createPty', () => {
  it('spawns python3 with pty-bridge.py and correct args', () => {
    const { spawnFn, child } = mockSpawn();
    createPty({ session: 'main', cols: 120, rows: 40, spawnFn });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnFn.mock.calls[0];
    expect(cmd).toBe('python3');
    expect(args).toContain('main');
    expect(args).toContain('120');
    expect(args).toContain('40');
  });

  it('falls back to default tmux attach when no session specified', () => {
    const { spawnFn } = mockSpawn();
    createPty({ cols: 80, rows: 24, spawnFn });
    const [, args] = spawnFn.mock.calls[0];
    // Should not include a session name arg (empty string)
    expect(args.some((a) => a === '')).toBe(true);
  });

  it('returns object with write, resize, kill, onData', () => {
    const { spawnFn } = mockSpawn();
    const pty = createPty({ session: 'test', cols: 80, rows: 24, spawnFn });
    expect(typeof pty.write).toBe('function');
    expect(typeof pty.resize).toBe('function');
    expect(typeof pty.kill).toBe('function');
    expect(typeof pty.onData).toBe('function');
    expect(typeof pty.onExit).toBe('function');
  });

  it('write() sends data to child stdin', () => {
    const { spawnFn, child } = mockSpawn();
    const pty = createPty({ session: 'test', cols: 80, rows: 24, spawnFn });
    pty.write('hello');
    expect(child.stdin.write).toHaveBeenCalledWith('hello');
  });

  it('resize() sends binary resize command to stdin', () => {
    const { spawnFn, child } = mockSpawn();
    const pty = createPty({ session: 'test', cols: 80, rows: 24, spawnFn });
    pty.resize(100, 50);
    const written = child.stdin.write.mock.calls[0][0];
    // Should be a Buffer starting with \x00R
    expect(Buffer.isBuffer(written)).toBe(true);
    expect(written[0]).toBe(0x00);
    expect(written[1]).toBe(0x52); // 'R'
    // cols = 100 as uint16 BE
    expect(written.readUInt16BE(2)).toBe(100);
    // rows = 50 as uint16 BE
    expect(written.readUInt16BE(4)).toBe(50);
  });

  it('kill() kills the child process', () => {
    const { spawnFn, child } = mockSpawn();
    const pty = createPty({ session: 'test', cols: 80, rows: 24, spawnFn });
    pty.kill();
    expect(child.kill).toHaveBeenCalled();
  });

  it('onData() receives stdout data from child', () => {
    const { spawnFn, child } = mockSpawn();
    const pty = createPty({ session: 'test', cols: 80, rows: 24, spawnFn });
    const chunks = [];
    pty.onData((data) => chunks.push(data));
    child._emitData(Buffer.from('terminal output'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].toString()).toBe('terminal output');
  });

  it('onExit() fires when child exits', () => {
    const { spawnFn, child } = mockSpawn();
    const pty = createPty({ session: 'test', cols: 80, rows: 24, spawnFn });
    const codes = [];
    pty.onExit((code) => codes.push(code));
    child._emitExit(0);
    expect(codes).toEqual([0]);
  });

  it('sets TERM=xterm-256color in spawn env', () => {
    const { spawnFn } = mockSpawn();
    createPty({ session: 'test', cols: 80, rows: 24, spawnFn });
    const opts = spawnFn.mock.calls[0][2];
    expect(opts.env.TERM).toBe('xterm-256color');
  });
});

describe('RESIZE_PREFIX', () => {
  it('is a 2-byte buffer with \\x00R', () => {
    expect(Buffer.isBuffer(RESIZE_PREFIX)).toBe(true);
    expect(RESIZE_PREFIX[0]).toBe(0x00);
    expect(RESIZE_PREFIX[1]).toBe(0x52);
  });
});
