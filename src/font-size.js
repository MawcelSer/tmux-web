export const STORAGE_KEY = 'tmuxweb:fontSize';
export const DEFAULT_SIZE = 14;
export const MIN_SIZE = 8;
export const MAX_SIZE = 28;

export class FontSizeManager {
  constructor(storage = localStorage) {
    this._storage = storage;
    this._listeners = [];
    const saved = parseInt(this._storage.getItem(STORAGE_KEY), 10);
    this._size = Number.isFinite(saved) ? this._clamp(saved) : DEFAULT_SIZE;
  }

  get() {
    return this._size;
  }

  set(size) {
    this._size = this._clamp(size);
    this._persist();
    this._notify();
    return this._size;
  }

  increase() {
    return this.set(this._size + 1);
  }

  decrease() {
    return this.set(this._size - 1);
  }

  onChange(cb) {
    this._listeners.push(cb);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== cb);
    };
  }

  _clamp(val) {
    return Math.max(MIN_SIZE, Math.min(MAX_SIZE, val));
  }

  _persist() {
    this._storage.setItem(STORAGE_KEY, String(this._size));
  }

  _notify() {
    for (const cb of this._listeners) cb(this._size);
  }
}
