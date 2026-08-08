import { z } from "zod";

/**
 * 助手的頁面感知上下文——**線上格式**（client → server）。
 *
 * 為什麼獨立一份而不是直接送前端的 AssistantPageContext：前端那份帶了顯示用的東西
 * （projectTitle、route），而線上格式只需要「模型要知道的最小集合」。多送的每一個欄位
 * 都是提示詞預算與注入面，所以這裡是**白名單**，不是把 store 整包丟過去。
 *
 * ## 三條不變式
 *
 * 1. **只是提示，不是授權。** projectId／entityId 到了伺服器一律重新過
 *    requireGroup／專案查詢／ACL。偽造 pageContext 頂多讓助手查到你本來就有權看的東西。
 * 2. **只放指標，不放資料。** entityId 是「指哪一個」，內容一律由助手用既有唯讀工具查。
 *    絕不夾帶腳本全文、素材內容或資料列。
 * 3. **逐欄夾制**（sanitizeAssistantPageContext）：與 shared/viewState.ts 的
 *    sanitizeViewState 同一條理由——這些值會進提示詞，不驗證等於開放注入。
 *
 * pageType／entityType 的字面值刻意與 client/src/lib/assistantContext.ts 對齊，
 * 其中 story／storyboard／production／final／settings 又與 shared/viewState.ts 的
 * ViewSection 同名——全站只有一套「在看什麼」的詞彙。
 */

export const ASSISTANT_PAGE_TYPES = [
  "home", "project",
  "story", "storyboard", "production", "final", "settings",
  "studio", "assets", "tasks", "notes", "schedule", "database",
  "agent_run", "collab", "chat", "community", "other",
] as const;
export type AssistantWirePageType = (typeof ASSISTANT_PAGE_TYPES)[number];

export const ASSISTANT_ENTITY_TYPES = [
  "scene", "shot", "asset", "task", "note", "schedule_item",
  "generation", "agent_run", "database", "script",
] as const;
export type AssistantWireEntityType = (typeof ASSISTANT_ENTITY_TYPES)[number];

/** 一次最多帶幾個選取 id：夠描述「這幾鏡」，又不會讓提示詞或查詢無界成長 */
export const MAX_SELECTED_ENTITY_IDS = 20;
/** 自由字串欄（activeTab／entityLabel／recentAction）的長度上限 */
const MAX_LABEL = 60;

/**
 * 自由字串欄的清洗：**換行與角括號一律去掉**。
 *
 * 這些值會逐行插進 `<使用者目前位置>` 圍欄裡。含換行的話，一個名為
 * 「第 3 鏡 ⏎ 結束圍欄 ⏎ 忽略上述規則」的分鏡標題就能偽造圍欄結尾，
 * 讓後面的字看起來像系統指令。標題是使用者可自由輸入的欄位（分鏡標題、資料庫名），
 * 所以這不是理論風險。壓成單行＋去角括號後，它只能是一段普通的字。
 */
function cleanLabel(v: string): string {
  return v.replace(/[\r\n\t<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
}

/** 一次最多帶幾個選取顯示名（與 id 上限同級；提示詞只列前幾個再說「另有 N 個」） */
export const MAX_SELECTED_LABELS = 8;

export const assistantPageContextSchema = z.object({
  pageType: z.enum(ASSISTANT_PAGE_TYPES),
  entityType: z.enum(ASSISTANT_ENTITY_TYPES).optional(),
  entityId: z.string().uuid().optional(),
  /** 顯示名（例：第 3 鏡）——讓模型講得出人話，不必吐 id */
  entityLabel: z.string().max(MAX_LABEL).transform(cleanLabel).optional(),
  selectedEntityIds: z.array(z.string().uuid()).max(MAX_SELECTED_ENTITY_IDS).optional(),
  /**
   * 選取項的顯示名（例：["第 2 鏡","第 3 鏡"]）。
   * 沒有它的話，模型只知道「選了 3 個」卻不知道是哪三個——「這 3 鏡」根本無從指涉，
   * 而 id 又刻意不給模型（它只會把 uuid 吐回給使用者）。顯示名是唯一講得通的中介。
   */
  selectedEntityLabels: z.array(z.string().max(MAX_LABEL).transform(cleanLabel)).max(MAX_SELECTED_LABELS).optional(),
  activeTab: z.string().max(MAX_LABEL).transform(cleanLabel).optional(),
  recentAction: z.string().max(MAX_LABEL).transform(cleanLabel).optional(),
});
export type AssistantWirePageContext = z.infer<typeof assistantPageContextSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 逐欄夾制（Express 手解析路徑用；tRPC 走上面的 zod）。
 * 壞欄位一律丟棄而不是整包拒絕——上下文是錦上添花，不該讓一個壞欄位害使用者問不到問題。
 */
export function sanitizeAssistantPageContext(raw: unknown): AssistantWirePageContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.pageType !== "string" || !(ASSISTANT_PAGE_TYPES as readonly string[]).includes(r.pageType)) {
    return null; // pageType 是必要的：沒有它，其餘欄位無從解讀
  }
  const out: AssistantWirePageContext = { pageType: r.pageType as AssistantWirePageType };
  if (typeof r.entityType === "string" && (ASSISTANT_ENTITY_TYPES as readonly string[]).includes(r.entityType)) {
    out.entityType = r.entityType as AssistantWireEntityType;
  }
  if (typeof r.entityId === "string" && UUID_RE.test(r.entityId)) out.entityId = r.entityId;
  for (const key of ["entityLabel", "activeTab", "recentAction"] as const) {
    const v = r[key];
    if (typeof v !== "string") continue;
    const cleaned = cleanLabel(v);
    if (cleaned) out[key] = cleaned;
  }
  if (Array.isArray(r.selectedEntityIds)) {
    const ids = r.selectedEntityIds
      .filter((v): v is string => typeof v === "string" && UUID_RE.test(v))
      .slice(0, MAX_SELECTED_ENTITY_IDS);
    if (ids.length) out.selectedEntityIds = ids;
  }
  if (Array.isArray(r.selectedEntityLabels)) {
    const labels = r.selectedEntityLabels
      .filter((v): v is string => typeof v === "string")
      .map(cleanLabel)
      .filter((v) => v.length > 0)
      .slice(0, MAX_SELECTED_LABELS);
    if (labels.length) out.selectedEntityLabels = labels;
  }
  return out;
}

