import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decryptSecret,
  drivePickedImportShape,
  encryptSecret,
  escapeDriveQueryTerm,
  notionPageTitle,
  resolveApiUrl,
  sanitizeIntegrationReturnTo,
  signIntegrationState,
  signIntegrationStateAt,
  validateApiConnectionInput,
  verifyIntegrationState,
} from "./integrations";
import { normalizeImportUrl } from "./databaseFiles";

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

/**
 * 授權完成後回到原本的「加入資料」流程（資料中心 P2 / Golden Path 1）。
 * 這條路徑同時是 open redirect 的風險面——回跳目的地必須被簽章綁住且限制在站內。
 */
describe("OAuth returnTo（回到原本的加入資料流程）", () => {
  it("簽進 state 的站內路徑可以原樣驗回", () => {
    const state = signIntegrationState("user-123", "/p/abc?add=google-drive");
    expect(verifyIntegrationState(state)).toEqual({
      userId: "user-123",
      returnTo: "/p/abc?add=google-drive",
    });
  });

  it("沒帶 returnTo 時為 null（不是空字串）", () => {
    expect(verifyIntegrationState(signIntegrationState("user-123"))?.returnTo).toBeNull();
  });

  it("★ 擋下 open redirect：外站網址、協定相對網址、反斜線變形一律丟掉", () => {
    for (const evil of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "javascript:alert(1)",
      "evil.com",
      "",
    ]) {
      expect(sanitizeIntegrationReturnTo(evil)).toBeNull();
      // 就算硬塞進簽發，驗回來也拿不到——兩端都過白名單
      expect(verifyIntegrationState(signIntegrationState("user-123", evil))?.returnTo).toBeNull();
    }
  });

  it("★ 控制字元與空白一律丟掉（瀏覽器會先剝掉再解析，剝完可能變成 //evil.com）", () => {
    expect(sanitizeIntegrationReturnTo("/\u0000/evil")).toBeNull();
    expect(sanitizeIntegrationReturnTo("/\n/evil")).toBeNull();
    expect(sanitizeIntegrationReturnTo("/ /evil")).toBeNull();
  });

  it("過長路徑丟掉（state 不當成夾帶通道）", () => {
    expect(sanitizeIntegrationReturnTo(`/${"a".repeat(600)}`)).toBeNull();
  });

  it("★ returnTo 被竄改後整個 state 驗不過（不是只忽略那一段）", () => {
    const state = signIntegrationState("user-123", "/databases");
    const [payload, sig] = state.split(".");
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const tampered = Buffer.from(decoded.replace("%2Fdatabases", "%2F%2Fevil.com")).toString("base64url");
    expect(verifyIntegrationState(`${tampered}.${sig}`)).toBeNull();
  });

  it("舊格式 state（沒有第三段）仍驗得過——升版不會讓授權中的使用者卡住", () => {
    const legacy = signIntegrationStateAt("user-123", Date.now() + 60_000);
    expect(verifyIntegrationState(legacy)).toEqual({ userId: "user-123", returnTo: null });
  });

  it("合法的站內路徑（含 hash 與查詢字串）保留", () => {
    expect(sanitizeIntegrationReturnTo("/p/abc#sec-knowledge")).toBe("/p/abc#sec-knowledge");
    expect(sanitizeIntegrationReturnTo("/databases?open=x&add=1")).toBe("/databases?open=x&add=1");
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

describe("escapeDriveQueryTerm（選檔搜尋跳脫）", () => {
  it("跳脫單引號與反斜線，其他字元原樣", () => {
    expect(escapeDriveQueryTerm("週報 'draft'")).toBe("週報 \\'draft\\'");
    expect(escapeDriveQueryTerm("a\\b")).toBe("a\\\\b");
    expect(escapeDriveQueryTerm("普通檔名")).toBe("普通檔名");
  });
  it("搜尋詞無法注入 Drive 查詢語法（不存在未跳脫的引號）", () => {
    const escaped = escapeDriveQueryTerm("x' or name contains 'y");
    expect(escaped).not.toMatch(/(^|[^\\])'/);
  });
});

describe("drivePickedImportShape（選檔 → 匯入形狀）", () => {
  it("Google 原生文件／試算表／簡報對映匯出類型", () => {
    expect(drivePickedImportShape("f1", "application/vnd.google-apps.document")?.kind).toBe("google-doc");
    expect(drivePickedImportShape("f1", "application/vnd.google-apps.spreadsheet")?.kind).toBe("google-sheet");
    expect(drivePickedImportShape("f1", "application/vnd.google-apps.presentation")?.kind).toBe("google-slides");
  });
  it("一般檔案（pdf/txt/圖片）走 google-drive 直載", () => {
    expect(drivePickedImportShape("f1", "application/pdf")?.kind).toBe("google-drive");
    expect(drivePickedImportShape("f1", "text/plain")?.kind).toBe("google-drive");
  });
  it("其餘 Google 原生類型（資料夾／表單）不可匯入", () => {
    expect(drivePickedImportShape("f1", "application/vnd.google-apps.folder")).toBeNull();
    expect(drivePickedImportShape("f1", "application/vnd.google-apps.form")).toBeNull();
  });
  it("sourceUrl 能被 normalizeImportUrl 解回同一 kind 與 fileId——重新整理沿用既有 Google 路徑", () => {
    for (const mime of [
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.spreadsheet",
      "application/vnd.google-apps.presentation",
      "application/pdf",
    ]) {
      const shape = drivePickedImportShape("abc_DEF-123", mime);
      expect(shape).not.toBeNull();
      const normalized = normalizeImportUrl(shape!.sourceUrl);
      expect(normalized.kind).toBe(shape!.kind);
      expect(normalized.fileId).toBe("abc_DEF-123");
    }
  });
});

describe("notionPageTitle（選頁標題解析）", () => {
  it("走 title 型 property 的 plain_text 串接", () => {
    expect(notionPageTitle({
      properties: {
        Name: { type: "title", title: [{ plain_text: "劇本" }, { plain_text: "初稿" }] },
        Status: { type: "select" },
      },
    })).toBe("劇本初稿");
  });
  it("沒有 title property 或空標題給替代字，不拋錯", () => {
    expect(notionPageTitle({})).toBe("（未命名頁面）");
    expect(notionPageTitle({ properties: { Name: { type: "title", title: [] } } })).toBe("（未命名頁面）");
  });
  it("超長標題截到 120 字", () => {
    const title = notionPageTitle({
      properties: { Name: { type: "title", title: [{ plain_text: "長".repeat(200) }] } },
    });
    expect(title.length).toBe(120);
  });

  // 迴歸：資料庫標題在頂層 title 陣列，properties 的 title 欄只是「欄位定義」（值是 {}）——
  // 只掃 properties 會讓每一個資料庫都變成「未命名」
  it("資料庫走頂層 title 陣列，不會被欄位定義騙成未命名", () => {
    expect(notionPageTitle({
      object: "database",
      title: [{ plain_text: "影片" }, { plain_text: "進度表" }],
      properties: { Name: { type: "title" } },
    })).toBe("影片進度表");
  });

  it("沒有標題的資料庫給資料庫專屬替代字", () => {
    expect(notionPageTitle({ object: "database", title: [] })).toBe("（未命名資料庫）");
  });
});
