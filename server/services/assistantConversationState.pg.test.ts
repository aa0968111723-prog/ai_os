import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { beginAssistantConversation, checkpointAssistantConversation, loadAssistantConversation } from "./assistantConversationState";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const describePg = RUN_PG ? describe : describe.skip;

describePg("durable Assistant conversation isolation", () => {
  const conversationId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const groupId = randomUUID();
  const otherGroupId = randomUUID();
  const auth = { user: { id: userId } } as any;
  const base = { auth, conversationId, groupId, message: "import", runId: randomUUID() } as any;

  afterAll(async () => {
    await db.delete(schema.assistantConversationStates).where(eq(schema.assistantConversationStates.conversationId, conversationId));
  });

  it("cannot overwrite or read a conversation from another user/group", async () => {
    await beginAssistantConversation(base);
    await expect(beginAssistantConversation({ ...base, auth: { user: { id: otherUserId } }, groupId: otherGroupId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await loadAssistantConversation({ user: { id: otherUserId } } as any, groupId, conversationId)).toBeNull();
    const owner = await loadAssistantConversation(auth, groupId, conversationId);
    expect(owner).toMatchObject({ conversationId, userId, groupId, status: "running" });
  });

  it("stores only verified bounded result references and expires stale context", async () => {
    const assetId = randomUUID();
    await checkpointAssistantConversation(base, {
      answer: "done", runId: base.runId, events: [], sources: [], activeGoal: undefined,
      dispatches: [], actions: [], siteActions: [], steps: [], canDispatch: false,
      commandLevel: "read", mock: false, contextUsed: [], degraded: false,
      executionPlan: { intent: "DIRECT" }, intakeFallbacks: [],
      executedSiteActions: [{
        action: { type: "import_url", groupId, projectId: randomUUID(), projectTitle: "p", url: "https://example.com", label: "import" },
        result: { type: "import", source: "url", resourceIds: [], assetIds: [assetId], intelligenceIds: [], count: 1, duplicateCount: 0, needsReviewCount: 0, backgroundProcessing: true, verification: { status: "verified", message: "read back" } },
        canUndo: false,
      }],
    } as any);
    const stored = await loadAssistantConversation(auth, groupId, conversationId);
    expect(stored?.recentActionResults[0]).toMatchObject({ type: "import", assetIds: [assetId] });
    expect(stored?.messages).toEqual([
      { role: "user", text: "import" },
      { role: "assistant", text: "done" },
    ]);
    expect(stored?.memoryMetadata).toMatchObject({ verified: true, createdBy: userId, scope: { groupId } });
    await db.update(schema.assistantConversationStates).set({
      memoryMetadata: { ...stored!.memoryMetadata, expiresAt: new Date(0).toISOString() },
    }).where(eq(schema.assistantConversationStates.conversationId, conversationId));
    const expired = await loadAssistantConversation(auth, groupId, conversationId);
    expect(expired?.activeGoal).toBeNull();
    expect(expired?.recentActionResults).toEqual([]);
  });
});
