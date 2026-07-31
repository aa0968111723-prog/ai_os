/**
 * 知識庫注入組裝（純函式，前後端／單元測試共用）。
 *
 * 目標：在固定字數預算內，優先塞「對的幾篇」而不是只塞「最新的」。
 * - preferIds：呼叫端指定（代理／預覽）永遠最前
 * - pinned：使用者釘選，次優先
 * - mode 決定其餘排序與配額
 */

export const KNOWLEDGE_INJECT_BUDGET_DEFAULT = 8_000;

export type KnowledgeKindId = "transcript" | "testimony" | "script" | "note";

export type KnowledgeInjectMode =
  /** 各 kind 配額（腳本／開示優先於筆記雜訊） */
  | "balanced"
  /** 腳本先全塞，剩餘再給其他 kind */
  | "script_first"
  /** 只注入腳本（拆分鏡用；通常不含卡片） */
  | "script_only"
  /** 舊行為近似：釘選後依時間新→舊，無 kind 配額 */
  | "flat";

export type KnowledgeRowForInject = {
  id: string;
  kind: string;
  title: string;
  content: string;
  pinned?: boolean;
  /** 抽取摘要；預算緊時可塞摘要覆蓋更多篇 */
  summary?: string | null;
  createdAt?: Date | string | number | null;
};

/** 摘要目標長度（中文約 2～4 句） */
export const KNOWLEDGE_SUMMARY_MAX = 280;

/**
 * 抽取式摘要（不呼叫 LLM）：取前段完整句子，壓空白後截斷。
 * 更新／新增知識時寫入 DB，注入時可當「預算緊」的備援。
 */
export function extractKnowledgeSummary(content: string, max = KNOWLEDGE_SUMMARY_MAX): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  if (flat.length <= max) return flat;
  // 優先在句號／問號／換行附近切斷
  const slice = flat.slice(0, max);
  const breakAt = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("！"), slice.lastIndexOf("？"), slice.lastIndexOf(". "));
  if (breakAt >= Math.floor(max * 0.45)) return slice.slice(0, breakAt + 1).trim();
  return `${slice.trim()}…`;
}

export type KnowledgeInjectOptions = {
  budgetChars?: number;
  /** 指定 id 永遠排最前（順序保留） */
  preferIds?: string[];
  /** 是否前置角色／場景卡片段落（字數計入 budget） */
  includeCards?: boolean;
  mode?: KnowledgeInjectMode;
};

/** balanced 模式：腳本與開示拿較多額度 */
export const KIND_BUDGET_WEIGHTS: Record<KnowledgeKindId, number> = {
  script: 0.4,
  transcript: 0.3,
  testimony: 0.15,
  note: 0.15,
};

export type KnowledgeItemInjectStatus = "full" | "partial" | "skipped";

export type KnowledgeItemInjectReport = {
  id: string;
  title: string;
  kind: string;
  pinned: boolean;
  chars: number;
  includedChars: number;
  status: KnowledgeItemInjectStatus;
};

export type KnowledgeInjectResult = {
  text: string;
  totalContentChars: number;
  includedChars: number;
  truncated: boolean;
  cardsIncluded: boolean;
  mode: KnowledgeInjectMode;
  budgetChars: number;
  items: KnowledgeItemInjectReport[];
};

function asTime(v: KnowledgeRowForInject["createdAt"]): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  const n = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** 正規化 kind；未知當 note */
export function normalizeKnowledgeKind(kind: string): KnowledgeKindId {
  if (kind === "transcript" || kind === "testimony" || kind === "script" || kind === "note") return kind;
  return "note";
}

/**
 * 排序：preferIds 順序 → pinned（新先）→ 其餘（新先）。
 * script_first 在「非 prefer」區再把 script 整段提前。
 */
export function rankKnowledgeRows(
  rows: KnowledgeRowForInject[],
  preferIds: string[] = [],
  mode: KnowledgeInjectMode = "balanced",
): KnowledgeRowForInject[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: KnowledgeRowForInject[] = [];

  for (const id of preferIds) {
    const row = byId.get(id);
    if (!row || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }

  const rest = rows
    .filter((r) => !seen.has(r.id))
    .slice()
    .sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      if (mode === "script_first") {
        const as = normalizeKnowledgeKind(a.kind) === "script" ? 1 : 0;
        const bs = normalizeKnowledgeKind(b.kind) === "script" ? 1 : 0;
        if (as !== bs) return bs - as;
      }
      return asTime(b.createdAt) - asTime(a.createdAt);
    });

  return out.concat(rest);
}

function emptyReport(row: KnowledgeRowForInject): KnowledgeItemInjectReport {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    pinned: !!row.pinned,
    chars: row.content.length,
    includedChars: 0,
    status: "skipped",
  };
}

/**
 * 在 budget 內依序塞入列；回傳文字片段與每筆狀態。
 * labelOf 把 kind 轉成人話（呼叫端提供，避免 shared 綁 UI 字串）。
 */
