/**
 * 資料中心（Unified Data Hub）的統一 View Model。
 *
 * 這一層存在的唯一理由：站內的資料真的分在四個 domain（知識庫／結構化表／表文件／素材），
 * 各有各的擁有者、生命週期與權限模型（見 docs/data-hub-current-state-2026-08.md）。
 * 底層要繼續分層——但一般創作者不該為了「把一份文件給專案和 AI 用」而先學會這四個詞。
 *
 * 因此本檔案只做一件事：**把四個 backend domain 翻成同一套 UI 語言**。
 * - 不是新的資料真相表（沒有任何 schema、沒有任何 migration）。
 * - 不重寫 ACL：AI 權限一律由 server 依各 domain 原本的規則解析後，
 *   在這裡收斂成同一組人話標籤（resolve* 系列只做「映射」，不做「授權」）。
 *
 * ★ 四條不變量（同 docs 第 14 節）在型別上是分開的欄位，不可互相推論：
 *   connection ≠ imported ≠ projectBound ≠ aiReadable ≠ aiWritable
 */

/* ────────────────────────── 列舉與標籤 ────────────────────────── */

/** 資源種類：對應底層四個 domain（使用者看到的是 kindLabel，不是這串 key） */
export const DATA_HUB_KINDS = ["knowledge", "table", "document", "asset"] as const;
export type DataHubKind = (typeof DATA_HUB_KINDS)[number];

/** 這份資料「怎麼進站的」——來源只是加入方式，不是主要工作區 */
export const DATA_HUB_SOURCES = [
  "manual",
  "upload",
  "google-drive",
  "notion",
  "url",
  "api",
  "generated",
] as const;
export type DataHubSource = (typeof DATA_HUB_SOURCES)[number];

/** 可見範圍：前四個沿用 databaseAcl 的四層；project＝掛在某個專案下（知識／素材） */
export const DATA_HUB_SCOPES = ["personal", "group", "team", "global", "project"] as const;
export type DataHubScope = (typeof DATA_HUB_SCOPES)[number];

/**
 * AI 使用方式（使用者層）：
 *   writable＝AI 可以協作（新增／修改允許的資料）
 *   readable＝AI 只能讀取（搜尋與引用）
 *   none    ＝不提供 AI（只有成員可以使用）
 * 這三個值**永遠**由 server 依真實 backend 權限算出，UI 不得自行放寬。
 */
export type DataHubAiAccess = "writable" | "readable" | "none";

/** 對外狀態（人話三態）：內部細節狀態見 DataHubInternalStatus */
export type DataHubStatus = "ready" | "processing" | "error";

/**
 * 內部細節狀態（工程語言）——只用來推導人話，永遠不直接顯示給使用者。
 * 站內目前是同步匯入（沒有背景 index 佇列），所以實務上多半只會出現
 * ready / unreadable / needs-reconnect；其餘值先定義好，之後接非同步管線不必改型別。
 */
export type DataHubInternalStatus =
  | "ready"
  | "uploading"
  | "fetching"
  | "parsing"
  | "indexing"
  | "processing"
  | "unreadable"
  | "needs-reconnect"
  | "failed";

export const DATA_HUB_KIND_LABEL: Record<DataHubKind, string> = {
  knowledge: "文字資料",
  table: "資料表",
  document: "文件",
  asset: "圖影素材",
};

export const DATA_HUB_SOURCE_LABEL: Record<DataHubSource, string> = {
  manual: "站內建立",
  upload: "上傳檔案",
  "google-drive": "Google 雲端",
  notion: "Notion",
  url: "網址",
  api: "外部 API",
  generated: "AI 生成",
};

export const DATA_HUB_SCOPE_LABEL: Record<DataHubScope, string> = {
  personal: "我的資料",
  group: "組共用",
  team: "團隊資料",
  global: "全站資料",
  project: "專案資料",
};

/** AI 使用方式的人話（§19：不要主要顯示「AI 可查可寫」） */
export const DATA_HUB_AI_ACCESS_LABEL: Record<DataHubAiAccess, string> = {
  writable: "AI 可以協作",
  readable: "AI 只能讀取",
  none: "不提供 AI",
};

export const DATA_HUB_AI_ACCESS_HINT: Record<DataHubAiAccess, string> = {
  writable: "AI 可以搜尋、引用，也能新增或修改允許的資料",
  readable: "AI 可以搜尋與引用，但不能修改",
  none: "只有成員可以使用；AI 看不到這份資料",
};

