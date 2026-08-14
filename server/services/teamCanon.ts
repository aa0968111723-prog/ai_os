/**
 * Team Canon service（master plan §2–§4、§18）。
 *
 * 不變量：
 * 1. canon_versions 一經寫入不可變——本檔沒有任何 UPDATE payload/fingerprint 的路徑，
 *    「改」只能開新版本（fingerprint 相同則冪等回舊版）。
 * 2. 「哪一版是 production」只存在 canon_entries.production_version_id 一處。
 * 3. Promote／rollback 是明確的人為動作（組長以上），訓練完成絕不自動 Promote。
 * 4. 專案取得 Canon 只能 pin（引用）；Team 出新版只標 UPDATE_AVAILABLE，
 *    升級（applyCanonUpgrade）是明確動作，且只 stale 真正依賴這張卡的 Shot。
 * 5. 專案私有素材不會自動變成團隊素材：createCanonFromEntity 必須 confirmRights，
 *    未確認前 reuseScope 落在 private（只有來源專案可用）。
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { requireGroup, requireLeader } from "../trpc";
import { loadCreativeContextProject } from "./storyEntityBinding";
import {
  CANON_VERSION_SCHEMA_VERSION,
  buildCanonDescriptorFromEntity,
  canPromoteCanonVersion,
  canonKindForLocalEntity,
  canonicalCanonVersionMaterial,
  localEntityKindForCanon,
  localFieldsForCanonKind,
  pinState,
  type CanonKind,
  type CanonLocalEntityKind,
  type CanonReferenceEntry,
  type CanonReuseScope,
  type CanonTrainingKind,
  type CanonUpgradeImpact,
  type CanonVersionCreatedReason,
  type CanonVersionPayload,
} from "../../shared/teamCanon";
import { packetDependencies, staleShotIdsForEntityChange } from "../../shared/shotContextPacket";
import type { TrainingJobState } from "../../shared/consistencyTraining";

export type CanonEntryRow = typeof schema.canonEntries.$inferSelect;
export type CanonVersionRow = typeof schema.canonVersions.$inferSelect;
export type ProjectCanonPinRow = typeof schema.projectCanonPins.$inferSelect;

export function canonVersionFingerprint(payload: CanonVersionPayload): string {
  return createHash("sha256").update(canonicalCanonVersionMaterial(payload)).digest("hex");
}

/** 與 loadProjectForContext 同一種遮罩：不屬於這個組時回 NOT_FOUND，不當存在性 oracle */
async function loadCanonOrThrow(auth: AuthState, canonId: string): Promise<CanonEntryRow> {
  const [canon] = await db.select().from(schema.canonEntries).where(eq(schema.canonEntries.id, canonId));
  if (!canon) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個 Canon" });
  try {
    requireGroup(auth, canon.groupId);
  } catch {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個 Canon" });
  }
  return canon;
}

async function loadVersionOrThrow(versionId: string): Promise<CanonVersionRow> {
  const [version] = await db.select().from(schema.canonVersions).where(eq(schema.canonVersions.id, versionId));
  if (!version) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個 Canon 版本" });
  return version;
}

async function nextVersionNumber(canonId: string): Promise<number> {
  const [latest] = await db.select({ n: schema.canonVersions.versionNumber })
    .from(schema.canonVersions)
    .where(eq(schema.canonVersions.canonId, canonId))
    .orderBy(desc(schema.canonVersions.versionNumber))
    .limit(1);
  return (latest?.n ?? 0) + 1;
}

async function recordCanonEvent(input: {
  canonId: string;
  versionId: string | null;
  event: "created" | "promoted" | "rolled_back" | "archived" | "rights_updated";
  detail?: Record<string, unknown>;
  actor: string;
}): Promise<void> {
  await db.insert(schema.canonVersionEvents).values({
    canonId: input.canonId,
    versionId: input.versionId,
    event: input.event,
    detail: input.detail ?? null,
    actor: input.actor,
  });
}

/**
 * 開新版本（冪等）：同 canon 同 fingerprint 直接回既有版本，不重複開版。
 * 這是唯一的版本寫入路徑——payload 落庫後不再有任何改寫。
 */
async function insertCanonVersion(input: {
  auth: AuthState;
  canon: CanonEntryRow;
  payload: CanonVersionPayload;
  reason: CanonVersionCreatedReason;
  parentVersionId: string | null;
}): Promise<{ version: CanonVersionRow; reused: boolean }> {
  const fingerprint = canonVersionFingerprint(input.payload);
  const [existing] = await db.select().from(schema.canonVersions).where(and(
    eq(schema.canonVersions.canonId, input.canon.id),
    eq(schema.canonVersions.fingerprint, fingerprint),
  ));
  if (existing) return { version: existing, reused: true };
  const versionNumber = await nextVersionNumber(input.canon.id);
  const [inserted] = await db.insert(schema.canonVersions).values({
    canonId: input.canon.id,
    groupId: input.canon.groupId,
    versionNumber,
    parentVersionId: input.parentVersionId,
    fingerprint,
    payload: input.payload,
    datasetFingerprint: input.payload.datasetFingerprint,
    adapterRef: input.payload.adapterRef,
    trainingJobId: input.payload.trainingJobId,
    createdReason: input.reason,
    evaluation: input.payload.evaluation,
    createdBy: input.auth.user.id,
  }).returning();
  await recordCanonEvent({
    canonId: input.canon.id,
    versionId: inserted.id,
    event: "created",
    detail: { reason: input.reason, versionNumber },
    actor: input.auth.user.id,
  });
  return { version: inserted, reused: false };
}

