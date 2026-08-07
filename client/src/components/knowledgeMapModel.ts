/**
 * 知識族譜（知識地圖・心智圖）的資料模型：把 knowledgeMap.graph 的六類原料
 * 濾成「分支 → 葉節點」的樹。抽成純函式的理由有二：
 * - 心智圖與清單兩種檢視吃同一棵樹，語意不能有第二套（篩到的節點在兩邊必須一致）。
 * - 濾鏡（鏡頭／專案／型別／搜尋）的組合規則是這張圖最容易出錯的地方，純函式才測得動。
 * 佈局、拖拉、導航仍留在 PlannerPage 的 KnowledgeMapCard。
 */

/** 葉節點的五種型別：筆記／行程（排程頁上方兩卡）＋知識庫／AI 執行計畫（掛專案）＋資料庫（組相關） */
export type LeafKind = "note" | "schedule" | "knowledge" | "agent" | "db";

/** 「團隊／個人／提及」三種鏡頭 */
export type MapLens = "all" | "mine" | "mentioned";

/**
 * 點節點後的導航動作：
 * anchor＝跳到本頁上方那筆；project＝進專案頁；db＝資料庫頁（可帶 ?open= 深連結）；
 * branch＝把這一支帶到清單檢視展開（心智圖每支只畫得下幾片葉子，其餘由清單接手）。
 */
export type MapNav =
  | { type: "anchor"; anchorId: string }
  | { type: "project"; projectId: string }
  | { type: "db"; tableId?: string }
  | { type: "branch"; key: string }
  | null;

export type MapLeaf = { id: string; kind: LeafKind; label: string; sub: string; nav: MapNav };
export type MapBranchKind = "project" | "bucket" | "dbhub";
export type MapBranch = { key: string; label: string; kind: MapBranchKind; projectId: string | null; leaves: MapLeaf[] };

/** knowledgeMap.graph 的回傳形狀（superjson 下日期是 Date，顯示前仍防禦性包 new Date） */
export type MapGraphData = {
  projects: Array<{ id: string; title: string; status: string; updatedAt: string | Date }>;
  notes: Array<{ id: string; projectId: string | null; title: string; createdBy: string; mentions: string[] | null; updatedAt: string | Date }>;
  schedule: Array<{ id: string; projectId: string | null; title: string; startsAt: string | Date; createdBy: string; mentions: string[] | null }>;
  knowledge: Array<{ id: string; projectId: string; kind: string; title: string; chars: number; createdBy: string; createdAt: string | Date }>;
  agents: Array<{ id: string; projectId: string; goal: string; status: string; estPoints: number; userId: string; updatedAt: string | Date }>;
  databases: Array<{ id: string; scope: string; name: string; rowCount: number; agentAccess: string; createdBy: string; updatedAt: string | Date }>;
};

export const KNOWLEDGE_KIND_LABEL: Record<string, string> = { transcript: "師父開示稿", testimony: "見證故事", script: "腳本", note: "其他筆記" };
export const AGENT_STATUS_LABEL: Record<string, string> = { awaiting_approval: "待核准", running: "執行中", done: "已完成", failed: "失敗", stopped: "已停止" };
export const DB_SCOPE_LABEL: Record<string, string> = { personal: "個人", group: "組", team: "團隊", global: "全站" };
export const DB_AGENT_ACCESS_LABEL: Record<string, string> = { none: "不開放 AI", read: "AI 唯讀", write: "AI 可查可寫" };

export const LEAF_TOGGLES: Array<{ kind: LeafKind; label: string }> = [
  { kind: "note", label: "筆記" },
  { kind: "schedule", label: "行程" },
  { kind: "knowledge", label: "知識" },
  { kind: "agent", label: "AI 執行計畫" },
  { kind: "db", label: "資料庫" },
];

export const LEAF_KIND_LABEL: Record<LeafKind, string> = {
  note: "筆記",
  schedule: "行程",
  knowledge: "知識",
  agent: "AI 執行計畫",
  db: "資料庫",
};

/** 組層級（未掛專案）分支與資料庫分支的固定 key——兩者不是專案，另外命名以免和專案 id 撞號 */
export const GROUP_BRANCH_KEY = "__group";
export const DB_BRANCH_KEY = "__db";

export type BuildOptions = {
  /** 目前登入者 id（鏡頭「我的」用） */
  meId: string;
  lens: MapLens;
  /** ""＝全部專案 */
  focusProject: string;
  types: Record<LeafKind, boolean>;
  /** 關鍵字（比對節點標題、副標與所屬分支名；空字串＝不過濾） */
  query: string;
  fmtDateTime: (d: string | Date) => string;
};

export type BuiltGraph = {
  branches: MapBranch[];
  counts: Record<LeafKind, number>;
  /** 濾完後圖上共有幾個葉節點 */
  total: number;
};

/**
 * 依鏡頭／專案聚焦／型別開關／關鍵字，把六類原料織成「分支 → 葉」的樹。
 *
 * 分支排序：內容多的在前，資料庫分支固定墊底（它不屬於任何專案，放最後才不會插隊擠掉專案）。
 * 葉排序：知識（沉澱）→ 筆記 → 行程 → AI 執行計畫（動態），同分支內由靜到動。
 * 這裡**不做任何數量截斷**——清單檢視要能看到全部；心智圖自己再取前幾支／前幾片。
 */
