import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyFetchMock = vi.hoisted(() => vi.fn());

vi.mock("./http", () => ({
  proxyFetch: proxyFetchMock,
}));

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
import {
  fetchImport,
  isNotionHost,
  normalizeImportUrl,
  notionPageIdFromUrl,
} from "./databaseFiles";

const PAGE_ID = "01234567-89ab-cdef-0123-456789abcdef";
const COMPACT_PAGE_ID = "0123456789abcdef0123456789abcdef";

describe("isNotionHost", () => {
  it.each([
    "notion.so",
    "www.notion.so",
    "acme.notion.so",
    "notion.com",
    "www.notion.com",
    "app.notion.com",
    "notion.site",
    "acme.notion.site",
  ])("辨識 Notion 官方網域與子網域：%s", (host) => {
    expect(isNotionHost(host)).toBe(true);
  });

  it.each([
    "fake-notion.com",
    "notion.com.example.com",
    "notion.so.example.org",
    "example.com",
  ])("不誤判相似或尾隨網域：%s", (host) => {
    expect(isNotionHost(host)).toBe(false);
  });
});

describe("normalizeImportUrl（Notion）", () => {
  it.each([
    `https://app.notion.com/p/Ai-${COMPACT_PAGE_ID}?source=copy_link#section`,
    `https://www.notion.com/Page-${COMPACT_PAGE_ID}?pvs=4`,
    `https://acme.notion.site/Page-${COMPACT_PAGE_ID}?v=abc`,
    `https://acme.notion.so/Page-${COMPACT_PAGE_ID}`,
  ])("所有 Notion 連結都固定走官方 API：%s", (url) => {
    const normalized = normalizeImportUrl(url);
    expect(normalized.kind).toBe("notion");
    expect(normalized.fetchUrl).not.toContain("?");
    expect(normalized.fetchUrl).not.toContain("#");
  });

  it("相似網域仍走一般 web 路徑", () => {
    expect(normalizeImportUrl(`https://notion.com.example.com/Page-${COMPACT_PAGE_ID}`).kind).toBe("web");
  });
});

describe("notionPageIdFromUrl", () => {
  it.each([
    `https://www.notion.so/team/My-Page-${COMPACT_PAGE_ID}`,
    `https://app.notion.com/p/Ai-${COMPACT_PAGE_ID}?source=copy_link`,
    `https://www.notion.com/Page-${COMPACT_PAGE_ID}?pvs=4`,
    `https://acme.notion.site/Page-${COMPACT_PAGE_ID}`,
    `https://notion.so/${PAGE_ID}`,
  ])("解析常見 Notion URL 變體：%s", (url) => {
    expect(notionPageIdFromUrl(url)).toBe(PAGE_ID);
  });

  it("沒有 Page ID 時回 null", () => {
    expect(notionPageIdFromUrl("https://app.notion.com/p/no-id-here")).toBeNull();
  });

  it("非 Notion 網域即使含 32 碼 ID 也回 null", () => {
    expect(notionPageIdFromUrl(`https://example.com/${COMPACT_PAGE_ID}`)).toBeNull();
  });
});

describe("fetchImport（Notion 防回退）", () => {
  beforeEach(() => {
    proxyFetchMock.mockReset();
  });

  it("Notion URL 不可進入一般網頁爬取流程", async () => {
    await expect(
      fetchImport(`https://app.notion.com/p/Ai-${COMPACT_PAGE_ID}?source=copy_link`),
    ).rejects.toThrow("必須透過官方 API");
    expect(proxyFetchMock).not.toHaveBeenCalled();
  });

  it("一般短網址重導到 Notion 時，在抓取目標前阻擋", async () => {
    proxyFetchMock.mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: {
        location: `https://app.notion.com/p/Ai-${COMPACT_PAGE_ID}?source=copy_link`,
      },
    }));

    await expect(fetchImport("https://example.com/notion-short-link"))
      .rejects.toThrow("必須透過官方 API");

    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
    expect(proxyFetchMock).toHaveBeenCalledWith(
      "https://example.com/notion-short-link",
      expect.objectContaining({ redirect: "manual" }),
    );
  });
});
