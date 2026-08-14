import { publishStoryReveal } from "./storyRevealQueue";

/**
 * Story-inline IA: the project page has one primary surface (story) and
 * on-demand sections disclosed by the red analysis chips. Collapse state
 * is UI-only — no schema change.
 *
 * Old four-stage hashes (#stage-board / #stage-create / #stage-deliver) and
 * context anchors (#sec-characters / …) still resolve here so bookmarks,
 * collaboration follow, and workbench chips keep working.
 */

export const STORY_INLINE_REVEAL_EVENT = "aios:story-inline-reveal";

export const STORY_INLINE_SECTION_IDS = [
  "characters",
  "looks",
  "scenes",
  "props",
  "markers",
  "storyboard",
  "production",
  "delivery",
] as const;

export type StoryInlineSectionId = (typeof STORY_INLINE_SECTION_IDS)[number];

export type StoryInlineSectionDef = {
  id: StoryInlineSectionId;
  label: string;
  /** DOM id of the collapsed row (also used as hash target). */
  anchorId: string;
  /** Legacy hashes / selectors that must open this section. */
  aliases: readonly string[];
};

export const STORY_INLINE_SECTIONS: readonly StoryInlineSectionDef[] = [
  {
    id: "characters",
    label: "角色",
    anchorId: "sec-characters",
    aliases: ["sec-characters", "story-inline-characters"],
  },
  {
    id: "looks",
    label: "造型",
    anchorId: "sec-looks",
    aliases: ["sec-looks", "sec-costume", "story-inline-looks"],
  },
  {
    id: "scenes",
    label: "場景",
    anchorId: "sec-scenes",
    aliases: ["sec-scenes", "story-inline-scenes"],
  },
  {
    id: "props",
    label: "道具",
    anchorId: "sec-props",
    aliases: ["sec-props", "story-inline-props"],
  },
  {
    id: "markers",
    label: "標記",
    anchorId: "sec-markers",
    aliases: ["sec-markers", "story-inline-markers"],
  },
  {
    id: "storyboard",
    label: "分鏡",
    anchorId: "stage-board",
    aliases: ["stage-board", "story-inline-storyboard"],
  },
  {
    id: "production",
    label: "製作",
    anchorId: "stage-create",
    aliases: ["stage-create", "sec-studio", "sec-generations", "gen-prompt", "story-inline-production"],
  },
  {
    id: "delivery",
    label: "交付",
    anchorId: "stage-deliver",
    aliases: ["stage-deliver", "onboard-delivery", "story-inline-delivery"],
  },
];

export type StoryInlineRevealDetail = {
  projectId?: string;
  section: StoryInlineSectionId;
  highlight?: boolean;
  scroll?: boolean;
  /** Nested target to apply after the slot's lazy manager mounts. */
  nestedSelector?: string;
};

const ALIAS_TO_SECTION = new Map<string, StoryInlineSectionId>();
for (const section of STORY_INLINE_SECTIONS) {
  ALIAS_TO_SECTION.set(section.id, section.id);
  ALIAS_TO_SECTION.set(section.anchorId, section.id);
  for (const alias of section.aliases) ALIAS_TO_SECTION.set(alias, section.id);
}

/** Story itself is the home surface, not a collapse row. */
const STORY_HOME_ALIASES = new Set(["stage-story", "stage-context", "story-workspace"]);

