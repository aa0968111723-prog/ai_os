import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { beginAssistantConversation, checkpointAssistantConversation, loadAssistantConversation } from "./assistantConversationState";

describe("assistantConversationState expire persist contract", () => {
  it("load and begin persist expired pickers instead of leaving status=pending", () => {
    const source = readFileSync(new URL("./assistantConversationState.ts", import.meta.url), "utf8");
    expect(source).toContain("expireStaleAssistantInteraction");
    expect(source).toContain("withoutResurrectingExpiredGoal");
  });
});

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

  it("read-back persists pendingInteraction status=expired in PostgreSQL", async () => {
    const conversationId = randomUUID();
    const userId = randomUUID();
    const groupId = randomUUID();
    const goalId = randomUUID();
    const runId = randomUUID();
    const auth = { user: { id: userId } } as any;
    await beginAssistantConversation({ auth, conversationId, groupId, message: "pick a source", runId } as any);
    await db.update(schema.assistantConversationStates).set({
      activeGoal: {
        goalId,
        status: "waiting_user_input",
        frame: {
          intent: "IMPORT",
          operation: "IMPORT",
          objectType: "ASSET",
          source: { type: "GOOGLE_DRIVE" },
          scope: {},
          referents: [],
          constraints: [],
          desiredOutcome: "PERSIST_ASSETS",
          missingSlots: ["source"],
          understandingConfidence: "high",
          sourceConfidence: "high",
          entityConfidence: "high",
          capabilityConfidence: "high",
        },
        resolvedSlots: {},
        missingSlots: ["source"],
        resultRefIds: [],
        pendingInteraction: {
          interactionId: randomUUID(),
          runId,
          goalId,
          type: "SOURCE_PICKER",
          title: "選擇來源",
          required: true,
          resumeToken: randomUUID(),
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
          expectedResultType: "selection",
          status: "pending",
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
      },
    }).where(eq(schema.assistantConversationStates.conversationId, conversationId));
    const loaded = await loadAssistantConversation(auth, groupId, conversationId);
    expect(loaded?.activeGoal?.pendingInteraction?.status).toBe("expired");
    const [row] = await db.select({ activeGoal: schema.assistantConversationStates.activeGoal })
      .from(schema.assistantConversationStates)
      .where(eq(schema.assistantConversationStates.conversationId, conversationId));
    expect(row?.activeGoal?.pendingInteraction?.status).toBe("expired");
    await db.delete(schema.assistantConversationStates)
      .where(eq(schema.assistantConversationStates.conversationId, conversationId));
  });
});
