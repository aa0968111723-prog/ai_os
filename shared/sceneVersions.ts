/**
 * 單格分鏡的「版本」領域邏輯（單格工作室 / single-frame studio）。
 *
 * 為什麼不新開一張 asset_versions 表：
 *   同一格歷來的每一次生成本來就已經逐筆落在 `generations`（含 modelId／prompt／來源底圖／
 *   點數／成敗），而「現用是哪一版」的單一真相是 `scenes.assetId`／`scenes.narrationAssetId`
 *   這兩個指標欄。指標欄結構上就保證「同一 (scene, role) 至多一個現用版本」——
 *   這正是 `shared/animationContracts.ts` 的 AssetVersion 契約要用 uniqueness 檢查去逼出的性質。
 *   再開一張表只會讓同一件事有兩個真相，且需要對帳。
 *
 * 因此本模組是純投影：把「該格的生成紀錄 ＋ 現用指標」算成使用者看得懂的版本清單。
 * 純函式、無 I/O，伺服器（scenes.versions）與前端（單格工作室）共用同一份判斷，
 * 不會出現「前端給了按鈕、後端拒收」這種分岔。
 */
import type { ModelEntry } from "./models";

/**
 * 版本歸屬的槽位：畫面（scenes.assetId）／旁白（scenes.narrationAssetId）／
 * 環境音（scenes.ambienceAssetId）。三軌各自編版次，互不干擾。
 */
export type SceneVersionRole = "visual" | "narration" | "ambience";

/**
 * 版本在使用者眼中的狀態。與 `AssetVersionStatus`（candidate/selected/superseded/rejected）
 * 同一概念，但多帶「生成中／待審／失敗」——因為這裡直接投影生成紀錄，未完成的嘗試也要看得到。
 */
export type SceneVersionState =
  | "current" // 現用（= AssetVersion 的 selected）
  | "candidate" // 已完成、可一鍵切回（= candidate/superseded）
  | "generating" // 排隊或執行中
  | "awaiting_approval" // 成本審核中（未扣點、未送 provider）
  | "failed"; // 失敗或被駁回（已退點）

/** 一筆生成紀錄（投影所需欄位）；欄位名與 `generations` 一致 */
export interface SceneVersionGenerationRow {
  generationId: string;
  status: string;
  sceneRole: SceneVersionRole | null;
  modelId: string;
  prompt: string;
  /** 圖生圖的底圖網址（null＝文生圖，不是從某張改出來的） */
  sourceUrl: string | null;
  error: string | null;
  createdAt: string;
  pointsEst: number;
  pointsActual: number | null;
  pointsRefunded: number;
  /** 這筆生成落地的素材（null＝尚未落地／已回收） */
  assetId: string | null;
  assetUrl: string | null;
  assetKind: string | null;
}

/** 現用指標（scenes 表的兩個欄位）＋它們指到的素材 */
export interface SceneCurrentPointers {
  assetId: string | null;
  narrationAssetId: string | null;
  ambienceAssetId?: string | null;
}

/** 沒有對應生成紀錄、但目前正被引用的素材（例如「＋加入分鏡」帶進來的成品） */
export interface SceneExternalAsset {
  assetId: string;
  assetUrl: string | null;
  assetKind: string | null;
  createdAt: string;
  title: string | null;
}

export interface SceneVersion {
  /** 同一 role 內由舊到新的版次（1 起算）；外部帶入的素材也佔一個版次 */
  index: number;
  role: SceneVersionRole;
  state: SceneVersionState;
  isCurrent: boolean;
  /** null＝不是由本系統生成（外部帶入的素材），沒有模型／提示詞可回看 */
  generationId: string | null;
  modelId: string | null;
  prompt: string | null;
  sourceUrl: string | null;
  error: string | null;
  createdAt: string;
  assetId: string | null;
  assetUrl: string | null;
  assetKind: string | null;
  /** 這一版實際的點數（尚未結算時退回預估值） */
  points: number;
  /** 可否一鍵切成現用：要有落地素材、且不是現用 */
  canSetCurrent: boolean;
  /** 可否拿這一版當底圖再修：要有落地的「圖片」素材 */
  canRefineFrom: boolean;
  /** 可否把這一版的提示詞抄回這一格 */
  canReusePrompt: boolean;
}