type LocalEntityRow = {
  id: string;
  name: string;
  referenceAssetId: string | null;
  characterId?: string;
  [key: string]: unknown;
};

async function loadLocalEntity(
  projectId: string,
  kind: CanonLocalEntityKind,
  entityId: string,
): Promise<LocalEntityRow | null> {
  switch (kind) {
    case "character": {
      const [row] = await db.select().from(schema.characters).where(and(
        eq(schema.characters.id, entityId), eq(schema.characters.projectId, projectId)));
      return row ?? null;
    }
    case "character_look": {
      const [row] = await db.select().from(schema.characterLooks).where(and(
        eq(schema.characterLooks.id, entityId), eq(schema.characterLooks.projectId, projectId)));
      return row ?? null;
    }
    case "scene_preset": {
      const [row] = await db.select().from(schema.scenePresets).where(and(
        eq(schema.scenePresets.id, entityId), eq(schema.scenePresets.projectId, projectId)));
      return row ?? null;
    }
    case "prop": {
      const [row] = await db.select().from(schema.props).where(and(
        eq(schema.props.id, entityId), eq(schema.props.projectId, projectId)));
      return row ?? null;
    }
  }
}

/** 參考圖要真的存在、同組、未刪除，才能進 Canon reference */
async function referenceEntryForAsset(input: {
  assetId: string;
  groupId: string;
  role: CanonReferenceEntry["role"];
  rightsReady: boolean;
}): Promise<CanonReferenceEntry | null> {
  const [asset] = await db.select({
    id: schema.assets.id,
    projectId: schema.assets.projectId,
    groupId: schema.assets.groupId,
    deletedAt: schema.assets.deletedAt,
  }).from(schema.assets).where(eq(schema.assets.id, input.assetId));
  if (!asset || asset.deletedAt || asset.groupId !== input.groupId) return null;
  return {
    assetId: asset.id,
    role: input.role,
    priority: "PRIMARY",
    rightsReady: input.rightsReady,
    sourceProjectId: asset.projectId,
  };
}

function referenceRoleForKind(kind: CanonKind): CanonReferenceEntry["role"] {
  switch (kind) {
    case "character": return "identity";
    case "character_look": return "look";
    case "scene": return "scene";
    case "prop": return "prop";
    case "style": return "style";
    default: return "style";
  }
}

async function buildPayloadFromLocalEntity(input: {
  kind: CanonKind;
  name: string;
  entity: LocalEntityRow;
  groupId: string;
  rightsConfirmed: boolean;
}): Promise<CanonVersionPayload> {
  const references: CanonReferenceEntry[] = [];
  if (input.entity.referenceAssetId) {
    const entry = await referenceEntryForAsset({
      assetId: input.entity.referenceAssetId,
      groupId: input.groupId,
      role: referenceRoleForKind(input.kind),
      rightsReady: input.rightsConfirmed,
    });
    if (entry) references.push(entry);
  }
  return {
    schemaVersion: CANON_VERSION_SCHEMA_VERSION,
    kind: input.kind,
    name: input.name,
    descriptor: buildCanonDescriptorFromEntity(input.kind, input.entity),
    references,
    datasetFingerprint: null,
    adapterRef: null,
    trainingJobId: null,
    trainingKind: null,
    evaluation: null,
  };
}

/**
 * 把專案的一張卡升成 Team Canon（含 V1 與自動 pin 回來源專案）。
 *
 * rights 守門：confirmRights=false 時 reuseScope 強制 private——
 * 專案私有素材不會因為「升了 Canon」就自動開放整組重用（§18）。
 * 冪等：同一張卡重複升級直接回既有 Canon。
 */
