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
  // Bare 資料庫 is a custom table, but must not steal 「素材資料庫」/「aios 資料庫」.
  [/(?:自訂(?:資料)?(?:庫|表)|資料表|\bdb\d+\b|query_database|custom\s*databases?|(?<!素材|aios\s*|AIOS\s*)資料庫)/iu, "CUSTOM_DATABASE"],
  [/(?:public\s*agent\s*fuel|公共\s*agent\s*素材|公共素材包)/iu, "PUBLIC_AGENT_FUEL"],
  [/(?:遠端供應商|remote\s*provider|fal\s*api)/iu, "REMOTE_PROVIDER"],
];

const CLOUD_ONLY_RE = /(?:雲端|cloud)/iu;
const IMPORT_RE = /(?:匯入|帶入|帶進|加入|放進|上傳|丟進|丟到|塞進|塞到|import|upload|加\s*\d+\s*張|加\s*[一二三四五六七八九十百]+張|丟\s*幾張|丟\s*\d+\s*張)/iu;
const ATTACH_RE = /(?:放到|放進|掛到|綁定|加入|放|丟到|丟進|塞到|塞進).{0,12}(?:分鏡|鏡|shot|場景|scene)|(?:分鏡|鏡|shot|場景|scene).{0,12}(?:放|掛|綁|加入|丟|塞)|(?:放|丟|掛|塞)\s*第\s*[一二三四五六七八九十\d]+\s*鏡|到\s*第\s*[一二三四五六七八九十\d]+\s*鏡/iu;
const ORGANIZE_RE = /(?:整理|分類|歸類|標註|辨識|重整|organize|classify)/iu;
const COUNT_RE = /(?:多少|幾個|幾項|幾列|幾筆|數量|count)|(?<!丟|加|帶)幾張/iu;
const LIST_RE = /(?:列出|有哪些|清單|顯示|show|list)/iu;
const FIND_RE = /(?:找|搜尋|查找|find|search)/iu;
const COMPARE_RE = /(?:比較|對比|compare)/iu;
const VERIFY_RE = /(?:確認|驗證|核對|verify)/iu;
const GENERATE_RE = /(?:生成|產生|生圖|生影片|做圖|做影片|generate)/iu;
const CREATE_RE = /(?:建立|新增|創建|開一個|建一個|create)/iu;
// Exclude 「沒更新／未更新／最久沒更新」 — those are staleness READs, not UPDATE writes.
const UPDATE_RE = /(?<!沒|未|不)(?:更新|修改|調整|改成)|(?<!not\s)(?:update|modify)/iu;
const STALE_PROJECT_RE = /(?:最久沒更新|最久未更新|最舊|最早建立|哪個最舊|哪一個最舊|stalest|oldest|least\s*recent)/iu;
/** Already-imported provenance read — must win over IMPORT_RE (Q16 / #660 family). */
const RECENT_IMPORT_READ_RE = /(?:最近|剛(?:才|剛)?).{0,8}(?:匯入|加入|帶入|上傳)(?:了)?(?:哪些|什麼|的)?(?:資料|素材|檔案)?|(?:查看|看|顯示|列出|開啟|打開|show|view|list).{0,12}(?:剛(?:才|剛)?(?:匯入|加入|帶入)|最近(?:匯入|加入)|剛匯入)(?:的)?(?:資料|素材|檔案)?|(?:匯入|加入)了哪些(?:資料|素材|檔案)?/iu;
const SCHEDULE_RE = /(?:會議|開會|行程|排程|約會|calendar|meeting|schedule)|(?:安排|排).{0,16}(?:會議|開會|行程|約會|明天|後天|下午|早上|晚上|\d+\s*點)/iu;
const FREE_ONLY_RE = /(?:只用|僅用|只要).{0,12}(?:免費|free).{0,12}(?:模型|model)|(?:不要|別|禁止|不得).{0,12}(?:付費|付费|paid).{0,16}(?:fallback|後備|備援|降級)|no[-\s]?paid[-\s]?fallback/iu;
const MAX_POINTS_RE = /(?:不要超過|不超過|最多|上限|預算上限|budget|within)\s*(\d+)\s*(?:點|點數|credits?)|(?:max(?:imum)?|cap)\s*(\d+)\s*(?:points?|credits?)/iu;
const DELIVERY_RE = /(?:做到|做到可以交|可以交|交付|交件|deadline|due).{0,16}(?:今天|今日|今晚|明天|明日)?|(?:今天|今日).{0,12}(?:可以交|交付|交件|完工|完成)/iu;
const RECENT_N_ASSETS_RE = /最近\s*([一二三四五六七八九十\d]+)\s*張/iu;
const CORRECTION_PREVIOUS_RE = /(?:不是這個|不是那個|不對).{0,12}(?:是|而是).{0,8}(?:剛才|剛剛|上一個|前一個)(?:那個|的)?|(?:剛才|剛剛|上一個|前一個)(?:那個|的那[個項筆])?/iu;

