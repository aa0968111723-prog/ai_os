/**
 * Phone Animation Production projection.
 *
 * Compact view of the existing Production Board / Review Queue / targeted
 * repair planner. This module is a pure adapter: it never invents findings,
 * never picks shots the planner did not return, and never moves a current
 * pointer. Display strings are human language — no evaluator JSON, packet
 * fingerprints, or raw UUIDs.
 */
import type { AnimationBoardLifecycleResult, AnimationShotLifecycle } from "./animationBoard";
import {
  ANIMATION_EVALUATION_DIMENSIONS,
  type AnimationConsistencyFinding,
  type AnimationEvaluationDimension,
  type EvaluationConfidence,
} from "./animationEvaluation";
import type { AnimationRepairPlan } from "./animationPipeline";
import type { PhoneAssistantAction, PhoneCard, PhoneWorkStep } from "./phoneAssistantProjection";

export const PHONE_ANIMATION_TOP_FINDINGS = 5;

/** Disclosed defaults for cost estimation. Execution still goes through the
 * existing stage command with these same ids — never a silent model switch. */
export const PHONE_REPAIR_KEYFRAME_MODEL_ID = "fal-ai/flux/dev";
export const PHONE_REPAIR_VIDEO_MODEL_ID = "fal-ai/wan/v2.2-a14b/image-to-video";
export const PHONE_REPAIR_KEYFRAME_POINTS = 1;
export const PHONE_REPAIR_VIDEO_POINTS = 6;

export const PHONE_DIMENSION_LABEL: Record<AnimationEvaluationDimension, string> = {
  semantic: "劇情",
  identity: "人物",
  look: "造型",
  scene: "場景",
  prop: "道具",
  style: "畫風",
  temporal: "連戲",
  physics: "動作",
};

export type PhoneFindingConfidenceLabel = "高可信" | "需確認" | "證據不足" | "尚未檢查";

export interface PhoneAnimationFinding {
  key: string;
  shotId: string;
  shotLabel: string;
  dimension: AnimationEvaluationDimension;
  dimensionLabel: string;
  severity: "warning" | "blocker" | "unresolved";
  severityLabel: string;
  confidenceLabel: PhoneFindingConfidenceLabel;
  reason: string;
  repairable: boolean;
}

export interface PhoneAnimationSummary {
  projectId: string;
  selectedShotId?: string;
  counts: {
    totalShots: number;
    needsReview: number;
    repairable: number;
    blocked: number;
    notChecked: number;
  };
  dimensionCounts: Partial<Record<AnimationEvaluationDimension, number>>;
  topFindings: PhoneAnimationFinding[];
  nextAction?: {
    kind: string;
    label: string;
    shotIds: string[];
  };
}

export interface PhoneAnimationBoardShot {
  shotId: string;
  orderIndex: number;
  title: string;
  lifecycle: AnimationShotLifecycle;
  needsReview: boolean;
  stale: boolean;
  visualCheckStatus: "completed" | "not_checked" | "failed" | "absent";
  currentKind: string | null;
  candidate?: {
    generationId: string;
    assetId: string;
    kind: string;
    url: string;
  } | null;
  current?: { assetId: string; kind: string; url: string } | null;
  nextAction: AnimationBoardLifecycleResult["nextAction"];
  findings: Array<AnimationConsistencyFinding & { shotId?: string }>;
}

export interface PhoneAnimationBoardInput {
  projectId: string;
  rows: readonly PhoneAnimationBoardShot[];
  reviewQueue: readonly PhoneAnimationBoardShot[];
  primaryAction: { shotId?: string; kind: string; label: string } | null;
  summary: { total: number; needsReview: number; complete: number };
}

export interface PhoneDimensionFilter {
  include: AnimationEvaluationDimension[];
  exclude: AnimationEvaluationDimension[];
}

export type PhoneAnimationIntent =
  | { kind: "summary" }
  | { kind: "list_findings"; filter: PhoneDimensionFilter }
  | { kind: "explain_shot"; shotRef: string }
  | { kind: "not_checked" }
  | { kind: "plan_repair"; filter: PhoneDimensionFilter; shotRefs: string[]; dropOrdinal?: number }
  | { kind: "confirm_execute" }
  | { kind: "compare" }
  | { kind: "adopt" }
  | { kind: "keep" }
  | { kind: "next" }
  | { kind: "resume" }
  | { kind: "none" };

