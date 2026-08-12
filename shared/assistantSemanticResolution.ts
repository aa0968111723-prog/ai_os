import {
  ASSISTANT_CAPABILITIES,
  type AssistantCapability,
  type AssistantExecutionPlan,
} from "./assistantExecution";
import {
  continuationHint,
  type AssistantActiveGoal,
  type AssistantContinuationType,
  type AssistantEvidenceScope,
  type AssistantGoalFrame,
  type AssistantGoalIntent,
  type AssistantGoalObject,
  type AssistantGoalOperation,
  type AssistantSourceType,
} from "./assistantGoalFrame";
import type { AssistantActionResult } from "./assistantActions";

/**
 * Assistant Brain v2 semantic resolution helpers.
 *
 * This module is deliberately pure: it does not call an LLM and it never
 * executes a tool. It turns explicit language + trusted conversation state
 * into a typed GoalFrame, then matches that frame against the single shared
 * capability registry. Server-side orchestration may ask a model to refine a
 * low-confidence frame, but model output is always parsed back through the
 * GoalFrame schema before it can influence routing.
 */

export type SemanticResolutionOrigin = "deterministic" | "continuation" | "model" | "fallback";

export interface AssistantCapabilityMatch {
  status: "matched" | "missing_context" | "unsupported";
  capability?: AssistantCapability;
  capabilityId?: string;
  reason: string;
  missingSlots: string[];
  evidenceScope: AssistantEvidenceScope;
}

export interface WorkingProjectCandidate {
  id: string;
  title: string;
}

export interface WorkingProjectResolution {
  status: "resolved" | "ambiguous" | "missing";
  projectId?: string;
  projectTitle?: string;
  source?: "explicit" | "active_goal" | "recent_result" | "page_context" | "unique_candidate" | "pending_choice";
  candidates: WorkingProjectCandidate[];
}

const SOURCE_MENTION: Array<[RegExp, AssistantSourceType]> = [
  [/(?:google\s*photos?|\bphotos?\b|google\s*相簿|google\s*照片|照片雲端)/iu, "GOOGLE_PHOTOS"],
  [/(?:google\s*drive|雲端硬碟|雲端磁碟|drive)/iu, "GOOGLE_DRIVE"],
  [/(?:本機|本地|電腦).{0,8}(?:資料夾|文件夾)|(?:資料夾|文件夾|folder)/iu, "LOCAL_FOLDER"],
  [/(?:本機|本地|電腦).{0,8}(?:檔案|文件)|(?:選檔|檔案|file)/iu, "LOCAL_FILE"],
  [/(?:https?:\/\/|網址|連結|url)/iu, "URL"],
  [/(?:外部\s*ai|flow|firefly|midjourney|runway|kling|可靈|sora)/iu, "EXTERNAL_AI"],
  [/(?:lumafusion|外部剪輯|剪輯軟體|editor)/iu, "EXTERNAL_EDITOR"],
  [/(?:素材庫|專案素材|目前素材|這個專案.{0,6}素材)/iu, "PROJECT_ASSETS"],
  [/(?:aios\s*資料庫|資料中心|全站素材|素材資料庫)/iu, "AIOS_LIBRARY"],
];

const CLOUD_ONLY_RE = /(?:雲端|cloud)/iu;
const IMPORT_RE = /(?:匯入|帶入|帶進|加入|放進|上傳|丟進|丟到|塞進|塞到|import|upload|加\s*\d+\s*張|加\s*[一二三四五六七八九十百]+張|丟\s*幾張|丟\s*\d+\s*張)/iu;
const ATTACH_RE = /(?:放到|放進|掛到|綁定|加入|放).{0,12}(?:分鏡|鏡|shot|場景|scene)|(?:分鏡|鏡|shot|場景|scene).{0,12}(?:放|掛|綁|加入)|放\s*第\s*[一二三四五六七八九十\d]+\s*鏡/iu;
const ORGANIZE_RE = /(?:整理|分類|歸類|標註|辨識|重整|organize|classify)/iu;
const COUNT_RE = /(?:多少|幾個|幾項|數量|count)/iu;
const LIST_RE = /(?:列出|有哪些|清單|list)/iu;
const FIND_RE = /(?:找|搜尋|查找|find|search)/iu;
const COMPARE_RE = /(?:比較|對比|compare)/iu;
const VERIFY_RE = /(?:確認|驗證|核對|verify)/iu;
const GENERATE_RE = /(?:生成|產生|生圖|生影片|做圖|做影片|generate)/iu;
const CREATE_RE = /(?:建立|新增|創建|開一個|建一個|create)/iu;
const UPDATE_RE = /(?:更新|修改|調整|改成|update|modify)/iu;