const ASSET_RE = /(?:素材|圖片|照片|影片|音訊|檔案|文件|這些|那批|剛才那些|asset)/iu;
const DATABASE_RE = /(?:自訂(?:資料)?(?:庫|表)|資料表|\bdb\d+\b|query_database|custom\s*databases?|(?<!素材|aios\s*|AIOS\s*)資料庫|庫有幾(?:筆|列))/iu;
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
  // Staleness / oldest-project questions are pure reads (#662).
  if (STALE_PROJECT_RE.test(text)) return "FIND";
  // Provenance reads must beat IMPORT_RE even when the utterance contains 匯入.
  if (RECENT_IMPORT_READ_RE.test(text)) return "READ";
  if (ATTACH_RE.test(text)) return "ATTACH";
  if (SCHEDULE_RE.test(text) && /(?:安排|排|幫我|替我|建立|新增|create|schedule)/iu.test(text)) return "CREATE";
  if (IMPORT_RE.test(text)) return "IMPORT";
  if (ORGANIZE_RE.test(text)) return "ORGANIZE";
  if (GENERATE_RE.test(text)) return "GENERATE";
  if (LIST_RE.test(text)) return "LIST";
  if (FIND_RE.test(text)) return "FIND";
  if (CREATE_RE.test(text) || DELIVERY_RE.test(text)) return "CREATE";
  if (UPDATE_RE.test(text)) return "UPDATE";
  return "READ";
}

function objectFromText(text: string, operation: AssistantGoalOperation): AssistantGoalObject {
  // Target object wins over source material: 「最近五張圖放第三鏡」 is SHOT attach.
  if (SHOT_RE.test(text)) return "SHOT";
  if (SCENE_RE.test(text)) return "SCENE";
  if (RECENT_IMPORT_READ_RE.test(text)) return "ASSET";
  if (SCHEDULE_RE.test(text)) return "SCHEDULE";
  if (SCRIPT_RE.test(text)) return "SCRIPT";
  if (TASK_RE.test(text)) return "TASK";
  if (DELIVERY_RE.test(text) && PROJECT_RE.test(text)) return "PROJECT";
  if (PROJECT_RE.test(text) && operation === "CREATE") return "PROJECT";
  if (GENERATION_RE.test(text)) return "GENERATION";
  if (ASSET_RE.test(text) || RECENT_N_ASSETS_RE.test(text) || operation === "IMPORT" || operation === "ATTACH" || operation === "ORGANIZE" || operation === "GENERATE") return "ASSET";
  // Custom DB rows/tables are not project assets (Q18). Check after ASSET so
  // 「素材庫有幾張」 stays ASSET / PROJECT_ASSETS.
  if (DATABASE_RE.test(text)) return "DATABASE";
  // 「哪一個最久沒更新」implicitly means projects in group scope.
  if (PROJECT_RE.test(text) || STALE_PROJECT_RE.test(text)) return "PROJECT";
  return "UNKNOWN";
}

function constraintsFromText(text: string): string[] {
  const constraints: string[] = [];
  if (FREE_ONLY_RE.test(text)) {
    constraints.push("free_only");
  }
  const maxMatch = text.match(MAX_POINTS_RE);
  if (maxMatch) {
    const raw = maxMatch[1] ?? maxMatch[2];
    const points = Number(raw);
    if (Number.isFinite(points) && points > 0 && points <= 1_000_000) {
      constraints.push(`max_points:${points}`);
    }
  }
  if (DELIVERY_RE.test(text)) {
    constraints.push(/今天|今日/u.test(text) ? "delivery:today" : "delivery:deadline");
  }
  return constraints;
}

