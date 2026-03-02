import { execFile as defaultExecFile } from 'node:child_process';

/**
 * Parse `tmux ls` stdout into structured session objects.
 * Each line: "name: N windows (created <date>) [(attached)]"
 */
export function parseSessions(stdout) {
  if (!stdout || !stdout.includes(' windows (created ')) return [];
  const sessions = [];
  for (const line of stdout.trim().split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^(.+?):\s+(\d+)\s+windows?\s+\(created\s+(.+?)\)(.*)$/);
    if (!match) continue;
    const [, name, windowCount, created, rest] = match;
    sessions.push({
      name,
      windows: parseInt(windowCount, 10),
      created,
      attached: rest.includes('(attached)'),
    });
  }
  return sessions;
}

/**
 * Parse `tmux list-windows -t <session>` stdout into structured window objects.
 * Each line: "0: name*- (N panes) [WxH] [layout ...] @N [(active)]"
 */
export function parseWindows(stdout) {
  if (!stdout) return [];
  const windows = [];
  for (const line of stdout.trim().split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^(\d+):\s+(\S+?)([*\-#!~MZ]*)\s+\(/);
    if (!match) continue;
    const [, index, name, flags] = match;
    windows.push({
      index: parseInt(index, 10),
      name,
      active: flags.includes('*') || line.includes('(active)'),
      flags,
    });
  }
  return windows;
}

/**
 * List all tmux sessions. Uses execFile to prevent command injection.
 */
export function listSessions(execFileFn = defaultExecFile) {
  return new Promise((resolve) => {
    execFileFn('tmux', ['ls'], (err, stdout, stderr) => {
      if (err) {
        resolve(parseSessions(stderr || ''));
        return;
      }
      resolve(parseSessions(stdout));
    });
  });
}

/**
 * List windows for a given tmux session. Uses execFile to prevent command injection.
 */
export function listWindows(session, execFileFn = defaultExecFile) {
  return new Promise((resolve, reject) => {
    execFileFn('tmux', ['list-windows', '-t', session], (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(parseWindows(stdout));
    });
  });
}
