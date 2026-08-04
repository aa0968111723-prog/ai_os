import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPublicHostOrError,
  extractKindOf,
  extractTextFromBuffer,
  formatBytes,
  htmlToText,
  isPrivateIp,
  MAX_EXTRACT_BYTES,
  normalizeImportUrl,
  notionPageIdFromUrl,
  ssrfGuardError,
  subtitleToText,
} from "./databaseFiles";

describe("htmlToText", () => {
  it("去 script/style、保留段落、解碼實體", () => {
    const html = `<html><head><title>t</title><style>.a{}</style></head>
      <body><script>alert(1)</script><h1>標題</h1><p>第一段&nbsp;&amp; more</p><ul><li>甲</li><li>乙</li></ul></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("標題");
    expect(text).toContain("第一段 & more");
    expect(text).toContain("甲");
    expect(text).not.toContain("alert");
    expect(text).not.toContain(".a{}");
    expect(text).not.toContain("<p>");
  });

  it("病態輸入不會卡死事件迴圈：大量『<』無『>』於毫秒級完成（修 htmltotext ReDoS）", () => {
    // 原 <[^>]+> 對此輸入呈 O(n²) 回溯；有界標籤長度後退化為線性。5MB 全 '<' 應瞬間完成。
    const evil = "<".repeat(5_000_000);
    const t0 = Date.now();
    const out = htmlToText(evil);
    expect(Date.now() - t0).toBeLessThan(2000); // 線性化後遠低於此；退化成 O(n²) 會遠超
    expect(typeof out).toBe("string");
  });

  it("超大輸入先截斷到上限（防事件迴圈被攻擊者 HTML 同步卡死）", () => {
    const huge = "文" + "x".repeat(6_000_000); // > HTML_TO_TEXT_MAX_CHARS(3M)
    const out = htmlToText(huge);
    expect(out.length).toBeLessThanOrEqual(3_000_001);
  });
});

describe("subtitleToText", () => {
  it("SRT：去序號與時間軸只留台詞", () => {
    const srt = "1\n00:00:01,000 --> 00:00:03,000\n師父開示第一句\n\n2\n00:00:03,500 --> 00:00:05,000\n第二句";
    expect(subtitleToText(srt)).toBe("師父開示第一句\n第二句");
  });
  it("VTT：去 WEBVTT 頭", () => {
    const vtt = "WEBVTT\n\n00:01.000 --> 00:04.000\n哈囉";
    expect(subtitleToText(vtt)).toBe("哈囉");
  });
});

describe("extractKindOf", () => {
  it("mime 與副檔名雙後備", () => {
    expect(extractKindOf("text/plain", "a.txt")).toBe("text");
    expect(extractKindOf("application/octet-stream", "逐字稿.md")).toBe("text");
    expect(extractKindOf("application/pdf", "a.pdf")).toBe("pdf");
    expect(extractKindOf("application/octet-stream", "a.docx")).toBe("docx");
    expect(extractKindOf("text/html", "page")).toBe("html");
    expect(extractKindOf("application/octet-stream", "sub.srt")).toBe("subtitle");
    expect(extractKindOf("image/png", "a.png")).toBeNull();
    expect(extractKindOf("video/mp4", "a.mp4")).toBeNull();
  });
});

describe("ssrfGuardError", () => {
  it("放行公開網址", () => {
    expect(ssrfGuardError("https://docs.google.com/document/d/abc/edit")).toBeNull();
    expect(ssrfGuardError("http://example.com/a.txt")).toBeNull();
  });
  it("擋非 http(s) 協定", () => {
    expect(ssrfGuardError("file:///etc/passwd")).toContain("http");
    expect(ssrfGuardError("gopher://x")).toContain("http");
    expect(ssrfGuardError("not a url")).toContain("格式");
  });
  it("擋 localhost 與私有網段字面位址", () => {
    for (const bad of [
      "http://localhost:3000/api",
      "http://127.0.0.1/x",
      "http://10.1.2.3/x",
      "http://192.168.1.1/x",
      "http://172.16.0.1/x",
      "http://172.31.255.255/x",
      "http://169.254.169.254/latest/meta-data",
      "http://100.100.1.1/x",
      "http://0.0.0.0/x",
      "http://[::1]/x",
      "http://[fd00::1]/x",
      "http://[fe80::1]/x",
      "http://db.internal/x",
    ]) {
      expect(ssrfGuardError(bad), bad).toContain("內部");
    }
    // 邊界外的合法位址要放行（172.32 不是私有段）
    expect(ssrfGuardError("http://172.32.0.1/x")).toBeNull();
  });
  it("擋非點分十進位的數字型主機名（整數/十六進位/缺段 IP 寫法）", () => {
    expect(ssrfGuardError("http://2130706433/x")).toContain("內部");   // = 127.0.0.1 的整數寫法
    expect(ssrfGuardError("http://0x7f000001/x")).toContain("內部");   // 十六進位
    expect(ssrfGuardError("http://127.1/x")).toContain("內部");        // 缺段
    expect(ssrfGuardError("http://10.0.1/x")).toContain("內部");
  });

  // TD-04：滲透回歸——metadata 與常見 rebinding 字面型必須擋
  it("擋雲端 metadata 與 .local/.internal 字面", () => {
    expect(ssrfGuardError("http://169.254.169.254/latest/meta-data/")).toContain("內部");
    expect(ssrfGuardError("http://metadata.google.internal/")).toContain("內部");
    expect(ssrfGuardError("http://something.local/secret")).toContain("內部");
  });
});

describe("isPrivateIp（SSRF 權威判準：DNS 解析後逐一 IP 檢查）", () => {
  it("擋 IPv4 私有／保留段（含雲端 metadata 169.254.169.254、CGNAT、0/8）", () => {
    for (const ip of [
      "127.0.0.1", "10.0.0.1", "10.255.255.255", "192.168.0.1",
      "172.16.0.1", "172.31.255.255", "169.254.169.254", "100.64.0.1",
      "100.127.255.255", "0.0.0.0",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it("擋 IPv6 loopback／ULA／link-local 與 IPv4-mapped 形式", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it("放行公開位址（IPv4 與 IPv6）", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.63.255.255", "93.184.216.34", "2606:2800:220:1::1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
  it("解析後涵蓋所有奇異數字寫法（getaddrinfo 正規化後就是這些真實 IP）", () => {
    // 這些主機字串本身繞得過字面字串檢查，但經 DNS/getaddrinfo 正規化後就是內部 IP，
    // 由 isPrivateIp 在「解析後」一律擋下——這是本次修補的核心不變式。
    expect(isPrivateIp("127.0.0.1")).toBe(true); // 0x7f.0.0.1 / 2130706433 / 127.1 皆解析成此
  });
});

describe("normalizeImportUrl", () => {
  it("Google 文件 → txt 匯出", () => {
    const n = normalizeImportUrl("https://docs.google.com/document/d/1AbC_-xyz/edit?usp=sharing");
    expect(n.kind).toBe("google-doc");
    expect(n.fetchUrl).toBe("https://docs.google.com/document/d/1AbC_-xyz/export?format=txt");
  });
  it("Google 試算表 → csv 匯出；簡報 → txt 匯出", () => {
    expect(normalizeImportUrl("https://docs.google.com/spreadsheets/d/SHEET1/edit#gid=0").fetchUrl)
      .toBe("https://docs.google.com/spreadsheets/d/SHEET1/export?format=csv");
    expect(normalizeImportUrl("https://docs.google.com/presentation/d/SLIDE/edit").fetchUrl)
      .toBe("https://docs.google.com/presentation/d/SLIDE/export/txt");
  });
  it("雲端硬碟檔案 → uc 直載；Notion → notion；其他 → web", () => {
    expect(normalizeImportUrl("https://drive.google.com/file/d/FILE9/view?usp=sharing").fetchUrl)
      .toBe("https://drive.google.com/uc?export=download&id=FILE9");
    expect(normalizeImportUrl("https://www.notion.so/team/Page-0123456789abcdef0123456789abcdef").kind).toBe("notion");
    expect(normalizeImportUrl("https://acme.notion.site/Page-0123456789abcdef0123456789abcdef").kind).toBe("notion");
    expect(normalizeImportUrl("https://example.com/blog").kind).toBe("web");
  });
});

describe("notionPageIdFromUrl", () => {
  it("路徑尾 32 碼 hex → 加連字號的 uuid", () => {
    expect(notionPageIdFromUrl("https://www.notion.so/team/My-Page-0123456789abcdef0123456789abcdef"))
      .toBe("01234567-89ab-cdef-0123-456789abcdef");
    expect(notionPageIdFromUrl("https://www.notion.so/no-id-here")).toBeNull();
  });
});

describe("formatBytes", () => {
  it("人話容量", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.00 GB");
  });
});

/* ── SSRF 權威防線：assertPublicHostOrError（含代理模式修法） ── */
const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] as const;
const savedProxy: Record<string, string | undefined> = {};
for (const k of PROXY_KEYS) savedProxy[k] = process.env[k];
function clearProxy(): void { for (const k of PROXY_KEYS) delete process.env[k]; }
function restoreProxy(): void {
  for (const k of PROXY_KEYS) { if (savedProxy[k] === undefined) delete process.env[k]; else process.env[k] = savedProxy[k]; }
}

describe("assertPublicHostOrError：DNS 解析後判內網（SSRF 權威防線）", () => {
  afterEach(restoreProxy);

  it("字面內網 IP 一律擋（直連模式）", async () => {
    clearProxy();
    expect(await assertPublicHostOrError("127.0.0.1")).toBe("不能匯入內部網址");
  });

  it("★安全修法：設了出口代理時，解析得到的內網 IP 仍要擋（舊版一律放行＝破口）", async () => {
    clearProxy();
    process.env.HTTPS_PROXY = "http://egress-proxy.internal:3128";
    // 127.0.0.1 為字面 IP，getaddrinfo 直接回傳自身（離線可判），代理模式下也必須被擋
    expect(await assertPublicHostOrError("127.0.0.1")).toBe("不能匯入內部網址");
  });

  it("代理模式下本機解不到的名稱 → 放行交給代理（不誤擋正常匯入）", async () => {
    clearProxy();
    process.env.HTTPS_PROXY = "http://egress-proxy.internal:3128";
    // .invalid 為 RFC 保留、永不解析 → dnsLookup 拋錯 → 代理模式回 null（委派出口代理）
    expect(await assertPublicHostOrError("nonexistent-host.invalid")).toBeNull();
  });

  it("直連模式下解不到的名稱 → 回錯誤（不是放行）", async () => {
    clearProxy();
    expect(await assertPublicHostOrError("nonexistent-host.invalid")).toBe("無法解析這個網址的主機（DNS 查詢失敗）");
  });
});

/* ── 文字抽取的隔離守門（解壓縮/CPU 炸彈 DoS 防護，見 extractInWorker） ── */
describe("extractTextFromBuffer：安全降級", () => {
  it("超過抽取上限的檔案 → 回 null（不進解析器，避免記憶體壓力）", async () => {
    const oversized = Buffer.alloc(MAX_EXTRACT_BYTES + 1);
    expect(await extractTextFromBuffer("application/pdf", "big.pdf", oversized)).toBeNull();
  });

  it("損壞的 pdf → worker 內解析失敗優雅回 null，主程序不受影響", async () => {
    expect(await extractTextFromBuffer("application/pdf", "x.pdf", Buffer.from("not a real pdf"))).toBeNull();
  }, 15_000);

  it("純文字走行內路徑（不進 worker），正常抽出", async () => {
    expect(await extractTextFromBuffer("text/plain", "x.txt", Buffer.from("hello 世界"))).toBe("hello 世界");
  });
});

/**
 * refreshFile 呼叫端守衛（routers/databases.ts）：
 * 與 importUrl 對齊——Google 登入頁 HTML 不覆寫既有內容；抽字為空也不靜默清空。
 */
describe("refreshFile caller guards (databases router source)", () => {
  const routerSource = readFileSync(new URL("../routers/databases.ts", import.meta.url), "utf8");
  // 只取 refreshFile 段：從 refreshFile: 到下一個 removeFile:（避免 importUrl 同句誤過）
  const refreshStart = routerSource.indexOf("refreshFile:");
  const refreshEnd = routerSource.indexOf("removeFile:", refreshStart);
  const refreshSource =
    refreshStart >= 0 && refreshEnd > refreshStart
      ? routerSource.slice(refreshStart, refreshEnd)
      : "";

  it("blocks Google login HTML for export kinds without overwriting existing content", () => {
    expect(refreshSource).toContain("expectsExport");
    expect(refreshSource).toContain('fetched.mime === "text/html"');
    expect(refreshSource).toContain("Google 回了登入頁");
    // 拋錯發生在寫入（updateDataFileSizeUnderQuota / 舊 db.update）之前，不得覆寫既有 textContent
    const writeAt = Math.max(
      refreshSource.indexOf("updateDataFileSizeUnderQuota"),
      refreshSource.indexOf("db.update"),
    );
    expect(writeAt).toBeGreaterThan(0);
    expect(refreshSource.indexOf("Google 回了登入頁")).toBeLessThan(writeAt);
  });

  it("throws on empty extracted HTML text with the same message as importUrl", () => {
    expect(refreshSource).toContain("這個網頁抓不到可讀文字（可能是純前端渲染的頁面）——試試該平台的匯出功能後上傳");
    expect(refreshSource).toMatch(/if \(!text\)[\s\S]*抓不到可讀文字/);
    const writeAt = Math.max(
      refreshSource.indexOf("updateDataFileSizeUnderQuota"),
      refreshSource.indexOf("db.update"),
    );
    expect(writeAt).toBeGreaterThan(0);
    expect(refreshSource.indexOf("抓不到可讀文字")).toBeLessThan(writeAt);
  });
});