export async function createCanonFromEntity(input: {
  auth: AuthState;
  projectId: string;
  entityKind: CanonLocalEntityKind;
  entityId: string;
  confirmRights: boolean;
  summary?: string;
}): Promise<{ canonId: string; versionId: string; pinId: string; reused: boolean }> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, true);
  const kind = canonKindForLocalEntity(input.entityKind);
  const entity = await loadLocalEntity(project.id, input.entityKind, input.entityId);
  if (!entity) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這張設定卡" });

  const [existing] = await db.select().from(schema.canonEntries).where(and(
    eq(schema.canonEntries.groupId, project.groupId),
    eq(schema.canonEntries.sourceEntityKind, input.entityKind),
    eq(schema.canonEntries.sourceEntityId, input.entityId),
  ));
  if (existing) {
    const [pin] = await db.select().from(schema.projectCanonPins).where(and(
      eq(schema.projectCanonPins.projectId, project.id),
      eq(schema.projectCanonPins.canonId, existing.id),
    ));
    return {
      canonId: existing.id,
      versionId: existing.productionVersionId ?? "",
      pinId: pin?.id ?? "",
      reused: true,
    };
  }

  // 造型 Canon 必須掛在角色 Canon 底下（跨專案 pin 造型前要先有角色）
  let parentCanonId: string | null = null;
  if (input.entityKind === "character_look") {
    const characterId = entity.characterId as string | undefined;
    const [parent] = characterId
      ? await db.select().from(schema.canonEntries).where(and(
        eq(schema.canonEntries.groupId, project.groupId),
        eq(schema.canonEntries.sourceEntityKind, "character"),
        eq(schema.canonEntries.sourceEntityId, characterId),
      ))
      : [];
    if (!parent) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "請先把這個造型所屬的角色升成 Team Canon" });
    }
    parentCanonId = parent.id;
  }

  const payload = await buildPayloadFromLocalEntity({
    kind,
    name: entity.name,
    entity,
    groupId: project.groupId,
    rightsConfirmed: input.confirmRights,
  });
  const fingerprint = canonVersionFingerprint(payload);

  const retryExisting = async () => {
    // 並行 race：同一張卡同時被兩個人升級——unique index 擋下第二筆後改走冪等回傳
    const [row] = await db.select().from(schema.canonEntries).where(and(
      eq(schema.canonEntries.groupId, project.groupId),
      eq(schema.canonEntries.sourceEntityKind, input.entityKind),
      eq(schema.canonEntries.sourceEntityId, input.entityId),
    ));
    if (!row) return null;
    const [pin] = await db.select().from(schema.projectCanonPins).where(and(
      eq(schema.projectCanonPins.projectId, project.id),
      eq(schema.projectCanonPins.canonId, row.id),
    ));
    return {
      canonId: row.id,
      versionId: row.productionVersionId ?? "",
      pinId: pin?.id ?? "",
      reused: true as const,
    };
  };

  let created: { canonId: string; versionId: string; pinId: string };
  try {
    created = await db.transaction(async (tx) => {
    const [canon] = await tx.insert(schema.canonEntries).values({
      groupId: project.groupId,
      kind,
      name: entity.name,
      summary: input.summary ?? null,
      parentCanonId,
      sourceProjectId: project.id,
      sourceEntityKind: input.entityKind,
      sourceEntityId: input.entityId,
      reuseScope: input.confirmRights ? "team" : "private",
      trainingAllowed: false,
      generationAllowed: true,
      createdBy: input.auth.user.id,
      updatedBy: input.auth.user.id,
    }).returning();
    const [version] = await tx.insert(schema.canonVersions).values({
      canonId: canon.id,
      groupId: canon.groupId,
      versionNumber: 1,
      parentVersionId: null,
      fingerprint,
      payload,
      createdReason: "initial",
      createdBy: input.auth.user.id,
    }).returning();
    await tx.update(schema.canonEntries)
      .set({ productionVersionId: version.id, updatedAt: new Date() })
      .where(eq(schema.canonEntries.id, canon.id));
    const [pin] = await tx.insert(schema.projectCanonPins).values({
      projectId: project.id,
      groupId: project.groupId,
      canonId: canon.id,
      pinnedVersionId: version.id,
      localEntityKind: input.entityKind,
      localEntityId: input.entityId,
      pinnedBy: input.auth.user.id,
    }).returning();
    await tx.insert(schema.canonVersionEvents).values({
      canonId: canon.id,
      versionId: version.id,
      event: "created",
      detail: { reason: "initial", versionNumber: 1 },
      actor: input.auth.user.id,
    });
    return { canonId: canon.id, versionId: version.id, pinId: pin.id };
    });
  } catch (error) {
    const { isUniqueViolation } = await import("./generationCore");
    if (isUniqueViolation(error)) {
      const winner = await retryExisting();
      if (winner) return winner;
    }
    throw error;
  }
  return { ...created, reused: false };
}

/** 把來源專案卡片「現在的樣子」存成新的 Candidate 版本（明確動作；production 指標不動） */
export async function addCanonVersionFromPin(input: {
  auth: AuthState;
  pinId: string;
}): Promise<{ versionId: string; versionNumber: number; reused: boolean }> {
  const [pin] = await db.select().from(schema.projectCanonPins).where(eq(schema.projectCanonPins.id, input.pinId));
  if (!pin) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個 Canon 引用" });
  const project = await loadCreativeContextProject(input.auth, pin.projectId, true);
  const canon = await loadCanonOrThrow(input.auth, pin.canonId);
  if (canon.status === "archived") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這個 Canon 已封存，不能開新版本" });
  }
  if (!pin.localEntityKind || !pin.localEntityId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "這個引用沒有本地卡片，無法從卡片建版本" });
  }
  const entity = await loadLocalEntity(project.id, pin.localEntityKind, pin.localEntityId);
  if (!entity) throw new TRPCError({ code: "NOT_FOUND", message: "找不到本地卡片" });
  const payload = await buildPayloadFromLocalEntity({
    kind: canon.kind,
    name: entity.name,
    entity,
    groupId: canon.groupId,
    // 從已確認 rights 的 Canon 更新版本時沿用其開放狀態；private 的維持未確認
    rightsConfirmed: canon.reuseScope === "team",
  });
  const { version, reused } = await insertCanonVersion({
    auth: input.auth,
    canon,
    payload,
    reason: "entity_update",
    parentVersionId: canon.productionVersionId,
  });
  return { versionId: version.id, versionNumber: version.versionNumber, reused };
}

