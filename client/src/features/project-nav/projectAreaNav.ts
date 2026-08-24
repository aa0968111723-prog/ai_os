/**
 * Project Page information architecture (IA).
 *
 * User mental model (first layer — do not force module count):
 *   現在 / 下一步 / 內容 / 進度 / 審核
 *
 * Top-level areas (max 5):
 *   1. 工作  2. 素材  3. 進度  4. 審核  5. 設定
 *
 * Animation work sub-stages inside 工作:
 *   故事 → 製作 → 成片
 *
 * Low-frequency features nest under 設定 as:
 *   更多 / 進階 / 工具
 *
 * This module is a pure mapping layer over the existing story-inline and
 * project-context reveal contracts. It does NOT delete core surfaces and
 * does NOT break deep-links: hashes still resolve via storyInlineNav /
 * projectContextNav; area is derived from those targets.
 */

import {
  isStoryHomeHash,
  sectionFromHash,
  type StoryInlineSectionId,
} from "../story-workspace/storyInlineNav";
import {
  contextTargetFromSelector,
  type ProjectContextTarget,
} from "./projectContextNav";

/** Top-level Project Page areas (≤5). */
export const PROJECT_AREA_IDS = [
  "work",
  "materials",
  "progress",
  "review",
  "settings",
] as const;

export type ProjectAreaId = (typeof PROJECT_AREA_IDS)[number];

export type ProjectAreaDef = {
  id: ProjectAreaId;
  label: string;
  /** Short hint for aria / empty states. */
  hint: string;
};

export const PROJECT_AREAS: readonly ProjectAreaDef[] = [
  {
    id: "work",
    label: "工作",
    hint: "故事、製作與成片；現在與下一步都在這裡",
  },
  {
    id: "materials",
    label: "素材",
    hint: "角色、場景、道具、素材庫與知識",
  },
  {
    id: "progress",
    label: "進度",
    hint: "階段軌跡、生成狀態與成片進度",
  },
  {
    id: "review",
    label: "審核",
    hint: "待確認鏡頭、審批與討論",
  },
  {
    id: "settings",
    label: "設定",
    hint: "專案基本資料、團隊與進階工具",
  },
] as const;

/** Animation project stages nested under 工作. */
export const WORK_STAGE_IDS = ["story", "production", "film"] as const;

export type WorkStageId = (typeof WORK_STAGE_IDS)[number];

export type WorkStageDef = {
  id: WorkStageId;
  label: string;
  /** Primary story-inline section (or home) this stage opens. */
  primarySection: StoryInlineSectionId | "home";
};

export const WORK_STAGES: readonly WorkStageDef[] = [
  { id: "story", label: "故事", primarySection: "home" },
  { id: "production", label: "製作", primarySection: "production" },
  { id: "film", label: "成片", primarySection: "delivery" },
] as const;

/** Low-frequency buckets under 設定 (not first-layer top nav). */
export const SETTINGS_LOW_FREQ_IDS = ["more", "advanced", "tools"] as const;

export type SettingsLowFreqId = (typeof SETTINGS_LOW_FREQ_IDS)[number];

export type SettingsLowFreqDef = {
  id: SettingsLowFreqId;
  label: string;
};

export const SETTINGS_LOW_FREQ: readonly SettingsLowFreqDef[] = [
  { id: "more", label: "更多" },
  { id: "advanced", label: "進階" },
  { id: "tools", label: "工具" },
] as const;

/** story-inline section → top area. */
export function areaFromStorySection(
  section: StoryInlineSectionId | "home",
): ProjectAreaId {
  switch (section) {
    case "home":
    case "markers":
    case "storyboard":
    case "production":
    case "delivery":
      return "work";
    case "characters":
    case "looks":
    case "scenes":
    case "props":
      return "materials";
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

/** project-context target → top area. */
export function areaFromContextTarget(target: ProjectContextTarget): ProjectAreaId {
  switch (target) {
    case "stage-context":
      return "work";
    case "worldview":
      // 作品設定：first-class under 設定; advanced themes stay low-freq.
      return "settings";
    case "characters":
    case "scenes":
    case "props":
    case "knowledge":
    case "databases":
    case "assets":
      return "materials";
    case "recycle":
      // 回收桶 is low-freq → 設定 / 進階
      return "settings";
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

/**
 * Derive area from a URL hash or selector (e.g. #stage-create, #sec-assets).
 * Falls back to 工作 when the hash is the story home or unrecognized.
 *
 * Deep-link compatibility: this only *classifies*; it never rewrites the hash.
 * Callers still use storyInlineNav / projectContextNav to reveal content.
 */
export function areaFromHash(raw: string | null | undefined): ProjectAreaId {
  if (!raw) return "work";
  const id = raw.replace(/^#/, "").trim();
  if (!id) return "work";

  if (isStoryHomeHash(id) || id === "stage-story" || id === "story-workspace") {
    return "work";
  }

  // Explicit progress / review anchors (may be introduced by shell later).
  if (
    id === "area-progress" ||
    id === "sec-progress" ||
    id === "onboard-progress"
  ) {
    return "progress";
  }
  if (
    id === "area-review" ||
    id === "sec-review" ||
    id === "sec-approvals" ||
    id === "onboard-review"
  ) {
    return "review";
  }
  if (
    id === "area-settings" ||
    id === "sec-settings" ||
    id === "psettings" ||
    id === "onboard-settings"
  ) {
    return "settings";
  }

  const storySection = sectionFromHash(id);
  if (storySection) return areaFromStorySection(storySection);

  const contextTarget = contextTargetFromSelector(`#${id}`);
  if (contextTarget) return areaFromContextTarget(contextTarget);

  // Default: stay in the primary work surface so unknown bookmarks still land usefully.
  return "work";
}

/** Map a work-related story section (or home) to the animation sub-stage. */
export function workStageFromSection(
  section: StoryInlineSectionId | "home",
): WorkStageId {
  switch (section) {
    case "home":
    case "markers":
      return "story";
    case "storyboard":
    case "production":
      return "production";
    case "delivery":
      return "film";
    // Material sections are not work stages; callers should only use this
    // after areaFromStorySection === "work". Fallback keeps UI stable.
    case "characters":
    case "looks":
    case "scenes":
    case "props":
      return "story";
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

export function workStageFromHash(raw: string | null | undefined): WorkStageId {
  if (!raw) return "story";
  const id = raw.replace(/^#/, "").trim();
  if (!id || isStoryHomeHash(id) || id === "stage-story") return "story";
  const section = sectionFromHash(id);
  if (!section) return "story";
  return workStageFromSection(section);
}

/** Which settings low-freq bucket a context target belongs to (if any). */
export function settingsLowFreqForTarget(
  target: ProjectContextTarget,
): SettingsLowFreqId | null {
  switch (target) {
    case "recycle":
      return "advanced";
    case "worldview":
      // Basic worldview lives in 作品設定; heavy theme packs can later route to advanced.
      return null;
    default:
      return null;
  }
}

export function defForArea(id: ProjectAreaId): ProjectAreaDef {
  const found = PROJECT_AREAS.find((a) => a.id === id);
  if (!found) throw new Error(`unknown project area: ${id}`);
  return found;
}

export function defForWorkStage(id: WorkStageId): WorkStageDef {
  const found = WORK_STAGES.find((s) => s.id === id);
  if (!found) throw new Error(`unknown work stage: ${id}`);
  return found;
}
