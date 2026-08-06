/**
 * ANIM-01 Production／Sequence／Shot adapter（純函式）。
 *
 * 將現況 Project + Scene 列映射為動畫產線正式形狀，**無 DB migration、不改 scenes API**。
 * 時間／軟刪／選版規則一律委派 `animationContracts`，禁止在此重複實作。
 *
 * 對應：
 * - docs/architecture/ai-animation-production-remediation-plan.md §3、ANIM-01
 * - docs/architecture/anim-00-baseline.md
 * - docs/architecture/anim-01-adapter.md
 */

import {
  DEFAULT_FRAME_RATE,
  durationFromFrames,
  durationFromSec,
  isNotSoftDeleted,
  listActiveOrderedScenes,
  type SoftDeletable,
} from "./animationContracts";
import type { ShotCharacterRef } from "./animationContinuity";
import { PROJECT_FORMAT_IDS, type ProjectFormat } from "./models";

// ─── 正式領域型別（對齊 remediation plan §3／§4；adapter 投影用） ─────────

/** 專案可選的全部比例（PROJECT_FORMATS）＋認不得的舊值 custom */
export type ProductionFormat = ProjectFormat | "custom";

export type ProductionState =
  | "development"
  | "preproduction"
  | "production"
  | "postproduction"
  | "review"
  | "delivered"
  | "archived";

export type ShotState =
  | "draft"
  | "planned"
  | "awaiting_reference"
  | "ready_to_generate"
  | "generating"
  | "review"
  | "approved"
  | "blocked"
  | "omitted";

/** 再匯出：角色引用型別單一真相在 animationContinuity（ANIM-02） */
export type { ShotCharacterRef };

/**
 * Production：一支影片／動畫作品。
 *
 * **id 策略（ANIM-01）**：無獨立 productions 表時，`id === projectId`（1:1 恆等）。
 * 之後若拆表，可改為獨立 uuid 並保留 projectId 外鍵；呼叫端應同時讀 id 與 projectId。
 */
export interface Production {
  id: string;
  projectId: string;
  title: string;
  format: ProductionFormat;
  targetDurationSec?: number;
  frameRate: number;
  resolution?: string;
  language?: string;
  state: ProductionState;
  scriptVersionId?: string;
  characterBibleVersionId?: string;
  styleBibleVersionId?: string;
}

export interface Sequence {
  id: string;
  productionId: string;
  orderIndex: number;
  title: string;
  narrativePurpose?: string;
  targetDurationSec?: number;
}

export interface Shot {
  id: string;
  sequenceId?: string;
  productionId: string;
  orderIndex: number;
  title: string;
  /** 衍生顯示用；真相來源見 durationFrames */
  durationSec: number;
  /** 單一真相：整數 frame（與 Production frameRate 換算） */
  durationFrames: number;
  shotType?: string;
  cameraMovement?: string;
  composition?: string;
  action?: string;
  dialogue?: string;
  narration?: string;
  visualPrompt?: string;
  negativePrompt?: string;
  state: ShotState;
  characterRefs: ShotCharacterRef[];
  styleBibleVersionId?: string;
  referencePackId?: string;
  referencePackVersionId?: string;
  selectedVisualVersionId?: string;
  selectedNarrationVersionId?: string;
  /** 相容欄位：來源 scene 軟刪時間（bundle 內通常已過濾） */
  deletedAt?: Date | string | null;
}

export interface ProductionBundle {
  production: Production;
  sequences: Sequence[];
  shots: Shot[];
}

// ─── 來源列（Project／Scene 最小欄位；不綁 drizzle 型別） ─────────────────

/** 專案列最小投影（對齊 projects 表） */
export interface ProjectRowLike {
  id: string;
  title: string;
  /** 畫面比例字串，如 "16:9"；未知則 fallback DEFAULT_PRODUCTION_FORMAT */
  format?: string | null;
  /** active｜paused｜archived（及未知字串） */
  status?: string | null;
  language?: string | null;
}

/** 分鏡列最小投影（對齊 scenes 表） */
export interface SceneRowLike extends SoftDeletable {
  id: string;
  projectId: string;
  orderIndex: number;
  title: string;
  durationSec: number;
  status?: string | null;
  assetId?: string | null;
  narrationAssetId?: string | null;
  prompt?: string | null;
  voiceover?: string | null;
}

