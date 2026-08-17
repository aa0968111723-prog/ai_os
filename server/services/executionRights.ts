/**
 * Execution-rights revalidation（closure master plan §3，P0）。
 *
 * Shot Context Packet 是 frozen historical intent——不 rebuild；
 * 但「現在還可不可以用這些權利執行」是 mutable authorization layer，
 * 送 provider 前必須重驗。#759 誠實留下的限制在這裡關閉：
 * cost approval 等待期間 Canon rights／專案狀態／成員資格被撤回時，
 * resume 不得沿用送出當下的凍結授權呼叫 provider。
 *
 * 不 silent fallback：權限失效＝structured blocker，呼叫端決定怎麼落地
 * （decideCost 把生成標 failed 且不扣點；packet-reuse resume 直接擋）。
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import type { ShotContextPacketPayload } from "../../shared/shotContextPacket";

export interface ExecutionRightsBlocker {
  code:
    | "project_unavailable"
    | "membership_revoked"
    | "canon_missing"
    | "canon_archived"
    | "canon_generation_revoked"
    | "canon_scope_revoked"
    | "canon_version_archived";
  message: string;
}

/** 從凍結 packet 收集 canon 依賴（identity slots＋voice＋style＋sound world＋adapter 來源） */
export function packetCanonDependencies(payload: ShotContextPacketPayload): {
  canonIds: string[];
  versionIds: string[];
} {
  const canonIds = new Set<string>();
  const versionIds = new Set<string>();
  for (const slot of payload.characterSlots ?? []) {
    if (slot.canonId) canonIds.add(slot.canonId);
    if (slot.canonVersionId) versionIds.add(slot.canonVersionId);
    if (slot.voiceCanonId) canonIds.add(slot.voiceCanonId);
    if (slot.voiceVersionId) versionIds.add(slot.voiceVersionId);
  }
  if (payload.styleCanon) {
    canonIds.add(payload.styleCanon.canonId);
    versionIds.add(payload.styleCanon.versionId);
  }
  if (payload.narrationVoice) {
    canonIds.add(payload.narrationVoice.canonId);
    versionIds.add(payload.narrationVoice.versionId);
  }
  if (payload.soundWorld) {
    canonIds.add(payload.soundWorld.canonId);
    versionIds.add(payload.soundWorld.versionId);
  }
  return { canonIds: [...canonIds], versionIds: [...versionIds] };
}

/**
 * 驗 packet 的 canon 依賴「此刻」仍可執行。
 * 純資料庫讀取，不需要 auth（呼叫端已各自過 ACL；這裡驗的是資源側授權）。
 */
export async function revalidatePacketCanonRights(input: {
  payload: ShotContextPacketPayload;
  projectId: string;
}): Promise<ExecutionRightsBlocker[]> {
  const blockers: ExecutionRightsBlocker[] = [];
  const deps = packetCanonDependencies(input.payload);
  if (!deps.canonIds.length) return blockers;

  const canons = await db.select({
    id: schema.canonEntries.id,
    name: schema.canonEntries.name,
    status: schema.canonEntries.status,
    generationAllowed: schema.canonEntries.generationAllowed,
    reuseScope: schema.canonEntries.reuseScope,
    sourceProjectId: schema.canonEntries.sourceProjectId,
  }).from(schema.canonEntries).where(inArray(schema.canonEntries.id, deps.canonIds));
  const byId = new Map(canons.map((row) => [row.id, row]));
  for (const canonId of deps.canonIds) {
    const canon = byId.get(canonId);
    if (!canon) {
      blockers.push({ code: "canon_missing", message: "這筆生成依賴的團隊設定已被刪除" });
      continue;
    }
    if (canon.status === "archived") {
      blockers.push({ code: "canon_archived", message: `團隊設定「${canon.name}」已封存，不能再用於生成` });
    }
    if (!canon.generationAllowed) {
      blockers.push({ code: "canon_generation_revoked", message: `團隊設定「${canon.name}」的生成授權已撤回` });
    }
    if (canon.reuseScope === "private" && canon.sourceProjectId !== input.projectId) {
      blockers.push({ code: "canon_scope_revoked", message: `團隊設定「${canon.name}」的重用授權已收回，僅來源專案可用` });
    }
  }
  if (deps.versionIds.length) {
    const versions = await db.select({
      id: schema.canonVersions.id,
      archived: schema.canonVersions.archived,
    }).from(schema.canonVersions).where(inArray(schema.canonVersions.id, deps.versionIds));
    const versionById = new Map(versions.map((row) => [row.id, row]));
    for (const versionId of deps.versionIds) {
      const version = versionById.get(versionId);
      if (!version) {
        blockers.push({ code: "canon_missing", message: "這筆生成依賴的設定版本已被刪除" });
      } else if (version.archived) {
        blockers.push({ code: "canon_version_archived", message: "這筆生成依賴的設定版本已封存" });
      }
    }
  }
  return blockers;
}

/**
 * Approval resume 的完整重驗（decideCost 在 CAS 認領後、扣點前呼叫）：
 * 專案狀態＋送出者成員資格＋packet canon 依賴。
 */
export async function revalidateExecutionRights(input: {
  generation: {
    id: string;
    projectId: string;
    groupId: string;
    userId: string;
    params: unknown;
  };
}): Promise<{ ok: boolean; blockers: ExecutionRightsBlocker[] }> {
  const blockers: ExecutionRightsBlocker[] = [];

  // 1. 專案仍存在且允許生成（封存／暫停專案不得 resume）——與 assertProjectAllows 同一份狀態機
  const { projectStateAllows } = await import("./projectState");
  const [project] = await db.select({
    id: schema.projects.id,
    status: schema.projects.status,
  }).from(schema.projects).where(eq(schema.projects.id, input.generation.projectId));
  if (!project || !projectStateAllows(project.status, "generate")) {
    blockers.push({ code: "project_unavailable", message: "專案已封存、暫停或不存在，不能執行這筆生成" });
  }

  // 2. 送出者仍是這個組的成員（等待核准期間被移出組＝資格撤回）
  const [membership] = await db.select({ id: schema.groupMembers.id })
    .from(schema.groupMembers)
    .where(and(
      eq(schema.groupMembers.groupId, input.generation.groupId),
      eq(schema.groupMembers.userId, input.generation.userId),
    ));
  if (!membership) {
    blockers.push({ code: "membership_revoked", message: "送出者已不在這個組，請由現任成員重新送出" });
  }

  // 3. Packet 的 canon 依賴此刻仍可執行
  const { splitGenerationSourceMeta } = await import("../../shared/generationSourceMeta");
  const meta = splitGenerationSourceMeta(input.generation.params).meta;
  if (meta.shotContextPacketId) {
    const [packetRow] = await db.select({ packet: schema.shotContextPackets.packet })
      .from(schema.shotContextPackets)
      .where(and(
        eq(schema.shotContextPackets.id, meta.shotContextPacketId),
        eq(schema.shotContextPackets.projectId, input.generation.projectId),
      ));
    if (packetRow) {
      blockers.push(...await revalidatePacketCanonRights({
        payload: packetRow.packet,
        projectId: input.generation.projectId,
      }));
    }
  }
  return { ok: blockers.length === 0, blockers };
}

/** 供測試與稽核用：blocker 陣列轉一句人話（存進 generations.error） */
export function formatExecutionRightsError(blockers: readonly ExecutionRightsBlocker[]): string {
  return `核准時重驗權限未通過：${blockers.map((row) => row.message).join("；")}`;
}