const ASSET_RE = /(?:素材|圖片|照片|影片|音訊|檔案|文件|這些|那批|剛才那些|asset)/iu;
const PROJECT_RE = /(?:專案|project)/iu;
const SHOT_RE = /(?:第\s*[一二三四五六七八九十百\d]+\s*鏡|shot\s*#?\s*\d+|分鏡\s*#?\s*\d+)/iu;
const SCENE_RE = /(?:場景|scene\s*#?\s*\d+)/iu;
const SCRIPT_RE = /(?:腳本|劇本|script)/iu;
const TASK_RE = /(?:任務|待辦|task)/iu;
const GENERATION_RE = /(?:生成紀錄|生成結果|generation)/iu;

function sourceFromText(text: string): AssistantSourceType | undefined {
  let resolved: { index: number; type: AssistantSourceType } | undefined;
  for (const [re, type] of SOURCE_MENTION) {
    const index = text.search(re);
    // A correction can name both the rejected and replacement source
    // ("不是 Drive，是 Photos"). The last explicit source is the asserted
    // replacement; registry order must never override conversation syntax.
    if (index >= 0 && (!resolved || index > resolved.index)) resolved = { index, type };
  }
  if (resolved) return resolved.type;
  if (CLOUD_ONLY_RE.test(text)) return "UNKNOWN_CLOUD";
  return undefined;
}

function operationFromText(text: string): AssistantGoalOperation {
  if (COUNT_RE.test(text)) return "COUNT";
  if (COMPARE_RE.test(text)) return "COMPARE";
  if (VERIFY_RE.test(text)) return "VERIFY";
  if (ATTACH_RE.test(text)) return "ATTACH";
  if (IMPORT_RE.test(text)) return "IMPORT";
  if (ORGANIZE_RE.test(text)) return "ORGANIZE";
  if (GENERATE_RE.test(text)) return "GENERATE";
  if (LIST_RE.test(text)) return "LIST";
  if (FIND_RE.test(text)) return "FIND";
  if (CREATE_RE.test(text)) return "CREATE";
  if (UPDATE_RE.test(text)) return "UPDATE";
  return "READ";
}

function objectFromText(text: string, operation: AssistantGoalOperation): AssistantGoalObject {
  if (SHOT_RE.test(text)) return "SHOT";
  if (SCENE_RE.test(text)) return "SCENE";
  if (SCRIPT_RE.test(text)) return "SCRIPT";
  if (TASK_RE.test(text)) return "TASK";
  if (PROJECT_RE.test(text) && operation === "CREATE") return "PROJECT";
  if (GENERATION_RE.test(text)) return "GENERATION";
  if (ASSET_RE.test(text) || operation === "IMPORT" || operation === "ATTACH" || operation === "ORGANIZE" || operation === "GENERATE") return "ASSET";
  if (PROJECT_RE.test(text)) return "PROJECT";
  return "UNKNOWN";
}

function intentFromOperation(operation: AssistantGoalOperation, continuation: AssistantContinuationType): AssistantGoalIntent {
  if (continuation === "CORRECT") return "CORRECT";
  if (continuation === "CONFIRM") return "CONFIRM";
  if (continuation === "CONTINUE" || continuation === "ANSWER_PENDING_QUESTION") return "CONTINUE";
  if (operation === "IMPORT") return "IMPORT";
  if (operation === "ATTACH" || operation === "UPDATE") return "MODIFY";
  if (operation === "CREATE") return "CREATE";
  if (operation === "GENERATE") return "GENERATE";
  if (operation === "ORGANIZE") return "ORGANIZE";
  if (operation === "COMPARE") return "ANALYZE";
  return "QUERY";
}

function desiredOutcomeFor(operation: AssistantGoalOperation, objectType: AssistantGoalObject): AssistantGoalFrame["desiredOutcome"] {
  if (operation === "COUNT") return "VERIFIED_COUNT";
  if (operation === "LIST" || operation === "FIND" || operation === "COMPARE" || operation === "VERIFY") return "VERIFIED_LIST";
  if (operation === "IMPORT") return "PERSIST_ASSETS";
  if (operation === "ATTACH") return "VERIFIED_BINDING";
  if (operation === "ORGANIZE") return "START_CLASSIFICATION";
  if (operation === "GENERATE") return "START_GENERATION";
  if (operation === "CREATE" && objectType === "PROJECT") return "PERSIST_PROJECT";
  if (operation === "CREATE" && (objectType === "SHOT" || objectType === "SCENE")) return "PERSIST_STORYBOARD";
  return "ANSWER";
}

function mergePreviousFrame(
  message: string,
  continuation: AssistantContinuationType,
  previous: AssistantActiveGoal | undefined,
): AssistantGoalFrame | undefined {
  if (!previous || continuation === "NEW_GOAL") return undefined;
  const explicitSource = sourceFromText(message);
  const explicitOperation = operationFromText(message);
  const explicitObject = objectFromText(message, explicitOperation);
  const next = structuredClone(previous.frame) as AssistantGoalFrame;

  if (continuation === "CORRECT") {
    next.intent = "CORRECT";
    if (explicitSource) next.source = { type: explicitSource };
    if (explicitObject !== "UNKNOWN") next.objectType = explicitObject;
    if (explicitOperation !== "READ" || /(?:讀|查看|查)/u.test(message)) next.operation = explicitOperation;
    next.desiredOutcome = desiredOutcomeFor(next.operation, next.objectType);
  } else if (continuation === "CONFIRM") {
    next.intent = "CONFIRM";
  } else {
    next.intent = "CONTINUE";
    if (explicitSource) next.source = { type: explicitSource };
    if (explicitObject !== "UNKNOWN") next.objectType = explicitObject;
    if (explicitOperation !== "READ") {
      next.operation = explicitOperation;
      next.desiredOutcome = desiredOutcomeFor(next.operation, next.objectType);
    }
  }
  next.continuationOfGoalId = previous.goalId;
  return next;
}

/**
 * Deterministic semantic frame for explicit, high-signal requests. Low-signal
 * frames intentionally carry lower confidence so the server can ask the
 * semantic model resolver rather than turning more regex into authority.
 */
export function deriveDeterministicGoalFrame(
  message: string,
  previous?: AssistantActiveGoal,
): { frame: AssistantGoalFrame; continuation: AssistantContinuationType; origin: SemanticResolutionOrigin } {
  const continuation = continuationHint(message);
  const merged = mergePreviousFrame(message, continuation, previous);
  if (merged) {
    const sourceMissing = merged.source?.type === "UNKNOWN_CLOUD" || !merged.source && merged.operation === "IMPORT";
    merged.missingSlots = sourceMissing
      ? [...new Set([...merged.missingSlots, "source"])]
      : merged.missingSlots.filter((slot) => slot !== "source");
    merged.sourceConfidence = sourceMissing ? "low" : merged.source ? "high" : merged.sourceConfidence;
    return { frame: merged, continuation, origin: "continuation" };
  }

  const operation = operationFromText(message);
  const objectType = objectFromText(message, operation);
  const sourceType = sourceFromText(message);
  const sourceMissing = sourceType === "UNKNOWN_CLOUD" || (operation === "IMPORT" && !sourceType);
  const highSignal = operation !== "READ" || !!sourceType || objectType !== "UNKNOWN";
  const frame: AssistantGoalFrame = {
    intent: intentFromOperation(operation, continuation),
    operation,
    objectType,
    ...(sourceType ? { source: { type: sourceType } } : {}),
    scope: {},
    referents: /(?:這些|那批|剛才那些|剛剛那些)/u.test(message) ? ["recent_results"] : [],
    constraints: [],
    desiredOutcome: desiredOutcomeFor(operation, objectType),
    missingSlots: sourceMissing ? ["source"] : [],
    understandingConfidence: highSignal ? "high" : "medium",
    sourceConfidence: sourceMissing ? "low" : sourceType ? "high" : "medium",
    entityConfidence: objectType === "UNKNOWN" ? "low" : "high",
    capabilityConfidence: highSignal ? "medium" : "low",
  };
  return { frame, continuation, origin: "deterministic" };
}

function findCapability(id: string): AssistantCapability | undefined {
  return ASSISTANT_CAPABILITIES.find((item) => item.id === id);
}

export function evidenceScopeForGoal(frame: AssistantGoalFrame): AssistantEvidenceScope {
  const source = frame.source?.type;
  if (source === "GOOGLE_DRIVE" || source === "GOOGLE_PHOTOS" || source === "URL") return "REMOTE_SOURCE";
  if (source === "AIOS_LIBRARY") return "AIOS_LIBRARY";
  if (source === "PROJECT_ASSETS") return "PROJECT_ASSETS";
  if (source === "EXTERNAL_AI" || source === "EXTERNAL_EDITOR") return "IMPORTED_PROVENANCE";
  if (frame.scope.projectId) return "PROJECT_USAGE";
  return "UNKNOWN";
}

/** Single source of truth: GoalFrame -> ASSISTANT_CAPABILITIES. */
export function matchAssistantCapabilityForGoal(frame: AssistantGoalFrame): AssistantCapabilityMatch {
  const missing = [...frame.missingSlots];
  const source = frame.source?.type;
  let capabilityId: string | undefined;

  if (frame.operation === "IMPORT") {
    if (source === "GOOGLE_DRIVE") capabilityId = "import_google_drive";
    else if (source === "LOCAL_FILE") capabilityId = "import_local_file";
    else if (source === "LOCAL_FOLDER") capabilityId = "import_folder";
    else if (source === "URL") capabilityId = "import_url";
    else if (source === "EXTERNAL_AI" || source === "EXTERNAL_EDITOR") capabilityId = "import_external_result";
    else if (source === "GOOGLE_PHOTOS") {
      return {
        status: "unsupported",
        reason: "目前沒有 Google Photos 遠端媒體列舉／直接匯入能力；不能以專案素材冒充遠端來源。",
        missingSlots: [],
        evidenceScope: "REMOTE_SOURCE",
      };
    }
  } else if (frame.operation === "ATTACH") {
    capabilityId = frame.target?.type === "SHOT" || frame.objectType === "SHOT"
      ? "attach_asset_to_shot"
      : frame.target?.type === "SCENE" || frame.objectType === "SCENE"
        ? "attach_asset_to_scene"
        : "attach_asset_to_project";
  } else if (frame.operation === "ORGANIZE") {
    capabilityId = "classify_asset";
  } else if (frame.operation === "GENERATE") {
    capabilityId = source === "EXTERNAL_AI" ? "prepare_external_generation" : "generate_media";
  } else if (frame.operation === "CREATE") {
    if (frame.objectType === "PROJECT") capabilityId = "create_project";
    else if (frame.objectType === "TASK") capabilityId = "create_task";
    else if (frame.objectType === "SHOT" || frame.objectType === "SCENE") capabilityId = "split_script";
  } else if (frame.operation === "COUNT" || frame.operation === "LIST" || frame.operation === "FIND" || frame.operation === "READ" || frame.operation === "COMPARE" || frame.operation === "VERIFY") {
    if (source === "GOOGLE_DRIVE" || source === "GOOGLE_PHOTOS") {
      return {
        status: "unsupported",
        reason: `目前沒有 ${source === "GOOGLE_PHOTOS" ? "Google Photos" : "Google Drive"} 遠端完整清單查詢能力；只能回答已經實際讀取到的 Aios 資料。`,
        missingSlots: [],
        evidenceScope: "REMOTE_SOURCE",
      };
    }
    if (frame.objectType === "TASK") capabilityId = "read_tasks";
    else if (frame.objectType === "SCRIPT") capabilityId = "read_script";
    else if (frame.objectType === "SHOT" || frame.objectType === "SCENE") capabilityId = "read_storyboard";
    else if (frame.objectType === "GENERATION") capabilityId = "read_generations";
    else if (frame.objectType === "ASSET" || source === "PROJECT_ASSETS" || source === "AIOS_LIBRARY") capabilityId = "read_assets";
    else capabilityId = "read_context";
  }

  if (!capabilityId) {
    return {
      status: missing.length ? "missing_context" : "unsupported",
      reason: missing.length ? `還缺：${missing.join("、")}` : "目前沒有可安全對應的能力。",
      missingSlots: missing,
      evidenceScope: evidenceScopeForGoal(frame),
    };
  }
  const capability = findCapability(capabilityId);
  if (!capability) {
    return {
      status: "unsupported",
      reason: `能力 ${capabilityId} 尚未註冊。`,
      missingSlots: missing,
      evidenceScope: evidenceScopeForGoal(frame),
    };
  }
  for (const slot of capability.requiredContextSlots) {
    const has = slot === "projectId" ? !!frame.scope.projectId
      : slot === "sceneId" ? !!frame.scope.sceneId
      : slot === "shotId" ? !!frame.scope.shotId
      : slot === "assetIds" ? frame.referents.includes("recent_results")
      : false;
    if (!has && !missing.includes(slot)) missing.push(slot);
  }
  return {
    status: missing.length ? "missing_context" : "matched",
    capability,
    capabilityId: capability.id,
    reason: missing.length ? `能力已找到，但還缺：${missing.join("、")}` : `使用「${capability.label}」`,
    missingSlots: missing,
    evidenceScope: evidenceScopeForGoal(frame),
  };
}

function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\-_–—・,，。.!！?？「」『』()（）]/g, "");
}