// ─── 常數與正規化 ───────────────────────────────────────────────────────

export const DEFAULT_PRODUCTION_FORMAT: ProductionFormat = "16:9";

/** 預設 Sequence 標題（單序列 adapter；無獨立 sequences 表） */
export const DEFAULT_SEQUENCE_TITLE = "主線";

/** 預設 Sequence 穩定 id 後綴（見 defaultSequenceId） */
export const DEFAULT_SEQUENCE_SUFFIX = "sequence:0";

/**
 * 由 productionId 衍生預設 Sequence id（adapter-only，確定性、可重算）。
 * 格式：`{productionId}:sequence:0`
 */
export function defaultSequenceId(productionId: string): string {
  return `${productionId}:${DEFAULT_SEQUENCE_SUFFIX}`;
}

/** 專案 format → ProductionFormat；無法辨識則 custom 或 default */
export function normalizeProductionFormat(
  format: string | null | undefined,
): ProductionFormat {
  if ((PROJECT_FORMAT_IDS as string[]).includes(format ?? "")) return format as ProjectFormat;
  if (format == null || format === "") return DEFAULT_PRODUCTION_FORMAT;
  return "custom";
}

/**
 * 專案 status → ProductionState（粗映射；正式階段機在後續 PR）。
 * - archived → archived
 * - paused → review（暫停＝暫緩製作、偏審核／凍結）
 * - active／未知 → production（現行可寫工作狀態）
 */
export function projectStatusToProductionState(
  status: string | null | undefined,
): ProductionState {
  if (status === "archived") return "archived";
  if (status === "paused") return "review";
  return "production";
}

/**
 * 分鏡 status → ShotState（粗映射；Command 狀態機後續）。
 * - todo／review／空 → draft
 * - pending → review
 * - approved → approved
 * - needs_work → blocked
 * - 未知 → draft
 */
export function sceneStatusToShotState(status: string | null | undefined): ShotState {
  switch (status) {
    case "pending":
      return "review";
    case "approved":
      return "approved";
    case "needs_work":
      return "blocked";
    case "todo":
    case "review":
    case null:
    case undefined:
    case "":
      return "draft";
    default:
      return "draft";
  }
}

// ─── Adapter 函式 ───────────────────────────────────────────────────────

export type ProjectToProductionOptions = {
  /** 覆寫 frameRate；預設 DEFAULT_FRAME_RATE (30) */
  frameRate?: number;
  /** 覆寫 production id；預設與 projectId 相同（1:1） */
  productionId?: string;
};

/**
 * Project → Production（1:1）。
 * id 預設等於 project.id；projectId 永遠是來源專案 id。
 */
export function projectToProduction(
  project: ProjectRowLike,
  opts: ProjectToProductionOptions = {},
): Production {
  const projectId = project.id;
  const id = opts.productionId ?? projectId;
  const frameRate =
    opts.frameRate != null && Number.isFinite(opts.frameRate) && opts.frameRate > 0
      ? opts.frameRate
      : DEFAULT_FRAME_RATE;

  const production: Production = {
    id,
    projectId,
    title: project.title,
    format: normalizeProductionFormat(project.format),
    frameRate,
    state: projectStatusToProductionState(project.status),
  };
  if (project.language != null && project.language !== "") {
    production.language = project.language;
  }
  return production;
}

/**
 * 為 Production 建立唯一預設 Sequence（adapter-only，無 DB 列）。
 * orderIndex=0；title 預設「主線」，可覆寫為專案名等。
 */
export function defaultSequenceFor(
  production: Pick<Production, "id" | "title">,
  opts: { title?: string } = {},
): Sequence {
  return {
    id: defaultSequenceId(production.id),
    productionId: production.id,
    orderIndex: 0,
    title: opts.title ?? DEFAULT_SEQUENCE_TITLE,
  };
}

export type SceneToShotOptions = {
  productionId: string;
  sequenceId?: string;
  frameRate?: number;
};

/**
 * 單一 Scene → Shot。
 * - durationSec → durationFromSec → durationFrames 真相 + 衍生 sec
 * - voiceover → narration；prompt → visualPrompt
 * - assetId → selectedVisualVersionId；narrationAssetId → selectedNarrationVersionId
 * 不在此過濾軟刪（呼叫端用 scenesToShots／bundle）。
 */
