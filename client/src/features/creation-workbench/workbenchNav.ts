import { scrollIntoViewForChrome } from "../../lib/scrollIntoViewForChrome";
import { updateDraft, type CreationMode } from "./creationDraft";

/**
 * External navigators (GenerationList chips, deep links, context bar) reveal a
 * workbench mode so anchors inside hidden tabpanels become visible before scroll.
 */

export const WORKBENCH_REVEAL_EVENT = "aios:workbench-reveal";

export type WorkbenchRevealDetail = {
  /** When set, only the matching project workbench handles the event */
  projectId?: string;
  mode?: CreationMode;
  /** Anchor id without leading # */
  anchor?: string;
  /** Expand plan execution <details> once */
  openPlan?: boolean;
  /** Expand the hub body if collapsed */
  expand?: boolean;
  /** Scroll to anchor after mode switch (default true) */
  scroll?: boolean;
};

export function modeForAnchor(anchorOrSelector: string): CreationMode | null {
  const id = anchorOrSelector.replace(/^#/, "");
  switch (id) {
    case "sec-agent":
      return "plan";
    case "sec-assistant":
      return "ask";
    case "sec-studio":
    case "gen-prompt":
      // Form lives inside generate tabpanel; both anchors must unhide it first.
      return "generate";
    case "sec-workflow":
      return "template";
    // Resource drawer anchors: do not switch creation mode (drawer opens via reveal event).
    case "sec-prompts":
    case "sec-generations":
    case "sec-trail":
    case "sec-templates-fav":
      return null;
    default:
      return null;
  }
}

function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return "auto";
  } catch {
    /* ignore */
  }
  return "smooth";
}

/** Single reduced-motion-aware scroll helper (one rAF)；預留底欄（M2）。 */
export function scrollToSelector(selector: string): void {
  const id = selector.startsWith("#") ? selector.slice(1) : selector;
  requestAnimationFrame(() => {
    const el = document.getElementById(id) ?? document.querySelector(selector);
    if (!el) return;
    // 有底欄時用 chrome-aware 捲動，否則仍用原生 block:start（桌面）
    const chrome = typeof window !== "undefined"
      ? Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chrome-bottom")) || 0
      : 0;
    if (chrome > 48) {
      scrollIntoViewForChrome(el, { behavior: scrollBehavior() });
    } else {
      el.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    }
  });
}

/**
 * Persist mode (when projectId known), notify mounted workbench, then scroll.
 * Safe for callers that only know the anchor (GenerationList chips).
 */
export function revealWorkbenchAnchor(
  anchorOrSelector: string,
  opts?: { projectId?: string; scroll?: boolean },
): void {
  if (typeof window === "undefined") return;
  const id = anchorOrSelector.replace(/^#/, "");
  const mode = modeForAnchor(id);
  const projectId = opts?.projectId;
  const scroll = opts?.scroll !== false;

  if (projectId && mode) {
    updateDraft(projectId, { mode });
  }

  const detail: WorkbenchRevealDetail = {
    projectId,
    mode: mode ?? undefined,
    anchor: id,
    openPlan: id === "sec-agent",
    expand: true,
    scroll,
  };
  window.dispatchEvent(new CustomEvent<WorkbenchRevealDetail>(WORKBENCH_REVEAL_EVENT, { detail }));

  // Delayed scroll so React can unhide the tabpanel after the event is handled.
  // Workbench also scrolls after apply; a second scrollIntoView is harmless.
  if (scroll) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToSelector(`#${id}`);
      });
    });
  }
}

/** Programmatic mode switch without requiring an anchor. */
export function requestWorkbenchMode(
  projectId: string,
  mode: CreationMode,
  extra?: Omit<WorkbenchRevealDetail, "projectId" | "mode">,
): void {
  updateDraft(projectId, { mode });
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<WorkbenchRevealDetail>(WORKBENCH_REVEAL_EVENT, {
      detail: {
        projectId,
        mode,
        expand: true,
        openPlan: mode === "plan",
        scroll: false,
        ...extra,
      },
    }),
  );
}
