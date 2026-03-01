import { describe, it, expect } from 'vitest';
import { KEYS, getKeySequence, TMUX_PREFIX_KEYS } from '../src/toolbar.js';

describe('KEYS mapping', () => {
  it('has Ctrl+b as \\x02', () => {
    expect(KEYS['Ctrl+b']).toBe('\x02');
  });

  it('has Esc as \\x1b', () => {
    expect(KEYS['Esc']).toBe('\x1b');
  });

  it('has Tab as \\t', () => {
    expect(KEYS['Tab']).toBe('\t');
  });

  it('has arrow keys as ANSI escape sequences', () => {
    expect(KEYS['↑']).toBe('\x1b[A');
    expect(KEYS['↓']).toBe('\x1b[B');
    expect(KEYS['→']).toBe('\x1b[C');
    expect(KEYS['←']).toBe('\x1b[D');
  });

  it('has PgUp and PgDn', () => {
    expect(KEYS['PgUp']).toBe('\x1b[5~');
    expect(KEYS['PgDn']).toBe('\x1b[6~');
  });

  it('has Ctrl+C as \\x03', () => {
    expect(KEYS['Ctrl+C']).toBe('\x03');
  });

  it('has Ctrl+D as \\x04', () => {
    expect(KEYS['Ctrl+D']).toBe('\x04');
  });

  it('has Ctrl+Z as \\x1a', () => {
    expect(KEYS['Ctrl+Z']).toBe('\x1a');
  });

  it('has Home and End', () => {
    expect(KEYS['Home']).toBe('\x1b[H');
    expect(KEYS['End']).toBe('\x1b[F');
  });
});

describe('getKeySequence', () => {
  it('returns the key sequence for a known key', () => {
    expect(getKeySequence('Ctrl+b')).toBe('\x02');
    expect(getKeySequence('↑')).toBe('\x1b[A');
  });

  it('returns the literal character for tmux prefix keys', () => {
    expect(getKeySequence('%')).toBe('%');
    expect(getKeySequence('"')).toBe('"');
    expect(getKeySequence('d')).toBe('d');
    expect(getKeySequence('n')).toBe('n');
    expect(getKeySequence('p')).toBe('p');
    expect(getKeySequence('[')).toBe('[');
  });

  it('returns undefined for unknown keys', () => {
    expect(getKeySequence('nonexistent')).toBeUndefined();
  });
});

describe('TMUX_PREFIX_KEYS', () => {
  it('contains expected tmux prefix keys', () => {
    expect(TMUX_PREFIX_KEYS).toContain('%');
    expect(TMUX_PREFIX_KEYS).toContain('"');
    expect(TMUX_PREFIX_KEYS).toContain('d');
    expect(TMUX_PREFIX_KEYS).toContain('n');
    expect(TMUX_PREFIX_KEYS).toContain('p');
    expect(TMUX_PREFIX_KEYS).toContain('[');
    expect(TMUX_PREFIX_KEYS).toContain(']');
    expect(TMUX_PREFIX_KEYS).toContain('c');
    expect(TMUX_PREFIX_KEYS).toContain('z');
  });
});