export type PhoneRepairTargetResolution =
  | {
    status: "resolved";
    shotIds: string[];
    findingKeys: string[];
    dimensions: AnimationEvaluationDimension[];
    findings: PhoneAnimationFinding[];
  }
  | {
    status: "clarify";
    question: string;
    options: Array<{ id: string; label: string }>;
  }
  | { status: "empty"; reason: string };

export interface PhoneRepairShotRow {
  shotId: string;
  shotLabel: string;
  stageLabel: string;
  stages: Array<"keyframe" | "video" | "evaluation">;
  reuseLabel?: string;
  reason: string;
}

export interface PhoneRepairProposalView {
  affectedShotIds: string[];
  findingKeys: string[];
  dimensions: AnimationEvaluationDimension[];
  shots: PhoneRepairShotRow[];
  untouchedCount: number;
  untouchedLabel: string;
  projectedPaidOperations: number;
  estimatedPoints: number;
  requiresApproval: boolean;
  approvalLabel?: string;
  capabilityDowngrades: string[];
  notes: string[];
  keyframeModelId: string;
  videoModelId: string;
}

export interface PhoneCompareItem {
  shotId: string;
  shotLabel: string;
  generationId: string;
  current?: { kind: string; url: string } | null;
  candidate: { kind: string; url: string };
  goals: string[];
  notChecked: boolean;
}

export interface PhoneRepairResume {
  state: "proposal" | "awaiting_confirmation" | "awaiting_approval" | "running" | "review_ready";
  affectedShotCount: number;
  estimatedPoints?: number;
}

export type PhoneCommand =
  | { type: "list_findings"; dimension?: AnimationEvaluationDimension }
  | { type: "explain_shot"; shotId: string }
  | { type: "plan_repair"; include?: AnimationEvaluationDimension[]; exclude?: AnimationEvaluationDimension[]; shotIds?: string[]; text?: string }
  | { type: "confirm_repair" }
  | { type: "adopt"; generationId: string }
  | { type: "keep"; shotId: string }
  | { type: "next_compare" }
  | { type: "resume" };

export function phoneShotLabel(row: { orderIndex: number; title: string }): string {
  const title = row.title.trim();
  if (title) return title;
  return `第 ${String(row.orderIndex + 1).padStart(2, "0")} 鏡`;
}

export function phoneFindingKey(shotId: string, code: string): string {
  return `${shotId}::${code}`;
}

export function phoneConfidenceLabel(confidence: EvaluationConfidence | string): PhoneFindingConfidenceLabel {
  if (confidence === "high") return "高可信";
  if (confidence === "insufficient_evidence") return "證據不足";
  return "需確認";
}

export function phoneSeverityLabel(severity: string): string {
  return severity === "blocker" ? "需修復" : "需確認";
}

function findingFromBoard(
  shot: PhoneAnimationBoardShot,
  finding: AnimationConsistencyFinding,
): PhoneAnimationFinding {
  return {
    key: phoneFindingKey(shot.shotId, finding.code),
    shotId: shot.shotId,
    shotLabel: phoneShotLabel(shot),
    dimension: finding.dimension,
    dimensionLabel: PHONE_DIMENSION_LABEL[finding.dimension],
    severity: finding.severity,
    severityLabel: phoneSeverityLabel(finding.severity),
    confidenceLabel: phoneConfidenceLabel(finding.confidence),
    reason: finding.reason.trim(),
    repairable: finding.severity !== "unresolved",
  };
}

export function collectPhoneFindings(rows: readonly PhoneAnimationBoardShot[]): PhoneAnimationFinding[] {
  const out: PhoneAnimationFinding[] = [];
  for (const shot of rows) {
    if (shot.stale && shot.findings.length === 0) {
      out.push({
        key: phoneFindingKey(shot.shotId, "stale_upstream"),
        shotId: shot.shotId,
        shotLabel: phoneShotLabel(shot),
        dimension: "temporal",
        dimensionLabel: PHONE_DIMENSION_LABEL.temporal,
        severity: "warning",
        severityLabel: "需確認",
        confidenceLabel: "需確認",
        reason: "上游設定已變更，這一鏡需要再確認",
        repairable: true,
      });
      continue;
    }
    for (const finding of shot.findings) {
      out.push(findingFromBoard(shot, finding));
    }
  }
  return out;
}

