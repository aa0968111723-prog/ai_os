/**
 * MCP animation writes against real PostgreSQL.
 *
 * Locks: Adopt goes through adoptGenerationCurrent; empty patches are
 * unchanged; same-group cross-project character updates are forbidden.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { XIAOHUA_LOCKED_APPEARANCE } from "../../shared/characterIdentityLock";
import { runMcpWriteExpansion } from "./mcpWriteExpansion";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("MCP animation write expansion (real PostgreSQL)", () => {
  const groupId = randomUUID();
  const userId = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const auth: AuthState = {
    user: { id: userId, name: "mcp-anim", email: "mcp-anim@example.test", isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "動畫組", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };

  afterAll(async () => {
    await db.delete(schema.characters).where(eq(schema.characters.projectId, projectA));
    await db.delete(schema.characters).where(eq(schema.characters.projectId, projectB));
    await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectA));
    await db.delete(schema.generations).where(eq(schema.generations.projectId, projectA));
    await db.delete(schema.assets).where(eq(schema.assets.projectId, projectA));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectA));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectB));
  });

  it("seeds two projects in the same animation group", async () => {
    await db.insert(schema.projects).values([
      { id: projectA, groupId, ownerId: userId, title: "MCP A", kind: "animation", platform: "test", format: "9:16" },
      { id: projectB, groupId, ownerId: userId, title: "MCP B", kind: "animation", platform: "test", format: "9:16" },
    ]);
  });

  it("add_character writes a verified row and empty update is unchanged", async () => {
    const created = await runMcpWriteExpansion(auth, "add_character", {
      projectId: projectA,
      name: "小華",
      appearance: "專案A小華、藍衣",
    }) as { characterId: string; name: string; verified: boolean };
    expect(created.verified).toBe(true);
    expect(created.name).toBe("小華");
    const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, created.characterId));
    expect(row?.projectId).toBe(projectA);
    expect(row?.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);
    const again = await runMcpWriteExpansion(auth, "add_character", {
      projectId: projectA,
      name: "小華（粉橘短髮女孩／白帽T）。不要寫素材清單。不要寫入除角色卡以外的資料",
      appearance: "年輕男性",
    }) as { characterId: string; name: string; reused: boolean };
    expect(again.characterId).toBe(created.characterId);
    expect(again.name).toBe("小華");
    expect(again.reused).toBe(true);
    await expect(runMcpWriteExpansion(auth, "add_character", {
      projectId: projectA,
      name: "不要寫素材清單",
      appearance: "待補外觀描述",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
    const empty = await runMcpWriteExpansion(auth, "update_character", {
      characterId: created.characterId,
    }) as { unchanged?: boolean };
    expect(empty.unchanged).toBe(true);
    const blobRename = await runMcpWriteExpansion(auth, "update_character", {
      characterId: created.characterId,
      name: "小華（粉橘短髮女孩／白帽T）。不要寫素材清單。不要寫入除角色卡以外的資料",
    }) as { characterId: string; name: string };
    expect(blobRename.characterId).toBe(created.characterId);
    expect(blobRename.name).toBe("小華");
    await expect(runMcpWriteExpansion(auth, "update_character", {
      characterId: created.characterId,
      name: "不要寫素材清單",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" } satisfies Partial<TRPCError>);
    const [afterBlob] = await db.select().from(schema.characters).where(eq(schema.characters.id, created.characterId));
    expect(afterBlob?.name).toBe("小華");
  });

  it("rejects updating project B 小華 with project A id", async () => {
    const inB = await runMcpWriteExpansion(auth, "add_character", {
      projectId: projectB,
      name: "小華",
      appearance: "專案B小華、紅衣",
    }) as { characterId: string };
    await expect(runMcpWriteExpansion(auth, "update_character", {
      characterId: inB.characterId,
      projectId: projectA,
      appearance: "不該寫入",
    })).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<TRPCError>);
    const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, inB.characterId));
    expect(row?.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);
  });

  it("set_scene_visual(generationId) adopts through the canonical path", async () => {
    const [scene] = await db.insert(schema.scenes).values({
      projectId: projectA,
      title: "鏡1",
      prompt: "小華揮手",
      orderIndex: 0,
    }).returning({ id: schema.scenes.id });
    const generationId = randomUUID();
    const resultUrl = `https://example.test/adopt-${generationId}.png`;
    await db.insert(schema.generations).values({
      id: generationId,
      projectId: projectA,
      groupId,
      userId,
      modelId: "fal-ai/flux/dev",
      kind: "image",
      status: "done",
      prompt: "小華揮手",
      sceneId: scene.id,
      resultUrl,
    });
    const [asset] = await db.insert(schema.assets).values({
      projectId: projectA,
      groupId,
      kind: "image",
      title: "candidate",
      url: resultUrl,
      isAiGenerated: true,
    }).returning({ id: schema.assets.id });
    const result = await runMcpWriteExpansion(auth, "set_scene_visual", {
      sceneId: scene.id,
      generationId,
    }) as { sceneId: string; assetId: string; adopted: boolean; verified: boolean };
    expect(result.adopted).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.assetId).toBe(asset.id);
    const [updated] = await db.select({ assetId: schema.scenes.assetId }).from(schema.scenes).where(eq(schema.scenes.id, scene.id));
    expect(updated?.assetId).toBe(asset.id);
  });
});
