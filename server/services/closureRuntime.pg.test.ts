/**
 * Production Consistency Closure integration（real PostgreSQL；#760 §13–§14）。
 *
 * 黃金冒險情境的 DB 可驗骨幹：Style／Voice／Sound World canon 真的流進凍結 packet、
 * 道具轉手 end-state 流進下一鏡、canon 升級只 stale 真依賴鏡、
 * rights 撤回在 execution 前生效、artifact staleness 由 meta 推導、
 * scorecard 是 server 唯一真相。RUN_PG_INTEGRATION=1 + DATABASE_URL 才跑。
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { addProjectCanonVersion, applyCanonUpgrade, createProjectCanon, promoteCanonVersion, setCanonRights } from "./teamCanon";
import { freezeShotContextPacket } from "./shotContextPackets";
import { adoptGenerationCurrent } from "./consistencyAdopt";
import { revalidateExecutionRights } from "./executionRights";
import { projectMediaLineage } from "./mediaLineage";
import { projectWorkspaceProjection } from "./projectConsistencyGraph";
import { storeGenerationSourceMeta } from "../../shared/generationSourceMeta";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("Production consistency closure (real PostgreSQL)", () => {
  const groupId = randomUUID();
  const teamId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();

  const leaderAuth: AuthState = {
    user: { id: userId, name: "Closure 組長", email: "closure-leader@example.test", isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "Closure 組", teamId, teamName: "Closure 團", role: "leader" }],
    adminTeamIds: [],
  };

  afterAll(async () => {
    await db.delete(schema.shotContinuityStates).where(eq(schema.shotContinuityStates.projectId, projectId));
    await db.delete(schema.shotContextPacketHeads).where(eq(schema.shotContextPacketHeads.projectId, projectId));
    await db.delete(schema.shotContextPackets).where(eq(schema.shotContextPackets.projectId, projectId));
    await db.delete(schema.assetRevisions).where(eq(schema.assetRevisions.projectId, projectId));
    await db.delete(schema.generations).where(eq(schema.generations.projectId, projectId));
    await db.delete(schema.assets).where(eq(schema.assets.projectId, projectId));
    await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
    await db.delete(schema.storyScenes).where(eq(schema.storyScenes.projectId, projectId));
    await db.delete(schema.stories).where(eq(schema.stories.projectId, projectId));
    await db.delete(schema.projectCanonPins).where(eq(schema.projectCanonPins.groupId, groupId));
    const canonIds = (await db.select({ id: schema.canonEntries.id }).from(schema.canonEntries).where(eq(schema.canonEntries.groupId, groupId))).map((row) => row.id);
    if (canonIds.length) {
      await db.delete(schema.canonVersionEvents).where(inArray(schema.canonVersionEvents.canonId, canonIds));
    }
    await db.delete(schema.canonVersions).where(eq(schema.canonVersions.groupId, groupId));
    await db.delete(schema.canonEntries).where(eq(schema.canonEntries.groupId, groupId));
    await db.delete(schema.characterLooks).where(eq(schema.characterLooks.groupId, groupId));
    await db.delete(schema.characters).where(eq(schema.characters.groupId, groupId));
    await db.delete(schema.props).where(eq(schema.props.groupId, groupId));
    await db.delete(schema.scenePresets).where(eq(schema.scenePresets.groupId, groupId));
    await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  });

  let namiId = "";
  let zoroId = "";
  let mapPropId = "";
  let transferShotId = "";
  let nextShotId = "";
  let styleCanonId = "";
  let stylePinId = "";
  let styleV1 = "";
  let narrVoiceCanonId = "";
  let narrVoiceV1 = "";
  let narrationShotId = "";

  it("seed：冒險情境（角色／道具／場景／分鏡）", async () => {
    await db.insert(schema.projects).values({
      id: projectId, groupId, ownerId: userId, title: "淺水灣冒險", kind: "campaign",
      platform: "test", format: "plan", worldview: { styles: ["寫實"], taboos: [] },
    });
    await db.insert(schema.groupMembers).values({ groupId, userId, role: "leader" });
    const [nami] = await db.insert(schema.characters).values({
      projectId, groupId, name: "娜美", appearance: "橘髮航海士", createdBy: userId,
    }).returning({ id: schema.characters.id });
    const [zoro] = await db.insert(schema.characters).values({
      projectId, groupId, name: "索隆", appearance: "綠髮三刀流", createdBy: userId,
    }).returning({ id: schema.characters.id });
    namiId = nami.id;
    zoroId = zoro.id;
    const [prop] = await db.insert(schema.props).values({
      projectId, groupId, name: "藏寶圖", appearance: "泛黃羊皮卷", ownerKind: "character", ownerId: namiId, createdBy: userId,
    }).returning({ id: schema.props.id });
    mapPropId = prop.id;
    const [shot1] = await db.insert(schema.scenes).values({
      projectId, groupId, title: "交出藏寶圖", orderIndex: 1, durationSec: 4,
      prompt: "娜美把藏寶圖交給索隆", characterIds: [namiId, zoroId], propIds: [mapPropId], createdBy: userId,
    }).returning({ id: schema.scenes.id });
    const [shot2] = await db.insert(schema.scenes).values({
      projectId, groupId, title: "索隆查看地圖", orderIndex: 2, durationSec: 4,
      prompt: "索隆展開地圖細看", characterIds: [zoroId], propIds: [mapPropId], createdBy: userId,
    }).returning({ id: schema.scenes.id });
    const [shot3] = await db.insert(schema.scenes).values({
      projectId, groupId, title: "旁白鏡", orderIndex: 3, durationSec: 4,
      prompt: "海面遠景", voiceover: "傳說中的寶藏就在前方", createdBy: userId,
    }).returning({ id: schema.scenes.id });
    transferShotId = shot1.id;
    nextShotId = shot2.id;
    narrationShotId = shot3.id;
  });

  it("§4–§6：Style／Voice／Sound World canon 建立＋pin＋真的流進凍結 packet", async () => {
    const style = await createProjectCanon({
      auth: leaderAuth, projectId, kind: "style", name: "主視覺風格",
      descriptorInput: { styles: ["水彩", "吉卜力"], negative: "不要棚拍打光" }, confirmRights: true,
    });
    styleCanonId = style.canonId;
    styleV1 = style.versionId;
    stylePinId = style.pinId;
    const narr = await createProjectCanon({
      auth: leaderAuth, projectId, kind: "voice", name: "旁白",
      descriptorInput: { modelId: "fal-ai/kokoro/mandarin-chinese", voiceId: "zf_xiaoxiao", role: "narration", language: "Chinese" },
      confirmRights: true,
    });
    narrVoiceCanonId = narr.canonId;
    narrVoiceV1 = narr.versionId;
    await createProjectCanon({
      auth: leaderAuth, projectId, kind: "voice", name: "索隆聲線",
      descriptorInput: { modelId: "fal-ai/kokoro/mandarin-chinese", voiceId: "zm_yunjian", characterId: zoroId },
      confirmRights: true,
    });
    await createProjectCanon({
      auth: leaderAuth, projectId, kind: "sound_world", name: "海灘聲音世界",
      descriptorInput: { ambience: "海浪、遠處人聲", music: "溫暖木吉他" }, confirmRights: true,
    });

    const frozen = await freezeShotContextPacket({ auth: leaderAuth, projectId, shotId: transferShotId });
    expect(frozen.payload.styleCanon?.canonId).toBe(styleCanonId);
    expect(frozen.payload.worldStyle).toEqual(["水彩", "吉卜力"]);
    expect(frozen.payload.negativeConstraints).toContain("不要棚拍打光");
    expect(frozen.payload.narrationVoice?.voiceId).toBe("zf_xiaoxiao");
    expect(frozen.payload.soundWorld?.ambience).toBe("海浪、遠處人聲");
    const zoroSlot = frozen.payload.characterSlots?.find((slot) => slot.characterId === zoroId);
    expect(zoroSlot?.voiceId).toBe("zm_yunjian");
  });

  it("§9：resolved 道具轉手在 Adopt 後流進下一鏡 previousEnd（索隆真的拿著地圖）", async () => {
    const frozen = await freezeShotContextPacket({ auth: leaderAuth, projectId, shotId: transferShotId });
    const transfer = frozen.payload.scriptAuthorizedChanges?.find((row) => row.type === "prop_transfer");
    expect(transfer?.resolved).toBe(true);
    expect(transfer?.toCharacterId).toBe(zoroId);

    const genId = randomUUID();
    const [asset] = await db.insert(schema.assets).values({
      projectId, groupId, kind: "image", title: "交圖畫面", url: `https://cdn.example.test/${genId}.png`, isAiGenerated: true,
    }).returning({ id: schema.assets.id });
    await db.insert(schema.generations).values({
      id: genId, projectId, groupId, userId, modelId: "fal-ai/flux/schnell", kind: "image",
      prompt: "娜美把藏寶圖交給索隆", status: "done", resultUrl: `https://cdn.example.test/${genId}.png`,
      sceneId: transferShotId, characterIds: [namiId, zoroId], propIds: [mapPropId],
      params: storeGenerationSourceMeta({ prompt: "x" }, { shotContextPacketId: frozen.packetId }),
    });
    const adopted = await adoptGenerationCurrent({ auth: leaderAuth, generationId: genId });
    expect(adopted.adopted).toBe(true);

    const [state] = await db.select().from(schema.shotContinuityStates)
      .where(eq(schema.shotContinuityStates.shotId, transferShotId));
    const zoroEnd = (state.endState as { actors: Array<{ characterId: string; heldPropId?: string | null }> }).actors
      .find((row) => row.characterId === zoroId);
    expect(zoroEnd?.heldPropId).toBe(mapPropId);

    const nextFrozen = await freezeShotContextPacket({ auth: leaderAuth, projectId, shotId: nextShotId });
    const zoroStart = nextFrozen.payload.continuity.currentStart?.actors.find((row) => row.characterId === zoroId);
    expect(zoroStart?.heldPropId).toBe(mapPropId);
  });

  it("§8：voice canon 升級只 stale 依賴聲線的鏡（targeted，不全專案）", async () => {
    await freezeShotContextPacket({ auth: leaderAuth, projectId, shotId: narrationShotId });
    const narrPin = (await db.select().from(schema.projectCanonPins)
      .where(eq(schema.projectCanonPins.canonId, narrVoiceCanonId)))[0]!;
    const v2 = await addProjectCanonVersion({
      auth: leaderAuth, pinId: narrPin.id,
      descriptorInput: { modelId: "fal-ai/kokoro/mandarin-chinese", voiceId: "zf_xiaobei", role: "narration", language: "Chinese" },
    });
    await promoteCanonVersion({ auth: leaderAuth, versionId: v2.versionId });
    const upgraded = await applyCanonUpgrade({ auth: leaderAuth, pinId: narrPin.id });
    // 三鏡都在 narrationVoice 依賴下（packet 級 narrationVoice 是專案預設）——
    // 但只有已凍結 packet 的鏡會被重算；transferShot／narrationShot 有凍結，皆依賴 → stale
    expect(upgraded.staleShotIds).toContain(narrationShotId);
    // 專案沒有無關鏡被 stale（nextShot 也凍結過且同樣依賴旁白預設——驗證不多不少）
    const heads = await db.select().from(schema.shotContextPacketHeads)
      .where(eq(schema.shotContextPacketHeads.projectId, projectId));
    const staleHeads = heads.filter((row) => row.stale).map((row) => row.shotId).sort();
    expect(staleHeads).toEqual([...upgraded.staleShotIds].sort());
  });

  it("§3：rights 撤回在 execution 前生效（revalidation 產生 structured blocker）", async () => {
    const frozen = await freezeShotContextPacket({ auth: leaderAuth, projectId, shotId: transferShotId });
    const genId = randomUUID();
    await db.insert(schema.generations).values({
      id: genId, projectId, groupId, userId, modelId: "fal-ai/flux/schnell", kind: "image",
      prompt: "重生成", status: "awaiting_approval", sceneId: transferShotId,
      params: storeGenerationSourceMeta({ prompt: "x" }, { shotContextPacketId: frozen.packetId }),
    });
    const okBefore = await revalidateExecutionRights({
      generation: { id: genId, projectId, groupId, userId, params: storeGenerationSourceMeta({ prompt: "x" }, { shotContextPacketId: frozen.packetId }) },
    });
    expect(okBefore.ok).toBe(true);

    await setCanonRights({ auth: leaderAuth, canonId: styleCanonId, generationAllowed: false });
    const blocked = await revalidateExecutionRights({
      generation: { id: genId, projectId, groupId, userId, params: storeGenerationSourceMeta({ prompt: "x" }, { shotContextPacketId: frozen.packetId }) },
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blockers.some((row) => row.code === "canon_generation_revoked")).toBe(true);
    // 還原（後續測試不受影響）
    await setCanonRights({ auth: leaderAuth, canonId: styleCanonId, generationAllowed: true });
  });

  it("§8：artifact staleness 由 meta 推導（旁白用舊聲線版本→voice_version_drift）", async () => {
    const genId = randomUUID();
    const [audio] = await db.insert(schema.assets).values({
      projectId, groupId, kind: "audio", title: "舊旁白", url: `https://cdn.example.test/${genId}.mp3`,
      isAiGenerated: true, meta: { generationId: genId },
    }).returning({ id: schema.assets.id });
    await db.insert(schema.generations).values({
      id: genId, projectId, groupId, userId, modelId: "fal-ai/kokoro/mandarin-chinese", kind: "audio",
      prompt: "傳說中的寶藏就在前方", status: "done", resultUrl: `https://cdn.example.test/${genId}.mp3`,
      sceneId: narrationShotId, sceneRole: "narration",
      params: storeGenerationSourceMeta({ prompt: "x" }, {
        voice: { canonId: narrVoiceCanonId, versionId: narrVoiceV1, voiceId: "zf_xiaoxiao", applied: true },
      }),
    });
    await db.update(schema.scenes).set({ narrationAssetId: audio.id }).where(eq(schema.scenes.id, narrationShotId));

    const lineage = await projectMediaLineage({ auth: leaderAuth, projectId, lineageShotIds: [narrationShotId] });
    const drift = lineage.findings.find((row) => row.track === "narration" && row.shotId === narrationShotId);
    expect(drift?.code).toBe("voice_version_drift");
    const shotLineage = lineage.lineages[0]!;
    expect(shotLineage.tracks.find((row) => row.track === "narration")?.canonDeps).toEqual([
      { canonId: narrVoiceCanonId, versionId: narrVoiceV1 },
    ]);
  });

  it("§11：scorecard 是 server 唯一真相（voice stale＋multi-char downgrade＋style 已 pin 不報）", async () => {
    const projection = await projectWorkspaceProjection({ auth: leaderAuth, projectId });
    const voiceRow = projection.scorecard.find((row) => row.dimension === "voice");
    expect(voiceRow?.status).toBe("stale");
    expect(voiceRow?.affectedShotIds).toContain(narrationShotId);
    const identityDowngrade = projection.scorecard.find((row) => row.status === "capability_downgrade");
    expect(identityDowngrade?.affectedShotIds).toContain(transferShotId);
    expect(projection.scorecard.find((row) => row.dimension === "style")).toBeUndefined();
    expect(projection.artifactFindings.some((row) => row.code === "voice_version_drift")).toBe(true);
    expect(projection.deliveryBlockers).toContain("有聲音與現行聲線／聲音世界不一致");
  });
});
