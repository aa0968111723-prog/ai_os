/**
 * generateInto stores the requested modelId; versions displays that same id.
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/routers/scenes.generateInto.model.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "../services/boot";
import type { AuthState } from "../services/auth";
import { scenesRouter } from "./scenes";
import { storeGenerationSourceMeta } from "../../shared/generationSourceMeta";
import { getModel } from "../../shared/models";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

const QWEN = "fal-ai/qwen-image-2/text-to-image";

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "model-x", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
}

d("generateInto model X is stored and displayed as X (real PostgreSQL)", () => {
  const leftovers: { users: string[]; projects: string[] } = { users: [], projects: [] };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.assets).where(eq(schema.assets.projectId, projectId));
      await db.delete(schema.generations).where(eq(schema.generations.projectId, projectId));
      await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  it("versions.modelId stays Qwen Image 2.0 and is not current until Adopt", async () => {
    expect(getModel(QWEN)?.label).toBe("Qwen Image 2.0");
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "ModelX", email: `modelx-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "overnight-model-x", kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);
    const [scene] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "鏡1", prompt: "禪堂晨光",
    }).returning();
    const genId = randomUUID();
    const assetId = randomUUID();
    await db.insert(schema.generations).values({
      id: genId,
      projectId: project.id,
      groupId,
      userId,
      modelId: QWEN,
      kind: "image",
      prompt: "禪堂晨光",
      sceneId: scene.id,
      sceneRole: "visual",
      status: "done",
      resultUrl: `/api/assets/${assetId}/file`,
      pointsEst: 1,
      pointsActual: 1,
      params: storeGenerationSourceMeta({ prompt: "禪堂晨光" }, { preserveScenePointer: true }),
    });
    await db.insert(schema.assets).values({
      id: assetId,
      projectId: project.id,
      groupId,
      kind: "image",
      title: "候選",
      url: `/api/assets/${assetId}/file`,
      isAiGenerated: true,
      meta: { generationId: genId, modelId: QWEN },
    });

    const scenes = scenesRouter.createCaller({ auth: authFor(userId, groupId) } as never);
    const before = await scenes.versions({ sceneId: scene.id });
    expect(before.assetId).toBeNull();
    const visual = before.versions.filter((v) => v.role === "visual");
    expect(visual).toHaveLength(1);
    expect(visual[0]?.modelId).toBe(QWEN);
    expect(visual[0]?.isCurrent).toBe(false);
    expect(visual[0]?.canSetCurrent).toBe(true);
    expect(visual[0]?.modelId).not.toBe("fal-ai/fast-lightning-sdxl");

    const adopted = await scenes.setVisualFromAsset({
      sceneId: scene.id,
      assetId,
      acknowledgeApproved: true,
    });
    expect(adopted.assetId).toBe(assetId);

    const after = await scenes.versions({ sceneId: scene.id });
    const current = after.versions.find((v) => v.isCurrent);
    expect(current?.modelId).toBe(QWEN);
    expect(getModel(current!.modelId!)?.label).toBe("Qwen Image 2.0");
  });
});
