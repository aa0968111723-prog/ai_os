/**
 * Story-inline IA: the project page has one primary surface (story) and six
 * on-demand sections. Collapse state is UI-only — no schema change.
 *
 * Old four-stage hashes (#stage-board / #stage-create / #stage-deliver) and
 * context anchors (#sec-characters / …) still resolve here so bookmarks,
 * collaboration follow, and workbench chips keep working.
 */

export const STORY_INLINE_REVEAL_EVENT = "aios:story-inline-reveal";

export const STORY_INLINE_SECTION_IDS = [
  "characters",
  "scenes",
  "props",
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
  },
): void {
  if (typeof window === "undefined") return;
  const detail: StoryInlineRevealDetail = {
    projectId: opts?.projectId,
    section,
    highlight: opts?.highlight !== false,
    scroll: opts?.scroll !== false,
  };
  window.dispatchEvent(
    new CustomEvent<StoryInlineRevealDetail>(STORY_INLINE_REVEAL_EVENT, { detail }),
  );
}

export function revealStoryInlineFromSelector(
  selector: string,
  opts?: {
    projectId?: string;
    highlight?: boolean;
    scroll?: boolean;
  },
): StoryInlineSectionId | null {
  const section = sectionFromSelector(selector);
  if (!section) return null;
  revealStoryInlineSection(section, opts);
  return section;
}

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
  doneGenerationCount: number;
}): StoryReadiness {
  if (!input.storyReady) {
    return { kind: "empty", label: "先寫故事", detail: "貼上或寫下故事後，就能解析並產生分鏡。" };
  }
  if (!input.hasParsed) {
    return { kind: "needs_parse", label: "可解析", detail: "按「AI 解析」讓角色、場景、道具在背景就位。" };
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
  if (input.doneGenerationCount <= 0) {
    return {
      kind: "ready_to_produce",
      label: "可製作",
      detail: `已有 ${input.sceneCount} 鏡。展開製作或從分鏡卡逐鏡生成。`,
    };
  }
  return {
    kind: "has_result",
    label: "已有成果",
    detail: `完成 ${input.doneGenerationCount} 次生成。不滿意再展開有問題的部分。`,
  };
}
