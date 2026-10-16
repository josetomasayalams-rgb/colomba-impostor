import { sha256 } from '@noble/hashes/sha2.js';
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export const hash = value => hex(sha256(new TextEncoder().encode(value)));
export const randomToken = length => hex(crypto.getRandomValues(new Uint8Array(length)));
export const randomUUID = () => crypto.randomUUID();
export function randomInt(max) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 0xffffffff) throw new RangeError('Invalid random range');
  const cutoff = Math.floor(0x100000000 / max) * max;
  let n;
  do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= cutoff);
  return n % max;
}
export class Signal {
  #listeners = new Map();
  on(type, fn) { const listeners = this.#listeners.get(type) ?? new Set(); listeners.add(fn); this.#listeners.set(type, listeners); return this; }
  off(type, fn) { this.#listeners.get(type)?.delete(fn); return this; }
  emit(type, ...args) { for (const fn of this.#listeners.get(type) ?? []) fn(...args); }
}
