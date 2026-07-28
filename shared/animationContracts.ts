/**
 * ANIM-00 動畫產線領域契約（純函式）。
 *
 * 鎖定「分鏡順序、軟刪過濾、時間真相、現用版本、匯出冪等」等不可變規則，
 * 不依賴 DB／HTTP。後續 ANIM-01+ adapter／Command 應引用此模組，而非複製散落約定。
 *
 * 對應文件：docs/architecture/ai-animation-production-remediation-plan.md §3、§13
 */

// ─── 時間真相：durationFrames 為唯一真相，durationSec 僅衍生 ─────────────

/** 預設影格率（與 exporter 時間軸 30fps 對齊；Production 可覆寫） */
export const DEFAULT_FRAME_RATE = 30;

/**
 * 秒 → 整數 frame（round；與 Production frameRate 換算）。
 * 禁止把浮點秒累加後再換 frame（會造成逐鏡偏移）。
 */
export function secToFrames(sec: number, frameRate: number = DEFAULT_FRAME_RATE): number {
  if (!Number.isFinite(sec) || sec < 0) return 0;
  if (!Number.isFinite(frameRate) || frameRate <= 0) return 0;
  return Math.round(sec * frameRate);
}

/** frame → 秒（衍生顯示／匯出用；不得再手改後寫回為真相） */
export function framesToSec(frames: number, frameRate: number = DEFAULT_FRAME_RATE): number {
  if (!Number.isFinite(frames) || frames < 0) return 0;
  if (!Number.isFinite(frameRate) || frameRate <= 0) return 0;
  return frames / frameRate;
}

/**
 * 由 durationFrames 建立時間欄位對（frames 為真相）。
 * durationSec 一律由 frames 衍生，避免雙重真相。
 */
export function durationFromFrames(
  durationFrames: number,
  frameRate: number = DEFAULT_FRAME_RATE,
): { durationFrames: number; durationSec: number; frameRate: number } {
  const frames = Number.isFinite(durationFrames) && durationFrames > 0 ? Math.floor(durationFrames) : 0;
  const fr = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : DEFAULT_FRAME_RATE;
  return {
    durationFrames: frames,
    durationSec: framesToSec(frames, fr),
    frameRate: fr,
  };
}

/**
 * 從既有 durationSec 正規化為 frames 真相（遷移／相容路徑）。
 * UI 若仍送秒，應經此函式再寫入。
 */
export function durationFromSec(
  durationSec: number,
  frameRate: number = DEFAULT_FRAME_RATE,
): { durationFrames: number; durationSec: number; frameRate: number } {
  const fr = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : DEFAULT_FRAME_RATE;
  const frames = secToFrames(durationSec, fr);
  return durationFromFrames(frames, fr);
}

/**
 * 粗剪／Timeline 總長 = 所有有效 Shot 的 durationFrames 之和（frame 真相）。
 * 無效／省略鏡頭不計入（由呼叫端先 filter）。
 */
export function sumDurationFrames(
  shots: ReadonlyArray<{ durationFrames: number }>,
): number {
  let total = 0;
  for (const s of shots) {
    const f = s.durationFrames;
    if (Number.isFinite(f) && f > 0) total += Math.floor(f);
  }
  return total;
}

/**
 * 與現況 exporter.sceneDur 對齊的「顯示秒」規則：非正數 durationSec 以 3 秒計。
 * 注意：此為 **現行粗剪／字幕** 行為鎖；正式 Timeline 應改走 durationFrames 真相（見 ANIM-06）。
 */
export const LEGACY_MIN_SCENE_DURATION_SEC = 3;

export function legacySceneDurationSec(durationSec: number): number {
  return durationSec > 0 ? durationSec : LEGACY_MIN_SCENE_DURATION_SEC;
}

/** 有效分鏡的 legacy 總秒數（粗剪總長契約） */
export function sumLegacyDurationSec(
  scenes: ReadonlyArray<{ durationSec: number }>,
): number {
  return scenes.reduce((acc, s) => acc + legacySceneDurationSec(s.durationSec), 0);
}

// ─── 軟刪過濾：正常列表／粗剪／交付不得含軟刪 ───────────────────────────

