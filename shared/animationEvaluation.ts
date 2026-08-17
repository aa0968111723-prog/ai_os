import { sha256 } from "./sha256";
import type { MotionFinding } from "./animationMotion";
import type { ShotContextPacketPayload } from "./shotContextPacket";

export const ANIMATION_EVALUATION_DIMENSIONS = [
  "semantic", "identity", "look", "scene", "prop", "style", "temporal", "physics",
] as const;
export type AnimationEvaluationDimension = (typeof ANIMATION_EVALUATION_DIMENSIONS)[number];

export type EvaluationConfidence = "high" | "medium" | "low" | "insufficient_evidence";
export type EvaluationDimensionStatus = "consistent" | "finding" | "not_checked" | "insufficient_evidence";

export interface EvaluationDimensionResult {
  status: EvaluationDimensionStatus;
  confidence: EvaluationConfidence;
  summary: string;
  evidenceSourceIds: string[];
}

export interface AnimationConsistencyFinding {
  code: string;
  dimension: AnimationEvaluationDimension;
  severity: "warning" | "blocker" | "unresolved";
  confidence: EvaluationConfidence;
  reason: string;
  evidenceSourceIds: string[];
  characterIds?: string[];
  propIds?: string[];
  sceneIds?: string[];
  repairHint?: string;
}

export interface AnimationConsistencyEvaluation {
  schemaVersion: "animation-consistency-evaluation.v1";
  generationId: string;
  shotId: string;
  evaluatorVersion: string;
  evidenceFingerprint: string;
  visualCheckStatus: "completed" | "not_checked" | "failed";
  dimensions: Record<AnimationEvaluationDimension, EvaluationDimensionResult>;
  recommendation: "keep" | "review" | "repair" | "block_adopt";
  findings: AnimationConsistencyFinding[];
}

export interface AnimationEvaluationEvidence {
  generationId: string;
  shotId: string;
  packetId: string;
  packetFingerprint: string;
  candidateAssetId: string;
  referenceAssetIds: string[];
  previousFrameAssetId: string | null;
  evaluatorVersion: string;
}

const notCheckedDimension = (): EvaluationDimensionResult => ({
  status: "not_checked",
  confidence: "insufficient_evidence",
  summary: "尚未執行視覺檢查",
  evidenceSourceIds: [],
});

export function emptyEvaluationDimensions(): AnimationConsistencyEvaluation["dimensions"] {
  return Object.fromEntries(
    ANIMATION_EVALUATION_DIMENSIONS.map((dimension) => [dimension, notCheckedDimension()]),
  ) as AnimationConsistencyEvaluation["dimensions"];
}

function confidence(value: unknown): EvaluationConfidence {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "insufficient_evidence";
}

function dimension(value: unknown): AnimationEvaluationDimension | null {
  return typeof value === "string"
    && (ANIMATION_EVALUATION_DIMENSIONS as readonly string[]).includes(value)
    ? value as AnimationEvaluationDimension
    : null;
}

/** Strict parser: malformed/omitted dimensions become insufficient, never consistent. */
export function parseVisualEvaluatorPayload(payload: unknown): Pick<AnimationConsistencyEvaluation, "dimensions" | "findings"> {
  const dimensions = emptyEvaluationDimensions();
  const row = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rawDimensions = row.dimensions && typeof row.dimensions === "object"
    ? row.dimensions as Record<string, unknown>
    : {};
  for (const name of ANIMATION_EVALUATION_DIMENSIONS) {
    const raw = rawDimensions[name];
    if (!raw || typeof raw !== "object") {
      dimensions[name] = {
        status: "insufficient_evidence",
        confidence: "insufficient_evidence",
        summary: "Evaluator 沒有回傳這個維度的可驗證結果",
        evidenceSourceIds: [],
      };
      continue;
    }
    const item = raw as Record<string, unknown>;
    const status = item.status === "consistent" || item.status === "finding"
      ? item.status
      : "insufficient_evidence";
    dimensions[name] = {
      status,
      confidence: confidence(item.confidence),
      summary: typeof item.summary === "string" && item.summary.trim()
        ? item.summary.trim().slice(0, 500)
        : "沒有可驗證摘要",
      evidenceSourceIds: Array.isArray(item.evidenceSourceIds)
        ? item.evidenceSourceIds.filter((id): id is string => typeof id === "string").slice(0, 20)
        : [],
    };
  }

  const findings: AnimationConsistencyFinding[] = [];
  for (const raw of Array.isArray(row.findings) ? row.findings : []) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const dim = dimension(item.dimension);
    if (!dim || typeof item.code !== "string" || typeof item.reason !== "string") continue;
    findings.push({
      code: item.code.slice(0, 100),
      dimension: dim,
      severity: item.severity === "blocker" || item.severity === "unresolved" ? item.severity : "warning",
      confidence: confidence(item.confidence),
      reason: item.reason.slice(0, 1000),
      evidenceSourceIds: Array.isArray(item.evidenceSourceIds)
        ? item.evidenceSourceIds.filter((id): id is string => typeof id === "string").slice(0, 20)
        : [],
      ...(Array.isArray(item.characterIds)
        ? { characterIds: item.characterIds.filter((id): id is string => typeof id === "string").slice(0, 20) }
        : {}),
      ...(Array.isArray(item.propIds)
        ? { propIds: item.propIds.filter((id): id is string => typeof id === "string").slice(0, 20) }
        : {}),
      ...(Array.isArray(item.sceneIds)
        ? { sceneIds: item.sceneIds.filter((id): id is string => typeof id === "string").slice(0, 20) }
        : {}),
      ...(typeof item.repairHint === "string" ? { repairHint: item.repairHint.slice(0, 500) } : {}),
    });
  }
  return { dimensions, findings };
}

