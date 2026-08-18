/**
 * Persist the project story / worldview into assistant prompts.
 * Page context stays pointer-only; this block is the server-read truth.
 */

export const ASSISTANT_STORY_CONTEXT_BUDGET = 4_000;

export function formatPersistedStoryForAssistant(input: {
  content?: string | null;
  lastParsedAt?: Date | string | null;
}): string {
  const text = (input.content ?? "").trim();
  if (!text) {
    return "故事全文：（尚未寫入。不要說「請貼上你的故事」——先講目前沒有儲存稿，再問要不要用對話發想。）";
  }
  const sliced = text.length > ASSISTANT_STORY_CONTEXT_BUDGET
    ? `${text.slice(0, ASSISTANT_STORY_CONTEXT_BUDGET)}…[truncated]`
    : text;
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