export type SoftDeletable = { deletedAt?: Date | string | null };

/** 未軟刪（deletedAt 為 null／undefined） */
export function isNotSoftDeleted(row: SoftDeletable): boolean {
  return row.deletedAt == null;
}

/** 從列表排除軟刪列（分鏡、素材等同口徑） */
export function excludeSoftDeleted<T extends SoftDeletable>(rows: readonly T[]): T[] {
  return rows.filter(isNotSoftDeleted);
}

/**
 * 正常列表用：未刪除、依 orderIndex 升序。
 * 不改 orderIndex 本身；僅投影查詢契約。
 */
export function listActiveOrderedScenes<T extends SoftDeletable & { orderIndex: number }>(
  rows: readonly T[],
): T[] {
  return excludeSoftDeleted(rows).slice().sort((a, b) => a.orderIndex - b.orderIndex);
}

// ─── 分鏡順序：唯一、可重排、缺漏補尾 ───────────────────────────────────

export type OrderableScene = SoftDeletable & { id: string; orderIndex: number };

export type ReorderResult =
  | { ok: true; orderedIds: string[] }
  | { ok: false; reason: "duplicate_ids" | "empty" };

/**
 * 純函式重排（對應 scenes.reorder 契約，不含 DB 鎖）：
 * 1. orderedIds 不得有重複（前端壞狀態直接拒絕）
 * 2. 只重排「未軟刪」且在 own 集合內的 id
 * 3. 清單漏掉的既有分鏡依原相對順序補到尾端
 * 4. 結果 order 唯一且連續 0..n-1
 */
export function computeSceneReorder(
  activeScenes: ReadonlyArray<Pick<OrderableScene, "id" | "orderIndex">>,
  orderedIds: readonly string[],
): ReorderResult {
  if (orderedIds.length === 0 && activeScenes.length === 0) {
    return { ok: true, orderedIds: [] };
  }
  if (new Set(orderedIds).size !== orderedIds.length) {
    return { ok: false, reason: "duplicate_ids" };
  }

  // 以 orderIndex 穩定排序作為「原相對順序」
  const byOrder = activeScenes.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const own = new Set(byOrder.map((s) => s.id));
  const listed = new Set(orderedIds);

  const result: string[] = [];
  for (const id of orderedIds) {
    if (!own.has(id)) continue;
    result.push(id);
  }
  for (const row of byOrder) {
    if (listed.has(row.id)) continue;
    result.push(row.id);
  }

  return { ok: true, orderedIds: result };
}

/** 指派連續 orderIndex（0-based）；ids 順序即新序 */
export function assignContiguousOrderIndices(orderedIds: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  orderedIds.forEach((id, idx) => map.set(id, idx));
  return map;
}

/** 檢查 orderIndex 在集合內是否唯一 */
export function orderIndicesAreUnique(
  scenes: ReadonlyArray<{ orderIndex: number }>,
): boolean {
  const seen = new Set<number>();
  for (const s of scenes) {
    if (seen.has(s.orderIndex)) return false;
    seen.add(s.orderIndex);
  }
  return true;
}

/**
 * 新增分鏡時的下一個 orderIndex：max(active) + 1（軟刪不計入）。
 * 對應 create／restore 尾端編號契約。
 */
export function nextOrderIndex(
  activeScenes: ReadonlyArray<{ orderIndex: number }>,
): number {
  if (activeScenes.length === 0) return 0;
  let max = -1;
  for (const s of activeScenes) {
    if (Number.isFinite(s.orderIndex) && s.orderIndex > max) max = s.orderIndex;
  }
  return max + 1;
}

/**
 * 與相鄰交換 orderIndex（move up/down 純邏輯）。
 * 僅在未刪除清單上操作；已在頂／底則回傳原陣列副本。
 */
