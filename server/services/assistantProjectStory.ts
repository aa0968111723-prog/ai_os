import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { formatPersistedStoryForAssistant } from "../../shared/assistantProjectStoryContext";

/** Server-read persisted story for assistant / planner prompts. */
export async function loadPersistedStoryForAssistant(projectId: string): Promise<string> {
  const [row] = await db
    .select({ content: schema.stories.content, lastParsedAt: schema.stories.lastParsedAt })
    .from(schema.stories)
    .where(eq(schema.stories.projectId, projectId))
    .limit(1);
  return formatPersistedStoryForAssistant({
    content: row?.content,
    lastParsedAt: row?.lastParsedAt,
  });
}