export function projectPhoneAnimationSummary(
  board: PhoneAnimationBoardInput,
  input: { selectedShotId?: string } = {},
): PhoneAnimationSummary {
  const findings = collectPhoneFindings(board.rows);
  const dimensionCounts: Partial<Record<AnimationEvaluationDimension, number>> = {};
  for (const finding of findings) {
    dimensionCounts[finding.dimension] = (dimensionCounts[finding.dimension] ?? 0) + 1;
  }
  const notChecked = board.rows.filter((row) =>
    row.visualCheckStatus === "not_checked" || row.visualCheckStatus === "absent" || row.visualCheckStatus === "failed",
  ).length;
  const blocked = findings.filter((row) => row.severity === "blocker").length;
  const repairable = findings.filter((row) => row.repairable).length;
  const nextShotIds = board.primaryAction?.shotId
    ? [board.primaryAction.shotId]
    : board.reviewQueue.slice(0, 3).map((row) => row.shotId);

  return {
    projectId: board.projectId,
    ...(input.selectedShotId ? { selectedShotId: input.selectedShotId } : {}),
    counts: {
      totalShots: board.summary.total,
      needsReview: board.summary.needsReview,
      repairable,
      blocked,
      notChecked,
    },
    dimensionCounts,
    topFindings: findings.slice(0, PHONE_ANIMATION_TOP_FINDINGS),
    ...(board.primaryAction
      ? {
        nextAction: {
          kind: board.primaryAction.kind,
          label: board.primaryAction.label,
          shotIds: nextShotIds,
        },
      }
      : {}),
  };
}

export function filterPhoneFindings(
  findings: readonly PhoneAnimationFinding[],
  filter: PhoneDimensionFilter,
): PhoneAnimationFinding[] {
  return findings.filter((finding) => {
    if (filter.exclude.includes(finding.dimension)) return false;
    if (filter.include.length === 0) return true;
    return filter.include.includes(finding.dimension);
  });
}

const PERSON_DIMENSIONS: AnimationEvaluationDimension[] = ["identity", "look"];
const CONTINUITY_DIMENSIONS: AnimationEvaluationDimension[] = ["temporal", "physics"];

const INCLUDE_PATTERNS: Array<{ pattern: RegExp; dimensions: AnimationEvaluationDimension[] }> = [
  { pattern: /人物|角色|長相|外觀|臉|identity|look/iu, dimensions: PERSON_DIMENSIONS },
  { pattern: /造型/iu, dimensions: ["look"] },
  { pattern: /場景|scene/iu, dimensions: ["scene"] },
  { pattern: /道具|prop/iu, dimensions: ["prop"] },
  { pattern: /畫風|風格|style/iu, dimensions: ["style"] },
  { pattern: /連戲|前後|連貫|temporal/iu, dimensions: CONTINUITY_DIMENSIONS },
  { pattern: /動作|物理|持物|左右手|motion|physics/iu, dimensions: ["physics"] },
  { pattern: /劇情|semantic/iu, dimensions: ["semantic"] },
];

export function parsePhoneDimensionFilter(text: string): PhoneDimensionFilter {
  const include = new Set<AnimationEvaluationDimension>();
  const exclude = new Set<AnimationEvaluationDimension>();
  const excludeClause = [
    ...(text.match(/(?:不要|別|先不要|先別|先不要動|不要動|先不要修)([^，。,\n]*)/gu) ?? []),
    ...(text.match(/([^，。,\n]{1,12})(?:不要|先不要|先別)/gu) ?? []),
  ];

  const apply = (chunk: string, into: Set<AnimationEvaluationDimension>) => {
    for (const entry of INCLUDE_PATTERNS) {
      if (entry.pattern.test(chunk)) {
        for (const dimension of entry.dimensions) into.add(dimension);
      }
    }
  };

  for (const clause of excludeClause) apply(clause, exclude);
  apply(text, include);
  if (exclude.size) {
    for (const dimension of exclude) include.delete(dimension);
  }
  return {
    include: [...include],
    exclude: [...exclude],
  };
}