/**
 * 把訓練成果掛成 Canon Candidate 版本（master plan §3）。
 * 只接受 succeeded 的訓練工作；版本一樣是 Candidate，Promote 另外走人為動作。
 */
export async function createCanonVersionFromTraining(input: {
  auth: AuthState;
  canonId: string;
  modelVersionId: string;
}): Promise<{ versionId: string; versionNumber: number; reused: boolean }> {
  const canon = await loadCanonOrThrow(input.auth, input.canonId);
  if (canon.status === "archived") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這個 Canon 已封存，不能開新版本" });
  }
  if (!canon.trainingAllowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: "這個 Canon 尚未允許訓練（rights 未確認）" });
  }
  const [modelVersion] = await db.select().from(schema.consistencyModelVersions)
    .where(eq(schema.consistencyModelVersions.id, input.modelVersionId));
  if (!modelVersion || modelVersion.groupId !== canon.groupId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個訓練成果" });
  }
  const [job] = await db.select().from(schema.consistencyTrainingJobs)
    .where(eq(schema.consistencyTrainingJobs.id, modelVersion.jobId));
  if (!job || job.status !== "succeeded") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "訓練尚未成功，不能掛成 Canon 版本" });
  }
  // 訓練對象要真的對應這個 Canon：來源卡或任何 pin 的本地卡
  if (job.characterId) {
    const pins = await db.select().from(schema.projectCanonPins)
      .where(eq(schema.projectCanonPins.canonId, canon.id));
    const localIds = new Set(pins.map((row) => row.localEntityId).filter(Boolean));
    if (canon.sourceEntityId) localIds.add(canon.sourceEntityId);
    if (!localIds.has(job.characterId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "訓練對象與這個 Canon 不對應" });
    }
  }
  const [manifest] = await db.select({ fingerprint: schema.consistencyDatasetManifests.fingerprint })
    .from(schema.consistencyDatasetManifests)
    .where(eq(schema.consistencyDatasetManifests.id, job.datasetId));

  const base = canon.productionVersionId ? await loadVersionOrThrow(canon.productionVersionId) : null;
  const trainingKind: CanonTrainingKind | null =
    canon.kind === "character" ? (job.lookId ? "character_look" : "character_identity")
      : canon.kind === "character_look" ? "character_look"
        : canon.kind === "scene" ? "scene_identity"
          : canon.kind === "style" ? "style"
            : canon.kind === "voice" ? "voice"
              : null;
  const payload: CanonVersionPayload = {
    schemaVersion: CANON_VERSION_SCHEMA_VERSION,
    kind: canon.kind,
    name: base?.payload.name ?? canon.name,
    descriptor: base?.payload.descriptor ?? {},
    references: base?.payload.references ?? [],
    datasetFingerprint: manifest?.fingerprint ?? null,
    adapterRef: modelVersion.adapterRef,
    trainingJobId: job.id,
    trainingKind,
    evaluation: null,
  };
  const { version, reused } = await insertCanonVersion({
    auth: input.auth,
    canon,
    payload,
    reason: "training",
    parentVersionId: canon.productionVersionId,
  });
  return { versionId: version.id, versionNumber: version.versionNumber, reused };
}

/** Promote（組長以上）：唯一會移動 production 指標的路徑之一（另一個是 rollback） */
export async function promoteCanonVersion(input: {
  auth: AuthState;
  versionId: string;
}): Promise<{ canonId: string; productionVersionId: string }> {
  const version = await loadVersionOrThrow(input.versionId);
  const canon = await loadCanonOrThrow(input.auth, version.canonId);
  requireLeader(input.auth, canon.groupId);

  let trainingJobStatus: TrainingJobState | null = null;
  let lookChanged = false;
  if (version.trainingJobId) {
    const [job] = await db.select().from(schema.consistencyTrainingJobs)
      .where(eq(schema.consistencyTrainingJobs.id, version.trainingJobId));
    trainingJobStatus = (job?.status ?? "failed") as TrainingJobState;
    lookChanged = job?.lookChanged ?? false;
  }
  const gate = canPromoteCanonVersion({
    versionArchived: version.archived,
    canonArchived: canon.status === "archived",
    trainingJobStatus,
    lookChangedDuringTraining: lookChanged,
  });
  if (!gate.ok) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: gate.reason ?? "這個版本還不能採用" });
  }
  if (canon.productionVersionId === version.id) {
    return { canonId: canon.id, productionVersionId: version.id };
  }
  await db.update(schema.canonEntries).set({
    productionVersionId: version.id,
    updatedBy: input.auth.user.id,
    updatedAt: new Date(),
  }).where(eq(schema.canonEntries.id, canon.id));
  await recordCanonEvent({
    canonId: canon.id,
    versionId: version.id,
    event: "promoted",
    detail: { prevProductionVersionId: canon.productionVersionId },
    actor: input.auth.user.id,
  });
  return { canonId: canon.id, productionVersionId: version.id };
}

