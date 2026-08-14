/**
 * Canon-to-Shot pipeline 閉環（real PostgreSQL；master plan §20 Integration＋§18 concurrency）：
 * Scene Package → Shot Packet 繼承 → Adopt 抽 end-state → 下一鏡 previousEnd →
 * 並行 double-Adopt／double-Promote／duplicate callback 冪等。
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { freezeScenePackage } from "./scenePackages";
import { freezeShotContextPacket } from "./shotContextPackets";
import { adoptGenerationCurrent } from "./consistencyAdopt";
import { applyTrainingCallback } from "./consistencyTraining";
import { storeGenerationSourceMeta } from "../../shared/generationSourceMeta";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("Canon-to-Shot pipeline (real PostgreSQL)", () => {
  const groupId = randomUUID();
  const teamId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const storySceneA = randomUUID();
  const storySceneB = randomUUID();

  const auth: AuthState = {
    user: { id: userId, name: "Pipeline 測試", email: "canon-pipeline@example.test", isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "Pipeline 組", teamId, teamName: "Pipeline 團", role: "leader" }],
    adminTeamIds: [],
  };

  afterAll(async () => {
    await db.delete(schema.shotContinuityStates).where(eq(schema.shotContinuityStates.projectId, projectId));
    await db.delete(schema.shotContextPacketHeads).where(eq(schema.shotContextPacketHeads.projectId, projectId));
    await db.delete(schema.shotContextPackets).where(eq(schema.shotContextPackets.projectId, projectId));
    await db.delete(schema.scenePackageHeads).where(eq(schema.scenePackageHeads.projectId, projectId));
    await db.delete(schema.scenePackages).where(eq(schema.scenePackages.projectId, projectId));
    await db.delete(schema.generations).where(eq(schema.generations.projectId, projectId));
    await db.delete(schema.assets).where(eq(schema.assets.projectId, projectId));
    await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
    await db.delete(schema.storyScenes).where(eq(schema.storyScenes.projectId, projectId));
    await db.delete(schema.consistencyModelVersions).where(eq(schema.consistencyModelVersions.groupId, groupId));
    await db.delete(schema.consistencyTrainingJobs).where(eq(schema.consistencyTrainingJobs.groupId, groupId));
    await db.delete(schema.consistencyDatasetManifests).where(eq(schema.consistencyDatasetManifests.groupId, groupId));
    await db.delete(schema.characters).where(eq(schema.characters.groupId, groupId));
    await db.delete(schema.scenePresets).where(eq(schema.scenePresets.groupId, groupId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  });

  let luffyId = "";
  let beachId = "";
  let shotA = "";
  let shotB = "";
  let packetAId = "";

  it("seed：一場戲兩鏡（雨天海灘）", async () => {
    await db.insert(schema.projects).values({
      id: projectId, groupId, ownerId: userId, title: "連戲閉環", kind: "campaign",
      platform: "test", format: "plan", worldview: {},
    });
    const [luffy] = await db.insert(schema.characters).values({
      projectId, groupId, name: "魯夫", appearance: "草帽紅背心", createdBy: userId,
    }).returning({ id: schema.characters.id });
    luffyId = luffy.id;
    const [beach] = await db.insert(schema.scenePresets).values({
      projectId, groupId, name: "淺水灣", palette: "灰藍", lighting: "陰天", createdBy: userId,
    }).returning({ id: schema.scenePresets.id });
    beachId = beach.id;
    await db.insert(schema.storyScenes).values([
      { id: storySceneA, projectId, orderIndex: 0, title: "海灘淋雨", locationId: beachId, environment: { weather: "雨" }, summary: "團隊在雨中抵達海灘，被雨淋濕" },
      { id: storySceneB, projectId, orderIndex: 1, title: "街頭", environment: { weather: "陰" }, summary: "他們走進街頭" },
    ]);
    const [a] = await db.insert(schema.scenes).values({
      projectId, orderIndex: 0, title: "雨中抵達", prompt: "魯夫在雨中走上海灘，被雨淋濕",
      characterIds: [luffyId], scenePresetIds: [beachId], storySceneId: storySceneA, durationSec: 3,
    }).returning({ id: schema.scenes.id });
    const [b] = await db.insert(schema.scenes).values({
      projectId, orderIndex: 1, title: "街頭續行", prompt: "魯夫走進街頭",
      characterIds: [luffyId], storySceneId: storySceneB, durationSec: 3,
    }).returning({ id: schema.scenes.id });
    shotA = a.id;
    shotB = b.id;
  });

  it("Scene Package 凍結後，Shot packet 內嵌 package 指紋與環境", async () => {
    const pkg = await freezeScenePackage({ auth, projectId, storySceneId: storySceneA });
    expect(pkg.payload.environment).toEqual({ weather: "雨" });
    expect(pkg.payload.activeCharacters.map((row) => row.id)).toEqual([luffyId]);
    expect(pkg.payload.location?.id).toBe(beachId);

    const frozen = await freezeShotContextPacket({ auth, projectId, shotId: shotA });
    packetAId = frozen.packetId;
    expect(frozen.payload.scenePackage?.packageId).toBe(pkg.packageId);
    expect(frozen.payload.scenePackage?.fingerprint).toBe(pkg.fingerprint);
    // 腳本說「被雨淋濕」＝授權的狀態改變
    expect(frozen.payload.scriptAuthorizedChanges?.some((row) => row.type === "got_wet")).toBe(true);
    expect(frozen.payload.characterSlots?.[0]?.characterId).toBe(luffyId);
  });

  it("double Adopt 冪等；end-state 帶濕度流進下一鏡 previousEnd", async () => {
    const assetId = randomUUID();
    const genId = randomUUID();
    const url = `https://assets.example.test/${assetId}.png`;
    await db.insert(schema.assets).values({
      id: assetId, projectId, groupId, kind: "image", title: "雨中畫面", url, uploadedBy: userId,
    });
    await db.insert(schema.generations).values({
      id: genId, projectId, groupId, userId, modelId: "fal-ai/fast-lightning-sdxl",
      kind: "image", prompt: "魯夫在雨中走上海灘，被雨淋濕", status: "done", resultUrl: url,
      sceneId: shotA, characterIds: [luffyId], scenePresetIds: [beachId],
      params: storeGenerationSourceMeta({ prompt: "x" }, { shotContextPacketId: packetAId, preserveScenePointer: true }),
    });

    const results = await Promise.allSettled([
      adoptGenerationCurrent({ auth, generationId: genId }),
      adoptGenerationCurrent({ auth, generationId: genId }),
    ]);
    const ok = results.filter((row) => row.status === "fulfilled");
    expect(ok.length).toBeGreaterThanOrEqual(1);

    const [shot] = await db.select({ assetId: schema.scenes.assetId }).from(schema.scenes)
      .where(eq(schema.scenes.id, shotA));
    expect(shot!.assetId).toBe(assetId);

    const states = await db.select().from(schema.shotContinuityStates)
      .where(eq(schema.shotContinuityStates.shotId, shotA));
    expect(states).toHaveLength(1);
    expect(states[0]!.endState.actors[0]?.wetness).toBe("wet");

    // 下一鏡重新凍結：previousEnd 帶著濕度進來（scene_change 不解除濕度）
    const frozenB = await freezeShotContextPacket({ auth, projectId, shotId: shotB });
    expect(frozenB.payload.continuity.previousEnd?.actors[0]?.wetness).toBe("wet");
    expect(frozenB.payload.continuity.currentStart?.actors[0]?.wetness).toBe("wet");
    expect(frozenB.payload.continuity.currentStart?.transitionType).toBe("scene_change");
  });

  it("duplicate training callback 冪等：一個 job 只產一個 model version", async () => {
    const datasetId = randomUUID();
    const jobId = randomUUID();
    await db.insert(schema.consistencyDatasetManifests).values({
      id: datasetId, projectId, groupId, characterId: luffyId,
      fingerprint: `pipe-${datasetId}`,
      manifest: { schemaVersion: "consistency-dataset.v1", projectId, characterId: luffyId, lookId: null, entries: [], fingerprint: `pipe-${datasetId}` },
      createdBy: userId,
    });
    await db.insert(schema.consistencyTrainingJobs).values({
      id: jobId, projectId, groupId, characterId: luffyId, datasetId,
      provider: "fal", modelId: "fal-ai/flux-lora-fast-training", status: "training",
      externalJobId: "ext-1", idempotencyKey: `pipe-${jobId}`, createdBy: userId,
    });
    const first = await applyTrainingCallback({ jobId, externalJobId: "ext-1", status: "succeeded", adapterRef: "lora://pipe" });
    const second = await applyTrainingCallback({ jobId, externalJobId: "ext-1", status: "succeeded", adapterRef: "lora://pipe" });
    expect(first.duplicated).toBe(false);
    expect(second.duplicated).toBe(true);
    expect(second.versionId).toBe(first.versionId);
    const versions = await db.select().from(schema.consistencyModelVersions)
      .where(eq(schema.consistencyModelVersions.jobId, jobId));
    expect(versions).toHaveLength(1);
    // callback 絕不 active（silent promote）
    expect(versions[0]!.active).toBe(false);
  });

  it("packet 依 shot 綁定變更而 stale；不相關的鏡不動", async () => {
    const { refreshShotContextStaleness } = await import("./shotContextPackets");
    // 改 shotA 的角色卡外觀 → 兩鏡都引用魯夫，兩鏡都該 stale；先各自凍結最新
    await freezeShotContextPacket({ auth, projectId, shotId: shotA });
    await freezeShotContextPacket({ auth, projectId, shotId: shotB });
    await db.update(schema.characters).set({ appearance: "草帽黃背心", rev: 1 })
      .where(eq(schema.characters.id, luffyId));
    const result = await refreshShotContextStaleness({
      auth, projectId, changed: { kind: "character", id: luffyId },
    });
    expect(new Set(result.staleShotIds)).toEqual(new Set([shotA, shotB]));
    // 場景卡只在 shotA：改它只 stale shotA
    await freezeShotContextPacket({ auth, projectId, shotId: shotA });
    await freezeShotContextPacket({ auth, projectId, shotId: shotB });
    await db.update(schema.scenePresets).set({ lighting: "夕陽", rev: 1 })
      .where(eq(schema.scenePresets.id, beachId));
    const targeted = await refreshShotContextStaleness({
      auth, projectId, changed: { kind: "scene_preset", id: beachId },
    });
    expect(targeted.staleShotIds).toEqual([shotA]);
  });
});