const SHOT_REF_RE = /(?:shot\s*#?\s*|第\s*)([一二三四五六七八九十百\d]+)\s*鏡?/giu;
const CHINESE_ORDINAL: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

export function parsePhoneShotRefs(text: string): string[] {
  const refs: string[] = [];
  for (const match of text.matchAll(SHOT_REF_RE)) {
    const raw = match[1];
    const n = Number(raw) || CHINESE_ORDINAL[raw];
    if (n) refs.push(String(n));
  }
  return refs;
}

function shotRefMatches(shot: { orderIndex: number; title: string; shotId: string }, ref: string): boolean {
  const n = Number(ref);
  if (Number.isFinite(n) && (shot.orderIndex === n || shot.orderIndex + 1 === n)) return true;
  return shot.title.includes(ref) || shot.title.includes(`第 ${ref}`) || shot.title.includes(`鏡 ${ref}`);
}

export function classifyPhoneAnimationIntent(text: string): PhoneAnimationIntent {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "none" };

  if (/(?:確認執行|照這個計畫執行|開始修|就這樣修|執行這個計畫|開始修復)/u.test(trimmed)) {
    return { kind: "confirm_execute" };
  }
  if (/(?:採用|用修好的|這張可以|用這版|採用這版)/u.test(trimmed) && !/不要採用/u.test(trimmed)) {
    return { kind: "adopt" };
  }
  if (/(?:保留現用|原本比較好|先留現在|不要換|keep current)/iu.test(trimmed)) {
    return { kind: "keep" };
  }
  if (/(?:下一鏡|下一個問題|下一個|繼續看)/u.test(trimmed)) {
    return { kind: "next" };
  }
  if (/(?:開始檢查|比較|對一下|看看候選)/u.test(trimmed)) {
    return { kind: "compare" };
  }
  if (/(?:繼續|恢復|剛剛的修復)/u.test(trimmed) && /修復|計畫|候選/u.test(trimmed)) {
    return { kind: "resume" };
  }

  const filter = parsePhoneDimensionFilter(trimmed);
  const shotRefs = parsePhoneShotRefs(trimmed);
  const dropOrdinal = /第\s*([一二三四五六七八九十\d]+)\s*個不要|第\s*([一二三四五六七八九十\d]+)\s*個先不要|第二個不要/u.exec(trimmed);
  const drop = dropOrdinal
    ? (dropOrdinal[0].includes("第二") ? 2 : Number(dropOrdinal[1] || dropOrdinal[2]) || CHINESE_ORDINAL[dropOrdinal[1] ?? ""] || undefined)
    : undefined;

  if (
    drop
    || /(?:幫我修|規劃修復|只修|先修|處理掉|修掉|修復計畫|把.*問題.*修|全部規劃|只處理)/u.test(trimmed)
  ) {
    return { kind: "plan_repair", filter, shotRefs, ...(drop ? { dropOrdinal: drop } : {}) };
  }
  if (/(?:還沒檢查|尚未檢查|沒檢查|幾鏡沒檢查)/u.test(trimmed)) {
    return { kind: "not_checked" };
  }
  if (/(?:為什麼|怎麼會|為何).{0,12}(?:需要修|被標|有問題|要修)/u.test(trimmed) && shotRefs[0]) {
    return { kind: "explain_shot", shotRef: shotRefs[0] };
  }
  if (/(?:哪些鏡頭|哪幾鏡|哪些鏡).{0,12}(?:不一致|有問題|要修)|人物不一致|連戲.*哪些|畫風.*哪些/u.test(trimmed)) {
    return { kind: "list_findings", filter };
  }
  if (/(?:有什麼問題|哪裡有問題|還有什麼問題|哪些.*問題|動畫檢查|製作狀態)/u.test(trimmed)) {
    return { kind: "summary" };
  }
  if (filter.include.length > 0 && /(?:問題|不一致|偏移)/u.test(trimmed)) {
    return { kind: "list_findings", filter };
  }
  return { kind: "none" };
}

function dropOrdinalFromText(text: string): number | undefined {
  if (/第二個不要|第二個先不要/u.test(text)) return 2;
  const match = /第\s*([一二三四五六七八九十\d]+)\s*個不要|第\s*([一二三四五六七八九十\d]+)\s*個先不要/u.exec(text);
  if (!match) return undefined;
  const raw = match[1] ?? match[2];
  return Number(raw) || CHINESE_ORDINAL[raw ?? ""] || undefined;
}