/** Rollback（組長以上）：production 指標退回指定版本；歷史全程留在 events */
export async function rollbackCanonVersion(input: {
  auth: AuthState;
  canonId: string;
  toVersionId: string;
}): Promise<{ canonId: string; productionVersionId: string }> {
  const canon = await loadCanonOrThrow(input.auth, input.canonId);
  requireLeader(input.auth, canon.groupId);
  const target = await loadVersionOrThrow(input.toVersionId);
  if (target.canonId !== canon.id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "這個版本不屬於這個 Canon" });
  }
  if (target.archived) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "已封存的版本不能退回採用" });
  }
  const fromVersionId = canon.productionVersionId;
  await db.update(schema.canonEntries).set({
    productionVersionId: target.id,
    updatedBy: input.auth.user.id,
    updatedAt: new Date(),
  }).where(eq(schema.canonEntries.id, canon.id));
  await recordCanonEvent({
    canonId: canon.id,
    versionId: target.id,
    event: "rolled_back",
    detail: { fromVersionId },
    actor: input.auth.user.id,
  });
  return { canonId: canon.id, productionVersionId: target.id };
}

/** 封存版本（組長以上）：current production 不可封存 */
export async function archiveCanonVersion(input: {
  auth: AuthState;
  versionId: string;
}): Promise<{ versionId: string }> {
  const version = await loadVersionOrThrow(input.versionId);
  const canon = await loadCanonOrThrow(input.auth, version.canonId);
  requireLeader(input.auth, canon.groupId);
  if (canon.productionVersionId === version.id) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "production 版本不能封存，請先 rollback 到其他版本" });
  }
  await db.update(schema.canonVersions).set({ archived: true }).where(eq(schema.canonVersions.id, version.id));
  await recordCanonEvent({
    canonId: canon.id,
    versionId: version.id,
    event: "archived",
    actor: input.auth.user.id,
  });
  return { versionId: version.id };
}

/** rights／重用治理（組長以上）——影響整組能不能用，不是一般編輯 */
export async function setCanonRights(input: {
  auth: AuthState;
  canonId: string;
  reuseScope?: CanonReuseScope;
  trainingAllowed?: boolean;
  generationAllowed?: boolean;
  rightsNote?: string | null;
}): Promise<{ canonId: string }> {
  const canon = await loadCanonOrThrow(input.auth, input.canonId);
  requireLeader(input.auth, canon.groupId);
  const changes: Record<string, unknown> = {};
  if (input.reuseScope !== undefined) changes.reuseScope = input.reuseScope;
  if (input.trainingAllowed !== undefined) changes.trainingAllowed = input.trainingAllowed;
  if (input.generationAllowed !== undefined) changes.generationAllowed = input.generationAllowed;
  if (input.rightsNote !== undefined) changes.rightsNote = input.rightsNote;
  if (Object.keys(changes).length === 0) return { canonId: canon.id };
  await db.update(schema.canonEntries).set({
    ...changes,
    updatedBy: input.auth.user.id,
    updatedAt: new Date(),
  }).where(eq(schema.canonEntries.id, canon.id));
  await recordCanonEvent({
    canonId: canon.id,
    versionId: null,
    event: "rights_updated",
    detail: changes,
    actor: input.auth.user.id,
  });
  return { canonId: canon.id };
}

export async function listCanonEntries(input: {
  auth: AuthState;
  groupId: string;
  kind?: CanonKind;
  includeArchived?: boolean;
}) {
  requireGroup(input.auth, input.groupId);
  const rows = await db.select().from(schema.canonEntries)
    .where(and(
      eq(schema.canonEntries.groupId, input.groupId),
      ...(input.kind ? [eq(schema.canonEntries.kind, input.kind)] : []),
      ...(input.includeArchived ? [] : [eq(schema.canonEntries.status, "active" as const)]),
    ))
    .orderBy(asc(schema.canonEntries.kind), asc(schema.canonEntries.name));
  const versionIds = rows.map((row) => row.productionVersionId).filter((id): id is string => Boolean(id));
  const versions = versionIds.length
    ? await db.select().from(schema.canonVersions).where(inArray(schema.canonVersions.id, versionIds))
    : [];
  const byId = new Map(versions.map((row) => [row.id, row]));
  return rows.map((row) => {
    const production = row.productionVersionId ? byId.get(row.productionVersionId) ?? null : null;
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      summary: row.summary,
      status: row.status,
      parentCanonId: row.parentCanonId,
      reuseScope: row.reuseScope,
      trainingAllowed: row.trainingAllowed,
      generationAllowed: row.generationAllowed,
      sourceProjectId: row.sourceProjectId,
      productionVersionId: row.productionVersionId,
      productionVersionNumber: production?.versionNumber ?? null,
      productionFingerprint: production?.fingerprint ?? null,
    };
  });
}

export async function getCanonEntry(input: { auth: AuthState; canonId: string }) {
  const canon = await loadCanonOrThrow(input.auth, input.canonId);
  const [versions, events, pins] = await Promise.all([
    db.select().from(schema.canonVersions)
      .where(eq(schema.canonVersions.canonId, canon.id))
      .orderBy(desc(schema.canonVersions.versionNumber)),
    db.select().from(schema.canonVersionEvents)
      .where(eq(schema.canonVersionEvents.canonId, canon.id))
      .orderBy(desc(schema.canonVersionEvents.createdAt)).limit(50),
    db.select().from(schema.projectCanonPins).where(eq(schema.projectCanonPins.canonId, canon.id)),
  ]);
  return {
    canon,
    versions: versions.map((row) => ({
      id: row.id,
      versionNumber: row.versionNumber,
      parentVersionId: row.parentVersionId,
      fingerprint: row.fingerprint,
      archived: row.archived,
      createdReason: row.createdReason,
      isProduction: canon.productionVersionId === row.id,
      hasTraining: Boolean(row.trainingJobId),
      adapterRef: row.adapterRef,
      createdAt: row.createdAt,
      payload: row.payload,
    })),
    events,
    pinnedProjectIds: pins.map((row) => row.projectId),
  };
}

