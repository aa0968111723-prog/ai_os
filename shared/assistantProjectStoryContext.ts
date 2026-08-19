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
  if (/(?:讀|看|摘要|總結|概述|列出|summarize).{0,32}(?:已存|目前|這個|專案)?(?:故事|腳本)/iu.test(text)) return true;
  if (/(?:故事|腳本).{0,20}(?:在講|說什麼|講什麼|內容|摘要|角色)/u.test(text)) return true;
  if (/小華在講|並列出角色|並列角色/u.test(text)) return true;
  // Live A–D short-100w summarize still returned 「從疲憊中找到力量」.
  if (/(?:A\s*[-–—~～到至]\s*D).{0,40}(?:摘要|總結|概述|summarize|故事|腳本|100\s*[wW字]|兩句|short[- ]?100)/iu.test(text)) return true;
  if (/(?:摘要|總結|概述|summarize|短摘|short[- ]?100).{0,40}(?:A\s*[-–—~～到至]\s*D|前[四4]幕|short[- ]?100|100\s*[wW字])/iu.test(text)) return true;
  return false;
}

/** Story-read lock line: 小華 is 她 / 粉橘短髮女孩; never another project's 疲憊稿. */
export const STORY_READ_THIS_PROJECT_LOCK =
  "本專案小華是粉橘短髮女孩，代詞用「她」不用「他」。摘要只依本專案 stories.content，禁止引用其他專案的小華故事（躺在床上、從疲憊中找到力量）。";

/**
 * Team / group ask has many projects. Inject stories.content only when
 * THIS project is uniquely named, or the group has exactly one project.
 */
export function pickNamedStoryProject<T extends { title: string }>(
  message: string,
  projects: readonly T[],
): T | null {
  if (projects.length === 1) return projects[0]!;
  const named = projects.filter((project) => {
    const title = project.title.trim();
    return title.length >= 2 && message.includes(title);
  });
  return named.length === 1 ? named[0]! : null;
}

/** Only names already on the card or written in this project's story. Never invent 安倢／媽媽. */
const STORY_CHARACTER_HINTS = ["小華", "禪定龜龜"] as const;

export function namesFromPersistedStory(
  storyContent?: string | null,
  cardNames: readonly string[] = [],
): string[] {
  const story = storyContent ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...cardNames, ...STORY_CHARACTER_HINTS]) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    if (cardNames.some((card) => card.trim() === name) || story.includes(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Live 08:32: 只用免費 tools already returned 專案全貌／分鏡, then the
 * final NIM call died with empty「免費模型逾時」. A read-only summarize
 * must still give two sentences + names from the fetched story.
 */
export function fallbackReadOnlyStorySummary(input: {
  storyContent?: string | null;
  characterNames?: readonly string[];
}): string {
  const story = (input.storyContent ?? "").trim();
  const names = namesFromPersistedStory(story, input.characterNames ?? []);
  const nameLine = names.length
    ? `角色：${names.join("、")}。`
    : "角色定裝尚未建立。";
  const sentences = story
    .split(/[。！？\n]+/u)
    .map((part) => part.replace(/^[A-F]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 72));
  const body = sentences.length
    ? `${sentences.join("。")}。`
    : "這個專案還沒有已存故事正文。";
  return lockAssistantStoryAnswer({
    answer: `${body}${nameLine}`,
    storyContent: story,
    characterNames: names,
  });
}

const FREE_ONLY_EMPTY_TIMEOUT = "免費模型逾時";

export function isEmptyFreeOnlyTimeoutAnswer(answer?: string | null): boolean {
  const text = (answer ?? "").trim();
  if (!text) return true;
  const stripped = text.replace(/[。．.！!？?\s]+$/u, "").trim();
  if (stripped === FREE_ONLY_EMPTY_TIMEOUT) return true;
  // Live 14:14: NIM / fallback sometimes wraps the same empty token.
  return /^免費模型逾時[，,]\s*請稍後再(?:試|問)(?:一次)?$/u.test(stripped);
}

/**
 * Live: tools already returned 專案全貌／分鏡 (2/2), then NIM died with
 * empty「免費模型逾時」. Never show that string once tools succeeded.
 */
export function replaceEmptyFreeTimeoutAfterTools(input: {
  answer?: string | null;
  fetchedOk: boolean;
  storyContent?: string | null;
  characterNames?: readonly string[];
}): string | null {
  if (!input.fetchedOk) {
    return isEmptyFreeOnlyTimeoutAnswer(input.answer) ? null : (input.answer ?? "").trim() || null;
  }
  if (!isEmptyFreeOnlyTimeoutAnswer(input.answer)) return (input.answer ?? "").trim();
  return fallbackReadOnlyStorySummary({
    storyContent: input.storyContent,
    characterNames: input.characterNames ?? [],
  });
}

/** After 專案全貌／分鏡 already returned, a free-only timeout must still answer. */
export function answerAfterFreeOnlyTimeout(input: {
  storyReadAsk: boolean;
  fetchedOk: boolean;
  storyContent?: string | null;
  characterNames?: readonly string[];
}): string | null {
  if (!input.storyReadAsk && !input.fetchedOk) return null;
  if (!(input.storyContent ?? "").trim() && !input.fetchedOk) return null;
  const answer = fallbackReadOnlyStorySummary({
    storyContent: input.storyContent,
    characterNames: input.characterNames ?? [],
  });
  return answer.trim() ? answer : null;
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
  let answer = (input.answer ?? "").replace(/已完成盤點/g, "");
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