export function resolvePhoneRepairTargets(input: {
  text: string;
  findings: readonly PhoneAnimationFinding[];
  shots: readonly PhoneAnimationBoardShot[];
  selectedShotId?: string;
  previousFindingKeys?: readonly string[];
  filterOverride?: PhoneDimensionFilter;
}): PhoneRepairTargetResolution {
  const intent = classifyPhoneAnimationIntent(input.text);
  const parsedFilter = intent.kind === "plan_repair" || intent.kind === "list_findings"
    ? intent.filter
    : parsePhoneDimensionFilter(input.text);
  const filter = input.filterOverride
    && (input.filterOverride.include.length > 0 || input.filterOverride.exclude.length > 0)
    ? input.filterOverride
    : parsedFilter;
  let selected = filterPhoneFindings(input.findings, filter);
  const dropOrdinal = (intent.kind === "plan_repair" ? intent.dropOrdinal : undefined)
    ?? dropOrdinalFromText(input.text);

  if (dropOrdinal && input.previousFindingKeys?.length) {
    const next = input.previousFindingKeys.filter((_, index) => index !== dropOrdinal - 1);
    selected = input.findings.filter((finding) => next.includes(finding.key));
  } else if (intent.kind === "plan_repair" && intent.shotRefs.length) {
    selected = selected.filter((finding) =>
      intent.shotRefs.some((ref) => {
        const shot = input.shots.find((row) => row.shotId === finding.shotId);
        return shot ? shotRefMatches(shot, ref) : false;
      }));
  } else if (input.selectedShotId && /幫我修一下|修這一鏡|修這鏡/u.test(input.text) && !filter.include.length) {
    selected = input.findings.filter((finding) => finding.shotId === input.selectedShotId);
  }

  if (/全部規劃/u.test(input.text)) {
    selected = filterPhoneFindings(input.findings, filter);
  } else if (/這三鏡|這\s*3\s*鏡|只處理這三鏡/u.test(input.text)) {
    const topIds = [...new Set(selected.map((row) => row.shotId))].slice(0, 3);
    selected = selected.filter((row) => topIds.includes(row.shotId));
  } else if (/只處理高優先|高優先的/u.test(input.text)) {
    const topIds = [...new Set(input.findings.map((row) => row.shotId))].slice(0, 3);
    selected = input.findings.filter((row) => topIds.includes(row.shotId));
  } else if (/幫我修一下|幫我修$|修一下/u.test(input.text) && !filter.include.length && !input.selectedShotId) {
    const shotIds = [...new Set(input.findings.map((row) => row.shotId))];
    if (shotIds.length > 1) {
      return {
        status: "clarify",
        question: `目前有 ${shotIds.length} 鏡需處理。要全部規劃，還是只處理現在這幾鏡？`,
        options: [
          { id: "all", label: `全部規劃（${shotIds.length} 鏡）` },
          { id: "top", label: `只處理高優先的 ${Math.min(3, shotIds.length)} 鏡` },
        ],
      };
    }
  }

  if (/修掉那個畫風問題|那個畫風/u.test(input.text)) {
    const style = input.findings.filter((row) => row.dimension === "style");
    if (style.length > 1) {
      return {
        status: "clarify",
        question: "目前有幾個畫風問題，要修哪一個？",
        options: style.map((row) => ({ id: row.key, label: `${row.shotLabel} · ${row.reason}` })),
      };
    }
  }

  if (selected.length === 0) {
    return { status: "empty", reason: "目前沒有符合條件、可以規劃修復的問題。" };
  }

  return {
    status: "resolved",
    shotIds: [...new Set(selected.map((row) => row.shotId))],
    findingKeys: selected.map((row) => row.key),
    dimensions: [...new Set(selected.map((row) => row.dimension))],
    findings: selected,
  };
}

