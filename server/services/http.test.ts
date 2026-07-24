/**
 * shouldBypass（NO_PROXY 網域邊界比對）單元測試。
 * 安全重點：舊版純 host.endsWith(entry) 讓 NO_PROXY=example.com 也匹配 evil-example.com，
 * 使該主機「繞過出口代理直連」——是規避出口控管的破口。修法要求「完全相等」或「.entry 結尾」。
 */
import { afterEach, describe, expect, it } from "vitest";
import { shouldBypass } from "./http";

const ORIG = process.env.NO_PROXY;
afterEach(() => {
  if (ORIG === undefined) delete process.env.NO_PROXY;
  else process.env.NO_PROXY = ORIG;
  delete process.env.no_proxy;
});

describe("shouldBypass：localhost 一律繞過代理", () => {
  it("localhost／127.0.0.1／::1", () => {
    delete process.env.NO_PROXY;
    expect(shouldBypass("http://localhost/x")).toBe(true);
    expect(shouldBypass("http://127.0.0.1:3000/x")).toBe(true);
    expect(shouldBypass("http://[::1]/x")).toBe(true);
  });
});

describe("shouldBypass：NO_PROXY 網域邊界（安全關鍵）", () => {
  it("完全相等或子網域才繞過", () => {
    process.env.NO_PROXY = "example.com";
    expect(shouldBypass("https://example.com/a")).toBe(true);
    expect(shouldBypass("https://api.example.com/a")).toBe(true); // 子網域
  });

  it("同尾綴的不同網域「不」繞過（舊版 endsWith 破口）", () => {
    process.env.NO_PROXY = "example.com";
    expect(shouldBypass("https://evil-example.com/a")).toBe(false);
    expect(shouldBypass("https://notexample.com/a")).toBe(false);
    expect(shouldBypass("https://example.com.attacker.net/a")).toBe(false);
  });

  it("前導點視為同義（.example.com == example.com）", () => {
    process.env.NO_PROXY = ".example.com";
    expect(shouldBypass("https://example.com/a")).toBe(true);
    expect(shouldBypass("https://api.example.com/a")).toBe(true);
    expect(shouldBypass("https://evil-example.com/a")).toBe(false);
  });

  it("多項清單、大小寫無關、空項忽略", () => {
    process.env.NO_PROXY = "foo.test, ,EXAMPLE.com";
    expect(shouldBypass("https://EXAMPLE.COM/a")).toBe(true);
    expect(shouldBypass("https://foo.test/a")).toBe(true);
    expect(shouldBypass("https://other.net/a")).toBe(false);
  });

  it("未設 NO_PROXY 時非 localhost 一律不繞過", () => {
    delete process.env.NO_PROXY;
    expect(shouldBypass("https://example.com/a")).toBe(false);
  });

  it("畸形網址不炸、回 false", () => {
    process.env.NO_PROXY = "example.com";
    expect(shouldBypass("not a url")).toBe(false);
  });
});
