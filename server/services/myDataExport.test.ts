/**
 * myDataExport.ts 單元測試：個資「可讀版」HTML 產生器。
 * 重點：使用者內容一律跳脫（防 HTML 注入）、列舉中文化、日期在地化、空狀態、
 * 自我包含（零外部資源／零 script）、以及 ?format=json 提示存在。
 */
import { describe, expect, it } from "vitest";
import { esc, fmtDateTime, renderMyDataHtml, summarizeWorldview, type MyDataExportPayload } from "./myDataExport";

const basePayload: MyDataExportPayload = {
  exportedAt: "2026-07-17T16:00:00.000Z",
  user: { id: "u1", name: "王小明", email: "ming@example.com", createdAt: "2026-01-02T03:04:05.000Z" },
  groups: [{ groupId: "g1", groupName: "剪輯組", teamId: "t1", teamName: "北區工作組", role: "admin" }],
  projects: [
    {
      id: "p1",
      title: "晨光開示",
      kind: "shorts",
      platform: "yt",
      format: "9:16",
      status: "active",
      groupId: "g1",
      groupName: "剪輯組",
      relation: "owner",
      myProjectRole: "owner",
      worldview: { logline: "在都市喧囂中找回平靜", tones: ["溫暖"], styles: ["寫實"] },
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-15T10:00:00.000Z",
      counts: { scenes: 2, knowledge: 1, characters: 1, scenePresets: 0, props: 1, assets: 3, myGenerations: 1 },
      scenes: [
        { orderIndex: 0, title: "開場", status: "approved", durationSec: 5, prompt: "清晨窗邊" },
        { orderIndex: 1, title: "結尾", status: "pending", durationSec: 4, prompt: null },
      ],
      knowledge: [{ title: "開示稿", kind: "transcript", pinned: true }],
      characters: [{ name: "阿明" }],
      scenePresets: [],
      props: [{ name: "紅傘" }],
      myAssets: [{ title: "封面圖", kind: "image", createdAt: "2026-07-10T10:00:00.000Z" }],
    },
  ],
  generations: [
    {
      id: "gen1",
      projectId: "p1",
      projectTitle: "晨光開示",
      modelId: "fal-ai/flux",
      kind: "image",
      prompt: "晨光中的老師父",
      status: "done",
      pointsEst: 5,
      pointsActual: 4,
      createdAt: "2026-07-15T10:00:00.000Z",
    },
  ],
  messages: [{ id: "m1", projectId: "p1", projectTitle: "晨光開示", body: "第一行\n第二行", createdAt: "2026-07-16T10:00:00.000Z" }],
  feedback: [
    {
      id: "f1",
      scores: { 整體滿意度: 5, 生成品質: 4 },
      best: "交付包好用",
      worst: "排隊久",
      note: null,
      createdAt: "2026-07-10T10:00:00.000Z",
      updatedAt: "2026-07-11T10:00:00.000Z",
    },
  ],
  notes: [{ id: "n1", title: "拍攝重點", content: "注意收音", projectId: "p1", projectTitle: "晨光開示", updatedAt: "2026-07-14T10:00:00.000Z" }],
  scheduleItems: [
    {
      id: "s1",
      title: "送審",
      startsAt: "2026-07-20T02:00:00.000Z",
      endsAt: null,
      note: "附字幕",
      projectId: "p1",
      projectTitle: "晨光開示",
      createdAt: "2026-07-16T10:00:00.000Z",
    },
  ],
};

