/**
 * C2 (#402)：專案上下文揭示契約——對齊 workbench 的 aios:workbench-reveal。
 * 事件展開 ① 分組／定裝 Tab、高亮、捲動；可帶 returnTo 讓定裝區顯示「回到原處」。
 */

import { flashAnchor } from "../../discuss";
import { revealWorkbenchAnchor, scrollToSelector } from "../creation-workbench/workbenchNav";
import { revealStoryInlineFromSelector, sectionFromSelector } from "../story-workspace/storyInlineNav";

export const PROJECT_CONTEXT_REVEAL_EVENT = "aios:project-context-reveal";

/** 可揭示的上下文目標（對應 ProjectPage 分區） */
export type ProjectContextTarget =
  | "worldview"
  | "characters"
  | "scenes"
  | "props"
  | "knowledge"
  | "databases"
  | "assets"
  | "recycle"
  | "stage-context";

/** 編完定裝／設定後要回哪一站 */
export type ProjectContextReturnTo = "studio" | "scenes";

export type ProjectContextRevealDetail = {
  projectId?: string;
  target: ProjectContextTarget;
  /** 記住從哪裡來：定裝區顯示「回到創作台／回到分鏡」 */
  returnTo?: ProjectContextReturnTo;
  /** 捲動後是否 flash 高亮（預設 true） */
  highlight?: boolean;
  /** 是否捲動（預設 true） */
  scroll?: boolean;
};

/** 目標 → DOM 錨點（與既有 summary chip / scroll 目標一致） */
export function selectorForContextTarget(target: ProjectContextTarget): string {
  switch (target) {
    case "worldview":
      return "#onboard-worldview";
    case "characters":
      return "#sec-characters";
    case "scenes":
      return "#sec-scenes";
    case "props":
      return "#sec-props";
    case "knowledge":
      return "#sec-knowledge";
    case "databases":
      return "#sec-databases";
    case "assets":
      return "#sec-assets";
    case "recycle":
      return "#sec-recyclebin";
    case "stage-context":
      return "#stage-context";
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

/** 錨點／selector → target（ContextBar、chip 用） */
export function contextTargetFromSelector(selector: string): ProjectContextTarget | null {
  const id = selector.replace(/^#/, "");
  switch (id) {
    case "onboard-worldview":
    case "onboard-worldview-card":
      return "worldview";
    case "sec-characters":
      return "characters";
    case "sec-scenes":
      return "scenes";
    case "sec-props":
      return "props";
    case "sec-knowledge":
      return "knowledge";
    case "sec-databases":
      return "databases";
    case "sec-assets":
      return "assets";
    case "sec-recyclebin":
      return "recycle";
    case "stage-context":
      return "stage-context";
    default:
      return null;
  }
}

/**
 * 派發上下文揭示事件。ProjectPage 監聽後展開分組／Tab；
 * 延遲 scroll + flash 讓 React 先 unhide。
 */
export function revealProjectContext(
  target: ProjectContextTarget,
  opts?: {
    projectId?: string;
    returnTo?: ProjectContextReturnTo;
    highlight?: boolean;
    scroll?: boolean;
  },
): void {
  if (typeof window === "undefined") return;
  const detail: ProjectContextRevealDetail = {
    projectId: opts?.projectId,
    target,
    returnTo: opts?.returnTo,
    highlight: opts?.highlight !== false,
    scroll: opts?.scroll !== false,
  };
  window.dispatchEvent(
    new CustomEvent<ProjectContextRevealDetail>(PROJECT_CONTEXT_REVEAL_EVENT, { detail }),
  );
  const selector = selectorForContextTarget(target);
  // Story-inline: character/scene/prop (and stage aliases) open the in-place slot.
  const inline = sectionFromSelector(selector);
  revealStoryInlineFromSelector(selector, {
    projectId: opts?.projectId,
    highlight: false,
    scroll: false,
  });

  if (detail.scroll === false) return;
  const scrollSelector = inline ? "#story-reveal-slot" : selector;
  const id = scrollSelector.replace(/^#/, "");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (detail.highlight !== false) {
        if (!flashAnchor(id)) scrollToSelector(scrollSelector);
      } else {
        scrollToSelector(scrollSelector);
      }
    });
  });
}

/** 從錨點揭示（chip 點擊）；無法對應時 fallback scroll */
export function revealProjectContextFromSelector(
  selector: string,
  opts?: {
    projectId?: string;
    returnTo?: ProjectContextReturnTo;
    highlight?: boolean;
    scroll?: boolean;
  },
): void {
  const target = contextTargetFromSelector(selector);
  if (target) {
    revealProjectContext(target, opts);
    return;
  }
  // 非上下文錨點（如 #stage-deliver）：直接捲
  if (opts?.scroll !== false) scrollToSelector(selector);
}

/** 依 returnTo 回到創作台或分鏡 */
export function returnFromContext(
  returnTo: ProjectContextReturnTo,
  opts?: { projectId?: string },
): void {
  if (returnTo === "studio") {
    revealStoryInlineFromSelector("#stage-create", { projectId: opts?.projectId, scroll: false });
    revealWorkbenchAnchor("#sec-studio", { projectId: opts?.projectId });
    return;
  }
  revealStoryInlineFromSelector("#stage-deliver", { projectId: opts?.projectId, scroll: true });
}

/**
 * C2.5：帶入摘要一句話（① 頂／② 生成台共用口徑）。
 * counts 為「這次會帶入」的勾選數，不是庫存總數。
 */
export function formatBringInSummary(parts: {
  wvReady: boolean;
  characterCount: number;
  sceneCount: number;
  propCount: number;
}): string {
  const bits: string[] = [
    parts.wvReady ? "設定✓" : "設定（待設）",
    `角色 ${parts.characterCount}`,
    `場景 ${parts.sceneCount}`,
    `道具 ${parts.propCount}`,
  ];
  return `本次生成會帶入：${bits.join(" · ")}`;
}
