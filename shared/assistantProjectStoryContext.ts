/**
 * Persist the project story / worldview into assistant prompts.
 * Page context stays pointer-only; this block is the server-read truth.
 */

import { isXiaohuaName, rewriteXiaohuaMaleCopy } from "./characterIdentityLock";

export const ASSISTANT_STORY_CONTEXT_BUDGET = 4_000;

/** 「請讀已存故事／摘要小華在講什麼」— do not retrieve another project's 小華稿. */
export function isAssistantStoryReadIntent(message: string): boolean {
  const text = (message ?? "").trim();
  if (!text) return false;
  return /(?:讀|看|摘要|總結|概述|列出).{0,24}(?:已存|目前|這個|專案)?(?:故事|腳本)|(?:故事|腳本).{0,20}(?:在講|說什麼|講什麼|內容|摘要|角色)|小華在講|並列出角色/u.test(text);
}

/**
 * Cross-project library bleed seen on live A–D story-reads.
 * Strip only when this project's stories.content does not contain the phrase.
 */
const FOREIGN_STORY_BLEED_PHRASES = [
  "從疲憊中找到力量",
  "躺在床上",
  "疲憊",
] as const;

function stripForeignStoryBleed(answer: string, storyContent?: string | null): string {
  const story = storyContent ?? "";
  let out = answer;
  for (const phrase of FOREIGN_STORY_BLEED_PHRASES) {
    if (story.includes(phrase)) continue;
    out = out.split(phrase).join("");
  }
  return out
    .replace(/，?\s*提到[他她]如何\s*/g, "")
    .replace(/如何(?=[。，]|$)/g, "")
    .replace(/[，、]{2,}/g, "，")
    .replace(/。{2,}/g, "。")
    .replace(/，。/g, "。")
    .replace(/\s+。/g, "。")
    .replace(/^\s*[，。]+/, "")
    .trim();
}

/** Answer lock: this project's 小華 is 她; never leave 已完成盤點 or foreign 疲憊 on a story-read. */
export function lockAssistantStoryAnswer(input: {
  answer: string;
  storyContent?: string | null;
  characterNames?: readonly string[];
}): string {
  let answer = (input.answer ?? "").replace(/已完成盤點/g, "已讀取本專案故事");
  answer = stripForeignStoryBleed(answer, input.storyContent);
  const hasXiaohua =
    /小華/.test(input.storyContent ?? "")
    || /小華/.test(answer)
    || (input.characterNames ?? []).some((name) => isXiaohuaName(name));
  if (hasXiaohua) answer = rewriteXiaohuaMaleCopy(answer, true);
  return answer;
}

/** Same 4k slice MCP / studio / planner use so truncation does not fork. */
export function slicePersistedStoryContent(content?: string | null): string | null {
  const text = (content ?? "").trim();
  if (!text) return null;
  return text.length > ASSISTANT_STORY_CONTEXT_BUDGET
    ? `${text.slice(0, ASSISTANT_STORY_CONTEXT_BUDGET)}…[truncated]`
    : text;
}

/** One inventory token — never dump 4k of 故事全文 into team `<組現況>`. */
export function formatTeamInventoryStoryFlag(content?: string | null): string {
  return slicePersistedStoryContent(content) ? "有故事稿" : "尚未儲存稿";
}

export function formatPersistedStoryForAssistant(input: {
  content?: string | null;
  lastParsedAt?: Date | string | null;
}): string {
  const sliced = slicePersistedStoryContent(input.content);
  if (!sliced) {
    return "故事全文：（專案尚未儲存稿。先據實說明目前沒有故事正文，再問要不要用對話發想。不要向使用者索取已存在於伺服器的稿。）";
  }
  const parsed = input.lastParsedAt
    ? `（已解析過 ${typeof input.lastParsedAt === "string" ? input.lastParsedAt : input.lastParsedAt.toISOString()}）`
    : "（已儲存、尚未解析成分鏡）";
  return `故事全文${parsed}（僅本專案 stories.content；禁止引用其他專案的小華故事）：\n${sliced}`;
}

export function buildAssistantProjectStatusContext(input: {
  title: string;
  kind: string;
  format: string;
  worldviewBlock: string;
  storyBlock: string;
  sceneCount: number;
  sceneLines: string;
  genDone: number;
  genRunning: number;
  genFailed: number;
  /** Compact roster — story / studio PAGE_TERMS include character. */
  characterLine?: string;
}): string {
  return [
    `標題：${input.title}（${input.kind}，${input.format}）`,
    `世界觀｜${input.worldviewBlock}`,
    input.storyBlock,
    input.characterLine,
    `分鏡（共 ${input.sceneCount}）：`,
    input.sceneLines,
    `生成：完成 ${input.genDone}／生成中 ${input.genRunning}／失敗 ${input.genFailed}`,
  ].filter(Boolean).join("\n");
}
