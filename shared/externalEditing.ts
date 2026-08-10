import { z } from "zod";

export const EDITING_BRIDGE_MANIFEST_VERSION = "1.0" as const;
export const EDITING_PACKAGE_TTL_HOURS = 24;

export const editingEditorIdSchema = z.enum(["lumafusion"]);
export type EditingEditorId = z.infer<typeof editingEditorIdSchema>;

export const editingSelectionTypeSchema = z.enum(["project", "story_scene", "shots", "shot"]);
export type EditingSelectionType = z.infer<typeof editingSelectionTypeSchema>;

export const editingSessionStatusSchema = z.enum([
  "preparing",
  "ready",
  "handed_off",
  "returning",
  "returned",
  "needs_review",
  "completed",
  "cancelled",
  "failed",
]);
export type EditingSessionStatus = z.infer<typeof editingSessionStatusSchema>;

export const editingHandoffModeSchema = z.enum(["share", "download", "files", "desktop_folder"]);
export type EditingHandoffMode = z.infer<typeof editingHandoffModeSchema>;

export const editingAssetRoleSchema = z.enum([
  "PRIMARY_MEDIA",
  "PRIMARY_VIDEO",
  "ALT_VIDEO",
  "VOICEOVER",
  "DIALOGUE",
  "MUSIC",
  "SFX",
  "AMBIENCE",
  "SUBTITLE",
  "CHARACTER_REFERENCE",
  "LOCATION_REFERENCE",
  "VISUAL_REFERENCE",
  "EDITED_MASTER",
]);
export type EditingAssetRole = z.infer<typeof editingAssetRoleSchema>;

export const editingManifestAssetSchema = z.object({
  assetId: z.string().uuid(),
  fileName: z.string().min(1).max(240),
  relativePath: z.string().min(1).max(320),
  kind: z.enum(["image", "video", "audio", "doc", "other"]),
  role: editingAssetRoleSchema,
  mime: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable(),
  projectId: z.string().uuid(),
  storySceneId: z.string().uuid().nullable(),
  sceneId: z.string().uuid().nullable(),
  shotId: z.string().uuid().nullable(),
  sourceAssetId: z.string().uuid().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  version: z.string().nullable(),
  subtitle: z.object({
    sourceAssetId: z.string().uuid(),
    language: z.string().nullable(),
    timingSource: z.string().nullable(),
  }).nullable(),
  locked: z.boolean().default(false),
});
export type EditingManifestAsset = z.infer<typeof editingManifestAssetSchema>;

export const editingManifestSchema = z.object({
  schema: z.literal("aios.external-editing-manifest"),
  schemaVersion: z.literal(EDITING_BRIDGE_MANIFEST_VERSION),
  version: z.literal(EDITING_BRIDGE_MANIFEST_VERSION),
  createdAt: z.string().datetime(),
  editor: z.object({ id: editingEditorIdSchema, name: z.string().min(1) }),
  editingSessionId: z.string().uuid(),
  project: z.object({
    id: z.string().uuid(),
    title: z.string(),
    aspectRatio: z.string().nullable(),
    frameRate: z.number().positive().nullable(),
    timelineDurationMs: z.number().int().nonnegative().nullable(),
  }),
  selection: z.object({
    type: editingSelectionTypeSchema,
    storySceneIds: z.array(z.string().uuid()),
    shotIds: z.array(z.string().uuid()),
  }),
  assets: z.array(editingManifestAssetSchema),
  return: z.object({
    method: z.literal("universal-intake"),
    editingSessionId: z.string().uuid(),
    acceptedKinds: z.array(z.enum(["video", "audio", "image", "doc"])),
  }),
  notes: z.array(z.string()).default([]),
});
export type EditingManifest = z.infer<typeof editingManifestSchema>;

export interface EditorAdapterContract {
  id: EditingEditorId;
  name: string;
  platforms: readonly ("ios" | "ipados" | "android" | "chromeos" | "macos")[];
  verifiedDocumentation: readonly string[];
  capabilities: {
    webShare: boolean;
    fileImport: boolean;
    externalDrive: boolean;
    projectPackageImport: boolean;
    publicDeepLink: boolean;
    publicProjectWriterApi: boolean;
    supportsDirectOpen: boolean;
    supportsShare: boolean;
    supportsFolderHandoff: boolean;
    supportsReturnShare: boolean;
    supportsDeepLink: boolean;
  };
  handoffModes: readonly EditingHandoffMode[];
  returnModes: readonly ["universal-intake"];
  guidance: readonly string[];
}

/**
 * Only documented LumaFusion behavior is represented here. In particular,
 * Aios does not claim a URL scheme, timeline writer, or project creation API.
 */
export const LUMAFUSION_ADAPTER: EditorAdapterContract = {
  id: "lumafusion",
  name: "LumaFusion",
  platforms: ["ios", "ipados", "android", "chromeos", "macos"],
  verifiedDocumentation: [
    "https://luma-touch.com/luma-fusion-for-ios/",
    "https://luma-touch.com/lumafusion-for-android/",
    "https://luma-touch.com/lumafusion-for-educators/",
    "https://luma-touch.com/tutorials/",
  ],
  capabilities: {
    webShare: true,
    fileImport: true,
    externalDrive: true,
    projectPackageImport: false,
    publicDeepLink: false,
    publicProjectWriterApi: false,
    supportsDirectOpen: false,
    supportsShare: true,
    supportsFolderHandoff: true,
    supportsReturnShare: true,
    supportsDeepLink: false,
  },
  handoffModes: ["share", "download", "files", "desktop_folder"],
  returnModes: ["universal-intake"],
  guidance: [
    "在 iPhone 或 iPad 使用分享選單，將交接 ZIP 儲存到 Files，再由 LumaFusion 匯入需要的媒體。",
    "在 Android 或 Chromebook 下載 ZIP、解壓縮後，從裝置或雲端儲存空間加入媒體。",
    "在 Apple Silicon Mac 將交接包解壓縮到本機資料夾，再從 LumaFusion 的媒體庫加入素材。",
    "Aios 會保存交接工作階段；剪輯完成後請回到同一張工作階段卡上傳成片。",
  ],
};

export function stableEditingFileName(input: {
  index: number;
  role: EditingAssetRole;
  title: string;
  extension?: string | null;
}): string {
  const ext = (input.extension ?? "").replace(/^\./, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const titleWithoutDuplicateExtension = ext
    ? input.title.replace(new RegExp(`\\.${ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), "")
    : input.title;
  const safeTitle = titleWithoutDuplicateExtension
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 80) || "asset";
  return `${String(input.index + 1).padStart(3, "0")}_${input.role}_${safeTitle}${ext ? `.${ext}` : ""}`;
}

export function editingPackageFileName(projectTitle: string, sessionId: string): string {
  const safe = projectTitle.normalize("NFKC").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "project";
  return `Aios_${safe}_LumaFusion_${sessionId.slice(0, 8)}.zip`;
}
