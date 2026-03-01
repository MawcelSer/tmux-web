import { describe, it, expect, beforeEach } from 'vitest';
import { FontSizeManager, STORAGE_KEY, DEFAULT_SIZE, MIN_SIZE, MAX_SIZE } from '../src/font-size.js';

function mockStorage() {
  const store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => { store[key] = String(val); },
    _store: store,
  };
}

describe('FontSizeManager', () => {
  let storage;
  let mgr;

  beforeEach(() => {
    storage = mockStorage();
    mgr = new FontSizeManager(storage);
  });

  it('defaults to 14px', () => {
    expect(mgr.get()).toBe(14);
  });

  it('restores saved value from storage', () => {
    storage.setItem(STORAGE_KEY, '18');
    mgr = new FontSizeManager(storage);
    expect(mgr.get()).toBe(18);
  });

  it('ignores invalid storage value and uses default', () => {
    storage.setItem(STORAGE_KEY, 'garbage');
    mgr = new FontSizeManager(storage);
    expect(mgr.get()).toBe(DEFAULT_SIZE);
  });

  it('increase() adds 1px', () => {
    expect(mgr.increase()).toBe(15);
    expect(mgr.get()).toBe(15);
  });

  it('decrease() subtracts 1px', () => {
    expect(mgr.decrease()).toBe(13);
    expect(mgr.get()).toBe(13);
  });

  it('does not exceed MAX_SIZE (28)', () => {
    storage.setItem(STORAGE_KEY, String(MAX_SIZE));
    mgr = new FontSizeManager(storage);
    expect(mgr.increase()).toBe(MAX_SIZE);
  });

  it('does not go below MIN_SIZE (8)', () => {
    storage.setItem(STORAGE_KEY, String(MIN_SIZE));
    mgr = new FontSizeManager(storage);
    expect(mgr.decrease()).toBe(MIN_SIZE);
  });

  it('persists to localStorage on increase', () => {
    mgr.increase();
    expect(storage._store[STORAGE_KEY]).toBe('15');
  });

  it('persists to localStorage on decrease', () => {
    mgr.decrease();
    expect(storage._store[STORAGE_KEY]).toBe('13');
  });

  it('notifies listener on change', () => {
    const sizes = [];
    mgr.onChange((s) => sizes.push(s));
    mgr.increase();
    mgr.decrease();
    expect(sizes).toEqual([15, 14]);
  });

  it('set() clamps to valid range and persists', () => {
    mgr.set(5);
    expect(mgr.get()).toBe(MIN_SIZE);
    mgr.set(50);
    expect(mgr.get()).toBe(MAX_SIZE);
    mgr.set(20);
    expect(mgr.get()).toBe(20);
    expect(storage._store[STORAGE_KEY]).toBe('20');
  });
});

describe('constants', () => {
  it('has correct default values', () => {
    expect(STORAGE_KEY).toBe('tmuxweb:fontSize');
    expect(DEFAULT_SIZE).toBe(14);
    expect(MIN_SIZE).toBe(8);
    expect(MAX_SIZE).toBe(28);
  });
});
