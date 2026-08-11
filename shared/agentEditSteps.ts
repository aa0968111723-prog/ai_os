/**
 * Revision-safe edit step contracts for agent update_scene / reorder_scenes (PR-4).
 *
 * Fail-closed on conflict; never last-write-wins. Pure helpers only — runner
 * applies DB writes with advisory lock + applyWithRevision.
 */

/** Feature flag: AGENT_EDIT_STEP_KINDS_V1=0|false|off disables revision gate (legacy soft path). */
export function isAgentEditStepKindsV1Enabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const v = String(env.AGENT_EDIT_STEP_KINDS_V1 ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

export type AgentEditConflictCode =
  | "conflict_revision_mismatch"
  | "reorder_incomplete_set"
  | "reorder_unknown_id"
  | "reorder_duplicate_id"
  | "update_empty_patch"
  | "update_invalid_trim"
  | "update_invalid_duration";

export interface SceneOrderRow {
  id: string;
  orderIndex: number;
}

/** Stable fingerprint of full order — used as reorder baseRevision. */
export function sceneOrderFingerprint(rows: readonly SceneOrderRow[]): string {
  const byOrder = [...rows].sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
  return `order:v1:${byOrder.map((r) => r.id).join(",")}`;
}

export function validateReorderSceneIds(
  orderedIds: readonly string[],
  currentIds: readonly string[],
): { ok: true } | { ok: false; code: AgentEditConflictCode; message: string } {
  if (orderedIds.length < 2) {
    return { ok: false, code: "reorder_incomplete_set", message: "重排清單至少需要兩鏡" };
  }
  if (new Set(orderedIds).size !== orderedIds.length) {
    return { ok: false, code: "reorder_duplicate_id", message: "重排清單含有重複的分鏡 id" };
  }
  const current = new Set(currentIds);
  const ordered = new Set(orderedIds);
  for (const id of orderedIds) {
    if (!current.has(id)) {
      return {
        ok: false,
        code: "reorder_unknown_id",
        message: `重排清單含有未知或不屬於本專案的分鏡`,
      };
    }
  }
  if (ordered.size !== current.size) {
    return {
      ok: false,
      code: "reorder_incomplete_set",
      message: `重排清單必須剛好涵蓋全部 ${current.size} 鏡（收到 ${ordered.size}）`,
    };
  }
  for (const id of currentIds) {
    if (!ordered.has(id)) {
      return {
        ok: false,
        code: "reorder_incomplete_set",
        message: "重排清單缺少既有分鏡，已拒絕以避免順序 silent 補洞",
      };
    }
  }
  return { ok: true };
}

export interface UpdateScenePatchInput {
  sceneTitle?: string;
  durationSec?: number;
  scenePrompt?: string;
  voiceover?: string;
  ambience?: string;
  trimStartMs?: number;
  trimEndMs?: number | null;
}

export function validateUpdateScenePatch(
  patch: UpdateScenePatchInput,
  current?: { trimStartMs?: number | null; trimEndMs?: number | null },
): { ok: true; fields: string[] } | { ok: false; code: AgentEditConflictCode; message: string } {
  const fields: string[] = [];
  if (patch.sceneTitle !== undefined) fields.push("title");
  if (patch.durationSec !== undefined) {
    if (!Number.isFinite(patch.durationSec) || patch.durationSec < 1 || patch.durationSec > 60) {
      return { ok: false, code: "update_invalid_duration", message: "durationSec 必須是 1–60 的整數秒" };
    }
    fields.push("durationSec");
  }
  if (patch.scenePrompt !== undefined) fields.push("prompt");
  if (patch.voiceover !== undefined) fields.push("voiceover");
  if (patch.ambience !== undefined) fields.push("ambience");
  if (patch.trimStartMs !== undefined || patch.trimEndMs !== undefined) {
    const nextStart = patch.trimStartMs != null
      ? Math.max(0, Math.round(patch.trimStartMs))
      : (current?.trimStartMs ?? 0);
    const nextEnd = patch.trimEndMs !== undefined
      ? (patch.trimEndMs == null ? null : Math.max(0, Math.round(patch.trimEndMs)))
      : (current?.trimEndMs ?? null);
    if (nextEnd != null && nextEnd <= nextStart) {
      return {
        ok: false,
        code: "update_invalid_trim",
        message: `修剪出點（${nextEnd}ms）必須大於入點（${nextStart}ms）`,
      };
    }
    if (patch.trimStartMs !== undefined) fields.push("trimStartMs");
    if (patch.trimEndMs !== undefined) fields.push("trimEndMs");
  }
  if (fields.length === 0) {
    return { ok: false, code: "update_empty_patch", message: "沒有可套用的欄位變更" };
  }
  return { ok: true, fields };
}

/** True when current order already matches desired (idempotent no-op). */
export function isReorderAlreadyApplied(
  orderedIds: readonly string[],
  currentOrderedIds: readonly string[],
): boolean {
  if (orderedIds.length !== currentOrderedIds.length) return false;
  return orderedIds.every((id, i) => id === currentOrderedIds[i]);
}

export function formatRevisionConflictMessage(input: {
  expectedRev: string | number;
  currentRev: string | number;
  entityLabel?: string;
}): string {
  const label = input.entityLabel ?? "分鏡";
  return `${label}已被其他人修改（期望版本 ${input.expectedRev}，目前 ${input.currentRev}）。請重新讀取後再規劃，不會覆蓋真人更新。`;
}

/** Observable audit payload — no CoT / prompts. */
export interface AgentEditAuditSummary {
  operation: "update_scene" | "reorder_scenes";
  entityType: "scene" | "scene_order";
  entityId?: string;
  baseRevision?: string;
  resultingRevision?: string;
  changedFields: string[];
  before: Record<string, string | number | boolean | null>;
  after: Record<string, string | number | boolean | null>;
  idempotencyKey?: string;
  compensatable: boolean;
}