/** Parse free_only / max_points constraints from a GoalFrame. */
export function parseGoalBudgetConstraints(constraints: readonly string[]): {
  freeOnly: boolean;
  maxPoints?: number;
  deliveryToday: boolean;
} {
  let freeOnly = false;
  let maxPoints: number | undefined;
  let deliveryToday = false;
  for (const raw of constraints) {
    const c = raw.trim().toLowerCase();
    if (c === "free_only" || c.includes("free_only")) freeOnly = true;
    if (c === "delivery:today" || c.includes("delivery:today")) deliveryToday = true;
    const m = c.match(/max_points:(\d+)/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) maxPoints = n;
    }
  }
  return { freeOnly, maxPoints, deliveryToday };
}

function recentAssetLimitFromText(text: string): number | undefined {
  const m = text.match(RECENT_N_ASSETS_RE);
  if (!m) return undefined;
  const raw = m[1];
  if (/^\d+$/.test(raw)) return Math.min(50, Math.max(1, Number(raw)));
  const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return map[raw] ?? undefined;
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
  if (operation === "CREATE" && objectType === "SCHEDULE") return "PERSIST_SCHEDULE";
  if (operation === "CREATE" && objectType === "TASK") return "PERSIST_TASK";
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
const ABORT_RE = /^(?:先不要|先別|不要了|先算了|取消|停下來|先停|stop|cancel)[。！!？?]?$/iu;

export function deriveDeterministicGoalFrame(
  message: string,
  previous?: AssistantActiveGoal,
): { frame: AssistantGoalFrame; continuation: AssistantContinuationType; origin: SemanticResolutionOrigin } {
  if (ABORT_RE.test(message.trim())) {
    return {
      frame: {
        intent: "QUERY",
        operation: "READ",
        objectType: "UNKNOWN",
        scope: {},
        referents: previous ? ["previous_candidate"] : [],
        constraints: ["abort_pending"],
        desiredOutcome: "ANSWER",
        missingSlots: [],
        understandingConfidence: "high",
        sourceConfidence: "high",
        entityConfidence: "medium",
        capabilityConfidence: "high",
      },
      continuation: "NEW_GOAL",
      origin: "deterministic",
    };
  }
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
  const sourceType = sourceFromText(message)
    ?? (objectType === "DATABASE" ? "CUSTOM_DATABASE" : undefined);
  const sourceMissing = sourceType === "UNKNOWN_CLOUD" || (operation === "IMPORT" && !sourceType);
  const highSignal = operation !== "READ" || !!sourceType || objectType !== "UNKNOWN";
  const recentLimit = recentAssetLimitFromText(message);
  const referents: string[] = [];
  if (/(?:這些|那批|剛才那些|剛剛那些)/u.test(message) || RECENT_IMPORT_READ_RE.test(message) || recentLimit) {
    referents.push("recent_results");
  }
  if (recentLimit) referents.push(`recent_limit:${recentLimit}`);
  if (CORRECTION_PREVIOUS_RE.test(message) && continuation === "CORRECT") {
    referents.push("previous_candidate");
  }
  const frame: AssistantGoalFrame = {
    intent: intentFromOperation(operation, continuation),
    operation,
    objectType,
    ...(sourceType ? { source: { type: sourceType } } : {}),
    scope: {},
    referents,
    constraints: constraintsFromText(message),
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
  if (source === "CUSTOM_DATABASE" || frame.objectType === "DATABASE") return "CUSTOM_DATABASE";
  if (source === "EXTERNAL_AI" || source === "EXTERNAL_EDITOR") return "IMPORTED_PROVENANCE";
  if (frame.scope.projectId) return "PROJECT_USAGE";
  return "UNKNOWN";
}

/** Single source of truth: GoalFrame -> ASSISTANT_CAPABILITIES. */
export function matchAssistantCapabilityForGoal(
  frame: AssistantGoalFrame,
  runtime?: { blockedCapabilityIds?: readonly string[] },
): AssistantCapabilityMatch {
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
    if (frame.objectType === "PROJECT") {
      // Delivery language is multi-step agent work (dispatch), not create_project.
      capabilityId = frame.constraints.some((c) => c.startsWith("delivery:"))
        ? "dispatch_agent"
        : "create_project";
    } else if (frame.objectType === "TASK") capabilityId = "create_task";
    else if (frame.objectType === "SCHEDULE") capabilityId = "add_schedule_item";
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
    else if (source === "CUSTOM_DATABASE" || (frame.objectType === "DATABASE" && source !== "AIOS_LIBRARY" && source !== "PROJECT_ASSETS")) {
      capabilityId = "read_database";
    } else if (frame.objectType === "ASSET" || source === "PROJECT_ASSETS" || source === "AIOS_LIBRARY") capabilityId = "read_assets";
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
  if (runtime?.blockedCapabilityIds?.includes(capability.id)) {
    return {
      status: "unsupported",
      capabilityId: capability.id,
      reason: `「${capability.label}」目前後端不可用，不能假裝執行成功。`,
      missingSlots: [],
      evidenceScope: evidenceScopeForGoal(frame),
    };
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

function titleExactInMessage(normalizedMessage: string, title: string): boolean {
  const index = normalizedMessage.indexOf(title);
  if (index < 0) return false;
  const after = normalizedMessage.slice(index + title.length);
  return after === "" || /^(?:的|專案|裡|里|中|內|裡頭|里面)/.test(after);
}

function explicitProject(message: string, candidates: readonly WorkingProjectCandidate[]): WorkingProjectCandidate | undefined {
  const normalized = normalizeTitle(message);
  const named = candidates
    .map((candidate) => ({ candidate, title: normalizeTitle(candidate.title) }))
    .filter((item) => item.title.length >= 1);

  // #674: exact > unique prefix > longest unique contains.
  const pickLongestUnique = (hits: typeof named) => {
    if (hits.length === 1) return hits[0]!.candidate;
    if (hits.length > 1) {
      hits.sort((a, b) => b.title.length - a.title.length);
      if (hits[0]!.title.length > hits[1]!.title.length) return hits[0]!.candidate;
    }
    return undefined;
  };

  const exact = named.filter((item) => titleExactInMessage(normalized, item.title));
  const exactPick = pickLongestUnique(exact);
  if (exact.length === 1 || exactPick) return exactPick;
  if (exact.length > 1) return undefined;

  const longEnough = named.filter((item) => item.title.length >= 2);
  const prefixes = longEnough.filter((item) => {
    for (let len = item.title.length - 1; len >= 2; len -= 1) {
      if (titleExactInMessage(normalized, item.title.slice(0, len))) return true;
    }
    return false;
  });
  const prefixPick = pickLongestUnique(prefixes);
  if (prefixes.length === 1 || prefixPick) return prefixPick;
  if (prefixes.length > 1) return undefined;

  const contains = longEnough.filter((item) => normalized.includes(item.title));
  return pickLongestUnique(contains);
}

function projectFromRecentResult(
  results: readonly AssistantActionResult[] | undefined,
  createdProjectOnly = false,
): string | undefined {
  if (!results?.length) return undefined;
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const result = results[i];
    if (result.verification?.status !== "verified") continue;
    if (result.type === "create_project") return result.projectId;
    if (createdProjectOnly) continue;
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
  continuation?: AssistantContinuationType;
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

  const explicitlyRecentCreatedProject = /(?:剛(?:才)?(?:建立|新增|開)(?:的)?專案|剛建立的專案|剛才那個專案|just[- ]created project)/iu.test(input.message);
  const recentProjectId = projectFromRecentResult(input.recentActionResults, explicitlyRecentCreatedProject);
  // An explicit recent-result referent is stronger than an older active goal:
  // "加入剛建立的專案" must not inherit a stale project from the previous
  // durable turn. Otherwise a visually successful import can bind the wrong
  // project while still passing a generic existence read-back.
  if (explicitlyRecentCreatedProject && recentProjectId) {
    const recent = input.candidates.find((candidate) => candidate.id === recentProjectId);
    if (recent) return { status: "resolved", projectId: recent.id, projectTitle: recent.title, source: "recent_result", candidates: [] };
  }

  // A NEW_GOAL gets a new scope. Only genuine continuation/correction/answer
  // turns are allowed to inherit the active goal's project.
  const activeProjectId = input.continuation === "NEW_GOAL" ? undefined : input.activeGoal?.frame.scope.projectId;
  if (activeProjectId) {
    const active = input.candidates.find((candidate) => candidate.id === activeProjectId);
    if (active) return { status: "resolved", projectId: active.id, projectTitle: active.title, source: "active_goal", candidates: [] };
  }

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
