import { describe, expect, it } from "vitest";
import {
  ADD_DATA_METHODS,
  addDataMethod,
  addDataMethodsFor,
  dataHubAiAccessLabel,
  dataHubConnectionLabel,
  dataHubConnectionState,
  dataHubProviderFromImportKind,
  dataHubResolveSource,
  dataHubResourceId,
  dataHubSourceFromUrl,
  dataHubSourceHasUpdate,
  formatDataHubSyncedAt,
  dataHubStatusOf,
  dataHubSummarySentence,
  formatDataHubBytes,
  formatDataHubChars,
  formatDataHubRows,
  parseDataHubResourceId,
  resolveAssetAiAccess,
  resolveDocumentAiAccess,
  resolveKnowledgeAiAccess,
  resolveTableAiAccess,
  summarizeDataHub,
  type DataHubResource,
} from "./dataHub";

function resource(over: Partial<DataHubResource> = {}): DataHubResource {
  return {
    id: "knowledge:k1",
    kind: "knowledge",
    rawId: "k1",
    title: "影片腳本",
    scope: "project",
    source: "manual",
    projectId: "p1",
    projectTitle: "AI OS",
    groupId: "g1",
    ai: resolveKnowledgeAiAccess(),
    status: "ready",
    statusLabel: "AI 可以使用",
    updatedAt: "2026-08-01T00:00:00.000Z",
    href: "/p/p1#sec-knowledge",
    sizeLabel: "1,200 字",
    syncedLabel: null,
    sourceHasUpdate: false,
    ...over,
  };
}

describe("resource id（跨 domain 唯一）", () => {
  it("複合鍵可來回轉換", () => {
    expect(dataHubResourceId("table", "abc")).toBe("table:abc");
    expect(parseDataHubResourceId("table:abc")).toEqual({ kind: "table", rawId: "abc" });
  });

  it("uuid 內含冒號以外的字元不會被截斷（只切第一個冒號）", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(parseDataHubResourceId(dataHubResourceId("document", uuid))).toEqual({
      kind: "document",
      rawId: uuid,
    });
  });

  it("未知 kind 或缺 rawId 一律回 null（不猜）", () => {
    expect(parseDataHubResourceId("mystery:abc")).toBeNull();
    expect(parseDataHubResourceId("table:")).toBeNull();
    expect(parseDataHubResourceId(":abc")).toBeNull();
    expect(parseDataHubResourceId("table")).toBeNull();
  });
});

describe("resolveTableAiAccess（只會更嚴、不會放寬）", () => {
  it("agentAccess=none → 不提供 AI", () => {
    expect(resolveTableAiAccess({ agentAccess: "none", canWriteRows: true }).access).toBe("none");
  });

  it("agentAccess=read → 只讀，即使本人可寫", () => {
    expect(resolveTableAiAccess({ agentAccess: "read", canWriteRows: true }).access).toBe("readable");
  });

  it("agentAccess=write 且本人可寫 → 可協作", () => {
    expect(resolveTableAiAccess({ agentAccess: "write", canWriteRows: true }).access).toBe("writable");
  });

  it("★ agentAccess=write 但本人只讀 → 降為只讀（UI 不得宣告 backend 不允許的能力）", () => {
    const ai = resolveTableAiAccess({ agentAccess: "write", canWriteRows: false });
    expect(ai.access).toBe("readable");
    expect(ai.reason).toContain("只有讀取權限");
  });
});

describe("resolveDocumentAiAccess", () => {
  it("所屬表不提供 AI 時，文件也不提供", () => {
    expect(
      resolveDocumentAiAccess({ tableAgentAccess: "none", readableChars: 9999 }).access,
    ).toBe("none");
  });

  it("有可讀文字 → 只讀（文件層永遠不可寫）", () => {
    expect(resolveDocumentAiAccess({ tableAgentAccess: "write", readableChars: 500 }).access).toBe("readable");
  });

  it("沒有可讀文字也沒有描述 → 誠實回報 AI 讀不到", () => {
    const ai = resolveDocumentAiAccess({ tableAgentAccess: "write", readableChars: 0 });
    expect(ai.access).toBe("none");
    expect(ai.reason).toContain("讀不到");
  });

  it("圖影有 AI 描述時 → 讀的是描述，不是原檔", () => {
    const ai = resolveDocumentAiAccess({
      tableAgentAccess: "read",
      readableChars: 0,
      aiDescription: "一張暖色調的講堂照片",
    });
    expect(ai.access).toBe("readable");
    expect(ai.reason).toContain("描述");
  });

  it("空白描述不算描述", () => {
    expect(
      resolveDocumentAiAccess({ tableAgentAccess: "read", readableChars: 0, aiDescription: "   " }).access,
    ).toBe("none");
  });
});

