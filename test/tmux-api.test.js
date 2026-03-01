import { describe, it, expect, vi } from 'vitest';
import { parseSessions, parseWindows, listSessions, listWindows } from '../server/tmux-api.js';

describe('parseSessions', () => {
  it('parses standard tmux ls output', () => {
    const stdout =
      'main: 3 windows (created Sat Jan  4 10:23:45 2025) (attached)\n' +
      'dev: 1 windows (created Sun Jan  5 14:00:00 2025)\n';
    const result = parseSessions(stdout);
    expect(result).toEqual([
      { name: 'main', windows: 3, created: 'Sat Jan  4 10:23:45 2025', attached: true },
      { name: 'dev', windows: 1, created: 'Sun Jan  5 14:00:00 2025', attached: false },
    ]);
  });

  it('returns empty array for "no server running" error', () => {
    const stderr = 'no server running on /tmp/tmux-1000/default';
    expect(parseSessions(stderr)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseSessions('')).toEqual([]);
  });

  it('handles session names with special characters', () => {
    const stdout = 'my-session_2: 5 windows (created Mon Feb  3 08:00:00 2025) (attached)\n';
    const result = parseSessions(stdout);
    expect(result).toEqual([
      { name: 'my-session_2', windows: 5, created: 'Mon Feb  3 08:00:00 2025', attached: true },
    ]);
  });

  it('handles session names with spaces', () => {
    const stdout = 'my session: 2 windows (created Tue Mar  4 12:00:00 2025)\n';
    const result = parseSessions(stdout);
    expect(result).toEqual([
      { name: 'my session', windows: 2, created: 'Tue Mar  4 12:00:00 2025', attached: false },
    ]);
  });

  it('handles "(group" suffix in tmux output', () => {
    const stdout = 'grouped: 1 windows (created Wed Apr  5 09:00:00 2025) (group grp) (attached)\n';
    const result = parseSessions(stdout);
    expect(result[0].name).toBe('grouped');
    expect(result[0].attached).toBe(true);
  });
});

describe('parseWindows', () => {
  it('parses standard tmux list-windows output', () => {
    const stdout =
      '0: bash* (1 panes) [191x43] [layout cccc,191x43,0,0] @0 (active)\n' +
      '1: vim- (1 panes) [191x43] [layout cccc,191x43,0,0] @1\n';
    const result = parseWindows(stdout);
    expect(result).toEqual([
      { index: 0, name: 'bash', active: true, flags: '*' },
      { index: 1, name: 'vim', active: false, flags: '-' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseWindows('')).toEqual([]);
  });

  it('returns empty array for error input', () => {
    expect(parseWindows('session not found')).toEqual([]);
  });

  it('handles windows with no flags', () => {
    const stdout = '0: bash (1 panes) [80x24] [layout cccc,80x24,0,0] @0\n';
    const result = parseWindows(stdout);
    expect(result).toEqual([
      { index: 0, name: 'bash', active: false, flags: '' },
    ]);
  });

  it('handles multiple flag characters', () => {
    const stdout = '2: htop*Z (2 panes) [191x43] [layout cccc,191x43,0,0] @2 (active)\n';
    const result = parseWindows(stdout);
    expect(result[0].name).toBe('htop');
    expect(result[0].active).toBe(true);
  });
});

describe('listSessions', () => {
  it('executes tmux ls and returns parsed sessions', async () => {
    const execMock = vi.fn((cmd, cb) => cb(null, 'test: 1 windows (created Mon Jan  6 10:00:00 2025)\n', ''));
    const result = await listSessions(execMock);
    expect(execMock).toHaveBeenCalledWith('tmux ls', expect.any(Function));
    expect(result).toEqual([
      { name: 'test', windows: 1, created: 'Mon Jan  6 10:00:00 2025', attached: false },
    ]);
  });

  it('returns empty array when tmux has no server', async () => {
    const execMock = vi.fn((cmd, cb) => cb(new Error('exit 1'), '', 'no server running on /tmp/tmux-1000/default'));
    const result = await listSessions(execMock);
    expect(result).toEqual([]);
  });
});

describe('listWindows', () => {
  it('executes tmux list-windows for a session', async () => {
    const stdout = '0: bash* (1 panes) [80x24] [layout cccc,80x24,0,0] @0 (active)\n';
    const execMock = vi.fn((cmd, cb) => cb(null, stdout, ''));
    const result = await listWindows('main', execMock);
    expect(execMock).toHaveBeenCalledWith('tmux list-windows -t main', expect.any(Function));
    expect(result).toEqual([
      { index: 0, name: 'bash', active: true, flags: '*' },
    ]);
  });

  it('throws when session not found', async () => {
    const execMock = vi.fn((cmd, cb) => cb(new Error('exit 1'), '', "can't find session: nope"));
    await expect(listWindows('nope', execMock)).rejects.toThrow("can't find session");
  });
});