export function projectPhoneRepairProposal(input: {
  board: PhoneAnimationBoardInput;
  plan: AnimationRepairPlan;
  findings: readonly PhoneAnimationFinding[];
  approvalThreshold?: number | null;
  keyframeModelId?: string;
  videoModelId?: string;
  keyframePoints?: number;
  videoPoints?: number;
  capabilityDowngrades?: string[];
}): PhoneRepairProposalView {
  const keyframeModelId = input.keyframeModelId ?? PHONE_REPAIR_KEYFRAME_MODEL_ID;
  const videoModelId = input.videoModelId ?? PHONE_REPAIR_VIDEO_MODEL_ID;
  const keyframePoints = input.keyframePoints ?? PHONE_REPAIR_KEYFRAME_POINTS;
  const videoPoints = input.videoPoints ?? PHONE_REPAIR_VIDEO_POINTS;
  const byShot = new Map<string, PhoneAnimationFinding[]>();
  for (const finding of input.findings) {
    const list = byShot.get(finding.shotId) ?? [];
    list.push(finding);
    byShot.set(finding.shotId, list);
  }
  const shots: PhoneRepairShotRow[] = input.plan.affectedShotIds.map((shotId) => {
    const row = input.board.rows.find((item) => item.shotId === shotId);
    const reasons = (byShot.get(shotId) ?? []).map((item) => item.reason);
    const motionOnly = !input.plan.affectedStages.includes("keyframe")
      && input.plan.affectedStages.some((stage) => stage === "video");
    const stageLabel = motionOnly ? "影片" : input.plan.affectedStages.includes("video") ? "關鍵影格與影片" : "關鍵影格";
    return {
      shotId,
      shotLabel: row ? phoneShotLabel(row) : "這一鏡",
      stageLabel,
      stages: input.plan.affectedStages,
      ...(motionOnly ? { reuseLabel: "沿用目前關鍵影格" } : {}),
      reason: reasons[0] ?? input.plan.reasons[0] ?? "依目前檢查結果修復",
    };
  });
  const paidKeyframe = input.plan.affectedStages.includes("keyframe") ? shots.length * keyframePoints : 0;
  const paidVideo = input.plan.affectedStages.includes("video") ? shots.length * videoPoints : 0;
  const estimatedPoints = paidKeyframe + paidVideo;
  const requiresApproval = input.approvalThreshold != null && estimatedPoints >= input.approvalThreshold;
  const untouchedCount = Math.max(0, input.board.summary.total - shots.length);
  return {
    affectedShotIds: input.plan.affectedShotIds,
    findingKeys: input.findings.map((row) => row.key),
    dimensions: input.plan.dimensions,
    shots,
    untouchedCount,
    untouchedLabel: untouchedCount > 0 ? `其他 ${untouchedCount} 鏡不動` : "沒有其他鏡頭",
    projectedPaidOperations: input.plan.projectedPaidOperations,
    estimatedPoints,
    requiresApproval,
    ...(requiresApproval ? { approvalLabel: `超過核准門檻，執行前需要你確認 ${estimatedPoints} 點` } : {}),
    capabilityDowngrades: input.capabilityDowngrades ?? [],
    notes: [
      "目前版本不會被覆蓋。",
      "完成後會產生候選，需要你再採用。",
      ...(input.plan.affectedStages.includes("evaluation")
        ? ["視覺檢查若尚未跑過，會顯示尚未檢查，不會假裝通過。"]
        : []),
    ],
    keyframeModelId,
    videoModelId,
  };
}

export function nextPhoneCompareItem(input: {
  items: readonly PhoneCompareItem[];
  decidedShotIds: ReadonlySet<string> | readonly string[];
}): PhoneCompareItem | null {
  const decided = input.decidedShotIds instanceof Set
    ? input.decidedShotIds
    : new Set(input.decidedShotIds);
  return input.items.find((item) => !decided.has(item.shotId)) ?? null;
}

export function sortPhoneCompareQueue(items: readonly PhoneCompareItem[]): PhoneCompareItem[] {
  return [...items].sort((a, b) => {
    const aBlock = a.goals.some((goal) => goal.includes("需修復")) ? 0 : 1;
    const bBlock = b.goals.some((goal) => goal.includes("需修復")) ? 0 : 1;
    if (aBlock !== bBlock) return aBlock - bBlock;
    return a.shotLabel.localeCompare(b.shotLabel, "zh-Hant");
  });
}

export function projectPhoneCompareQueue(board: PhoneAnimationBoardInput): PhoneCompareItem[] {
  const items: PhoneCompareItem[] = [];
  for (const row of board.rows) {
    if (!row.candidate) continue;
    const findings = collectPhoneFindings([row]);
    items.push({
      shotId: row.shotId,
      shotLabel: phoneShotLabel(row),
      generationId: row.candidate.generationId,
      current: row.current ? { kind: row.current.kind, url: row.current.url } : null,
      candidate: { kind: row.candidate.kind, url: row.candidate.url },
      goals: findings.slice(0, 3).map((finding) => finding.reason),
      notChecked: row.visualCheckStatus !== "completed",
    });
  }
  return sortPhoneCompareQueue(items);
}

export function derivePhoneRepairResume(input: {
  awaitingGenerations: number;
  runningGenerations: number;
  compareCount: number;
  proposalShotCount?: number;
  awaitingConfirmation?: boolean;
}): PhoneRepairResume | null {
  if (input.awaitingGenerations > 0) {
    return { state: "awaiting_approval", affectedShotCount: input.awaitingGenerations };
  }
  if (input.runningGenerations > 0) {
    return { state: "running", affectedShotCount: input.runningGenerations };
  }
  if (input.compareCount > 0) {
    return { state: "review_ready", affectedShotCount: input.compareCount };
  }
  if (input.awaitingConfirmation && (input.proposalShotCount ?? 0) > 0) {
    return { state: "awaiting_confirmation", affectedShotCount: input.proposalShotCount ?? 0 };
  }
  if ((input.proposalShotCount ?? 0) > 0) {
    return { state: "proposal", affectedShotCount: input.proposalShotCount ?? 0 };
  }
  return null;
}