describe("resolveKnowledgeAiAccess / resolveAssetAiAccess", () => {
  it("知識庫一律只讀（AI 不反寫知識庫）", () => {
    expect(resolveKnowledgeAiAccess().access).toBe("readable");
  });

  it("素材：有描述才說 AI 看過", () => {
    expect(resolveAssetAiAccess({ hasAiDescription: true }).reason).toContain("看過");
    expect(resolveAssetAiAccess({ hasAiDescription: false }).reason).toContain("生成的來源");
  });
});

describe("AI 使用方式的人話", () => {
  it("不再以「AI 可查可寫」為主要文案", () => {
    expect(dataHubAiAccessLabel("writable")).toBe("AI 可以協作");
    expect(dataHubAiAccessLabel("readable")).toBe("AI 只能讀取");
    expect(dataHubAiAccessLabel("none")).toBe("不提供 AI");
  });
});

describe("dataHubStatusOf（工程狀態 → 人話）", () => {
  it("ready", () => {
    expect(dataHubStatusOf("ready")).toEqual({ status: "ready", label: "AI 可以使用" });
  });

  it("parsing / indexing / processing 都收斂成「正在準備給 AI 使用」", () => {
    for (const s of ["parsing", "indexing", "processing"] as const) {
      expect(dataHubStatusOf(s)).toEqual({ status: "processing", label: "正在準備給 AI 使用" });
    }
  });

  it("錯誤三態各有不同人話（不能混成同一句）", () => {
    expect(dataHubStatusOf("unreadable").label).toBe("部分內容無法讀取");
    expect(dataHubStatusOf("needs-reconnect").label).toBe("需要重新連接");
    expect(dataHubStatusOf("failed").label).toBe("加入失敗");
  });

  it("所有錯誤態的 status 都是 error（UI 才知道要標紅）", () => {
    for (const s of ["unreadable", "needs-reconnect", "failed"] as const) {
      expect(dataHubStatusOf(s).status).toBe("error");
    }
  });
});

describe("dataHubSourceFromUrl", () => {
  it("沒有來源網址＝上傳檔", () => {
    expect(dataHubSourceFromUrl(null)).toBe("upload");
    expect(dataHubSourceFromUrl(undefined)).toBe("upload");
  });

  it("認得 Google 與 Notion", () => {
    expect(dataHubSourceFromUrl("https://docs.google.com/document/d/abc/edit")).toBe("google-drive");
    expect(dataHubSourceFromUrl("https://drive.google.com/file/d/abc/view")).toBe("google-drive");
    expect(dataHubSourceFromUrl("https://www.notion.so/abc123")).toBe("notion");
  });

  it("★ 不被相似網域騙（google.com.evil.tld 不是 Google）", () => {
    expect(dataHubSourceFromUrl("https://google.com.evil.tld/x")).toBe("url");
    expect(dataHubSourceFromUrl("https://notnotion.so/x")).toBe("url");
  });

  it("解析失敗一律當 url，不亂猜", () => {
    expect(dataHubSourceFromUrl("not a url")).toBe("url");
  });
});