/** 生成狀態 → 版本狀態（現用與否由指標決定，另外覆寫） */
function stateOf(status: string): SceneVersionState {
  if (status === "queued" || status === "running") return "generating";
  if (status === "awaiting_approval") return "awaiting_approval";
  if (status === "failed" || status === "rejected") return "failed";
  return "candidate";
}

/** 實花點數：結算後用 pointsActual 扣掉退回；未結算先用預估值（與帳本同口徑：淨消耗） */
function pointsOf(row: Pick<SceneVersionGenerationRow, "pointsEst" | "pointsActual" | "pointsRefunded">): number {
  const charged = row.pointsActual ?? row.pointsEst;
  return Math.max(0, charged - row.pointsRefunded);
}

/** 舊到新排序鍵：createdAt 相同時用 id 當決勝，確保版次穩定（不會每次查詢跳號） */
function ascending(a: { createdAt: string; key: string }, b: { createdAt: string; key: string }): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.key < b.key ? -1 : 1;
}

/**
 * 把生成紀錄 ＋ 現用指標 ＋ 外部帶入素材，算成版本清單（新到舊）。
 *
 * - 版次（index）依「同 role 由舊到新」編號，所以第 1 版永遠是第 1 版，不會因為新生成而跳號。
 * - 現用版本由指標決定，不看生成狀態——指標是單一真相。
 * - 外部帶入的素材（externals）只有在沒有任何生成紀錄指到同一個 assetId 時才另立一版，
 *   否則會與該筆生成重複顯示成兩版。
 */
/** 該 role 的現用指標。ambienceAssetId 為 optional（舊呼叫端沒帶＝這格沒有環境音）。 */
function pointerFor(role: SceneVersionRole, current: SceneCurrentPointers): string | null {
  if (role === "narration") return current.narrationAssetId;
  if (role === "ambience") return current.ambienceAssetId ?? null;
  return current.assetId;
}

export function buildSceneVersions(
  rows: readonly SceneVersionGenerationRow[],
  current: SceneCurrentPointers,
  externals: readonly SceneExternalAsset[] = [],
): SceneVersion[] {
  const seenAssetIds = new Set(rows.map((r) => r.assetId).filter((id): id is string => !!id));

  type Draft = Omit<SceneVersion, "index"> & { key: string };
  const drafts: Draft[] = [];

  for (const row of rows) {
    // sceneRole 為 null 的舊資料視為 visual（與 listByProject／advanceGeneration 同口徑）
    const role: SceneVersionRole =
      row.sceneRole === "narration" || row.sceneRole === "ambience" ? row.sceneRole : "visual";
    const pointer = pointerFor(role, current);
    const isCurrent = !!row.assetId && row.assetId === pointer;
    const state = isCurrent ? "current" : stateOf(row.status);
    drafts.push({
      key: row.generationId,
      role,
      state,
      isCurrent,
      generationId: row.generationId,
      modelId: row.modelId,
      prompt: row.prompt,
      sourceUrl: row.sourceUrl,
      error: row.error,
      createdAt: row.createdAt,
      assetId: row.assetId,
      assetUrl: row.assetUrl,
      assetKind: row.assetKind,
      points: pointsOf(row),
      canSetCurrent: !!row.assetId && !isCurrent && row.status === "done",
      canRefineFrom: !!row.assetId && row.assetKind === "image",
      canReusePrompt: row.prompt.trim() !== "",
    });
  }

  for (const ext of externals) {
    if (seenAssetIds.has(ext.assetId)) continue;
    // 外部帶入的音檔有兩個可能的家：先看它是不是某一軌的現用指標，指到誰就歸誰。
    // 都沒指到就沿用既有預設（旁白）——那是加環境音之前的行為，不該因為多一軌而改判。
    const role: SceneVersionRole =
      ext.assetKind !== "audio"
        ? "visual"
        : ext.assetId === (current.ambienceAssetId ?? null)
          ? "ambience"
          : "narration";
    const pointer = pointerFor(role, current);
    const isCurrent = ext.assetId === pointer;
    drafts.push({
      key: ext.assetId,
      role,
      state: isCurrent ? "current" : "candidate",
      isCurrent,
      generationId: null,
      modelId: null,
      prompt: null,
      sourceUrl: null,
      error: null,
      createdAt: ext.createdAt,
      assetId: ext.assetId,
      assetUrl: ext.assetUrl,
      assetKind: ext.assetKind,
      points: 0,
      canSetCurrent: !isCurrent,
      canRefineFrom: ext.assetKind === "image",
      canReusePrompt: false,
    });
  }

  // 版次：同 role 內由舊到新編號
  const counters: Record<SceneVersionRole, number> = { visual: 0, narration: 0, ambience: 0 };
  const ascendingAll = [...drafts].sort(ascending);
  const indexByKey = new Map<string, number>();
  for (const d of ascendingAll) {
    counters[d.role] += 1;
    indexByKey.set(d.key, counters[d.role]);
  }

  return ascendingAll
    .reverse()
    .map(({ key, ...rest }) => ({ ...rest, index: indexByKey.get(key) ?? 0 }));
}

