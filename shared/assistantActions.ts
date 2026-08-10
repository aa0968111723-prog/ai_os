/**
 * Command Center contracts shared by the assistant, tools and UI.
 *
 * Results are deliberately small, typed references. They are safe to keep for
 * a few turns and let phrases such as "這些資料" resolve without copying the
 * imported content (or file bytes) back into the model context.
 */

export type AssistantSurface = "global" | "project" | "group_campaign";

export interface AssistantReturnContext {
  assistantSurface: AssistantSurface;
  conversationId: string;
  runId?: string;
  originRoute: string;
  originScrollY?: number;
  focusAnchor?: string;
  projectId?: string;
  groupId?: string;
}

export interface AssistantVerification {
  status: "verified" | "unverified";
  message: string;
}

export interface ImportActionResult {
  type: "import";
  source: "url" | "file" | "google-drive" | "folder" | "external-result";
  resourceIds: string[];
  assetIds: string[];
  intelligenceIds: string[];
  processingBatchId?: string;
  folderImportSessionId?: string;
  projectId?: string;
  sceneId?: string;
  shotId?: string;
  count: number;
  duplicateCount: number;
  needsReviewCount: number;
  backgroundProcessing: boolean;
  verification: AssistantVerification;
}

export interface CreateProjectActionResult {
  type: "create_project";
  projectId: string;
  title: string;
  verification: AssistantVerification;
}

export interface CreateTaskActionResult {
  type: "create_task";
  taskIds: string[];
  count: number;
  projectId: string;
  verification: AssistantVerification;
}

export interface GenerationActionResult {
  type: "generation";
  generationIds: string[];
  projectId: string;
  sceneIds?: string[];
  verification: AssistantVerification;
}

export interface EditingHandoffActionResult {
  type: "editing_handoff";
  editingSessionId: string;
  projectId: string;
  editorId: "lumafusion";
  assetIds: string[];
  verification: AssistantVerification;
}

export type AssistantActionResult =
  | ImportActionResult
  | CreateProjectActionResult
  | CreateTaskActionResult
  | GenerationActionResult
  | EditingHandoffActionResult;

/** Keep the reference window bounded; this is a pronoun resolver, not memory. */
export const MAX_RECENT_ACTION_RESULTS = 5;
export const MAX_RECENT_RESULT_IDS = 50;

export function boundAssistantActionResults(
  results: readonly AssistantActionResult[],
): AssistantActionResult[] {
  return results.slice(-MAX_RECENT_ACTION_RESULTS).map((result) => {
    if (result.type === "import") {
      return {
        ...result,
        resourceIds: result.resourceIds.slice(0, MAX_RECENT_RESULT_IDS),
        assetIds: result.assetIds.slice(0, MAX_RECENT_RESULT_IDS),
        intelligenceIds: result.intelligenceIds.slice(0, MAX_RECENT_RESULT_IDS),
      };
    }
    if (result.type === "create_task") {
      return { ...result, taskIds: result.taskIds.slice(0, MAX_RECENT_RESULT_IDS) };
    }
    if (result.type === "generation") {
      return {
        ...result,
        generationIds: result.generationIds.slice(0, MAX_RECENT_RESULT_IDS),
        sceneIds: result.sceneIds?.slice(0, MAX_RECENT_RESULT_IDS),
      };
    }
    if (result.type === "editing_handoff") {
      return { ...result, assetIds: result.assetIds.slice(0, MAX_RECENT_RESULT_IDS) };
    }
    return result;
  });
}

export function formatRecentActionResults(results: readonly AssistantActionResult[]): string {
  const bounded = boundAssistantActionResults(results);
  if (!bounded.length) return "";
  const lines = bounded.map((result, index) => {
    if (result.type === "import") {
      return `${index + 1}. import：project=${result.projectId ?? "none"}；resourceIds=${result.resourceIds.join(",") || "none"}；assetIds=${result.assetIds.join(",") || "none"}；batch=${result.processingBatchId ?? result.folderImportSessionId ?? "none"}；count=${result.count}`;
    }
    if (result.type === "create_project") {
      return `${index + 1}. create_project：projectId=${result.projectId}；title=${result.title}`;
    }
    if (result.type === "create_task") {
      return `${index + 1}. create_task：projectId=${result.projectId}；taskIds=${result.taskIds.join(",")}`;
    }
    if (result.type === "editing_handoff") {
      return `${index + 1}. editing_handoff：projectId=${result.projectId}；editingSessionId=${result.editingSessionId}；editor=${result.editorId}；assetIds=${result.assetIds.join(",") || "none"}`;
    }
    return `${index + 1}. generation：projectId=${result.projectId}；generationIds=${result.generationIds.join(",")}`;
  });
  return [
    "<最近動作結果>",
    ...lines,
    "『這些資料／剛才那些』優先指最近的 import；『剛建立的專案』優先指最近的 create_project。這些 id 只是工具參照，不得直接顯示給使用者。",
    "</最近動作結果>",
  ].join("\n");
}
