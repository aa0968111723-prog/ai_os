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
  /** Creative Direction v4：這一版是哪個方向、屬於哪一批、從哪一版延伸（null＝不是方向變體） */
  creative?: SceneVersionCreative | null;
}

/**
 * 方向與血緣投影（v4）。
 *
 * 值來自 `generations.params.__aiosSourceMeta.creative`——與版本清單同一筆生成紀錄，
 * 不是第二份真相。這也是「partial failure reload 後仍然一致」的關鍵：
 * 一批變體的身分（batchId）落在 DB 裡，不在 React state 裡。
 */
export interface SceneVersionCreative {
  batchId: string;
  directionId: string;
  directionLabel: string;
  keep?: string[];
  /** 使用者是從哪一版按下「再用這版變體」的——V2 →（變體）→ V5 的那條線 */
  parentAssetId?: string;
  batchSize?: number;
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
  /** 方向與血緣（null＝一般生成／外部帶入，不是方向變體） */
  creative: SceneVersionCreative | null;
  /**
   * 血緣：這一版延伸自第幾版（null＝沒有可解析的來源）。
   * 由 parentAssetId 對回同一份版本清單算出來，所以「V5 是從 V2 延伸」在 UI 上
   * 講的是使用者看得到的版次，而不是一串 uuid。
   */
  parentIndex: number | null;
}

/** 生成狀態 → 版本狀態（現用與否由指標決定，另外覆寫） */
function stateOf(status: string): SceneVersionState {
  if (status === "queued" || status === "running") return "generating";
  if (status === "awaiting_approval") return "awaiting_approval";
  if (status === "failed" || status === "rejected") return "failed";
  return "candidate";
}

/**
 * 實花點數：結算後用 pointsActual 扣掉退回；未結算先用預估值（與帳本同口徑：淨消耗）。
 *
 * `awaiting_approval` 例外回 0（IR-2 / #725 P2）：那個狀態的定義就是
 * **未扣點、未送 provider**（見上面 SceneVersionState 的註解），
 * 但 pointsActual 是 null，沿用 pointsEst 會讓「實際淨花費」把還沒發生的錢算進去。
 * 三個變體全部卡在待核時，UI 會顯示花了 3×N 點而帳本上是 0——對使用者是謊報。
 * 被駁回／取消（rejected → failed）同理：從未扣點，退點欄也不會有值。
 */
function pointsOf(
  row: Pick<SceneVersionGenerationRow, "pointsEst" | "pointsActual" | "pointsRefunded" | "status">,
): number {
  if (row.status === "awaiting_approval" || row.status === "rejected") return 0;
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
      creative: row.creative ?? null,
      parentIndex: null, // 版次還沒編，血緣在下方編號完成後回填
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
      creative: null,
      parentIndex: null,
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

  // 血緣：parentAssetId → 那一版的版次。編號完成後才算得出來，所以放在這裡而不是建 draft 時。
  const indexByAssetId = new Map<string, number>();
  for (const draft of ascendingAll) {
    if (draft.assetId) indexByAssetId.set(draft.assetId, indexByKey.get(draft.key) ?? 0);
  }

  return ascendingAll
    .reverse()
    .map(({ key, ...rest }) => ({
      ...rest,
      index: indexByKey.get(key) ?? 0,
      parentIndex: rest.creative?.parentAssetId ? indexByAssetId.get(rest.creative.parentAssetId) ?? null : null,
    }));
}

/**
 * 一批方向變體的狀態——**完全由持久化的版本清單推導**。
 *
 * 這支存在的理由是 v3 的實際缺口：批次身分只活在 React state 裡，重新整理就沒了，
 * 於是「A 成功／B 失敗／C 等待核准」這件事在 reload 之後講不出來。batchId 現在
 * 落在 `generations.params` 內，所以同一批在任何一次查詢都湊得回來，
 * 不需要第二個 candidate 資料表，也不需要前端記憶。
 */
export interface VisualVariantBatch {
  batchId: string;
  /** 送出時就寫進 meta 的預期數量；用來算「還缺幾個」 */
  requested: number;
  versions: SceneVersion[];
  successes: SceneVersion[];
  failed: SceneVersion[];
  generating: SceneVersion[];
  awaitingApproval: SceneVersion[];
  /** 送出當下就失敗、連生成列都沒建起來的 slot 數（requested − 實際落庫數） */
  missing: number;
  settled: boolean;
  actualPoints: number;
  /** 可並排比較的候選（最多 3 個，與 Compare 上限同口徑） */
  compareAssetIds: string[];
  createdAt: string;
}

/** 把版本清單分群成「批」；新到舊。沒有方向 meta 的版本不屬於任何一批。 */
export function groupVisualVariantBatches(versions: readonly SceneVersion[]): VisualVariantBatch[] {
  const byBatch = new Map<string, SceneVersion[]>();
  for (const version of versions) {
    if (version.role !== "visual" || !version.creative) continue;
    const rows = byBatch.get(version.creative.batchId);
    if (rows) rows.push(version);
    else byBatch.set(version.creative.batchId, [version]);
  }

  const batches: VisualVariantBatch[] = [];
  for (const [batchId, rows] of byBatch) {
    const successes = rows.filter((row) => !!row.assetId && row.state !== "failed");
    const failed = rows.filter((row) => row.state === "failed");
    const generating = rows.filter((row) => row.state === "generating");
    const awaitingApproval = rows.filter((row) => row.state === "awaiting_approval");
    // batchSize 是送出當下寫進 meta 的；舊資料沒有就退回「看得到幾筆算幾筆」
    const requested = Math.max(rows[0]?.creative?.batchSize ?? rows.length, rows.length);
    batches.push({
      batchId,
      requested,
      versions: rows,
      successes,
      failed,
      generating,
      awaitingApproval,
      missing: Math.max(0, requested - rows.length),
      settled: generating.length === 0 && awaitingApproval.length === 0,
      actualPoints: rows.reduce((sum, row) => sum + row.points, 0),
      compareAssetIds: successes.map((row) => row.assetId!).slice(0, 3),
      createdAt: rows.reduce((latest, row) => (row.createdAt > latest ? row.createdAt : latest), rows[0]!.createdAt),
    });
  }
  return batches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
 * 動作走位要不要注入這個模型。
 *
 * 只有影片類吃。走位是時間性的——「從門口走到窗邊」在單張圖上畫不出來，
 * 擴散模型收到只會試圖同時呈現起點與終點，生出多重人影或糊掉的肢體。
 * 這正是把 action 從 prompt 拆出來的目的：拆開之後才有辦法各自注入。
 */
export function sceneActionAppliesTo(model: Pick<ModelEntry, "kind"> | undefined): boolean {
  return model?.kind === "video";
}

/**
 * 這一鏡送給模型的畫面提示詞：畫面描述，影片類再接上走位。
 * 兩者都空就回空字串（呼叫端據此擋下「沒有提示詞就送生成」）。
 */
export function sceneVisualPrompt(
  scene: { prompt?: string | null; action?: string | null },
  model: Pick<ModelEntry, "kind"> | undefined,
): string {
  const base = (scene.prompt ?? "").trim();
  const action = (scene.action ?? "").trim();
  if (!action || !sceneActionAppliesTo(model)) return base;
  return base ? `${base}｜動作：${action}` : `動作：${action}`;
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
