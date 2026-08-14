/**
 * Team Canon contract（Team Canon → Canon-to-Shot master plan §2–§4）。
 *
 * Team Canon 是「組」層級的長期創作記憶：人物、造型、場景、道具、風格、聲線、聲音世界。
 * 專案用 pin（引用）取得 Canon，不 copy 出第二份會各自漂移的真相；
 * Canon Version 一經建立即不可變——要改就開新版本，不得原地改寫 V7。
 *
 * 本模組只放純函式與型別；hash 與資料庫操作在 server/services/teamCanon.ts。
 */
import type { ShotReferenceRole } from "./shotContextPacket";
import type { TrainingJobState } from "./consistencyTraining";

export const CANON_KINDS = [
  "character",
  "character_look",
  "scene",
  "prop",
  "style",
  "voice",
  "sound_world",
] as const;
export type CanonKind = (typeof CANON_KINDS)[number];

/** 生命週期：active＝可用；archived＝退役（版本歷史仍可追溯，不可再 pin） */
export const CANON_STATUSES = ["active", "archived"] as const;
export type CanonStatus = (typeof CANON_STATUSES)[number];

/** 重用範圍：team＝全組專案可 pin；private＝只有來源專案可用（rights 未確認前的預設保護） */
export const CANON_REUSE_SCOPES = ["team", "private"] as const;
export type CanonReuseScope = (typeof CANON_REUSE_SCOPES)[number];

export const CANON_VERSION_SCHEMA_VERSION = "canon-version.v1";

/** 訓練模組化類型（master plan §3）——記在版本上，供 UX 顯示「這版加強了什麼」 */
export const CANON_TRAINING_KINDS = [
  "character_identity",
  "character_look",
  "scene_identity",
  "style",
  "voice",
] as const;
export type CanonTrainingKind = (typeof CANON_TRAINING_KINDS)[number];

export interface CanonReferenceEntry {
  assetId: string;
  role: ShotReferenceRole;
  priority: "PRIMARY" | "SECONDARY" | "SUPPORTING";
  /** rights 是否已由人確認可供團隊重用（未確認的參考不得進 training manifest） */
  rightsReady: boolean;
  /** 來源專案（provenance；跨專案追溯用） */
  sourceProjectId: string | null;
}

/**
 * Canon Version 的不可變 payload。
 * descriptor 是 kind 對應的文字錨點（appearance／costume／palette…），
 * 欄位名沿用來源卡片的欄位，避免第二套詞彙。
 */
export interface CanonVersionPayload {
  schemaVersion: typeof CANON_VERSION_SCHEMA_VERSION;
  kind: CanonKind;
  name: string;
  descriptor: Record<string, string | null>;
  references: CanonReferenceEntry[];
  /** 若這版來自訓練：資料集指紋（consistency_dataset_manifests.fingerprint） */
  datasetFingerprint: string | null;
  /** 若這版來自訓練：adapter／LoRA 產物 ref（consistency_model_versions.adapter_ref） */
  adapterRef: string | null;
  /** 若這版來自訓練：訓練工作 id（consistency_training_jobs.id） */
  trainingJobId: string | null;
  trainingKind: CanonTrainingKind | null;
  /** 評估摘要（分維度分數）；null＝尚未評估 */
  evaluation: Record<string, number> | null;
}

export const CANON_VERSION_CREATED_REASONS = [
  "initial",
  "entity_update",
  "training",
  "manual",
] as const;
export type CanonVersionCreatedReason = (typeof CANON_VERSION_CREATED_REASONS)[number];

export const CANON_VERSION_EVENTS = [
  "created",
  "promoted",
  "rolled_back",
  "archived",
  "rights_updated",
] as const;
export type CanonVersionEvent = (typeof CANON_VERSION_EVENTS)[number];

/**
 * 版本指紋的 canonical 素材：references 先排序、鍵順序固定，
 * 同一內容永遠算出同一字串（hash 在 server 端做）。
 */
export function canonicalCanonVersionMaterial(payload: CanonVersionPayload): string {
  const descriptorKeys = Object.keys(payload.descriptor).sort();
  return JSON.stringify({
    schemaVersion: payload.schemaVersion,
    kind: payload.kind,
    name: payload.name,
    descriptor: descriptorKeys.map((key) => [key, payload.descriptor[key] ?? null]),
    references: payload.references
      .map((ref) => ({
        assetId: ref.assetId,
        role: ref.role,
        priority: ref.priority,
        rightsReady: ref.rightsReady,
        sourceProjectId: ref.sourceProjectId,
      }))
      .sort((a, b) => (a.assetId + a.role).localeCompare(b.assetId + b.role)),
    datasetFingerprint: payload.datasetFingerprint,
    adapterRef: payload.adapterRef,
    trainingJobId: payload.trainingJobId,
    trainingKind: payload.trainingKind,
  });
}