describe("esc", () => {
  it("跳脫 HTML 特殊字元，杜絕標籤注入", () => {
    expect(esc(`<script>alert('x')&"</script>`)).toBe(
      "&lt;script&gt;alert(&#39;x&#39;)&amp;&quot;&lt;/script&gt;",
    );
  });
  it("null／undefined 轉空字串", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

describe("fmtDateTime", () => {
  it("以台灣時區繁中格式化（含年月日）", () => {
    const out = fmtDateTime("2026-07-17T16:00:00.000Z"); // UTC 16:00 → 台北 00:00（次日）
    expect(out).toContain("2026");
    expect(out).toContain("7");
    expect(out).toContain("18"); // +8 時區跨到 18 日
  });
  it("無值或不可解析回破折號，不拋錯", () => {
    expect(fmtDateTime(null)).toBe("—");
    expect(fmtDateTime("")).toBe("—");
    expect(fmtDateTime("not-a-date")).toBe("—");
  });
});

describe("renderMyDataHtml", () => {
  const html = renderMyDataHtml(basePayload);

  it("是自我包含 HTML：doctype 開頭、無 <script>、無外部 http(s) 資源", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script/i);
    // 不得有任何指向外部網址的資源載入（src=/href= 指向 http(s)）——self-contained
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
  });

  it("帶入帳號基本資料", () => {
    expect(html).toContain("王小明");
    expect(html).toContain("ming@example.com");
  });

  it("列舉值中文化：狀態 done→已完成、角色 admin→管理員、類型 image→圖片", () => {
    expect(html).toContain("已完成");
    expect(html).toContain("管理員");
    expect(html).toContain("圖片");
    // 不應把英文原碼直接露給使用者看
    expect(html).not.toContain(">done<");
    expect(html).not.toContain(">admin<");
  });

  it("提示可用 ?format=json 取原始檔（資料可攜）", () => {
    expect(html).toContain("?format=json");
  });

  it("使用者內容一律跳脫：注入的標籤不會成為真標籤", () => {
    const evil = renderMyDataHtml({
      ...basePayload,
      notes: [
        { id: "n2", title: "<img src=x onerror=alert(1)>", content: "<script>alert('xss')</script>", updatedAt: "2026-07-14T10:00:00.000Z" },
      ],
    });
    // 原始危險標籤不得原樣出現
    expect(evil).not.toContain("<img src=x onerror=alert(1)>");
    expect(evil).not.toContain("<script>alert('xss')</script>");
    // 但內容仍以跳脫後的可讀文字呈現
    expect(evil).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(evil).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
  });

  it("空資料區塊顯示柔性空狀態，不留只有標題的空殼", () => {
    const empty = renderMyDataHtml({
      ...basePayload,
      projects: [],
      generations: [],
      messages: [],
      feedback: [],
      notes: [],
      scheduleItems: [],
    });
    expect(empty).toContain("目前沒有這類資料");
    // 概覽數字歸零
    expect(empty).toContain('<div class="n">0</div>');
  });

  it("專案區塊含標題、世界觀摘要、分鏡與知識", () => {
    expect(html).toContain("晨光開示");
    expect(html).toContain("相關專案");
    expect(html).toContain("在都市喧囂中找回平靜");
    expect(html).toContain("開場");
    expect(html).toContain("已通過");
    expect(html).toContain("開示稿");
    expect(html).toContain("阿明");
    expect(html).toContain("擁有者");
  });

  it("生成／留言帶專案名欄", () => {
    expect(html).toContain("<th>專案</th>");
    // 生成表與留言表都應出現專案名
    expect(html.match(/晨光開示/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("summarizeWorldview 只抽安全摘要並截斷", () => {
    const s = summarizeWorldview({
      logline: "短故事",
      message: "主張",
      tones: ["溫暖", "沉靜"],
      styles: ["寫實"],
      ghost: { nested: true },
    });
    expect(s).toEqual({
      logline: "短故事",
      message: "主張",
      tones: ["溫暖", "沉靜"],
      styles: ["寫實"],
    });
  });

  it("回饋 scores 的英文問卷代碼對照回白話題目", () => {
    const withCodes = renderMyDataHtml({
      ...basePayload,
      feedback: [
        {
          id: "f2",
          scores: { context: 5, usability: 3 },
          best: null,
          worst: null,
          note: null,
          createdAt: "2026-07-10T10:00:00.000Z",
          updatedAt: "2026-07-10T10:00:00.000Z",
        },
      ],
    });
    expect(withCodes).toContain("AI 懂不懂我們的素材（不用重複解釋）");
    expect(withCodes).toContain("不用教也會用");
    expect(withCodes).toContain("5／5");
    // 不把英文代碼裸露給使用者
    expect(withCodes).not.toContain(">context<");
  });

  it("模型技術代號顯示為友善名稱（查得到對照時）", () => {
    const withModel = renderMyDataHtml({
      ...basePayload,
      generations: [
        { ...basePayload.generations[0], modelId: "fal-ai/flux-2/pro" },
      ],
    });
    expect(withModel).toContain("FLUX.2 [pro]");
    // 原始代號仍保留在 title 供需要者查
    expect(withModel).toContain('title="fal-ai/flux-2/pro"');
  });

  it("多行內容換行轉為 <br>（留言/筆記長文可讀）", () => {
    expect(html).toContain("第一行<br>第二行");
  });
});
