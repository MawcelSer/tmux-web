import { spawn as defaultSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT = join(__dirname, 'pty-bridge.py');

export const RESIZE_PREFIX = Buffer.from([0x00, 0x52]); // \x00R

/**
 * Create a PTY instance attached to a tmux session via the Python bridge.
 *
 * @param {object} opts
 * @param {string} [opts.session] - tmux session name (empty = most recent)
 * @param {number} opts.cols
 * @param {number} opts.rows
 * @param {Function} [opts.spawnFn] - injectable spawn (for testing)
 * @returns {{ write, resize, kill, onData, onExit }}
 */
export function createPty({ session = '', cols = 80, rows = 24, spawnFn = defaultSpawn }) {
  const child = spawnFn(
    'python3',
    [BRIDGE_SCRIPT, session, String(cols), String(rows)],
    {
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  const dataCallbacks = [];
  const exitCallbacks = [];

  child.stdout.on('data', (chunk) => {
    for (const cb of dataCallbacks) cb(chunk);
  });

  child.stderr.on('data', () => {});

  child.on('exit', (code) => {
    for (const cb of exitCallbacks) cb(code);
  });

  return {
    write(data) {
      child.stdin.write(data);
    },

    resize(newCols, newRows) {
      const buf = Buffer.alloc(6);
      buf[0] = 0x00;
      buf[1] = 0x52; // 'R'
      buf.writeUInt16BE(newCols, 2);
      buf.writeUInt16BE(newRows, 4);
      child.stdin.write(buf);
    },

    kill() {
      child.kill();
    },

    onData(cb) {
      dataCallbacks.push(cb);
    },

    onExit(cb) {
      exitCallbacks.push(cb);
    },
  };
}
