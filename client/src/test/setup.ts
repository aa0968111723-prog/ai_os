import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Node 22 exposes an experimental `globalThis.localStorage` getter that warns
// unless --localstorage-file is provided. A tiny in-memory browser-compatible
// implementation keeps jsdom tests deterministic without touching disk.
class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

const testLocalStorage = new MemoryStorage();
const testSessionStorage = new MemoryStorage();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: testLocalStorage,
});
Object.defineProperty(window, "sessionStorage", {
  configurable: true,
  value: testSessionStorage,
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: testLocalStorage,
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: testSessionStorage,
});

afterEach(() => {
  cleanup();
  testLocalStorage.clear();
  testSessionStorage.clear();
});
