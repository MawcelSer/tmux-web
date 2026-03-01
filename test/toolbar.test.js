import { describe, it, expect } from 'vitest';
import { KEYS, getKeySequence } from '../src/toolbar.js';

describe('KEYS mapping', () => {
  it('has ESC as \\x1b', () => {
    expect(KEYS['ESC']).toBe('\x1b');
  });

  it('has TAB as \\t', () => {
    expect(KEYS['TAB']).toBe('\t');
  });

  it('has arrow keys as ANSI escape sequences', () => {
    expect(KEYS['↑']).toBe('\x1b[A');
    expect(KEYS['↓']).toBe('\x1b[B');
    expect(KEYS['→']).toBe('\x1b[C');
    expect(KEYS['←']).toBe('\x1b[D');
  });

  it('has PGUP and PGDN', () => {
    expect(KEYS['PGUP']).toBe('\x1b[5~');
    expect(KEYS['PGDN']).toBe('\x1b[6~');
  });

  it('has HOME and END', () => {
    expect(KEYS['HOME']).toBe('\x1b[H');
    expect(KEYS['END']).toBe('\x1b[F');
  });

  it('has special characters as literals', () => {
    expect(KEYS['-']).toBe('-');
    expect(KEYS['/']).toBe('/');
    expect(KEYS['|']).toBe('|');
    expect(KEYS['_']).toBe('_');
    expect(KEYS['~']).toBe('~');
  });
});

describe('getKeySequence', () => {
  it('returns the sequence for known keys', () => {
    expect(getKeySequence('ESC')).toBe('\x1b');
    expect(getKeySequence('↑')).toBe('\x1b[A');
    expect(getKeySequence('HOME')).toBe('\x1b[H');
    expect(getKeySequence('-')).toBe('-');
  });

  it('returns undefined for unknown keys', () => {
    expect(getKeySequence('nonexistent')).toBeUndefined();
  });
});