export function dataHubKindLabel(kind: DataHubKind): string {
  return DATA_HUB_KIND_LABEL[kind] ?? "資料";
}

export function dataHubSourceLabel(source: DataHubSource): string {
  return DATA_HUB_SOURCE_LABEL[source] ?? "站內建立";
}

export function dataHubScopeLabel(scope: DataHubScope): string {
  return DATA_HUB_SCOPE_LABEL[scope] ?? "資料";
}

export function dataHubAiAccessLabel(access: DataHubAiAccess): string {
  return DATA_HUB_AI_ACCESS_LABEL[access] ?? DATA_HUB_AI_ACCESS_LABEL.none;
}

/**
 * 內部狀態 → 人話（§38）。
 * 錯誤與「正在準備」一定要看得出差別，否則使用者會以為東西壞了／以為好了。
 */
export function dataHubStatusOf(internal: DataHubInternalStatus): { status: DataHubStatus; label: string } {
  switch (internal) {
    case "ready":
      return { status: "ready", label: "AI 可以使用" };
    case "uploading":
      return { status: "processing", label: "正在加入" };
    case "fetching":
      return { status: "processing", label: "正在讀取來源" };
    case "parsing":
    case "indexing":
    case "processing":
      return { status: "processing", label: "正在準備給 AI 使用" };
    case "unreadable":
      return { status: "error", label: "部分內容無法讀取" };
    case "needs-reconnect":
      return { status: "error", label: "需要重新連接" };
    case "failed":
    default:
      return { status: "error", label: "加入失敗" };
  }
}

/* ────────────────────────── Resource View Model ────────────────────────── */

export interface DataHubAi {
  access: DataHubAiAccess;
  /** 一句話說明「為什麼是這個等級」——UI 直接顯示，不要讓使用者去猜 */
  reason: string;
}

/**
 * 統一資源。**id 是複合鍵**（`kind:rawId`）——不同 domain 的 uuid 可能相同，
 * 而且前端 key 一定要跨 domain 唯一。需要打回原本的 API 時用 `rawId`。
 */
export interface DataHubResource {
  id: string;
  kind: DataHubKind;
  rawId: string;
  title: string;
  scope: DataHubScope;
  source: DataHubSource;
  /** 掛在哪個專案（知識／素材必有；表／文件為 null——表與專案的關係走 project link field） */
  projectId: string | null;
  projectTitle: string | null;
  groupId: string | null;
  ai: DataHubAi;
  status: DataHubStatus;
  /** status 的人話（來自 dataHubStatusOf） */
  statusLabel: string;
  /** ISO 字串（tRPC superjson 會轉回 Date，但 view model 一律以字串為準，前端自己格式化） */
  updatedAt: string;
  /** 開啟原本完整編輯器的站內連結（Data Hub 不重寫 grid editor，只負責帶路） */
  href: string;
  /** 「12 列」「3,400 字」「2.1 MB」之類的人話規模；沒有就 null */
  sizeLabel: string | null;
  /**
   * 「5 分鐘前讀取」——本站最後一次真的去來源抓的時刻（P6）。
   * 沒有記錄（站內建立、或舊列）就是 null，UI 據此留白，不編。
   */
  syncedLabel: string | null;
  /**
   * 來源端比站內版本新。**兩個時間都有記錄才會是 true**——
   * 判斷不出來一律 false，「不知道」絕不可以顯示成「有更新」。
   */
  sourceHasUpdate: boolean;
  /** Intelligence Library sidecar. Missing means the background enrolment has not reached this legacy row yet. */
  intelligence?: {
    id: string;
    canonicalType: string;
    category: string | null;
    summary: string | null;
    tags: string[];
    confidence: number | null;
    analysisStatus: string;
  } | null;
}

export function dataHubResourceId(kind: DataHubKind, rawId: string): string {
  return `${kind}:${rawId}`;
}

export function parseDataHubResourceId(id: string): { kind: DataHubKind; rawId: string } | null {
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  const kind = id.slice(0, idx) as DataHubKind;
  const rawId = id.slice(idx + 1);
  if (!rawId || !DATA_HUB_KINDS.includes(kind)) return null;
  return { kind, rawId };
}

/* ────────────────────────── AI 權限映射（不是授權） ────────────────────────── */

/**
 * 結構化資料表：`agent_access` × 「本人是否可寫」→ 使用者層等級。
 *
 * ★ 只會更嚴、不會放寬——與 services/databaseAcl.resolveAgentAccess 同一條規則：
 * write 等級要真的顯示成「AI 可以協作」，本人自己也必須有寫入權，
 * 否則 UI 會宣告一個 backend 根本不允許的能力（§67-10）。
 */
