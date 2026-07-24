import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  resolveApiUrl,
  signIntegrationState,
  signIntegrationStateAt,
  validateApiConnectionInput,
  verifyIntegrationState,
} from "./integrations";

// 金鑰種子固定走環境變數：測試不落 Volume 金鑰檔
beforeAll(() => { process.env.INTEGRATION_TOKEN_SECRET = "test-secret-for-vitest"; });
afterAll(() => { delete process.env.INTEGRATION_TOKEN_SECRET; });

describe("encryptSecret / decryptSecret", () => {
  it("roundtrip：加密後可解回原文，且每次密文不同（隨機 iv）", () => {
    const secret = "ntn_abc123中文もOK";
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(secret);
    expect(decryptSecret(b)).toBe(secret);
  });
  it("竄改密文即拋錯（GCM 認證標籤）", () => {
    const enc = encryptSecret("hello");
    const [iv, tag, data] = enc.split(":");
    const flipped = data.slice(0, -1) + (data.endsWith("0") ? "1" : "0");
    expect(() => decryptSecret(`${iv}:${tag}:${flipped}`)).toThrow();
  });
  it("格式錯誤即拋錯", () => {
    expect(() => decryptSecret("not-a-valid-blob")).toThrow();
  });
});

describe("OAuth state（HMAC 簽章）", () => {
  it("簽發後可驗回 userId；竄改即失敗", () => {
    const state = signIntegrationState("user-123");
    expect(verifyIntegrationState(state)?.userId).toBe("user-123");
    expect(verifyIntegrationState(state + "x")).toBeNull();
    expect(verifyIntegrationState("aaaa.bbbb")).toBeNull();
    expect(verifyIntegrationState("")).toBeNull();
  });
  it("過期 state 驗證失敗（簽章正確但已過期，真正觸發 TTL 檢查）", () => {
    // signIntegrationStateAt 讓我們造出「簽章正確、但到期時刻在過去」的樣本——
    // 驗簽會過，被 verifyIntegrationState 的 Number(expStr) < Date.now() 擋下
    const expired = signIntegrationStateAt("user-123", Date.now() - 1000);
    expect(verifyIntegrationState(expired)).toBeNull();
    // 對照：尚未到期的可通過
    const valid = signIntegrationStateAt("user-123", Date.now() + 60_000);
    expect(verifyIntegrationState(valid)?.userId).toBe("user-123");
  });
});

describe("validateApiConnectionInput", () => {
  const ok = { name: "總會 Airtable", baseUrl: "https://api.airtable.com/v0/app123", secret: "Bearer pat123" };
  it("合法輸入通過", () => {
    expect(validateApiConnectionInput(ok)).toBeNull();
    expect(validateApiConnectionInput({ ...ok, headerName: "X-Api-Key" })).toBeNull();
  });
  it("http 明文擋下（憑證不能走明文）", () => {
    expect(validateApiConnectionInput({ ...ok, baseUrl: "http://api.example.com" })).toContain("https");
  });
  it("內部位址擋下（SSRF）", () => {
    expect(validateApiConnectionInput({ ...ok, baseUrl: "https://192.168.1.10/api" })).toContain("內部");
    expect(validateApiConnectionInput({ ...ok, baseUrl: "https://localhost/api" })).toContain("內部");
  });
  it("危險/畸形標頭名擋下", () => {
    expect(validateApiConnectionInput({ ...ok, headerName: "Host" })).toContain("Host");
    expect(validateApiConnectionInput({ ...ok, headerName: "X Api Key" })).toContain("標頭");
    expect(validateApiConnectionInput({ ...ok, headerName: "Cookie" })).toContain("Cookie");
  });
  it("金鑰含換行（標頭注入）擋下", () => {
    expect(validateApiConnectionInput({ ...ok, secret: "abc\r\nX-Evil: 1" })).toContain("金鑰");
  });
});

describe("resolveApiUrl（憑證固定同源）", () => {
  const base = "https://api.airtable.com/v0/app123";
  it("空路徑＝基底本身；相對路徑與查詢字串照拼", () => {
    expect(resolveApiUrl(base, "")).toBe(base);
    expect(resolveApiUrl(base, "rows")).toBe("https://api.airtable.com/v0/app123/rows");
    expect(resolveApiUrl(base, "?limit=5")).toBe("https://api.airtable.com/v0/app123?limit=5");
    expect(resolveApiUrl(base, "/v0/app123/tbl?x=1")).toBe("https://api.airtable.com/v0/app123/tbl?x=1");
  });
  it("同源完整網址可用；跨主機一律擋（含 //host 與絕對網址）", () => {
    expect(resolveApiUrl(base, "https://api.airtable.com/v0/other")).toBe("https://api.airtable.com/v0/other");
    expect(() => resolveApiUrl(base, "https://evil.com/steal")).toThrow(/基底網址/);
    expect(() => resolveApiUrl(base, "//evil.com/steal")).toThrow(/基底網址/);
  });
  it("跨埠／換協定視為不同源", () => {
    expect(() => resolveApiUrl(base, "https://api.airtable.com:8443/x")).toThrow(/基底網址/);
  });
});