/**
 * Canon kind → 專案本地卡片（pin 時要落地的 handle）。
 * style／voice／sound_world 沒有本地卡——它們在 PR-B 由 packet 直接消費。
 */
export const CANON_LOCAL_ENTITY_KINDS = ["character", "character_look", "scene_preset", "prop"] as const;
export type CanonLocalEntityKind = (typeof CANON_LOCAL_ENTITY_KINDS)[number];

export function localEntityKindForCanon(kind: CanonKind): CanonLocalEntityKind | null {
  switch (kind) {
    case "character": return "character";
    case "character_look": return "character_look";
    case "scene": return "scene_preset";
    case "prop": return "prop";
    default: return null;
  }
}

export function canonKindForLocalEntity(kind: CanonLocalEntityKind): CanonKind {
  switch (kind) {
    case "character": return "character";
    case "character_look": return "character_look";
    case "scene_preset": return "scene";
    case "prop": return "prop";
  }
}

/** Pin 狀態（master plan §4）：Team 出了新版不 silent-update，只標 UPDATE_AVAILABLE */
export type CanonPinState = "PINNED" | "UPDATE_AVAILABLE";

export function pinState(input: {
  pinnedVersionId: string;
  productionVersionId: string | null;
}): CanonPinState {
  if (input.productionVersionId && input.productionVersionId !== input.pinnedVersionId) {
    return "UPDATE_AVAILABLE";
  }
  return "PINNED";
}

/**
 * Promote 守門（master plan §3／§23-4）：
 * 訓練產物只能是 Candidate；Promote 是人的明確動作，且訓練中途素材已變（look drift）不得上線。
 */
export function canPromoteCanonVersion(input: {
  versionArchived: boolean;
  canonArchived: boolean;
  trainingJobStatus: TrainingJobState | null;
  lookChangedDuringTraining: boolean;
}): { ok: boolean; reason: string | null } {
  if (input.canonArchived) return { ok: false, reason: "這個 Canon 已封存，不能再採用新版本" };
  if (input.versionArchived) return { ok: false, reason: "這個版本已封存，不能採用" };
  if (input.trainingJobStatus !== null) {
    if (input.trainingJobStatus !== "succeeded") {
      return { ok: false, reason: "訓練尚未成功，這個版本還不能採用" };
    }
    if (input.lookChangedDuringTraining) {
      return { ok: false, reason: "訓練期間造型已變更，請重新訓練後再採用" };
    }
  }
  return { ok: true, reason: null };
}

/** 升級影響（master plan §4）：只 stale 真正依賴舊版本的 Shot，原 current 保留 */
export interface CanonUpgradeImpact {
  canonId: string;
  fromVersionId: string;
  toVersionId: string;
  /** 依 Shot Context Packet 依賴圖算出的受影響鏡 */
  affectedShotIds: string[];
  /** 受影響鏡中目前已有 current 畫面的數量（升級後保留，需明確重生成＋Adopt 才會換） */
  currentMediaCount: number;
}

/**
 * 從專案卡片欄位建 Canon descriptor（pure；service 與測試共用同一個映射，
 * 避免「服務存的」與「測試以為的」兩套欄位）。
 */
export function buildCanonDescriptorFromEntity(
  kind: CanonKind,
  entity: Record<string, unknown>,
): Record<string, string | null> {
  const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
  switch (kind) {
    case "character":
      return { appearance: str(entity.appearance), notes: str(entity.notes) };
    case "character_look":
      return { costume: str(entity.costume), notes: str(entity.notes) };
    case "scene":
      return { palette: str(entity.palette), lighting: str(entity.lighting) };
    case "prop":
      return { appearance: str(entity.appearance), notes: str(entity.notes) };
    case "style":
      return { style: str(entity.style), notes: str(entity.notes) };
    case "voice":
      return { voice: str(entity.voice), notes: str(entity.notes) };
    case "sound_world":
      return { ambience: str(entity.ambience), notes: str(entity.notes) };
  }
}

/** 本地 handle 要同步哪些欄位（applyCanonUpgrade 用；與 descriptor 對稱） */
export function localFieldsForCanonKind(kind: CanonKind): string[] {
  switch (kind) {
    case "character": return ["appearance", "notes"];
    case "character_look": return ["costume", "notes"];
    case "scene": return ["palette", "lighting"];
    case "prop": return ["appearance", "notes"];
    default: return [];
  }
}