export function resolveTableAiAccess(input: {
  agentAccess: "none" | "read" | "write";
  canWriteRows: boolean;
}): DataHubAi {
  if (input.agentAccess === "none") {
    return { access: "none", reason: "這張表設定為不提供 AI 使用" };
  }
  if (input.agentAccess === "write" && input.canWriteRows) {
    return { access: "writable", reason: "AI 可以查詢，也能把結果寫回這張表" };
  }
  if (input.agentAccess === "write") {
    return { access: "readable", reason: "你在這張表只有讀取權限，AI 也跟著只能讀" };
  }
  return { access: "readable", reason: "這張表設定為 AI 只讀" };
}

/**
 * 資料表文件：AI 讀的是抽出的純文字。
 * 沒有可讀文字（圖影、加密 PDF…）＝ AI 事實上讀不到，就不要在 UI 上假裝可以。
 * 文件層**永遠不可寫**（AI 不會改人上傳的原檔）。
 */
export function resolveDocumentAiAccess(input: {
  tableAgentAccess: "none" | "read" | "write";
  readableChars: number;
  aiDescription?: string | null;
}): DataHubAi {
  if (input.tableAgentAccess === "none") {
    return { access: "none", reason: "所屬資料表設定為不提供 AI 使用" };
  }
  if (input.readableChars > 0) {
    return { access: "readable", reason: "AI 可以搜尋與引用這份文件的內容" };
  }
  if (input.aiDescription && input.aiDescription.trim()) {
    return { access: "readable", reason: "AI 讀的是這份圖影的描述，不是原檔" };
  }
  return { access: "none", reason: "這份檔案沒有可讀文字——AI 目前讀不到內容" };
}

/**
 * 專案知識庫：進了專案就會被注入該專案的 AI（buildKnowledgeContext）。
 * 沒有 per-resource 的 AI 開關，所以一律 readable——但 AI 不會反寫知識庫。
 */
export function resolveKnowledgeAiAccess(): DataHubAi {
  return { access: "readable", reason: "專案 AI 會自動讀取這份文字資料" };
}

/**
 * 素材：可作為生成來源；圖片另可經 AI 看圖描述才「讀得懂」。
 * 是否真的理解內容仍依模型能力而定——文案不誇大。
 */
export function resolveAssetAiAccess(input: { hasAiDescription: boolean }): DataHubAi {
  return input.hasAiDescription
    ? { access: "readable", reason: "AI 已經看過這張素材，可以引用它的描述" }
    : { access: "readable", reason: "可以作為 AI 生成的來源；要讓 AI 讀懂內容需先產生描述" };
}

/* ────────────────────────── 來源推斷 ────────────────────────── */

const GOOGLE_HOST_RE = /(^|\.)(google\.com|googleusercontent\.com|goo\.gl)$/i;
const NOTION_HOST_RE = /(^|\.)notion\.(so|site)$/i;

/**
 * 匯入管線的 kind（services/databaseFiles.normalizeImportUrl）→ 來源供應商。
 *
 * 匯入當下就知道答案，所以寫進 source_provider 欄位；之後顯示不必再從網址猜。
 * 這支是「記錄時」用的，dataHubSourceFromUrl 是「沒有記錄時」的退路。
 */
export function dataHubProviderFromImportKind(
  kind: "google-doc" | "google-sheet" | "google-slides" | "google-drive" | "notion" | "web",
): DataHubSource {
  if (kind === "notion") return "notion";
  if (kind === "web") return "url";
  return "google-drive";
}

/**
 * 由 `source_url` 推斷來源。解析失敗一律當成 `url`——寧可少講一點，
 * 也不要把不確定的東西標成「Google 雲端」誤導使用者。
 *
 * ★ 只在沒有 source_provider 記錄時才用（舊列）。有記錄一律以記錄為準。
 */
export function dataHubSourceFromUrl(sourceUrl: string | null | undefined): DataHubSource {
  if (!sourceUrl) return "upload";
  let host: string;
  try {
    host = new URL(sourceUrl).hostname;
  } catch {
    return "url";
  }
  if (GOOGLE_HOST_RE.test(host)) return "google-drive";
  if (NOTION_HOST_RE.test(host)) return "notion";
  return "url";
}

/* ────────────────────────── 規模文案 ────────────────────────── */

