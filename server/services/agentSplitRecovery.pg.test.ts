import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { splitScriptCore, type SplitSceneDraft } from "../routers/director";
import { deriveEffectUuid } from "./agentRunner";
import { RATE_LIMIT_SCOPES } from "./rateLimit";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1"
  && process.env.E2E_MOCK === "1"
  && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("agent split-script recovery (real PostgreSQL)", () => {
  const userId = randomUUID();
  const projectId = randomUUID();
  const groupId = randomUUID();
  const effectId = randomUUID();
  const sceneIds = Array.from({ length: 12 }, (_, index) =>
    deriveEffectUuid(effectId, "split-scene", index),
  );

  beforeAll(async () => {
    await db.insert(schema.users).values({
      id: userId,
      name: "Split recovery test",
      email: `split-recovery-${userId}@example.test`,
      passwordHash: "test-only",
    });
    await db.insert(schema.projects).values({
      id: projectId,
      groupId,
      ownerId: userId,
      title: "Crash recovery",
      kind: "video",
      platform: "test",
      format: "16:9",
      worldview: {},
    });
  });

  afterAll(async () => {
    await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.rateLimitBuckets).where(
      eq(schema.rateLimitBuckets.scope, RATE_LIMIT_SCOPES.director),
    );
  });

  it("persists parsed output before insert, then replays the exact rows without duplicates", async () => {
    let prepared: SplitSceneDraft[] | undefined;
    const simulatedCrash = new Error("fault: crash after prepared result");
    await expect(splitScriptCore({
      userId,
      projectId,
      scriptText: "第一段內容。\n\n第二段內容。",
      sceneIds,
      assertAccess: () => {},
      onPrepared: (scenes) => {
        prepared = scenes.map((scene) => ({ ...scene }));
        throw simulatedCrash;
      },
    })).rejects.toBe(simulatedCrash);

    expect(prepared).toHaveLength(2);
    const beforeReplay = await db
      .select({ id: schema.scenes.id })
      .from(schema.scenes)
      .where(eq(schema.scenes.projectId, projectId));
    expect(beforeReplay).toHaveLength(0);

    const firstReplay = await splitScriptCore({
      userId,
      projectId,
      preparedScenes: prepared,
      sceneIds,
      assertAccess: () => {},
    });
    expect(firstReplay.scenes.map((scene) => scene.id)).toEqual(sceneIds.slice(0, 2));

    const committedReplay = await splitScriptCore({
      userId,
      projectId,
      preparedScenes: prepared,
      sceneIds,
      assertAccess: () => {},
    });
    expect(committedReplay.scenes.map((scene) => scene.id)).toEqual(sceneIds.slice(0, 2));
    const afterReplay = await db
      .select({ id: schema.scenes.id })
      .from(schema.scenes)
      .where(eq(schema.scenes.projectId, projectId));
    expect(afterReplay).toHaveLength(2);
  });

  it("fails closed when fixed scene ids are only partially present", async () => {
    const [remaining] = await db
      .select({ id: schema.scenes.id })
      .from(schema.scenes)
      .where(eq(schema.scenes.projectId, projectId));
    expect(remaining).toBeDefined();
    await db.delete(schema.scenes).where(eq(schema.scenes.id, sceneIds[1]));

    await expect(splitScriptCore({
      userId,
      projectId,
      preparedScenes: [
        { title: "第一幕", prompt: "第一幕畫面" },
        { title: "第二幕", prompt: "第二幕畫面" },
      ],
      sceneIds,
      assertAccess: () => {},
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