export function fillKnowledgeBudget(
  ranked: KnowledgeRowForInject[],
  budgetChars: number,
  labelOf: (kind: string) => string,
): { parts: string[]; includedChars: number; truncated: boolean; items: KnowledgeItemInjectReport[] } {
  const items = ranked.map(emptyReport);
  const reportById = new Map(items.map((i) => [i.id, i]));
  const parts: string[] = [];
  let budget = Math.max(0, budgetChars);
  let includedChars = 0;
  let truncated = false;

  for (const row of ranked) {
    const rep = reportById.get(row.id)!;
    if (budget <= 0) {
      truncated = true;
      continue;
    }
    const slice = row.content.slice(0, budget);
    if (slice.length < row.content.length) truncated = true;
    rep.includedChars = slice.length;
    rep.status = slice.length >= row.content.length ? "full" : slice.length > 0 ? "partial" : "skipped";
    includedChars += slice.length;
    parts.push(
      `【${labelOf(row.kind)}｜${row.title}】\n${slice}${row.content.length > slice.length ? "…(截斷)" : ""}`,
    );
    budget -= slice.length;
  }

  // 還有列完全沒吃到
  if (items.some((i) => i.status === "skipped" && i.chars > 0)) truncated = true;

  return { parts, includedChars, truncated, items };
}

/**
 * balanced：各 kind 依權重切預算；剩餘再第二輪依 rank 補。
 * 其他 mode：單一路 fillKnowledgeBudget。
 */
export function assembleKnowledgeBody(
  ranked: KnowledgeRowForInject[],
  budgetChars: number,
  mode: KnowledgeInjectMode,
  labelOf: (kind: string) => string,
): { parts: string[]; includedChars: number; truncated: boolean; items: KnowledgeItemInjectReport[] } {
  if (mode === "script_only") {
    const only = ranked.filter((r) => normalizeKnowledgeKind(r.kind) === "script");
    // 無腳本時退回全部（避免拆分鏡完全空；呼叫端可再判斷）
    return fillKnowledgeBudget(only.length ? only : ranked, budgetChars, labelOf);
  }

  if (mode !== "balanced") {
    return fillKnowledgeBudget(ranked, budgetChars, labelOf);
  }

  const budget = Math.max(0, budgetChars);
  if (budget === 0) {
    return {
      parts: [],
      includedChars: 0,
      truncated: ranked.length > 0,
      items: ranked.map(emptyReport),
    };
  }

  // 第一輪：依 kind 配額
  const byKind = new Map<KnowledgeKindId, KnowledgeRowForInject[]>();
  for (const k of Object.keys(KIND_BUDGET_WEIGHTS) as KnowledgeKindId[]) byKind.set(k, []);
  for (const row of ranked) {
    const k = normalizeKnowledgeKind(row.kind);
    byKind.get(k)!.push(row);
  }

  const reportById = new Map<string, KnowledgeItemInjectReport>();
  for (const row of ranked) reportById.set(row.id, emptyReport(row));

  const parts: string[] = [];
  let includedChars = 0;
  let leftover = 0;
  const kinds = Object.keys(KIND_BUDGET_WEIGHTS) as KnowledgeKindId[];

  for (const kind of kinds) {
    const pool = byKind.get(kind) ?? [];
    const share = Math.floor(budget * KIND_BUDGET_WEIGHTS[kind]);
    let kindBudget = share;
    if (pool.length === 0) {
      leftover += share;
      continue;
    }
    for (const row of pool) {
      const rep = reportById.get(row.id)!;
      if (kindBudget <= 0) break;
      const slice = row.content.slice(0, kindBudget);
      rep.includedChars = slice.length;
      rep.status = slice.length >= row.content.length ? "full" : "partial";
      includedChars += slice.length;
      parts.push(
        `【${labelOf(row.kind)}｜${row.title}】\n${slice}${row.content.length > slice.length ? "…(截斷)" : ""}`,
      );
      kindBudget -= slice.length;
    }
    leftover += kindBudget;
  }

  // 第二輪：用 leftover 依 rank 補 partial／skipped
  if (leftover > 0) {
    for (const row of ranked) {
      if (leftover <= 0) break;
      const rep = reportById.get(row.id)!;
      if (rep.status === "full") continue;
      const already = rep.includedChars;
      const need = row.content.length - already;
      if (need <= 0) continue;
      const take = Math.min(need, leftover);
      const extra = row.content.slice(already, already + take);
      // 重寫該篇段落（簡化：append 片段標記；為保持單一段落乾淨，重建該 id 的 part）
      rep.includedChars = already + take;
      rep.status = rep.includedChars >= row.content.length ? "full" : "partial";
      includedChars += take;
      leftover -= take;
      // 從 parts 移除舊篇再推新
      const label = `【${labelOf(row.kind)}｜${row.title}】\n`;
      const idx = parts.findIndex((p) => p.startsWith(label));
      const fullSlice = row.content.slice(0, rep.includedChars);
      const block = `${label}${fullSlice}${rep.includedChars < row.content.length ? "…(截斷)" : ""}`;
      if (idx >= 0) parts[idx] = block;
      else parts.push(block);
    }
  }

  const items = ranked.map((r) => reportById.get(r.id)!);
  const truncated =
    items.some((i) => i.status !== "full" && i.chars > 0) || items.some((i) => i.status === "skipped" && i.chars > 0);

  return { parts, includedChars, truncated, items };
}