export function isStoryHomeHash(raw: string): boolean {
  const id = raw.replace(/^#/, "");
  return STORY_HOME_ALIASES.has(id);
}

export function sectionFromHash(raw: string | null | undefined): StoryInlineSectionId | null {
  if (!raw) return null;
  const id = raw.replace(/^#/, "").trim();
  if (!id) return null;
  return ALIAS_TO_SECTION.get(id) ?? null;
}

export function sectionFromSelector(selector: string): StoryInlineSectionId | null {
  return sectionFromHash(selector);
}

export function defForSection(id: StoryInlineSectionId): StoryInlineSectionDef {
  const found = STORY_INLINE_SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`unknown story-inline section: ${id}`);
  return found;
}

export function selectorForInlineSection(id: StoryInlineSectionId): string {
  return `#${defForSection(id).anchorId}`;
}

/**
 * Persist the open section in the URL without adding history entries.
 * Empty / story-home hashes stay as #stage-story so old bookmarks still land.
 */
export function writeInlineHash(section: StoryInlineSectionId | null): void {
  if (typeof window === "undefined") return;
  const next = section ? `#${defForSection(section).anchorId}` : "#stage-story";
  if (window.location.hash === next) return;
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
}

export function revealStoryInlineSection(
  section: StoryInlineSectionId,
  opts?: {
    projectId?: string;
    highlight?: boolean;
    scroll?: boolean;
    nestedSelector?: string;
  },
): void {
  if (typeof window === "undefined") return;
  const detail: StoryInlineRevealDetail = {
    projectId: opts?.projectId,
    section,
    highlight: opts?.highlight !== false,
    scroll: opts?.scroll !== false,
    nestedSelector: opts?.nestedSelector,
  };
  publishStoryReveal({
    section,
    nestedSelector: opts?.nestedSelector,
    scroll: detail.scroll,
  });
  window.dispatchEvent(
    new CustomEvent<StoryInlineRevealDetail>(STORY_INLINE_REVEAL_EVENT, { detail }),
  );
}

/** Parse-summary chip keys from storyDraft.summaryChips → the section they open. */
export function sectionForSummaryChip(key: string): StoryInlineSectionId | null {
  switch (key) {
    case "characters":
      return "characters";
    case "looks":
      return "looks";
    case "locations":
      return "scenes";
    case "props":
      return "props";
    case "shots":
      return "storyboard";
    case "markers":
      return "markers";
    case "production":
      return "production";
    case "delivery":
      return "delivery";
    default:
      return null;
  }
}

export function revealStoryInlineFromSelector(
  selector: string,
  opts?: {
    projectId?: string;
    highlight?: boolean;
    scroll?: boolean;
    nestedSelector?: string;
  },
): StoryInlineSectionId | null {
  const section = sectionFromSelector(selector);
  if (!section) return null;
  revealStoryInlineSection(section, opts);
  return section;
}

/** A video file. Per-shot video is not an assembled project film. */
export function isPlayableFilmAsset(kind: string | null | undefined): boolean {
  return kind === "video";
}

export { isAssembledProjectFilm } from "@shared/projectCreativeContext";

export type StoryReadinessKind = "empty" | "needs_parse" | "ready_for_board" | "ready_to_produce" | "has_result";

export type StoryReadiness = {
  kind: StoryReadinessKind;
  label: string;
  detail: string;
};

/**
 * First-screen readiness. Uses only already-loaded project facts.
 * Does not invent a generation gate — blocking rules stay on the existing
 * parse / storyboard / workbench / quota paths.
 */
export function storyReadiness(input: {
  storyReady: boolean;
  hasParsed: boolean;
  pendingCount: number;
  sceneCount: number;
  /** Playable assembled video / deliverable — not a still image or generic done generation. */
  playableResultCount: number;
  /** Unsaved edits or story that no longer matches the last parse. */
  isDirty?: boolean;
}): StoryReadiness {
  if (!input.storyReady) {
    return { kind: "empty", label: "先寫故事", detail: "貼上或寫下故事後，就能解析並產生分鏡。" };
  }
  if (!input.hasParsed || input.isDirty) {
    return {
      kind: "needs_parse",
      label: input.isDirty && input.hasParsed ? "故事已改" : "可解析",
      detail: input.isDirty && input.hasParsed
        ? "尚未儲存或重新解析，先前的可製作狀態已過期。"
        : "按「AI 解析」讓角色、場景、道具在背景就位。",
    };
  }
  if (input.sceneCount <= 0) {
    return {
      kind: "ready_for_board",
      label: input.pendingCount > 0 ? `可產生分鏡・${input.pendingCount} 項待確認` : "可產生分鏡",
      detail: input.pendingCount > 0
        ? "不確定的項目不會擋住第一版分鏡；確認後再細修即可。"
        : "解析已完成。按「產生分鏡」建成可製作的鏡頭。",
    };
  }
  if (input.playableResultCount <= 0) {
    return {
      kind: "ready_to_produce",
      label: "可製作",
      detail: `已有 ${input.sceneCount} 鏡。按「生成畫面」做第一版，不必先打開製作。`,
    };
  }
  return {
    kind: "has_result",
    label: "已有成片",
    detail: `已有 ${input.playableResultCount} 段可播放成果。不滿意再指出問題鏡。`,
  };
}