export function buildKnowledgeBranches(data: MapGraphData, opts: BuildOptions): BuiltGraph {
  const { meId, lens, focusProject, types, fmtDateTime } = opts;
  const q = opts.query.trim().toLowerCase();

  // 鏡頭：全組看全部；「我的」＝我建立的（各型別皆適用）；「提及我」只有筆記／行程有 @提及語意
  const inLens = (createdBy: string, mentions?: string[] | null) => {
    if (lens === "all") return true;
    if (lens === "mine") return createdBy === meId;
    return Array.isArray(mentions) && mentions.includes(meId);
  };
  const projTitle = (pid: string | null) => (pid ? data.projects.find((p) => p.id === pid)?.title ?? "（已移除專案）" : null);

  const noteRows = data.notes.filter((n) => types.note && inLens(n.createdBy, n.mentions) && (!focusProject || n.projectId === focusProject));
  const schedRows = data.schedule.filter((e) => types.schedule && inLens(e.createdBy, e.mentions) && (!focusProject || e.projectId === focusProject));
  const knowRows = data.knowledge.filter((k) => types.knowledge && inLens(k.createdBy) && (!focusProject || k.projectId === focusProject));
  const agentRows = data.agents.filter((a) => types.agent && inLens(a.userId) && (!focusProject || a.projectId === focusProject));
  // 資料庫不掛專案：聚焦某專案時不畫（避免誤導成「這庫屬於這個專案」）
  const dbRows = focusProject ? [] : data.databases.filter((d) => types.db && inLens(d.createdBy));

  const branches = new Map<string, MapBranch>();
  const branchOf = (pid: string | null) => {
    const key = pid ?? GROUP_BRANCH_KEY;
    let b = branches.get(key);
    if (!b) {
      b = { key, label: pid ? projTitle(pid) ?? "專案" : "組層級", kind: pid ? "project" : "bucket", projectId: pid, leaves: [] };
      branches.set(key, b);
    }
    return b;
  };

  for (const k of knowRows)
    branchOf(k.projectId).leaves.push({
      id: `k-${k.id}`,
      kind: "knowledge",
      label: k.title,
      sub: `知識庫・${KNOWLEDGE_KIND_LABEL[k.kind] ?? k.kind}・${k.chars.toLocaleString()} 字`,
      nav: { type: "project", projectId: k.projectId },
    });
  for (const n of noteRows)
    branchOf(n.projectId).leaves.push({
      id: `n-${n.id}`,
      kind: "note",
      label: n.title,
      sub: `筆記・${fmtDateTime(n.updatedAt)} 更新`,
      nav: { type: "anchor", anchorId: `note-${n.id}` },
    });
  for (const e of schedRows)
    branchOf(e.projectId).leaves.push({
      id: `s-${e.id}`,
      kind: "schedule",
      label: e.title,
      sub: `行程・${fmtDateTime(e.startsAt)}`,
      nav: { type: "anchor", anchorId: `schedule-${e.id}` },
    });
  for (const a of agentRows)
    branchOf(a.projectId).leaves.push({
      id: `a-${a.id}`,
      kind: "agent",
      label: a.goal,
      sub: `AI 執行計畫・${AGENT_STATUS_LABEL[a.status] ?? a.status}・估 ${a.estPoints} 點`,
      nav: { type: "project", projectId: a.projectId },
    });

  if (dbRows.length > 0) {
    branches.set(DB_BRANCH_KEY, {
      key: DB_BRANCH_KEY,
      label: "資料庫",
      kind: "dbhub",
      projectId: null,
      leaves: dbRows.map((d) => ({
        id: `d-${d.id}`,
        kind: "db" as const,
        label: d.name,
        sub: `資料庫・${DB_SCOPE_LABEL[d.scope] ?? d.scope}・${d.rowCount.toLocaleString()} 列・${DB_AGENT_ACCESS_LABEL[d.agentAccess] ?? d.agentAccess}`,
        nav: { type: "db", tableId: d.id },
      })),
    });
  }

  // 關鍵字：比對葉的標題與副標；分支名命中則整支保留（搜「爬山」要能一次看到那個專案底下全部）
  const filtered: MapBranch[] = [];
  for (const b of branches.values()) {
    const branchHit = !!q && b.label.toLowerCase().includes(q);
    const leaves = !q || branchHit ? b.leaves : b.leaves.filter((l) => `${l.label} ${l.sub}`.toLowerCase().includes(q));
    if (leaves.length > 0) filtered.push({ ...b, leaves });
  }

  // 內容多的分支在前；資料庫分支墊底（不屬於任何專案）。
  // 同數量時專案優先於「組層級」——專案是主要的組織單位，雜項桶不該插在專案中間。
  filtered.sort((a, b) => {
    if ((a.kind === "dbhub") !== (b.kind === "dbhub")) return a.kind === "dbhub" ? 1 : -1;
    if (a.leaves.length !== b.leaves.length) return b.leaves.length - a.leaves.length;
    if (a.kind !== b.kind) return a.kind === "project" ? -1 : 1;
    return 0;
  });

  const counts: Record<LeafKind, number> = { note: 0, schedule: 0, knowledge: 0, agent: 0, db: 0 };
  for (const b of filtered) for (const l of b.leaves) counts[l.kind] += 1;

  return { branches: filtered, counts, total: filtered.reduce((n, b) => n + b.leaves.length, 0) };
}
