import { z } from "zod";

/**
 * Typed boundary between an Assistant run and a client-side picker/card.
 *
 * The request is durable workflow state, not authorization. Every id returned
 * by the client is reloaded under the actor's ACL before a run may resume.
 */
export const ASSISTANT_INTERACTION_TYPES = [
  "SOURCE_PICKER",
  "FILE_PICKER",
  "FOLDER_PICKER",
  "DRIVE_PICKER",
  "PHOTOS_PICKER",
  "PROJECT_PICKER",
  "ASSET_PICKER",
  "SCENE_PICKER",
  "SHOT_PICKER",
  "MODEL_PICKER",
  "CONFIRMATION_CARD",
  "PERMISSION_CARD",
  "BUDGET_CARD",
  "HUMAN_INPUT_FORM",
] as const;

export const assistantInteractionTypeSchema = z.enum(ASSISTANT_INTERACTION_TYPES);
export type AssistantInteractionType = z.infer<typeof assistantInteractionTypeSchema>;

export const assistantInteractionOptionSchema = z.object({
  id: z.string().min(1).max(500),
  label: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  icon: z.string().max(80).optional(),
  availability: z.enum(["AVAILABLE", "DEGRADED", "BLOCKED"]).default("AVAILABLE"),
  blockerReason: z.string().max(500).optional(),
});
export type AssistantInteractionOption = z.infer<typeof assistantInteractionOptionSchema>;

export const assistantInteractionRequestSchema = z.object({
  interactionId: z.string().uuid(),
  runId: z.string().min(1).max(200),
  goalId: z.string().uuid(),
  type: assistantInteractionTypeSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(1_000).optional(),
  required: z.boolean(),
  options: z.array(assistantInteractionOptionSchema).max(100).optional(),
  capabilityId: z.string().max(120).optional(),
  missingSlot: z.string().max(80).optional(),
  /** One-time bearer bound to conversation + run + goal + interaction. */
  resumeToken: z.string().uuid(),
  expiresAt: z.string().datetime(),
  targetProjectId: z.string().uuid().optional(),
  expectedResultType: z.enum(["selection", "import", "confirmation"]).default("selection"),
  status: z.enum(["pending", "consumed", "cancelled", "expired"]).default("pending"),
  createdAt: z.string().datetime(),
});
export type AssistantInteractionRequest = z.infer<typeof assistantInteractionRequestSchema>;

export const assistantInteractionImportResultSchema = z.object({
  source: z.enum(["file", "url", "google-drive", "folder"]),
  projectId: z.string().uuid(),
  assetIds: z.array(z.string().uuid()).max(50),
  resourceIds: z.array(z.string().uuid()).max(50),
  intelligenceIds: z.array(z.string().uuid()).max(50),
  count: z.number().int().min(0).max(10_000),
  folderImportSessionId: z.string().uuid().optional(),
});
export type AssistantInteractionImportResult = z.infer<typeof assistantInteractionImportResultSchema>;

export const assistantInteractionSubmissionSchema = z.object({
  groupId: z.string().uuid(),
  conversationId: z.string().uuid(),
  runId: z.string().min(1).max(200),
  goalId: z.string().uuid(),
  interactionId: z.string().uuid(),
  resumeToken: z.string().uuid(),
  selectedIds: z.array(z.string().min(1).max(500)).max(50).optional(),
  importResult: assistantInteractionImportResultSchema.optional(),
}).refine((value) => !!value.importResult || !!value.selectedIds?.length, {
  message: "Interaction submission requires a selection or verified import references",
});
export type AssistantInteractionSubmission = z.infer<typeof assistantInteractionSubmissionSchema>;

export const assistantInteractionLifecycleSchema = z.object({
  groupId: z.string().uuid(),
  conversationId: z.string().uuid(),
  runId: z.string().min(1).max(200),
  goalId: z.string().uuid(),
  interactionId: z.string().uuid(),
  resumeToken: z.string().uuid(),
  event: z.enum(["presented", "opened", "cancelled"]),
});
export type AssistantInteractionLifecycle = z.infer<typeof assistantInteractionLifecycleSchema>;

export function interactionPickerMode(type: AssistantInteractionType): "files" | "folder" | "drive" | undefined {
  if (type === "FILE_PICKER") return "files";
  if (type === "FOLDER_PICKER") return "folder";
  if (type === "DRIVE_PICKER") return "drive";
  return undefined;
}

export function interactionIsWaiting(
  request: AssistantInteractionRequest | null | undefined,
  now = Date.now(),
): boolean {
  return request?.status === "pending" && !isAssistantInteractionExpired(request, now);
}

export function isAssistantInteractionExpired(
  request: Pick<AssistantInteractionRequest, "expiresAt" | "status"> | null | undefined,
  now = Date.now(),
): boolean {
  if (!request) return false;
  if (request.status === "expired") return true;
  const expiresAt = Date.parse(request.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

/** Mark a pending handoff expired without touching consumed/cancelled rows. */
export function expireAssistantInteraction(
  request: AssistantInteractionRequest,
  now = Date.now(),
): AssistantInteractionRequest {
  if (request.status !== "pending" || !isAssistantInteractionExpired(request, now)) return request;
  return { ...request, status: "expired" };
}