/**
 * Pin：專案引用 Canon（reference，不 copy）。
 * 有本地卡型別時落一張 handle 卡讓既有 runtime（綁定、packet、生成）直接可用；
 * canonical 真相仍在 Canon version，之後升級由 applyCanonUpgrade 明確同步。
 */
export async function pinCanonToProject(input: {
  auth: AuthState;
  projectId: string;
  canonId: string;
  versionId?: string;
}): Promise<{ pinId: string; localEntityId: string | null; versionId: string; reused: boolean }> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, true);
  const canon = await loadCanonOrThrow(input.auth, input.canonId);
  if (canon.status === "archived") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這個 Canon 已封存，不能再引用" });
  }
  if (canon.groupId !== project.groupId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個 Canon" });
  }
  if (canon.reuseScope === "private" && canon.sourceProjectId !== project.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "這個 Canon 的授權尚未確認，還不能給其他專案使用" });
  }

  const [existing] = await db.select().from(schema.projectCanonPins).where(and(
    eq(schema.projectCanonPins.projectId, project.id),
    eq(schema.projectCanonPins.canonId, canon.id),
  ));
  if (existing) {
    return { pinId: existing.id, localEntityId: existing.localEntityId, versionId: existing.pinnedVersionId, reused: true };
  }

  const versionId = input.versionId ?? canon.productionVersionId;
  if (!versionId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這個 Canon 還沒有可用版本" });
  const version = await loadVersionOrThrow(versionId);
  if (version.canonId !== canon.id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "這個版本不屬於這個 Canon" });
  }
  if (version.archived) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "已封存的版本不能引用" });
  }

  const localKind = localEntityKindForCanon(canon.kind);
  // 本地 handle 與 pin 同一個交易：pin 撞 unique（並行 pin race）時 handle 一起回滾，不留孤兒卡
  try {
    return await db.transaction(async (tx) => {
  let localEntityId: string | null = null;
  if (localKind) {
    const payload = version.payload;
    const primaryRef = payload.references.find((ref) => ref.priority === "PRIMARY")?.assetId ?? null;
    if (localKind === "character") {
      const [row] = await tx.insert(schema.characters).values({
        projectId: project.id,
        groupId: project.groupId,
        name: payload.name,
        appearance: payload.descriptor.appearance ?? payload.name,
        notes: payload.descriptor.notes ?? null,
        referenceAssetId: primaryRef,
        createdBy: input.auth.user.id,
      }).returning({ id: schema.characters.id });
      localEntityId = row.id;
    } else if (localKind === "character_look") {
      if (!canon.parentCanonId) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這個造型 Canon 缺少所屬角色" });
      }
      const [parentPin] = await tx.select().from(schema.projectCanonPins).where(and(
        eq(schema.projectCanonPins.projectId, project.id),
        eq(schema.projectCanonPins.canonId, canon.parentCanonId),
      ));
      if (!parentPin?.localEntityId) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "請先把所屬角色 pin 進這個專案" });
      }
      const [row] = await tx.insert(schema.characterLooks).values({
        projectId: project.id,
        groupId: project.groupId,
        characterId: parentPin.localEntityId,
        name: payload.name,
        costume: payload.descriptor.costume ?? null,
        notes: payload.descriptor.notes ?? null,
        referenceAssetId: primaryRef,
        source: "manual",
        createdBy: input.auth.user.id,
      }).returning({ id: schema.characterLooks.id });
      localEntityId = row.id;
    } else if (localKind === "scene_preset") {
      const [row] = await tx.insert(schema.scenePresets).values({
        projectId: project.id,
        groupId: project.groupId,
        name: payload.name,
        palette: payload.descriptor.palette ?? "未指定",
        lighting: payload.descriptor.lighting ?? null,
        referenceAssetId: primaryRef,
        createdBy: input.auth.user.id,
      }).returning({ id: schema.scenePresets.id });
      localEntityId = row.id;
    } else {
      const [row] = await tx.insert(schema.props).values({
        projectId: project.id,
        groupId: project.groupId,
        name: payload.name,
        appearance: payload.descriptor.appearance ?? payload.name,
        notes: payload.descriptor.notes ?? null,
        referenceAssetId: primaryRef,
        createdBy: input.auth.user.id,
      }).returning({ id: schema.props.id });
      localEntityId = row.id;
    }
  }

  const [pin] = await tx.insert(schema.projectCanonPins).values({
    projectId: project.id,
    groupId: project.groupId,
    canonId: canon.id,
    pinnedVersionId: version.id,
    localEntityKind: localKind,
    localEntityId,
    pinnedBy: input.auth.user.id,
  }).returning();
  return { pinId: pin.id, localEntityId, versionId: version.id, reused: false };
    });
  } catch (error) {
    const { isUniqueViolation } = await import("./generationCore");
    if (isUniqueViolation(error)) {
      const [winner] = await db.select().from(schema.projectCanonPins).where(and(
        eq(schema.projectCanonPins.projectId, project.id),
        eq(schema.projectCanonPins.canonId, canon.id),
      ));
      if (winner) {
        return { pinId: winner.id, localEntityId: winner.localEntityId, versionId: winner.pinnedVersionId, reused: true };
      }
    }
    throw error;
  }
}

