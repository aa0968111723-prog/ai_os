import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { formatPersistedStoryForAssistant } from "../../shared/assistantProjectStoryContext";

export type PersistedStoryRow = {
  content: string | null;
  lastParsedAt: Date | string | null;
};

/** Raw stories.content for THIS project — never another 小華稿. */
export async function loadPersistedStoryRow(projectId: string): Promise<PersistedStoryRow | null> {
  const [row] = await db
    .select({ content: schema.stories.content, lastParsedAt: schema.stories.lastParsedAt })
    .from(schema.stories)
    .where(eq(schema.stories.projectId, projectId))
    .limit(1);
  return row ?? null;
}

/** Server-read persisted story for assistant / planner prompts. */
export async function loadPersistedStoryForAssistant(projectId: string): Promise<string> {
  const row = await loadPersistedStoryRow(projectId);
  return formatPersistedStoryForAssistant({
    content: row?.content,
    lastParsedAt: row?.lastParsedAt,
  });
}
