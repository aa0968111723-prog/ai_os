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

// jsdom 沒有實作 Element.prototype.scrollIntoView（沒有版面配置就沒有捲動）。
// 元件在 setTimeout 裡呼叫它時，例外會落在測試的斷言之外——測試全綠、vitest 卻
// 以「unhandled error」非零退出，CI 紅掉但看不出哪個測試壞了。補一個 no-op 樁，
// 讓「捲到可視範圍」這種純視覺副作用在 jsdom 下安靜略過。
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

afterEach(() => {
  cleanup();
  testLocalStorage.clear();
  testSessionStorage.clear();
});