/** 解除引用：pin 移除、本地卡保留（變成獨立卡，不再收到 Canon 更新） */
export async function unpinCanon(input: { auth: AuthState; pinId: string }): Promise<{ removed: boolean }> {
  const [pin] = await db.select().from(schema.projectCanonPins).where(eq(schema.projectCanonPins.id, input.pinId));
  if (!pin) return { removed: false };
  await loadCreativeContextProject(input.auth, pin.projectId, true);
  await db.delete(schema.projectCanonPins).where(eq(schema.projectCanonPins.id, pin.id));
  return { removed: true };
}

export async function listProjectPins(input: { auth: AuthState; projectId: string }) {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);
  const pins = await db.select().from(schema.projectCanonPins)
    .where(eq(schema.projectCanonPins.projectId, project.id));
  if (!pins.length) return [];
  const canonIds = [...new Set(pins.map((row) => row.canonId))];
  const versionIds = [...new Set(pins.map((row) => row.pinnedVersionId))];
  const [canons, versions] = await Promise.all([
    db.select().from(schema.canonEntries).where(inArray(schema.canonEntries.id, canonIds)),
    db.select().from(schema.canonVersions).where(inArray(schema.canonVersions.id, versionIds)),
  ]);
  const canonById = new Map(canons.map((row) => [row.id, row]));
  const versionById = new Map(versions.map((row) => [row.id, row]));
  const productionIds = canons.map((row) => row.productionVersionId).filter((id): id is string => Boolean(id));
  const productionVersions = productionIds.length
    ? await db.select({ id: schema.canonVersions.id, versionNumber: schema.canonVersions.versionNumber })
      .from(schema.canonVersions).where(inArray(schema.canonVersions.id, productionIds))
    : [];
  const productionById = new Map(productionVersions.map((row) => [row.id, row]));
  return pins.map((pin) => {
    const canon = canonById.get(pin.canonId);
    const pinned = versionById.get(pin.pinnedVersionId);
    const production = canon?.productionVersionId ? productionById.get(canon.productionVersionId) ?? null : null;
    return {
      pinId: pin.id,
      canonId: pin.canonId,
      canonKind: canon?.kind ?? null,
      canonName: canon?.name ?? null,
      localEntityKind: pin.localEntityKind,
      localEntityId: pin.localEntityId,
      pinnedVersionId: pin.pinnedVersionId,
      pinnedVersionNumber: pinned?.versionNumber ?? null,
      productionVersionId: canon?.productionVersionId ?? null,
      productionVersionNumber: production?.versionNumber ?? null,
      state: canon ? pinState({
        pinnedVersionId: pin.pinnedVersionId,
        productionVersionId: canon.productionVersionId,
      }) : "PINNED",
    };
  });
}

const PACKET_KIND_BY_LOCAL: Record<CanonLocalEntityKind, string> = {
  character: "character",
  character_look: "character_look",
  scene_preset: "scene_preset",
  prop: "prop",
};

/**
 * 升級影響（master plan §4）：用 Shot Context Packet 依賴圖算「哪些鏡真的用到這張卡」，
 * 不是整個專案一起 stale。
 */