function explicitProject(message: string, candidates: readonly WorkingProjectCandidate[]): WorkingProjectCandidate | undefined {
  const normalized = normalizeTitle(message);
  const matches = candidates.filter((candidate) => {
    const title = normalizeTitle(candidate.title);
    return title.length >= 2 && normalized.includes(title);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function projectFromRecentResult(results: readonly AssistantActionResult[] | undefined): string | undefined {
  if (!results?.length) return undefined;
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const result = results[i];
    if (result.verification?.status !== "verified") continue;
    if (result.type === "create_project") return result.projectId;
    if ("projectId" in result && typeof result.projectId === "string") return result.projectId;
  }
  return undefined;
}

function pendingChoiceIndex(message: string): number | undefined {
  const m = message.trim().match(/^(?:第)?([一二三四五六七八九十\d]+)(?:個)?[。！!]?$/u);
  if (!m) return undefined;
  const raw = m[1];
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw) - 1);
  const map: Record<string, number> = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 七: 6, 八: 7, 九: 8, 十: 9 };
  return map[raw];
}

/**
 * Trusted working-project resolution. Explicit project mention always wins over
 * the route. This fixes the old "current page silently overrides what the user
 * actually named" behavior.
 */
export function resolveWorkingProject(input: {
  message: string;
  candidates: readonly WorkingProjectCandidate[];
  activeGoal?: AssistantActiveGoal;
  recentActionResults?: readonly AssistantActionResult[];
  pageProjectId?: string;
}): WorkingProjectResolution {
  const explicit = explicitProject(input.message, input.candidates);
  if (explicit) return { status: "resolved", projectId: explicit.id, projectTitle: explicit.title, source: "explicit", candidates: [] };

  const pending = input.activeGoal?.resolvedSlots?.projectCandidates;
  const index = pendingChoiceIndex(input.message);
  if (Array.isArray(pending) && index != null) {
    const option = pending[index] as { id?: unknown; title?: unknown } | undefined;
    if (option && typeof option.id === "string") {
      const trusted = input.candidates.find((candidate) => candidate.id === option.id);
      if (trusted) return { status: "resolved", projectId: trusted.id, projectTitle: trusted.title, source: "pending_choice", candidates: [] };
    }
  }

  const activeProjectId = input.activeGoal?.frame.scope.projectId;
  if (activeProjectId) {
    const active = input.candidates.find((candidate) => candidate.id === activeProjectId);
    if (active) return { status: "resolved", projectId: active.id, projectTitle: active.title, source: "active_goal", candidates: [] };
  }

  const recentProjectId = projectFromRecentResult(input.recentActionResults);
  if (recentProjectId) {
    const recent = input.candidates.find((candidate) => candidate.id === recentProjectId);
    if (recent) return { status: "resolved", projectId: recent.id, projectTitle: recent.title, source: "recent_result", candidates: [] };
  }

  if (input.pageProjectId) {
    const page = input.candidates.find((candidate) => candidate.id === input.pageProjectId);
    if (page) return { status: "resolved", projectId: page.id, projectTitle: page.title, source: "page_context", candidates: [] };
  }

  if (input.candidates.length === 1) {
    const only = input.candidates[0];
    return { status: "resolved", projectId: only.id, projectTitle: only.title, source: "unique_candidate", candidates: [] };
  }
  if (input.candidates.length > 1) return { status: "ambiguous", candidates: [...input.candidates].slice(0, 8) };
  return { status: "missing", candidates: [] };
}

export function executionPlanFromGoal(
  frame: AssistantGoalFrame,
  match: AssistantCapabilityMatch,
  title: string,
): AssistantExecutionPlan {
  const capability = match.capability;
  const missing = match.missingSlots.length > 0;
  const write = capability?.access === "WRITE";
  const intent: AssistantExecutionPlan["intent"] = missing
    ? "ASK"
    : !capability
      ? "ASK"
      : capability.executionMode === "GROUP_CAMPAIGN"
        ? "PLAN"
        : capability.executionMode === "PROJECT_AGENT" && write
          ? "AGENT"
          : write
            ? "DIRECT"
            : "ASK";
  return {
    intent,
    confidence: missing || !capability ? "medium" : "high",
    title: title.slice(0, 120) || "處理這項請求",
    steps: missing
      ? ["理解目標", `補齊 ${match.missingSlots.join("、")}`, "繼續原目標"]
      : capability
        ? ["理解目標", `使用：${capability.label}`, write ? "執行並驗證結果" : "查證並回答"]
        : ["理解目標", "確認目前能力邊界", "提供可驗證的下一步"],
    ...(capability ? { capabilityId: capability.id, executionMode: capability.executionMode } : {}),
  };
}