export function sceneToShot(scene: SceneRowLike, opts: SceneToShotOptions): Shot {
  const frameRate =
    opts.frameRate != null && Number.isFinite(opts.frameRate) && opts.frameRate > 0
      ? opts.frameRate
      : DEFAULT_FRAME_RATE;
  const dur = durationFromSec(scene.durationSec, frameRate);

  const shot: Shot = {
    id: scene.id,
    productionId: opts.productionId,
    orderIndex: scene.orderIndex,
    title: scene.title,
    durationSec: dur.durationSec,
    durationFrames: dur.durationFrames,
    state: sceneStatusToShotState(scene.status),
    characterRefs: [],
  };

  if (opts.sequenceId != null) shot.sequenceId = opts.sequenceId;

  if (scene.voiceover != null && scene.voiceover !== "") {
    shot.narration = scene.voiceover;
  }
  if (scene.prompt != null && scene.prompt !== "") {
    shot.visualPrompt = scene.prompt;
  }
  if (scene.assetId != null) {
    shot.selectedVisualVersionId = scene.assetId;
  }
  if (scene.narrationAssetId != null) {
    shot.selectedNarrationVersionId = scene.narrationAssetId;
  }
  if (scene.deletedAt != null) {
    shot.deletedAt = scene.deletedAt;
  }

  return shot;
}

export type ScenesToShotsOptions = {
  productionId: string;
  sequenceId?: string;
  frameRate?: number;
  /**
   * 是否排除軟刪（預設 true，對齊 listActiveOrderedScenes）。
   * false 時保留全部並仍依 orderIndex 排序。
   */
  excludeDeleted?: boolean;
};

/**
 * Scene 列表 → Shot 列表：軟刪過濾 + orderIndex 升序，再逐列 sceneToShot。
 */
export function scenesToShots(
  scenes: readonly SceneRowLike[],
  opts: ScenesToShotsOptions,
): Shot[] {
  const excludeDeleted = opts.excludeDeleted !== false;
  const ordered = excludeDeleted
    ? listActiveOrderedScenes(scenes)
    : scenes.slice().sort((a, b) => a.orderIndex - b.orderIndex);

  return ordered.map((scene) =>
    sceneToShot(scene, {
      productionId: opts.productionId,
      sequenceId: opts.sequenceId,
      frameRate: opts.frameRate,
    }),
  );
}

export type BuildProductionBundleOptions = {
  frameRate?: number;
  productionId?: string;
  /** 預設 Sequence 標題；預設「主線」 */
  sequenceTitle?: string;
  excludeDeletedScenes?: boolean;
};

/**
 * Project + Scenes → { production, sequences, shots } 一次組裝。
 * sequences 固定一筆預設主線；shots 掛在該 sequence 上。
 */
export function buildProductionBundle(
  project: ProjectRowLike,
  scenes: readonly SceneRowLike[],
  opts: BuildProductionBundleOptions = {},
): ProductionBundle {
  const production = projectToProduction(project, {
    frameRate: opts.frameRate,
    productionId: opts.productionId,
  });
  const sequence = defaultSequenceFor(production, { title: opts.sequenceTitle });
  const shots = scenesToShots(scenes, {
    productionId: production.id,
    sequenceId: sequence.id,
    frameRate: production.frameRate,
    excludeDeleted: opts.excludeDeletedScenes,
  });

  return {
    production,
    sequences: [sequence],
    shots,
  };
}

/**
 * Round-trip 安全檢查：Shot 的 durationSec 必須等於 framesToSec(durationFrames)。
 * 供測試與防呆；回傳不一致的 shot id。
 */
export function findDurationInconsistencies(
  shots: ReadonlyArray<Pick<Shot, "id" | "durationFrames" | "durationSec">>,
  frameRate: number = DEFAULT_FRAME_RATE,
): string[] {
  const bad: string[] = [];
  for (const s of shots) {
    const expected = durationFromFrames(s.durationFrames, frameRate);
    if (s.durationFrames !== expected.durationFrames || s.durationSec !== expected.durationSec) {
      bad.push(s.id);
    }
  }
  return bad;
}

// ─── 再匯出常用 contracts 符號（adapter 消費者一站引用） ─────────────────

export {
  DEFAULT_FRAME_RATE,
  durationFromFrames,
  durationFromSec,
  isNotSoftDeleted,
  listActiveOrderedScenes,
  sumDurationFrames,
} from "./animationContracts";