function commandAction(label: string, command: PhoneCommand, paid = false): PhoneAssistantAction {
  return {
    id: `phone.animation.${command.type}`,
    label,
    kind: "phone_command",
    command,
    ...(paid ? { paid: true } : {}),
  };
}

export function phoneAnimationSummaryCard(summary: PhoneAnimationSummary): PhoneCard {
  const dimLines = ANIMATION_EVALUATION_DIMENSIONS
    .filter((dimension) => (summary.dimensionCounts[dimension] ?? 0) > 0)
    .map((dimension) => `${PHONE_DIMENSION_LABEL[dimension]} ${summary.dimensionCounts[dimension]}`);
  const lines = [
    `${summary.counts.needsReview} 鏡需要處理`,
    ...dimLines.slice(0, 2),
  ];
  if (summary.counts.notChecked > 0 && lines.length < 3) {
    lines.push(`${summary.counts.notChecked} 鏡尚未檢查`);
  }
  return {
    kind: "answer",
    title: "動畫檢查",
    lines: lines.slice(0, 3),
    steps: [],
    primaryAction: commandAction("查看問題", { type: "list_findings" }),
    secondaryAction: commandAction("幫我規劃修復", { type: "plan_repair" }),
  };
}

export function phoneAnimationFindingsCard(findings: readonly PhoneAnimationFinding[]): PhoneCard {
  if (findings.length === 0) {
    return {
      kind: "answer",
      title: "目前沒有要處理的問題",
      lines: ["這一幕沒有尚未處理的檢查結果。"],
      steps: [],
    };
  }
  return {
    kind: "answer",
    title: `${findings.length} 個問題`,
    lines: findings.slice(0, 3).map((finding) => `${finding.shotLabel} · ${finding.dimensionLabel}`),
    steps: [],
    primaryAction: commandAction("幫我規劃修復", {
      type: "plan_repair",
      shotIds: [...new Set(findings.map((row) => row.shotId))],
    }),
  };
}

export function phoneAnimationExplainCard(finding: PhoneAnimationFinding | undefined, shotLabel: string): PhoneCard {
  if (!finding) {
    return {
      kind: "answer",
      title: `${shotLabel} 目前沒有要修的問題`,
      lines: ["這一鏡沒有尚未處理的檢查結果。"],
      steps: [],
    };
  }
  return {
    kind: "answer",
    title: `${finding.shotLabel} · ${finding.dimensionLabel}`,
    lines: [finding.reason, finding.confidenceLabel],
    steps: [],
    primaryAction: commandAction("加入修復", {
      type: "plan_repair",
      shotIds: [finding.shotId],
      include: [finding.dimension],
    }),
  };
}

export function phoneAnimationRepairCard(proposal: PhoneRepairProposalView): PhoneCard {
  return {
    kind: "proposal",
    title: `修復計畫 · ${proposal.shots.length} 鏡`,
    lines: [
      ...proposal.shots.slice(0, 2).map((shot) => `${shot.shotLabel} · ${shot.stageLabel}`),
      proposal.untouchedLabel,
    ].slice(0, 3),
    steps: [],
    primaryAction: commandAction("查看成本", { type: "confirm_repair" }, true),
    secondaryAction: {
      id: "phone.animation.repair.detail",
      label: "查看明細",
      kind: "open_assistant",
    },
  };
}