export async function canonUpgradeImpact(input: {
  auth: AuthState;
  projectId: string;
  canonId: string;
  toVersionId?: string;
}): Promise<CanonUpgradeImpact> {
  const project = await loadCreativeContextProject(input.auth, input.projectId, false);
  const canon = await loadCanonOrThrow(input.auth, input.canonId);
  const [pin] = await db.select().from(schema.projectCanonPins).where(and(
    eq(schema.projectCanonPins.projectId, project.id),
    eq(schema.projectCanonPins.canonId, canon.id),
  ));
  if (!pin) throw new TRPCError({ code: "NOT_FOUND", message: "這個專案沒有引用這個 Canon" });
  const toVersionId = input.toVersionId ?? canon.productionVersionId;
  if (!toVersionId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這個 Canon 還沒有可升級的版本" });

  const empty: CanonUpgradeImpact = {
    canonId: canon.id,
    fromVersionId: pin.pinnedVersionId,
    toVersionId,
    affectedShotIds: [],
    currentMediaCount: 0,
  };
  if (pin.pinnedVersionId === toVersionId) return empty;
  if (!pin.localEntityKind || !pin.localEntityId) return empty;

  const heads = await db.select().from(schema.shotContextPacketHeads)
    .where(eq(schema.shotContextPacketHeads.projectId, project.id));
  if (!heads.length) return empty;
  const packets = await db.select().from(schema.shotContextPackets)
    .where(inArray(schema.shotContextPackets.id, heads.map((row) => row.packetId)));
  const graphs = packets.map((row) => packetDependencies(row.packet));
  const affectedShotIds = staleShotIdsForEntityChange(graphs, {
    kind: PACKET_KIND_BY_LOCAL[pin.localEntityKind],
    id: pin.localEntityId,
  });
  if (!affectedShotIds.length) return empty;
  const shots = await db.select({ id: schema.scenes.id, assetId: schema.scenes.assetId })
    .from(schema.scenes)
    .where(and(
      eq(schema.scenes.projectId, project.id),
      inArray(schema.scenes.id, affectedShotIds),
      isNull(schema.scenes.deletedAt),
    ));
  return {
    ...empty,
    affectedShotIds,
    currentMediaCount: shots.filter((row) => row.assetId).length,
  };
}

/**
 * 明確升級：pin 移到新版本、本地 handle 同步 descriptor／參考圖、
 * 只 stale 依賴這張卡的 Shot。原 current 畫面保留（重生成結果照舊走 Candidate → Adopt）。
 */
export async function applyCanonUpgrade(input: {
  auth: AuthState;
  pinId: string;
  toVersionId?: string;
}): Promise<{ impact: CanonUpgradeImpact; staleShotIds: string[] }> {
  const [pin] = await db.select().from(schema.projectCanonPins).where(eq(schema.projectCanonPins.id, input.pinId));
  if (!pin) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個 Canon 引用" });
  const project = await loadCreativeContextProject(input.auth, pin.projectId, true);
  const canon = await loadCanonOrThrow(input.auth, pin.canonId);
  const toVersionId = input.toVersionId ?? canon.productionVersionId;
  if (!toVersionId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "這個 Canon 還沒有可升級的版本" });
  const version = await loadVersionOrThrow(toVersionId);
  if (version.canonId !== canon.id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "這個版本不屬於這個 Canon" });
  }
  if (version.archived) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "已封存的版本不能採用" });
  }

  const impact = await canonUpgradeImpact({
    auth: input.auth,
    projectId: project.id,
    canonId: canon.id,
    toVersionId,
  });
  if (pin.pinnedVersionId === toVersionId) {
    return { impact, staleShotIds: [] };
  }

  await db.update(schema.projectCanonPins).set({
    pinnedVersionId: toVersionId,
    updatedAt: new Date(),
  }).where(eq(schema.projectCanonPins.id, pin.id));

  // 同步本地 handle（handle 是 Canon 的 runtime 投影，不是獨立真相）
  if (pin.localEntityKind && pin.localEntityId) {
    const fields = localFieldsForCanonKind(canon.kind);
    const descriptor = version.payload.descriptor;
    const primaryRef = version.payload.references.find((ref) => ref.priority === "PRIMARY")?.assetId ?? null;
    const patch: Record<string, unknown> = { referenceAssetId: primaryRef };
    for (const field of fields) {
      if (descriptor[field] !== undefined) patch[field] = descriptor[field];
    }
    if (pin.localEntityKind === "character") {
      if (patch.appearance == null) delete patch.appearance; // NOT NULL 欄位不寫入 null
      const [row] = await db.select({ rev: schema.characters.rev }).from(schema.characters)
        .where(eq(schema.characters.id, pin.localEntityId));
      if (row) {
        await db.update(schema.characters).set({ ...patch, rev: row.rev + 1 })
          .where(eq(schema.characters.id, pin.localEntityId));
      }
    } else if (pin.localEntityKind === "character_look") {
      const [row] = await db.select({ rev: schema.characterLooks.rev }).from(schema.characterLooks)
        .where(eq(schema.characterLooks.id, pin.localEntityId));
      if (row) {
        await db.update(schema.characterLooks).set({ ...patch, rev: row.rev + 1 })
          .where(eq(schema.characterLooks.id, pin.localEntityId));
      }
    } else if (pin.localEntityKind === "scene_preset") {
      if (patch.palette == null) delete patch.palette;
      const [row] = await db.select({ rev: schema.scenePresets.rev }).from(schema.scenePresets)
        .where(eq(schema.scenePresets.id, pin.localEntityId));
      if (row) {
        await db.update(schema.scenePresets).set({ ...patch, rev: row.rev + 1 })
          .where(eq(schema.scenePresets.id, pin.localEntityId));
      }
    } else if (pin.localEntityKind === "prop") {
      if (patch.appearance == null) delete patch.appearance;
      const [row] = await db.select({ rev: schema.props.rev }).from(schema.props)
        .where(eq(schema.props.id, pin.localEntityId));
      if (row) {
        await db.update(schema.props).set({ ...patch, rev: row.rev + 1 })
          .where(eq(schema.props.id, pin.localEntityId));
      }
    }
  }

  // 只 stale 依賴這張卡的鏡（refreshShotContextStaleness 會重算指紋後才標）
  let staleShotIds: string[] = [];
  if (pin.localEntityKind && pin.localEntityId) {
    const { refreshShotContextStaleness } = await import("./shotContextPackets");
    const result = await refreshShotContextStaleness({
      auth: input.auth,
      projectId: project.id,
      changed: { kind: PACKET_KIND_BY_LOCAL[pin.localEntityKind], id: pin.localEntityId },
    });
    staleShotIds = result.staleShotIds;
  }
  return { impact, staleShotIds };
}
