/**
 * Structured Agent → UI handoff requests.
 *
 * When the Agent already knows the next user step (pick source, confirm, budget),
 * it must emit a typed InteractionRequest so the client can render cards/pickers
 * instead of free-text instructions that force manual tool hunting.
 */
import { z } from "zod";

export const ASSISTANT_INTERACTION_KINDS = [
  "SOURCE_PICKER",
  "FILE_PICKER",
  "FOLDER_PICKER",
  "DRIVE_PICKER",
  "PROJECT_PICKER",
  "ASSET_PICKER",
  "SCENE_PICKER",
  "SHOT_PICKER",
  "MODEL_PICKER",
  "CONFIRMATION_CARD",
  "PERMISSION_CARD",
  "BUDGET_CARD",
] as const;
export type AssistantInteractionKind = (typeof ASSISTANT_INTERACTION_KINDS)[number];

export const assistantInteractionOptionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).optional(),
  /** Client may auto-send this prompt on select (same-goal continuation). */
  prompt: z.string().trim().min(1).max(500).optional(),
  /** Opaque value for project/source ids; server re-validates on resume. */
  value: z.string().trim().min(1).max(500).optional(),
});
export type AssistantInteractionOption = z.infer<typeof assistantInteractionOptionSchema>;

export const assistantInteractionRequestSchema = z.object({
  kind: z.enum(ASSISTANT_INTERACTION_KINDS),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  options: z.array(assistantInteractionOptionSchema).max(20).default([]),
  /** When true, client should open the matching picker immediately (single path). */
  autoLaunch: z.boolean().default(false),
  /** Intake mode for FILE/FOLDER/DRIVE pickers. */
  intakeMode: z.enum(["drive", "files", "folder"]).optional(),
  projectId: z.string().uuid().optional(),
  projectTitle: z.string().trim().max(200).optional(),
  goalId: z.string().uuid().optional(),
});
export type AssistantInteractionRequest = z.infer<typeof assistantInteractionRequestSchema>;

export function sourcePickerInteraction(goalId?: string): AssistantInteractionRequest {
  return {
    kind: "SOURCE_PICKER",
    title: "請選擇資料來源",
    description: "你說的「雲端」需要確認是哪一種來源。",
    autoLaunch: false,
    goalId,
    options: [
      { id: "google_drive", label: "Google Drive", prompt: "是 Google Drive", value: "GOOGLE_DRIVE" },
      { id: "google_photos", label: "Google Photos", prompt: "是 Google Photos", value: "GOOGLE_PHOTOS" },
      { id: "project_assets", label: "Aios 素材", prompt: "是 Aios 目前專案素材", value: "PROJECT_ASSETS" },
      { id: "local_file", label: "手機檔案", prompt: "用本機檔案", value: "LOCAL_FILE" },
    ],
  };
}

export function projectPickerInteraction(
  candidates: readonly { id: string; title: string }[],
  goalId?: string,
): AssistantInteractionRequest {
  const options = candidates.slice(0, 8).map((candidate, index) => ({
    id: candidate.id,
    label: candidate.title,
    prompt: index === 0 ? "第一個" : index === 1 ? "第二個" : index === 2 ? "第三個" : candidate.title,
    value: candidate.id,
  }));
  return {
    kind: "PROJECT_PICKER",
    title: "請選擇目標專案",
    description: candidates.length ? `有 ${candidates.length} 個可用專案` : "目前沒有可用專案",
    autoLaunch: false,
    goalId,
    options,
  };
}

export function intakePickerInteraction(input: {
  mode: "drive" | "files" | "folder";
  projectId: string;
  projectTitle: string;
  message: string;
  goalId?: string;
}): AssistantInteractionRequest {
  const kind = input.mode === "drive" ? "DRIVE_PICKER" : input.mode === "folder" ? "FOLDER_PICKER" : "FILE_PICKER";
  return {
    kind,
    title: input.mode === "drive" ? "選擇 Google Drive 檔案" : input.mode === "folder" ? "選擇資料夾" : "選擇檔案",
    description: input.message,
    autoLaunch: true,
    intakeMode: input.mode,
    projectId: input.projectId,
    projectTitle: input.projectTitle,
    goalId: input.goalId,
    options: [],
  };
}