export function phoneAnimationCostCard(proposal: PhoneRepairProposalView): PhoneCard {
  const stageLines: string[] = [];
  const keyframeCount = proposal.shots.filter((shot) => shot.stages.includes("keyframe")).length;
  const videoCount = proposal.shots.filter((shot) => shot.stages.includes("video")).length;
  if (keyframeCount) stageLines.push(`${keyframeCount} 次關鍵影格生成`);
  if (videoCount) stageLines.push(`${videoCount} 次影片生成`);
  const headline = proposal.requiresApproval
    ? (proposal.approvalLabel ?? `超過核准門檻，需要你確認 ${proposal.estimatedPoints} 點`)
    : `預估 ${proposal.estimatedPoints} 點`;
  return {
    kind: "proposal",
    title: "執行前確認",
    lines: [
      ...stageLines.slice(0, 1),
      headline,
      proposal.untouchedLabel,
    ].slice(0, 3),
    steps: [
      ...proposal.shots.map((shot) => ({
        key: shot.shotId,
        label: `${shot.shotLabel} · ${shot.stageLabel}${shot.reuseLabel ? ` · ${shot.reuseLabel}` : ""}`,
        state: "pending" as const,
      })),
      { key: "candidate-only", label: "目前版本不會被覆蓋，完成後仍只是候選", state: "pending" as const },
      ...proposal.capabilityDowngrades.map((line, index) => ({
        key: `downgrade-${index}`,
        label: line,
        state: "blocked" as const,
      })),
    ],
    primaryAction: commandAction("確認執行", { type: "confirm_repair" }, true),
    attention: true,
  };
}

export function phoneAnimationProgressCard(input: {
  steps: PhoneWorkStep[];
  done: number;
  total: number;
}): PhoneCard {
  return {
    kind: "progress",
    title: "修復進度",
    lines: input.total > 0 ? [`${input.done} / ${input.total} 已完成`] : [],
    steps: input.steps,
  };
}

export function phoneAnimationCompareCard(item: PhoneCompareItem): PhoneCard {
  return {
    kind: "result",
    title: item.shotLabel,
    lines: [
      item.notChecked ? "視覺一致性尚未檢查" : (item.goals[0] ?? "可比較候選"),
      "現用版本不會被覆蓋，除非你採用。",
    ].slice(0, 3),
    steps: [],
    primaryAction: commandAction("採用這版", { type: "adopt", generationId: item.generationId }),
    secondaryAction: commandAction("保留現用", { type: "keep", shotId: item.shotId }),
    media: {
      current: item.current,
      candidate: item.candidate,
      currentLabel: "現用版本",
      candidateLabel: "修復候選",
    },
  };
}

export function phoneAnimationAdoptCard(input: {
  shotLabel: string;
  before: number;
  after: number;
  kept?: boolean;
}): PhoneCard {
  return {
    kind: "result",
    title: input.kept ? `${input.shotLabel} 保留現用版本` : `${input.shotLabel} 已採用修復版本`,
    lines: [`Review Queue ${input.before} → ${input.after}`],
    steps: [],
    primaryAction: commandAction("下一個問題", { type: "next_compare" }),
  };
}

export function phoneAnimationClarifyCard(question: string, options: Array<{ id: string; label: string }>): PhoneCard {
  return {
    kind: "clarify",
    title: question,
    lines: ["還沒有執行，也還沒有花點數。"],
    steps: [],
    primaryAction: {
      id: "phone.animation.clarify",
      label: "選擇",
      kind: "open_assistant",
    },
    attention: true,
    choices: options,
  };
}

export function phoneAnimationResumeCard(resume: PhoneRepairResume): PhoneCard {
  const title = resume.state === "review_ready"
    ? `你有 ${resume.affectedShotCount} 鏡修復結果待檢查`
    : resume.state === "running"
      ? `${resume.affectedShotCount} 鏡修復進行中`
      : resume.state === "awaiting_approval"
        ? `等待你確認生成`
        : `你有 ${resume.affectedShotCount} 鏡修復計畫`;
  return {
    kind: resume.state === "running" ? "progress" : resume.state === "review_ready" ? "result" : "proposal",
    title,
    lines: resume.state === "awaiting_confirmation" || resume.state === "proposal"
      ? ["硬重新整理後從伺服器狀態接續，沒有另外輪詢。"]
      : [],
    steps: [],
    primaryAction: commandAction("繼續", { type: "resume" }),
  };
}

export function assertNoTechnicalLeak(text: string): boolean {
  return !/(?:fingerprint|packet|evaluator|uuid|generation_consistency|0f8fad5b)/i.test(text);
}

/** Switching projects must drop in-memory repair session (compare queue / confirm lock). */
export function shouldResetPhoneAnimationRepair(
  previousProjectId: string | undefined,
  nextProjectId: string | undefined,
): boolean {
  return previousProjectId !== nextProjectId;
}

/** A failed repair round must not keep the confirm lock; the user can retry. */
export function shouldUnlockPhoneRepairConfirm(failedCount: number): boolean {
  return failedCount > 0;
}
