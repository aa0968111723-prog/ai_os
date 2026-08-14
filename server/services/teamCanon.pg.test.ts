/**
 * Team Canon integration（real PostgreSQL；master plan §20 Integration）：
 * Team Canon → Project Pin → 跨專案 reuse → Canon upgrade → targeted stale。
 *
 * 這些不變量（版本不可變、升級只 stale 依賴鏡、rights 擋跨專案）都跨多張表，
 * 純函式測不到，鎖在真 DB 上。RUN_PG_INTEGRATION=1 + DATABASE_URL 才跑。
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import {
  addCanonVersionFromPin,
  applyCanonUpgrade,
  archiveCanonVersion,
  canonUpgradeImpact,
  canonVersionFingerprint,
  createCanonFromEntity,
  createCanonVersionFromTraining,
  getCanonEntry,
  listProjectPins,
  pinCanonToProject,
  promoteCanonVersion,
  rollbackCanonVersion,
  setCanonRights,
} from "./teamCanon";
import { freezeShotContextPacket } from "./shotContextPackets";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("Team Canon foundation (real PostgreSQL)", () => {
  const groupId = randomUUID();
  const teamId = randomUUID();
  const userId = randomUUID();
  const memberId = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();

  const leaderAuth: AuthState = {
    user: { id: userId, name: "Canon 測試組長", email: "canon-leader@example.test", isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "Canon 組", teamId, teamName: "Canon 團", role: "leader" }],
    adminTeamIds: [],
  };
  const memberAuth: AuthState = {
    user: { id: memberId, name: "Canon 測試組員", email: "canon-member@example.test", isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "Canon 組", teamId, teamName: "Canon 團", role: "member" }],
    adminTeamIds: [],
  };

  afterAll(async () => {
    await db.delete(schema.shotContextPacketHeads).where(inArray(schema.shotContextPacketHeads.projectId, [projectA, projectB]));
    await db.delete(schema.shotContextPackets).where(inArray(schema.shotContextPackets.projectId, [projectA, projectB]));
    await db.delete(schema.scenes).where(inArray(schema.scenes.projectId, [projectA, projectB]));
    await db.delete(schema.projectCanonPins).where(eq(schema.projectCanonPins.groupId, groupId));
    await db.delete(schema.canonVersionEvents).where(inArray(
      schema.canonVersionEvents.canonId,
      (await db.select({ id: schema.canonEntries.id }).from(schema.canonEntries).where(eq(schema.canonEntries.groupId, groupId))).map((row) => row.id),
    ));
    await db.delete(schema.canonVersions).where(eq(schema.canonVersions.groupId, groupId));
    await db.delete(schema.canonEntries).where(eq(schema.canonEntries.groupId, groupId));
    await db.delete(schema.consistencyModelVersions).where(eq(schema.consistencyModelVersions.groupId, groupId));
    await db.delete(schema.consistencyTrainingJobs).where(eq(schema.consistencyTrainingJobs.groupId, groupId));
    await db.delete(schema.consistencyDatasetManifests).where(eq(schema.consistencyDatasetManifests.groupId, groupId));
    await db.delete(schema.characterLooks).where(eq(schema.characterLooks.groupId, groupId));
    await db.delete(schema.characters).where(eq(schema.characters.groupId, groupId));
    await db.delete(schema.props).where(eq(schema.props.groupId, groupId));
    await db.delete(schema.scenePresets).where(eq(schema.scenePresets.groupId, groupId));
    await db.delete(schema.projects).where(inArray(schema.projects.id, [projectA, projectB]));
  });

  let luffyCardA = "";
  let canonId = "";
  let pinAId = "";
  let v1Id = "";
  let v2Id = "";
  let v3Id = "";
  let pinBId = "";
  let luffyCardB = "";
  let shotWithLuffy = "";
  let shotWithout = "";

  it("seed：兩個專案與角色卡", async () => {
    await db.insert(schema.projects).values([
      { id: projectA, groupId, ownerId: userId, title: "白日夢島", kind: "campaign", platform: "test", format: "plan", worldview: {} },
      { id: projectB, groupId, ownerId: userId, title: "第二部腳本", kind: "campaign", platform: "test", format: "plan", worldview: {} },
    ]);
    const [card] = await db.insert(schema.characters).values({
      projectId: projectA, groupId, name: "魯夫",
      appearance: "草帽、紅背心、短褲", notes: "樂觀直率", createdBy: userId,
    }).returning({ id: schema.characters.id });
    luffyCardA = card.id;
  });

  it("createCanonFromEntity：升 Canon＝V1 production＋自動 pin 回來源專案；重複呼叫冪等", async () => {
    const created = await createCanonFromEntity({
      auth: leaderAuth, projectId: projectA, entityKind: "character", entityId: luffyCardA, confirmRights: true,
    });
    expect(created.reused).toBe(false);
    canonId = created.canonId;
    v1Id = created.versionId;
    pinAId = created.pinId;

    const again = await createCanonFromEntity({
      auth: leaderAuth, projectId: projectA, entityKind: "character", entityId: luffyCardA, confirmRights: true,
    });
    expect(again.reused).toBe(true);
    expect(again.canonId).toBe(canonId);

    const entry = await getCanonEntry({ auth: leaderAuth, canonId });
    expect(entry.canon.reuseScope).toBe("team");
    expect(entry.canon.productionVersionId).toBe(v1Id);
    expect(entry.versions).toHaveLength(1);
    expect(entry.versions[0]!.versionNumber).toBe(1);
  });

  it("版本不可變：同內容不重複開版；改內容開 V2，V1 payload 原封不動", async () => {
    const noChange = await addCanonVersionFromPin({ auth: leaderAuth, pinId: pinAId });
    expect(noChange.reused).toBe(true);
    expect(noChange.versionId).toBe(v1Id);

    await db.update(schema.characters)
      .set({ appearance: "草帽、紅背心、短褲、傷疤", rev: 1 })
      .where(eq(schema.characters.id, luffyCardA));
    const v2 = await addCanonVersionFromPin({ auth: leaderAuth, pinId: pinAId });
    expect(v2.reused).toBe(false);
    expect(v2.versionNumber).toBe(2);
    v2Id = v2.versionId;

    const [v1Row] = await db.select().from(schema.canonVersions).where(eq(schema.canonVersions.id, v1Id));
    expect(v1Row!.payload.descriptor.appearance).toBe("草帽、紅背心、短褲");
    expect(v1Row!.fingerprint).toBe(canonVersionFingerprint(v1Row!.payload));
    // production 指標未動：訓練／新版不 silent promote
    const entry = await getCanonEntry({ auth: leaderAuth, canonId });
    expect(entry.canon.productionVersionId).toBe(v1Id);
  });

  it("Promote 是組長的明確動作；組員 FORBIDDEN；events 留下歷史", async () => {
    await expect(promoteCanonVersion({ auth: memberAuth, versionId: v2Id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const promoted = await promoteCanonVersion({ auth: leaderAuth, versionId: v2Id });
    expect(promoted.productionVersionId).toBe(v2Id);
    const entry = await getCanonEntry({ auth: leaderAuth, canonId });
    const promotedEvent = entry.events.find((row) => row.event === "promoted");
    expect(promotedEvent?.versionId).toBe(v2Id);
    expect((promotedEvent?.detail as { prevProductionVersionId?: string })?.prevProductionVersionId).toBe(v1Id);
  });

  it("pin 進第二個專案＝reference not copy：落地本地 handle、記住 canonical 來源", async () => {
    const pinned = await pinCanonToProject({ auth: leaderAuth, projectId: projectB, canonId });
    expect(pinned.reused).toBe(false);
    expect(pinned.versionId).toBe(v2Id);
    expect(pinned.localEntityId).toBeTruthy();
    pinBId = pinned.pinId;
    luffyCardB = pinned.localEntityId!;

    const [cardB] = await db.select().from(schema.characters).where(eq(schema.characters.id, luffyCardB));
    expect(cardB!.projectId).toBe(projectB);
    expect(cardB!.appearance).toBe("草帽、紅背心、短褲、傷疤");

    const pins = await listProjectPins({ auth: leaderAuth, projectId: projectB });
    expect(pins).toHaveLength(1);
    expect(pins[0]!.state).toBe("PINNED");

    const repin = await pinCanonToProject({ auth: leaderAuth, projectId: projectB, canonId });
    expect(repin.reused).toBe(true);
    expect(repin.pinId).toBe(pinBId);
  });

  it("canon upgrade 只 stale 真正依賴這張卡的鏡；current 畫面保留", async () => {
    const [withLuffy] = await db.insert(schema.scenes).values({
      projectId: projectB, orderIndex: 0, title: "魯夫出場", prompt: "魯夫站在船頭",
      characterIds: [luffyCardB], durationSec: 3,
    }).returning({ id: schema.scenes.id });
    const [without] = await db.insert(schema.scenes).values({
      projectId: projectB, orderIndex: 1, title: "空景", prompt: "海面空景", durationSec: 3,
    }).returning({ id: schema.scenes.id });
    shotWithLuffy = withLuffy.id;
    shotWithout = without.id;
    await freezeShotContextPacket({ auth: leaderAuth, projectId: projectB, shotId: shotWithLuffy });
    await freezeShotContextPacket({ auth: leaderAuth, projectId: projectB, shotId: shotWithout });

    // Team 端出 V3（改造型描述）並 promote
    await db.update(schema.characters)
      .set({ appearance: "草帽、黃背心、短褲、傷疤", rev: 2 })
      .where(eq(schema.characters.id, luffyCardA));
    const v3 = await addCanonVersionFromPin({ auth: leaderAuth, pinId: pinAId });
    v3Id = v3.versionId;
    await promoteCanonVersion({ auth: leaderAuth, versionId: v3Id });

    // 專案 B 看到 UPDATE_AVAILABLE，不 silent-update
    const pins = await listProjectPins({ auth: leaderAuth, projectId: projectB });
    expect(pins[0]!.state).toBe("UPDATE_AVAILABLE");
    expect(pins[0]!.pinnedVersionId).toBe(v2Id);

    const impact = await canonUpgradeImpact({ auth: leaderAuth, projectId: projectB, canonId });
    expect(impact.affectedShotIds).toEqual([shotWithLuffy]);

    const upgraded = await applyCanonUpgrade({ auth: leaderAuth, pinId: pinBId });
    expect(upgraded.staleShotIds).toEqual([shotWithLuffy]);

    const heads = await db.select().from(schema.shotContextPacketHeads)
      .where(inArray(schema.shotContextPacketHeads.shotId, [shotWithLuffy, shotWithout]));
    const headLuffy = heads.find((row) => row.shotId === shotWithLuffy);
    const headEmpty = heads.find((row) => row.shotId === shotWithout);
    expect(headLuffy?.stale).toBe(true);
    expect(headEmpty?.stale).toBe(false);

    // 本地 handle 已同步到 V3、rev 有進位（下游依 rev 判斷變更）
    const [cardB] = await db.select().from(schema.characters).where(eq(schema.characters.id, luffyCardB));
    expect(cardB!.appearance).toBe("草帽、黃背心、短褲、傷疤");
    expect(cardB!.rev).toBeGreaterThan(0);
  });

  it("rights：未確認授權的 Canon 是 private，其他專案 pin 被擋；組長開放後才可用", async () => {
    const [namiCard] = await db.insert(schema.characters).values({
      projectId: projectA, groupId, name: "娜美", appearance: "橘髮、藍上衣", createdBy: userId,
    }).returning({ id: schema.characters.id });
    const nami = await createCanonFromEntity({
      auth: leaderAuth, projectId: projectA, entityKind: "character", entityId: namiCard.id, confirmRights: false,
    });
    await expect(pinCanonToProject({ auth: leaderAuth, projectId: projectB, canonId: nami.canonId }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setCanonRights({ auth: memberAuth, canonId: nami.canonId, reuseScope: "team" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await setCanonRights({ auth: leaderAuth, canonId: nami.canonId, reuseScope: "team" });
    const pinned = await pinCanonToProject({ auth: leaderAuth, projectId: projectB, canonId: nami.canonId });
    expect(pinned.localEntityId).toBeTruthy();
  });

  it("訓練成果只能是 Candidate：rights 未允許訓練先 FORBIDDEN；掛上後 production 不動", async () => {
    const datasetId = randomUUID();
    const jobId = randomUUID();
    const modelVersionId = randomUUID();
    await db.insert(schema.consistencyDatasetManifests).values({
      id: datasetId, projectId: projectA, groupId, characterId: luffyCardA,
      fingerprint: `test-${datasetId}`,
      manifest: { schemaVersion: "consistency-dataset.v1", projectId: projectA, characterId: luffyCardA, lookId: null, entries: [], fingerprint: `test-${datasetId}` },
      createdBy: userId,
    });
    await db.insert(schema.consistencyTrainingJobs).values({
      id: jobId, projectId: projectA, groupId, characterId: luffyCardA, datasetId,
      provider: "fal", modelId: "fal-ai/flux-lora-fast-training", status: "succeeded",
      idempotencyKey: `test-${jobId}`, createdBy: userId,
    });
    await db.insert(schema.consistencyModelVersions).values({
      id: modelVersionId, projectId: projectA, groupId, characterId: luffyCardA, jobId,
      adapterRef: "lora://test-adapter", active: false, metrics: {},
    });

    await expect(createCanonVersionFromTraining({ auth: leaderAuth, canonId, modelVersionId }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await setCanonRights({ auth: leaderAuth, canonId, trainingAllowed: true });
    const trained = await createCanonVersionFromTraining({ auth: leaderAuth, canonId, modelVersionId });
    expect(trained.reused).toBe(false);

    const entry = await getCanonEntry({ auth: leaderAuth, canonId });
    // production 指標仍在 V3——訓練完成絕不 silent promote
    expect(entry.canon.productionVersionId).toBe(v3Id);
    const trainedVersion = entry.versions.find((row) => row.id === trained.versionId);
    expect(trainedVersion?.hasTraining).toBe(true);
    expect(trainedVersion?.adapterRef).toBe("lora://test-adapter");
    expect(trainedVersion?.isProduction).toBe(false);
  });

  it("rollback 與封存守門：production 版本不能封存；rollback 走事件留痕", async () => {
    await expect(archiveCanonVersion({ auth: leaderAuth, versionId: v3Id }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const rolled = await rollbackCanonVersion({ auth: leaderAuth, canonId, toVersionId: v1Id });
    expect(rolled.productionVersionId).toBe(v1Id);
    await archiveCanonVersion({ auth: leaderAuth, versionId: v3Id });
    const entry = await getCanonEntry({ auth: leaderAuth, canonId });
    expect(entry.events.some((row) => row.event === "rolled_back")).toBe(true);
    expect(entry.versions.find((row) => row.id === v3Id)?.archived).toBe(true);
    // 已封存版本不能再被 promote
    await expect(promoteCanonVersion({ auth: leaderAuth, versionId: v3Id }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