export interface SceneVersionSummary {
  visual: number;
  narration: number;
  /** 有沒有仍在跑的版本（前端據此加快輪詢） */
  generating: boolean;
  currentVisualIndex: number | null;
  currentNarrationIndex: number | null;
}

export function summarizeSceneVersions(versions: readonly SceneVersion[]): SceneVersionSummary {
  const summary: SceneVersionSummary = {
    visual: 0,
    narration: 0,
    generating: false,
    currentVisualIndex: null,
    currentNarrationIndex: null,
  };
  for (const v of versions) {
    if (v.role === "narration") summary.narration += 1;
    else summary.visual += 1;
    if (v.state === "generating") summary.generating = true;
    if (v.isCurrent) {
      if (v.role === "narration") summary.currentNarrationIndex = v.index;
      else summary.currentVisualIndex = v.index;
    }
  }
  return summary;
}

/**
 * 同一 (scene, role) 至多一個現用版本——指標欄結構上已保證，這裡是防呆：
 * 若查詢投影寫錯（例如 join 出重複列）要當場炸，不要靜默讓 UI 出現兩個「現用」。
 */
export function findDuplicateCurrent(versions: readonly SceneVersion[]): SceneVersionRole[] {
  const seen = new Set<SceneVersionRole>();
  const dup = new Set<SceneVersionRole>();
  for (const v of versions) {
    if (!v.isCurrent) continue;
    if (seen.has(v.role)) dup.add(v.role);
    seen.add(v.role);
  }
  return [...dup];
}

// ─── 單格工作室可用的模型（前後端同一份判斷） ───────────────────────────

/**
 * 「重生這一格」可用的模型：不需要來源輸入，且輸出是畫面（圖／影片）。
 * 排除 needs 模型——它們沒有底圖會被 generationCore 直接擋下（白按一次才知道）。
 */
export function isSceneRegenModel(model: Pick<ModelEntry, "kind" | "needs">): boolean {
  return !model.needs && (model.kind === "image" || model.kind === "video");
}

/**
 * 「以這張為底圖修正」可用的模型：吃圖片來源、輸出仍是畫面。
 * 這一類就是 Adobe 式「把單張拉出來改」的核心——重繪／局部修／放大／去背／轉場動態，
 * 全都在 image-to-image 與 image-to-video 兩個類別裡。
 */
export function isSceneRefineModel(model: Pick<ModelEntry, "kind" | "needs">): boolean {
  return model.needs === "image" && (model.kind === "image" || model.kind === "video");
}

/** 「修正」用的模型分組標題：讓挑選器把「改圖」與「讓它動起來」分開，不要混成一長串 */
export function refineGroupOf(model: Pick<ModelEntry, "kind">): "image" | "video" {
  return model.kind === "video" ? "video" : "image";
}