describe("規模文案", () => {
  it("bytes", () => {
    expect(formatDataHubBytes(0)).toBe("0 B");
    expect(formatDataHubBytes(512)).toBe("512 B");
    expect(formatDataHubBytes(2048)).toBe("2 KB");
    expect(formatDataHubBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("chars：0 字要講人話，不是「0 字」", () => {
    expect(formatDataHubChars(0)).toBe("尚無可讀文字");
    expect(formatDataHubChars(3400)).toBe("3,400 字");
  });

  it("rows", () => {
    expect(formatDataHubRows(12)).toBe("12 列");
    expect(formatDataHubRows(-3)).toBe("0 列");
  });
});

describe("摘要（首屏人話）", () => {
  it("空站不顯示 0 資料庫 / 0 資料列", () => {
    expect(dataHubSummarySentence(summarizeDataHub([]))).toBe("還沒有資料");
  });

  it("全部可用時不重複報兩個相同數字", () => {
    const counts = summarizeDataHub([resource(), resource({ id: "knowledge:k2", rawId: "k2" })]);
    expect(dataHubSummarySentence(counts)).toBe("2 份資料・AI 都可以使用");
  });

  it("部分可用時同時給總數與可用數", () => {
    const counts = summarizeDataHub([
      resource(),
      resource({
        id: "table:t1",
        kind: "table",
        rawId: "t1",
        ai: { access: "none", reason: "x" },
      }),
    ]);
    expect(counts.aiUsable).toBe(1);
    expect(dataHubSummarySentence(counts)).toBe("2 份資料・1 份 AI 可以使用");
  });

  it("全部不提供 AI 時要講清楚，不要讓人以為 AI 已經在用", () => {
    const counts = summarizeDataHub([resource({ ai: { access: "none", reason: "x" } })]);
    expect(dataHubSummarySentence(counts)).toContain("都沒有提供給 AI");
  });

  it("byKind 分類正確", () => {
    const counts = summarizeDataHub([
      resource(),
      resource({ id: "table:t1", kind: "table", rawId: "t1" }),
      resource({ id: "asset:a1", kind: "asset", rawId: "a1" }),
    ]);
    expect(counts.byKind).toEqual({ knowledge: 1, table: 1, document: 0, asset: 1 });
  });
});

describe("加入資料的方式（單一真相）", () => {
  it("id 不重複", () => {
    const ids = ADD_DATA_METHODS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("首屏不要求使用者先選 Database / Knowledge / Integration", () => {
    const labels = ADD_DATA_METHODS.map((m) => m.label);
    expect(labels).not.toContain("資料庫");
    expect(labels).not.toContain("知識庫");
    expect(labels).not.toContain("整合");
  });

  it("外部 API 是進階選項，不佔首屏", () => {
    expect(addDataMethod("api")?.advanced).toBe(true);
    expect(addDataMethod("upload")?.advanced).toBe(false);
  });

  it("專案內的入口收斂：不含結構化表與外部 API", () => {
    const ids = addDataMethodsFor("project").map((m) => m.id);
    expect(ids).toContain("google-drive");
    expect(ids).toContain("notion");
    expect(ids).toContain("upload");
    expect(ids).not.toContain("tabular");
    expect(ids).not.toContain("api");
  });

  it("資料中心保留完整入口", () => {
    expect(addDataMethodsFor("hub").length).toBe(ADD_DATA_METHODS.length);
  });
});

describe("連線狀態（永遠只講「能不能去挑」，不是 AI 讀得到什麼）", () => {
  it("站方沒設定 → unavailable", () => {
    expect(dataHubConnectionState({ configured: false, connected: false })).toBe("unavailable");
  });

  it("已連接但授權失效 → 需要重新連接", () => {
    expect(dataHubConnectionState({ connected: true, status: "error" })).toBe("needs-reconnect");
    expect(dataHubConnectionLabel("needs-reconnect")).toBe("需要重新連接");
  });

  it("正常已連接", () => {
    expect(dataHubConnectionState({ connected: true, status: "active" })).toBe("connected");
  });

  it("未連接", () => {
    expect(dataHubConnectionState({ connected: false })).toBe("not-connected");
    expect(dataHubConnectionLabel("not-connected")).toBe("尚未連接");
  });
});

/* ────────── 來源譜系（P6）────────── */

describe("dataHubProviderFromImportKind（匯入當下就記下來，不事後猜）", () => {
  it("Google 系的四種 kind 都算 Google 雲端", () => {
    for (const k of ["google-doc", "google-sheet", "google-slides", "google-drive"] as const) {
      expect(dataHubProviderFromImportKind(k)).toBe("google-drive");
    }
  });

  it("notion 與一般網址各自對應", () => {
    expect(dataHubProviderFromImportKind("notion")).toBe("notion");
    expect(dataHubProviderFromImportKind("web")).toBe("url");
  });
});

describe("dataHubResolveSource（記錄優先於猜測）", () => {
  it("★ 有記錄就用記錄——猜出來的不該蓋掉匯入當下知道的事實", () => {
    // 網址看起來像一般網頁，但匯入當下記的是 Notion（例如自訂網域的 Notion 站）
    expect(dataHubResolveSource({
      sourceProvider: "notion",
      sourceUrl: "https://example.com/page",
    })).toBe("notion");
  });

  it("沒有記錄（舊列）才從網址猜", () => {
    expect(dataHubResolveSource({
      sourceProvider: null,
      sourceUrl: "https://docs.google.com/document/d/x/edit",
    })).toBe("google-drive");
  });

  it("兩者都沒有時用呼叫端給的 fallback", () => {
    expect(dataHubResolveSource({ fallback: "upload" })).toBe("upload");
    expect(dataHubResolveSource({})).toBe("manual");
  });

  it("★ 記錄的值不在白名單內就當作沒記錄（不把髒資料直接當來源顯示）", () => {
    expect(dataHubResolveSource({
      sourceProvider: "<script>",
      sourceUrl: "https://www.notion.so/abc",
    })).toBe("notion");
    expect(dataHubResolveSource({ sourceProvider: "  " })).toBe("manual");
  });
});

describe("formatDataHubSyncedAt（措辭是「讀取」不是「同步」）", () => {
  const now = Date.parse("2026-08-08T12:00:00.000Z");

  it("★ 不講「同步」——站內沒有背景同步，講同步會讓人以為系統會自動跟上來源", () => {
    const label = formatDataHubSyncedAt("2026-08-08T11:00:00.000Z", now);
    expect(label).toBe("1 小時前讀取");
    expect(label).not.toContain("同步");
  });

  it("各時間刻度", () => {
    expect(formatDataHubSyncedAt("2026-08-08T11:59:40.000Z", now)).toBe("剛剛讀取");
    expect(formatDataHubSyncedAt("2026-08-08T11:55:00.000Z", now)).toBe("5 分鐘前讀取");
    expect(formatDataHubSyncedAt("2026-08-05T12:00:00.000Z", now)).toBe("3 天前讀取");
  });

  it("沒有記錄就是 null（UI 留白，不編）", () => {
    expect(formatDataHubSyncedAt(null)).toBeNull();
    expect(formatDataHubSyncedAt(undefined)).toBeNull();
    expect(formatDataHubSyncedAt("not a date")).toBeNull();
  });
});

describe("dataHubSourceHasUpdate（不知道絕不顯示成「有更新」）", () => {
  it("來源端比站內新 → 有更新", () => {
    expect(dataHubSourceHasUpdate({
      sourceModifiedAt: "2026-08-08T12:00:00.000Z",
      lastSyncedAt: "2026-08-08T10:00:00.000Z",
    })).toBe(true);
  });

  it("站內比來源新（或同時）→ 沒有更新", () => {
    expect(dataHubSourceHasUpdate({
      sourceModifiedAt: "2026-08-08T10:00:00.000Z",
      lastSyncedAt: "2026-08-08T12:00:00.000Z",
    })).toBe(false);
  });

  it("★ 任一時間缺席就是 false——判斷不出來不可以說「有更新」", () => {
    expect(dataHubSourceHasUpdate({ sourceModifiedAt: "2026-08-08T12:00:00.000Z" })).toBe(false);
    expect(dataHubSourceHasUpdate({ lastSyncedAt: "2026-08-08T12:00:00.000Z" })).toBe(false);
    expect(dataHubSourceHasUpdate({})).toBe(false);
  });

  it("時間格式壞掉也是 false", () => {
    expect(dataHubSourceHasUpdate({ sourceModifiedAt: "x", lastSyncedAt: "y" })).toBe(false);
  });
});