export function animationEvidenceFingerprint(evidence: AnimationEvaluationEvidence): string {
  return sha256(JSON.stringify({
    generationId: evidence.generationId,
    shotId: evidence.shotId,
    packetId: evidence.packetId,
    packetFingerprint: evidence.packetFingerprint,
    candidateAssetId: evidence.candidateAssetId,
    referenceAssetIds: [...new Set(evidence.referenceAssetIds)].sort(),
    previousFrameAssetId: evidence.previousFrameAssetId,
    evaluatorVersion: evidence.evaluatorVersion,
  }));
}

export function recommendationForFindings(
  findings: readonly AnimationConsistencyFinding[],
): AnimationConsistencyEvaluation["recommendation"] {
  if (findings.some((row) =>
    row.severity === "blocker"
    && row.confidence === "high"
    && ["semantic", "identity", "prop"].includes(row.dimension))) return "block_adopt";
  if (findings.some((row) => row.severity === "blocker" || row.confidence === "high")) return "repair";
  if (findings.length) return "review";
  return "keep";
}

/** Structural findings run without a multimodal provider and never masquerade as a visual pass. */
export function structuralAnimationEvaluation(input: {
  generationId: string;
  shotId: string;
  packet: ShotContextPacketPayload;
  candidate: {
    characterIds?: string[] | null;
    scenePresetIds?: string[] | null;
    propIds?: string[] | null;
  };
  evidenceFingerprint: string;
  evaluatorVersion: string;
  motionFindings?: readonly MotionFinding[];
}): AnimationConsistencyEvaluation {
  const findings: AnimationConsistencyFinding[] = [];
  const expectedCharacters = new Set(input.packet.characters.map((row) => row.id));
  const expectedScenes = new Set(input.packet.presets.map((row) => row.id));
  const expectedProps = new Set(input.packet.props.map((row) => row.id));
  const missing = (expected: Set<string>, actual: readonly string[]) =>
    [...expected].filter((id) => !actual.includes(id));

  const missingCharacters = missing(expectedCharacters, input.candidate.characterIds ?? []);
  if (missingCharacters.length) findings.push({
    code: "semantic_character_binding_missing",
    dimension: "semantic",
    severity: "blocker",
    confidence: "high",
    reason: "候選生成沒有使用凍結分鏡要求的角色綁定",
    evidenceSourceIds: [input.evidenceFingerprint],
    characterIds: missingCharacters,
    repairHint: "用同一份 Shot Packet 重新生成候選",
  });
  const missingScenes = missing(expectedScenes, input.candidate.scenePresetIds ?? []);
  if (missingScenes.length) findings.push({
    code: "semantic_scene_binding_missing",
    dimension: "scene",
    severity: "blocker",
    confidence: "high",
    reason: "候選生成沒有使用凍結分鏡要求的場景綁定",
    evidenceSourceIds: [input.evidenceFingerprint],
    sceneIds: missingScenes,
    repairHint: "保留其他設定，只補回場景綁定後重生候選",
  });
  const missingProps = missing(expectedProps, input.candidate.propIds ?? []);
  if (missingProps.length) findings.push({
    code: "semantic_prop_binding_missing",
    dimension: "prop",
    severity: "blocker",
    confidence: "high",
    reason: "候選生成沒有使用凍結分鏡要求的道具綁定",
    evidenceSourceIds: [input.evidenceFingerprint],
    propIds: missingProps,
    repairHint: "保留其他設定，只補回道具綁定後重生候選",
  });
  for (const motion of input.motionFindings ?? []) {
    findings.push({
      code: motion.code,
      dimension: motion.dimension,
      severity: motion.severity,
      confidence: motion.confidence,
      reason: motion.reason,
      evidenceSourceIds: motion.evidence,
      ...(motion.characterId ? { characterIds: [motion.characterId] } : {}),
      ...(motion.propId ? { propIds: [motion.propId] } : {}),
      repairHint: motion.dimension === "physics"
        ? "沿用已採用關鍵影格，只修復影片動作階段"
        : "加入上一鏡已採用結尾影格後重生受影響鏡頭",
    });
  }

  const dimensions = emptyEvaluationDimensions();
  for (const dimension of ANIMATION_EVALUATION_DIMENSIONS) {
    const rows = findings.filter((row) => row.dimension === dimension);
    if (rows.length) {
      dimensions[dimension] = {
        status: "finding",
        confidence: rows.some((row) => row.confidence === "high") ? "high" : "medium",
        summary: rows.map((row) => row.reason).join("；"),
        evidenceSourceIds: [...new Set(rows.flatMap((row) => row.evidenceSourceIds))],
      };
    }
  }
  return {
    schemaVersion: "animation-consistency-evaluation.v1",
    generationId: input.generationId,
    shotId: input.shotId,
    evaluatorVersion: input.evaluatorVersion,
    evidenceFingerprint: input.evidenceFingerprint,
    visualCheckStatus: "not_checked",
    dimensions,
    recommendation: findings.length ? recommendationForFindings(findings) : "review",
    findings,
  };
}

export function mergeVisualEvaluation(
  structural: AnimationConsistencyEvaluation,
  visual: Pick<AnimationConsistencyEvaluation, "dimensions" | "findings">,
): AnimationConsistencyEvaluation {
  const findings = [...structural.findings, ...visual.findings];
  const dimensions = { ...structural.dimensions };
  for (const dimension of ANIMATION_EVALUATION_DIMENSIONS) {
    const visualDimension = visual.dimensions[dimension];
    if (visualDimension.status !== "not_checked") dimensions[dimension] = visualDimension;
  }
  return {
    ...structural,
    visualCheckStatus: "completed",
    dimensions,
    findings,
    recommendation: recommendationForFindings(findings),
  };
}