/**
 * 已記錄的來源優先，沒記錄才從網址猜（舊列）。
 * 這條優先序是 P6 的重點：猜出來的東西不該蓋掉匯入當下真正知道的事實。
 */
export function dataHubResolveSource(input: {
  sourceProvider?: string | null;
  sourceUrl?: string | null;
  fallback?: DataHubSource;
}): DataHubSource {
  const recorded = input.sourceProvider?.trim();
  if (recorded && (DATA_HUB_SOURCES as readonly string[]).includes(recorded)) {
    return recorded as DataHubSource;
  }
  if (input.sourceUrl) return dataHubSourceFromUrl(input.sourceUrl);
  return input.fallback ?? "manual";
}

/**
 * 「最後同步」的人話。
 *
 * ★ 措辭刻意是「最後讀取」而不是「最後同步」：站內沒有背景同步，這個時間是
 *   「上次真的去對方那裡抓的時刻」（匯入或手動重新整理）。講成「同步」會讓人
 *   以為系統會自動跟上來源的變更——那是假的（§32：不要為了畫面做假同步）。
 */
export function formatDataHubSyncedAt(lastSyncedAt: string | null | undefined, now = Date.now()): string | null {
  if (!lastSyncedAt) return null;
  const then = new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(then)) return null;
  const min = Math.floor((now - then) / 60_000);
  if (min < 1) return "剛剛讀取";
  if (min < 60) return `${min} 分鐘前讀取`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前讀取`;
  const day = Math.floor(hr / 24);
  return `${day} 天前讀取`;
}

/**
 * 來源端是否比站內版本新（兩個時間都有記錄才判斷）。
 * 判斷不出來就回 false——「不知道」絕不可以顯示成「有更新」。
 */
export function dataHubSourceHasUpdate(input: {
  sourceModifiedAt?: string | null;
  lastSyncedAt?: string | null;
}): boolean {
  if (!input.sourceModifiedAt || !input.lastSyncedAt) return false;
  const modified = new Date(input.sourceModifiedAt).getTime();
  const synced = new Date(input.lastSyncedAt).getTime();
  if (!Number.isFinite(modified) || !Number.isFinite(synced)) return false;
  return modified > synced;
}

export function formatDataHubBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatDataHubChars(chars: number): string {
  if (!Number.isFinite(chars) || chars <= 0) return "尚無可讀文字";
  return `${Math.round(chars).toLocaleString("en-US")} 字`;
}

export function formatDataHubRows(rows: number): string {
  return `${Math.max(0, Math.round(rows)).toLocaleString("en-US")} 列`;
}

/* ────────────────────────── 摘要（首頁 KPI 的人話版） ────────────────────────── */

export interface DataHubSummaryCounts {
  /** 這個人看得到的資料總份數 */
  total: number;
  /** 其中 AI 可以使用（readable 或 writable）的份數 */
  aiUsable: number;
  byKind: Record<DataHubKind, number>;
}

export function summarizeDataHub(resources: readonly DataHubResource[]): DataHubSummaryCounts {
  const byKind: Record<DataHubKind, number> = { knowledge: 0, table: 0, document: 0, asset: 0 };
  let aiUsable = 0;
  for (const r of resources) {
    byKind[r.kind] += 1;
    if (r.ai.access !== "none") aiUsable += 1;
  }
  return { total: resources.length, aiUsable, byKind };
}

/**
 * 首屏那一行字（§9：不要再用「10 資料庫 / 64 資料列 / 10 AI 可使用」當主資訊）。
 * 空狀態要講「還沒有資料」，不是「0 份資料，0 份 AI 可以使用」。
 */
export function dataHubSummarySentence(counts: DataHubSummaryCounts): string {
  if (counts.total === 0) return "還沒有資料";
  if (counts.aiUsable === 0) return `${counts.total} 份資料・目前都沒有提供給 AI`;
  if (counts.aiUsable === counts.total) return `${counts.total} 份資料・AI 都可以使用`;
  return `${counts.total} 份資料・${counts.aiUsable} 份 AI 可以使用`;
}

/* ────────────────────────── 加入資料的來源選項（AddDataSheet 單一真相） ────────────────────────── */

/**
 * 「你想從哪裡加入？」的選項表。
 *
 * ★ 產品原則（§12）：Google Drive / Notion / 上傳 / 網址都只是**加入資料的方法**，
 * 不是主要工作區。所以它們在這裡是平等的選項，而不是各自一個頁面。
 * 連接與否是 flow 內的 prerequisite，不是使用者要先去別頁完成的前置作業。
 */
export type AddDataMethodId =
  | "upload"
  | "upload-folder"
  | "photo-library"
  | "paste"
  | "google-drive"
  | "google-docs"
  | "google-sheets"
  | "notion"
  | "url"
  | "tabular"
  | "api";

export interface AddDataMethod {
  id: AddDataMethodId;
  label: string;
  /** 一句話說明「這適合放什麼」——不解釋系統架構 */
  hint: string;
  /** 需要外部連線才能用（UI 據此顯示已連接／需要連接） */
  requiresConnection: null | "google-drive" | "notion" | "api";
  /** 進階：預設收在「更多方式」裡，不佔首屏 */
  advanced: boolean;
}

export const ADD_DATA_METHODS: readonly AddDataMethod[] = [
  {
    id: "upload",
    label: "上傳檔案",
    hint: "PDF、Word、圖片、影音等",
    requiresConnection: null,
    advanced: false,
  },
  {
    id: "upload-folder",
    label: "上傳資料夾",
    hint: "保留整批檔案，一次交給 AI 整理",
    requiresConnection: null,
    advanced: false,
  },
  {
    id: "photo-library",
    label: "相簿",
    hint: "從手機相簿選圖片或影片",
    requiresConnection: null,
    advanced: false,
  },
  {
    id: "paste",
    label: "貼上文字",
    hint: "腳本、筆記、會議紀錄",
    requiresConnection: null,
    advanced: false,
  },
  {
    id: "google-drive",
    label: "Google 雲端",
    hint: "從你的雲端挑檔案加入",
    requiresConnection: "google-drive",
    advanced: false,
  },
  {
    id: "google-docs",
    label: "Google Docs",
    hint: "挑選文件並解析成可搜尋文字",
    requiresConnection: "google-drive",
    advanced: false,
  },
  {
    id: "google-sheets",
    label: "Google Sheets",
    hint: "挑選試算表加入專案資料",
    requiresConnection: "google-drive",
    advanced: false,
  },
  {
    id: "notion",
    label: "Notion",
    hint: "從你的 Notion 挑頁面或資料庫",
    requiresConnection: "notion",
    advanced: false,
  },
  {
    id: "url",
    label: "網址",
    hint: "網頁與公開文件",
    requiresConnection: null,
    advanced: false,
  },
  {
    id: "tabular",
    label: "CSV / JSON",
    hint: "名單、排程等結構化資料",
    requiresConnection: null,
    advanced: false,
  },
  {
    id: "api",
    label: "外部 API",
    hint: "從你自己的系統抓資料",
    requiresConnection: "api",
    advanced: true,
  },
] as const;

export function addDataMethod(id: AddDataMethodId): AddDataMethod | undefined {
  return ADD_DATA_METHODS.find((m) => m.id === id);
}

/**
 * 依「目的地」過濾可用的加入方式。
 *
 * 專案內加入資料時，結構化表與外部 API 走的是另一套（表要選欄位對應、API 要先登記連線），
 * 硬塞進專案 flow 只會多一層 wizard——這兩項留在資料中心的完整入口。
 * 這是產品決策，不是能力缺口：backend 兩條路都還在，只是入口收斂。
 */
export function addDataMethodsFor(destination: "project" | "hub"): readonly AddDataMethod[] {
  if (destination === "hub") return ADD_DATA_METHODS;
  return ADD_DATA_METHODS.filter((m) => m.id !== "tabular" && m.id !== "api");
}

/* ────────────────────────── 連線狀態（來源只是加入方式） ────────────────────────── */

export type DataHubConnectionState = "connected" | "needs-reconnect" | "not-connected" | "unavailable";

/**
 * 連線狀態的人話。**注意**：這裡講的永遠只是「你能不能去挑東西」，
 * 絕不可以被讀成「AI 可以讀整顆 Drive」（不變量 I1）。
 */
export function dataHubConnectionLabel(state: DataHubConnectionState): string {
  switch (state) {
    case "connected":
      return "已連接";
    case "needs-reconnect":
      return "需要重新連接";
    case "unavailable":
      return "站方尚未設定";
    case "not-connected":
    default:
      return "尚未連接";
  }
}

export function dataHubConnectionState(input: {
  configured?: boolean;
  connected: boolean;
  status?: "active" | "error" | null;
}): DataHubConnectionState {
  if (input.configured === false) return "unavailable";
  if (!input.connected) return "not-connected";
  return input.status === "error" ? "needs-reconnect" : "connected";
}