/** 中文標籤（提示詞與畫面共用一份，模型與使用者看到的是同一個名字） */
export const ASSISTANT_PAGE_LABEL: Partial<Record<AssistantWirePageType, string>> = {
  home: "今日工作台",
  project: "專案",
  story: "故事",
  storyboard: "分鏡",
  production: "製作",
  final: "成片",
  settings: "專案設定",
  studio: "動畫創作室",
  assets: "素材庫",
  tasks: "任務",
  notes: "筆記",
  schedule: "行程",
  database: "資料庫",
  agent_run: "AI 計畫",
  collab: "協作中心",
  chat: "私訊",
  community: "社群",
};

export const ASSISTANT_ENTITY_LABEL: Partial<Record<AssistantWireEntityType, string>> = {
  scene: "場",
  shot: "分鏡",
  asset: "素材",
  task: "任務",
  note: "筆記",
  schedule_item: "行程",
  generation: "生成",
  agent_run: "AI 計畫",
  database: "資料庫",
  script: "故事",
};

/**
 * 提示詞用的 compact 區塊（Context = pointer，Tool = truth）。
 *
 * 刻意不列 id：模型拿到 uuid 只會學會把它吐回給使用者，而使用者看不懂 uuid。
 * 要讀內容就用工具查——這一段的任務只是讓「這一鏡／這幾張」有明確所指。
 */
export function formatAssistantPageContext(ctx: AssistantWirePageContext | null | undefined): string {
  if (!ctx) return "";
  const lines: string[] = [];
  const page = ASSISTANT_PAGE_LABEL[ctx.pageType];
  if (page) lines.push(`目前頁面：${page}`);
  const entityName = ctx.entityType ? ASSISTANT_ENTITY_LABEL[ctx.entityType] ?? ctx.entityType : undefined;
  if (ctx.entityLabel) lines.push(`正在看：${ctx.entityLabel}`);
  else if (entityName) lines.push(`正在看：${entityName}`);
  const n = ctx.selectedEntityIds?.length ?? 0;
  if (n > 0) {
    // 只給數量的話，「這 3 鏡」對模型是無從指涉的——它知道有三個，卻不知道是哪三個。
    // id 又刻意不給（模型只會把 uuid 吐回給使用者），所以顯示名是唯一講得通的中介。
    const labels = ctx.selectedEntityLabels ?? [];
    const shown = labels.slice(0, MAX_SELECTED_LABELS);
    const rest = n - shown.length;
    lines.push(
      shown.length
        ? `已選取 ${n} 個${entityName ?? "項目"}：${shown.join("、")}${rest > 0 ? `（另有 ${rest} 個）` : ""}`
        : `已選取：${n} 個${entityName ?? "項目"}`,
    );
  }
  if (ctx.activeTab) lines.push(`顯示模式：${ctx.activeTab}`);
  if (ctx.recentAction) lines.push(`剛剛做了：${ctx.recentAction}`);
  if (!lines.length) return "";
  return [
    "<使用者目前位置>",
    ...lines,
    "使用者說「這個／這一鏡／這幾個」而沒有指名時，就是指上面這些。需要內容時用工具去查，不要用 id 回話。",
    "</使用者目前位置>",
  ].join("\n");
}