/** 組裝完整注入文字（含可選 cardBlock 前綴） */
export function assembleKnowledgeContext(
  rows: KnowledgeRowForInject[],
  cardBlock: string,
  labelOf: (kind: string) => string,
  options: KnowledgeInjectOptions = {},
): KnowledgeInjectResult {
  const mode: KnowledgeInjectMode = options.mode ?? "balanced";
  const includeCards = options.includeCards !== false && mode !== "script_only";
  const budgetChars = Math.max(0, options.budgetChars ?? KNOWLEDGE_INJECT_BUDGET_DEFAULT);
  const preferIds = options.preferIds ?? [];

  let working = rows;
  if (mode === "script_only") {
    working = rows.filter((r) => normalizeKnowledgeKind(r.kind) === "script");
    if (working.length === 0) working = rows; // 無腳本時退回全部
  }

  const totalContentChars = rows.reduce((sum, r) => sum + r.content.length, 0);
  const byId = new Map(working.map((r) => [r.id, r]));
  const preferred: KnowledgeRowForInject[] = [];
  const preferSeen = new Set<string>();
  for (const id of preferIds) {
    const row = byId.get(id);
    if (!row || preferSeen.has(id)) continue;
    preferSeen.add(id);
    preferred.push(row);
  }
  const restPool = working.filter((r) => !preferSeen.has(r.id));
  const rankedRest = rankKnowledgeRows(restPool, [], mode);

  if (preferred.length === 0 && rankedRest.length === 0 && !(includeCards && cardBlock)) {
    return {
      text: "",
      totalContentChars,
      includedChars: 0,
      truncated: false,
      cardsIncluded: false,
      mode,
      budgetChars,
      items: [],
    };
  }

  const parts: string[] = [];
  let budget = budgetChars;
  let cardsIncluded = false;
  if (includeCards && cardBlock) {
    parts.push(cardBlock);
    budget = Math.max(0, budget - cardBlock.length);
    cardsIncluded = true;
  }

  // 預留一部分預算給「未全文納入篇」的摘要補丁（避免長文吃光後無法覆蓋其他篇）
  const summaryReserve = Math.min(400, Math.floor(budget * 0.18));
  let mainBudget = Math.max(0, budget - summaryReserve);

  // 指定來源先完整佔預算（與代理 pick 行為一致；prefer 可用 main+reserve）
  const preferFill = fillKnowledgeBudget(preferred, mainBudget + summaryReserve, labelOf);
  parts.push(...preferFill.parts);
  const afterPrefer = Math.max(0, mainBudget + summaryReserve - preferFill.includedChars);
  // 摘要預留：prefer 吃完後若仍 > summaryReserve，其餘給 body
  mainBudget = Math.max(0, afterPrefer - summaryReserve);
  let summaryBudget = Math.min(summaryReserve, afterPrefer);

  const body = assembleKnowledgeBody(rankedRest, mainBudget, mode, labelOf);
  parts.push(...body.parts);
  // body 沒用完的加回摘要預算
  summaryBudget += Math.max(0, mainBudget - body.includedChars);
  let budgetForSummary = summaryBudget;

  // 合併 report：prefer + rest
  const items = [...preferFill.items, ...body.items];
  let includedChars = preferFill.includedChars + body.includedChars;

  // 摘要補丁：只給「完全沒進」的篇目（partial 已有正文開頭，不再塞摘要搶預算）
  const rowMap = new Map(working.map((r) => [r.id, r]));
  for (const rep of items) {
    if (budgetForSummary <= 0) break;
    if (rep.status !== "skipped") continue;
    const row = rowMap.get(rep.id);
    const summary = row?.summary?.trim() || (row ? extractKnowledgeSummary(row.content) : "");
    if (!summary) continue;
    const slice = summary.slice(0, budgetForSummary);
    const block = `【摘要｜${rep.title}】\n${slice}${summary.length > slice.length ? "…(截斷)" : ""}`;
    parts.push(block);
    budgetForSummary -= slice.length;
    includedChars += slice.length;
    rep.status = "partial";
    rep.includedChars = slice.length;
  }

  const truncated =
    preferFill.truncated || body.truncated || items.some((i) => i.status !== "full" && i.chars > 0);

  return {
    text: parts.filter(Boolean).join("\n\n"),
    totalContentChars,
    includedChars,
    truncated,
    cardsIncluded,
    mode,
    budgetChars,
    items,
  };
}