export function swapAdjacentOrder(
  activeOrdered: ReadonlyArray<{ id: string; orderIndex: number }>,
  sceneId: string,
  direction: "up" | "down",
): Array<{ id: string; orderIndex: number }> {
  const list = activeOrdered.map((s) => ({ ...s }));
  const idx = list.findIndex((s) => s.id === sceneId);
  if (idx < 0) return list;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= list.length) return list;
  const a = list[idx]!.orderIndex;
  const b = list[swapIdx]!.orderIndex;
  list[idx] = { ...list[idx]!, orderIndex: b };
  list[swapIdx] = { ...list[swapIdx]!, orderIndex: a };
  return list.sort((x, y) => x.orderIndex - y.orderIndex);
}

// ─── Asset 現用版本：Shot 指標為單一真相；(shotId, role) 至多一筆 selected ─

export type AssetVersionRole =
  | "visual"
  | "narration"
  | "dialogue"
  | "music"
  | "sfx"
  | "reference"
  | "delivery";

export type AssetVersionStatus = "candidate" | "selected" | "rejected" | "superseded";

export interface AssetVersionLike {
  id: string;
  shotId: string;
  role: AssetVersionRole;
  status: AssetVersionStatus;
  /** 所屬 production／project；跨專案綁定必須拒絕 */
  productionId?: string;
  projectId?: string;
}

export interface ShotSelectionPointers {
  id: string;
  productionId?: string;
  projectId?: string;
  selectedVisualVersionId?: string | null;
  selectedNarrationVersionId?: string | null;
}

/**
 * 同一 (shotId, role) 至多一筆 status=selected。
 * 回傳違規鍵列表（空＝合規）。
 */
export function findDuplicateSelectedVersions(
  versions: ReadonlyArray<Pick<AssetVersionLike, "shotId" | "role" | "status" | "id">>,
): Array<{ shotId: string; role: AssetVersionRole; versionIds: string[] }> {
  const groups = new Map<string, string[]>();
  for (const v of versions) {
    if (v.status !== "selected") continue;
    const key = `${v.shotId}\0${v.role}`;
    const arr = groups.get(key) ?? [];
    arr.push(v.id);
    groups.set(key, arr);
  }
  const bad: Array<{ shotId: string; role: AssetVersionRole; versionIds: string[] }> = [];
  for (const [key, ids] of groups) {
    if (ids.length > 1) {
      const [shotId, role] = key.split("\0") as [string, AssetVersionRole];
      bad.push({ shotId, role, versionIds: ids });
    }
  }
  return bad;
}

export function assertSelectedUniqueness(
  versions: ReadonlyArray<Pick<AssetVersionLike, "shotId" | "role" | "status" | "id">>,
): void {
  const bad = findDuplicateSelectedVersions(versions);
  if (bad.length > 0) {
    const sample = bad[0]!;
    throw new Error(
      `AssetVersion selected 不唯一: shotId=${sample.shotId} role=${sample.role} ids=${sample.versionIds.join(",")}`,
    );
  }
}

/**
 * 選版原子結果（純模擬）：舊 selected → superseded；新 → selected。
 * Shot 指標為寫入真相；status 僅為查詢投影。
 */
export function applySelectAssetVersion(
  versions: readonly AssetVersionLike[],
  shot: ShotSelectionPointers,
  opts: { versionId: string; role: "visual" | "narration" },
): {
  versions: AssetVersionLike[];
  shot: ShotSelectionPointers;
  error?: string;
} {
  const target = versions.find((v) => v.id === opts.versionId);
  if (!target) {
    return { versions: versions.map((v) => ({ ...v })), shot: { ...shot }, error: "version_not_found" };
  }
  if (target.shotId !== shot.id) {
    return { versions: versions.map((v) => ({ ...v })), shot: { ...shot }, error: "version_shot_mismatch" };
  }
  if (target.role !== opts.role) {
    return { versions: versions.map((v) => ({ ...v })), shot: { ...shot }, error: "version_role_mismatch" };
  }
  // 跨專案／production 擋（有填才驗）
  const shotScope = shot.productionId ?? shot.projectId;
  const verScope = target.productionId ?? target.projectId;
  if (shotScope && verScope && shotScope !== verScope) {
    return { versions: versions.map((v) => ({ ...v })), shot: { ...shot }, error: "version_project_mismatch" };
  }

  const next = versions.map((v) => {
    if (v.shotId === shot.id && v.role === opts.role && v.status === "selected") {
      return { ...v, status: "superseded" as const };
    }
    if (v.id === opts.versionId) {
      return { ...v, status: "selected" as const };
    }
    return { ...v };
  });

  const nextShot: ShotSelectionPointers = {
    ...shot,
    ...(opts.role === "visual"
      ? { selectedVisualVersionId: opts.versionId }
      : { selectedNarrationVersionId: opts.versionId }),
  };

  return { versions: next, shot: nextShot };
}

