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
  fetchNotionText,
  isNotionHost,
  normalizeImportUrl,
  notionPageIdFromUrl,
  notionPropertyText,
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

describe("notionPropertyText（資料庫欄位值 → 文字）", () => {
  it.each([
    [{ type: "title", title: [{ plain_text: "第一集" }] }, "第一集"],
    [{ type: "rich_text", rich_text: [{ plain_text: "備註" }] }, "備註"],
    [{ type: "number", number: 0 }, "0"],
    [{ type: "select", select: { name: "拍攝中" } }, "拍攝中"],
    [{ type: "status", status: { name: "完成" } }, "完成"],
    [{ type: "multi_select", multi_select: [{ name: "禪" }, { name: "剪輯" }] }, "禪、剪輯"],
    [{ type: "date", date: { start: "2026-01-01", end: "2026-01-05" } }, "2026-01-01 ~ 2026-01-05"],
    [{ type: "checkbox", checkbox: true }, "是"],
    [{ type: "checkbox", checkbox: false }, "否"],
    [{ type: "url", url: "https://example.com" }, "https://example.com"],
    [{ type: "people", people: [{ name: "小明" }] }, "小明"],
    [{ type: "unique_id", unique_id: { prefix: "VID", number: 7 } }, "VID-7"],
    [{ type: "formula", formula: { type: "string", string: "算出來的" } }, "算出來的"],
    [{ type: "formula", formula: { type: "number", number: 12 } }, "12"],
    [{ type: "rollup", rollup: { type: "array", array: [{ type: "number", number: 1 }, { type: "number", number: 2 }] } }, "1、2"],
    [{ type: "relation", relation: [{ id: "a" }, { id: "b" }] }, "2 筆關聯"],
  ])("轉出各型別的可讀值：%o", (prop, expected) => {
    expect(notionPropertyText(prop)).toBe(expected);
  });

  it("空值與未知型別回空字串，不拋錯", () => {
    expect(notionPropertyText(undefined)).toBe("");
    expect(notionPropertyText({ type: "number", number: null })).toBe("");
    expect(notionPropertyText({ type: "select", select: null })).toBe("");
    expect(notionPropertyText({ type: "沒看過的型別" })).toBe("");
  });
});

/**
 * 迴歸：Notion 資料庫不是一般頁面——blocks/{id}/children 讀不到任何一列。
 * 舊版只走 blocks 路徑，選了資料庫就只會拿到「Notion API 錯誤（400）」或「頁面未授權」。
 */
describe("fetchNotionText（資料庫走 databases query）", () => {
  const DB_META = {
    title: [{ plain_text: "影片進度表" }],
    properties: {
      Name: { name: "名稱", type: "title" },
      Status: { name: "狀態", type: "select" },
    },
  };
  const DB_ROWS = {
    results: [
      {
        properties: {
          Name: { type: "title", title: [{ plain_text: "第一集" }] },
          Status: { type: "select", select: { name: "拍攝中" } },
        },
      },
    ],
    has_more: false,
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  beforeEach(() => {
    proxyFetchMock.mockReset();
    delete process.env.NOTION_TOKEN;
  });

  it("blocks 回 400（id 是資料庫）時改走 databases query，抽出表格文字", async () => {
    proxyFetchMock
      .mockResolvedValueOnce(json({ message: "not a block" }, 400)) // blocks/{id}/children
      .mockResolvedValueOnce(json(DB_META))                        // databases/{id}
      .mockResolvedValueOnce(json(DB_ROWS));                       // databases/{id}/query

    const text = await fetchNotionText(PAGE_ID, "secret_user");

    expect(text).toBe("# 影片進度表\n名稱 | 狀態\n第一集 | 拍攝中");
    expect(proxyFetchMock.mock.calls[2][0]).toBe(`https://api.notion.com/v1/databases/${PAGE_ID}/query`);
    expect(proxyFetchMock.mock.calls[2][1]).toMatchObject({ method: "POST" });
  });

  it("blocks 回 200 空陣列時也要試資料庫路徑（Notion 對資料庫 id 不一定回錯）", async () => {
    proxyFetchMock
      .mockResolvedValueOnce(json({ results: [], has_more: false }))
      .mockResolvedValueOnce(json(DB_META))
      .mockResolvedValueOnce(json(DB_ROWS));

    await expect(fetchNotionText(PAGE_ID, "secret_user")).resolves.toContain("第一集 | 拍攝中");
  });

  it("一般頁面有內容時不會多打資料庫端點", async () => {
    proxyFetchMock.mockResolvedValueOnce(json({
      results: [{ id: "b1", type: "paragraph", paragraph: { rich_text: [{ plain_text: "一般段落" }] } }],
      has_more: false,
    }));

    await expect(fetchNotionText(PAGE_ID, "secret_user")).resolves.toBe("一般段落");
    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
  });

  it("兩條路徑都 404：維持「請到 Connections 授權」的可操作訊息", async () => {
    proxyFetchMock
      .mockResolvedValueOnce(json({ message: "not found" }, 404))
      .mockResolvedValueOnce(json({ message: "not found" }, 404));

    await expect(fetchNotionText(PAGE_ID, "secret_user")).rejects.toThrow("Connections");
  });

  it("401 不浪費一次資料庫請求，直接回 token 失效", async () => {
    proxyFetchMock.mockResolvedValueOnce(json({ message: "unauthorized" }, 401));

    await expect(fetchNotionText(PAGE_ID, "secret_user")).rejects.toThrow("Token 已失效");
    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
  });
});
