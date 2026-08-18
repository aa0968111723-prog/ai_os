/**
 * Persist the project story / worldview into assistant prompts.
 * Page context stays pointer-only; this block is the server-read truth.
 */

export const ASSISTANT_STORY_CONTEXT_BUDGET = 4_000;

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
  return `故事全文${parsed}：\n${sliced}`;
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
}): string {
  return [
    `標題：${input.title}（${input.kind}，${input.format}）`,
    `世界觀｜${input.worldviewBlock}`,
    input.storyBlock,
    `分鏡（共 ${input.sceneCount}）：`,
    input.sceneLines,
    `生成：完成 ${input.genDone}／生成中 ${input.genRunning}／失敗 ${input.genFailed}`,
  ].filter(Boolean).join("\n");
}