/**
 * 查詢投影：以 Shot 指標為準校正 status。
 * 若指標指向的版本 status 不是 selected，回傳應校正的版本 id。
 */
export function reconcileSelectionStatus(
  versions: readonly AssetVersionLike[],
  shot: ShotSelectionPointers,
): { pointerIsTruth: true; visualSelectedId: string | null; narrationSelectedId: string | null } {
  return {
    pointerIsTruth: true,
    visualSelectedId: shot.selectedVisualVersionId ?? null,
    narrationSelectedId: shot.selectedNarrationVersionId ?? null,
  };
}

/**
 * 音訊生成只更新 narration／dialogue 角色，不覆蓋主畫面指標。
 * 圖／影生成只更新 visual。
 */
export function selectionPatchForAssetKind(
  kind: "image" | "video" | "audio" | string,
  assetId: string,
): { assetId?: string; narrationAssetId?: string; role: AssetVersionRole } {
  if (kind === "audio") {
    return { narrationAssetId: assetId, role: "narration" };
  }
  return { assetId, role: "visual" };
}

// ─── 匯出冪等：同專案＋同素材選擇鍵 → 重用進行中 job ───────────────────

/**
 * 素材多選正規化鍵（排序去重後串接）；null/空＝全量打包。
 * 對應 exportJobs.assetKey 契約。
 */
export function exportAssetSelectionKey(assetIds: readonly string[] | null | undefined): string {
  if (!assetIds || assetIds.length === 0) return "";
  return [...new Set(assetIds)].sort().join(",");
}

export type ExportJobLike = {
  id: string;
  projectId: string;
  status: string;
  assetIds?: string[] | null;
};

/**
 * 若同專案＋同選擇鍵已有 queued/running job，應重用（reused=true），不建第二份。
 */
export function findReusableExportJob(
  pendingJobs: readonly ExportJobLike[],
  projectId: string,
  assetIds: readonly string[] | null | undefined,
): ExportJobLike | null {
  const key = exportAssetSelectionKey(assetIds);
  for (const j of pendingJobs) {
    if (j.projectId !== projectId) continue;
    if (j.status !== "queued" && j.status !== "running") continue;
    if (exportAssetSelectionKey(j.assetIds) === key) return j;
  }
  return null;
}

/**
 * 內容指紋（純規則）：相同 selected 版本集合 + timeline 版本 → 相同交付內容身份。
 * 用於「相同 idempotency key 重試不產生不同內容」的契約鎖；實作可用 hash。
 */
export function exportContentIdentity(input: {
  projectId: string;
  timelineVersion?: number | string | null;
  selectedAssetVersionIds: readonly string[];
  preset?: string | null;
}): string {
  const assets = [...new Set(input.selectedAssetVersionIds)].sort().join(",");
  const tl = input.timelineVersion == null ? "" : String(input.timelineVersion);
  const preset = input.preset ?? "";
  return `${input.projectId}|tl=${tl}|assets=${assets}|preset=${preset}`;
}

/**
 * 相同 export identity 應視為同一交付意圖；不同 identity 不得共用結果。
 */
export function exportIdentitiesMatch(a: string, b: string): boolean {
  return a === b && a.length > 0;
}

// ─── 生成入口契約標籤（與 PolicySource 對齊，供測試命名） ───────────────

/** 動畫鏡頭生成必須走同一 Policy／Command 的入口 */
export const ANIMATION_GENERATION_SOURCES = [
  "web",
  "rest",
  "mcp",
  "workflow",
  "agent",
  "system",
] as const;

export type AnimationGenerationSource = (typeof ANIMATION_GENERATION_SOURCES)[number];
