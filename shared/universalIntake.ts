import { z } from "zod";

export const INTAKE_SOURCES = [
  "upload", "drag-drop", "clipboard", "url", "google-drive", "desktop-watch",
  "mobile-share", "browser-extension", "external-ai", "internal-generation",
  "external-editor",
] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];

export type PublicUrlIntakeCapability =
  | { kind: "direct"; provider: "public-url" }
  | {
      kind: "requires-transfer";
      provider: "google-photos";
      reason: string;
      alternatives: readonly ["files", "google-drive", "download-upload"];
    };

/**
 * A share page is not the same thing as a downloadable media URL.  Google
 * Photos share pages require browser/session interaction and must never be
 * persisted as if the original photos had been imported.
 */
export function publicUrlIntakeCapability(rawUrl: string): PublicUrlIntakeCapability {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: "direct", provider: "public-url" };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "photos.app.goo.gl" || host === "photos.google.com") {
    return {
      kind: "requires-transfer",
      provider: "google-photos",
      reason: "Google Photos 分享頁不是原始媒體下載連結，目前的正式 Intake 無法直接取得其中的照片或影片。",
      alternatives: ["files", "google-drive", "download-upload"],
    };
  }
  return { kind: "direct", provider: "public-url" };
}

export const intakePageContextSchema = z.object({
  currentProjectId: z.string().uuid().optional(),
  currentStoryboardId: z.string().uuid().optional(),
  currentSceneId: z.string().uuid().optional(),
  currentCharacterId: z.string().uuid().optional(),
  currentLocation: z.string().trim().max(200).optional(),
  currentWorkspace: z.string().trim().max(120).optional(),
}).strict();
export type IntakePageContext = z.infer<typeof intakePageContextSchema>;

export const deterministicMediaMetadataSchema = z.object({
  width: z.number().int().positive().max(100_000).optional(),
  height: z.number().int().positive().max(100_000).optional(),
  duration: z.number().nonnegative().max(86_400).optional(),
  fps: z.number().positive().max(1_000).optional(),
  hasAudio: z.boolean().optional(),
  createdAt: z.string().datetime().optional(),
}).strict();
export type DeterministicMediaMetadata = z.infer<typeof deterministicMediaMetadataSchema>;

export interface SceneMatchCandidate {
  id: string;
  title: string;
  orderIndex: number;
  prompt?: string | null;
  action?: string | null;
  dialogue?: string | null;
  voiceover?: string | null;
}

export interface RankedSceneMatch {
  sceneId: string;
  score: number;
  reasons: string[];
}

/** Conservative tokenisation for filenames and Chinese/Latin storyboard text. */
export function intakeTokens(value: string): string[] {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[\-_./\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
  const words = normalized.split(/\s+/).filter((token) => token.length >= 2);
  const cjk = [...normalized.matchAll(/[\p{Script=Han}]{2,}/gu)]
    .flatMap((match) => {
      const text = match[0];
      const pairs: string[] = [];
      for (let i = 0; i < text.length - 1; i += 1) pairs.push(text.slice(i, i + 2));
      return pairs;
    });
  return [...new Set([...words, ...cjk])].slice(0, 100);
}

/**
 * Explainable, deterministic first-pass matching.  Explicit page/session context
 * outranks lexical evidence.  It only returns suggestions; confirmation is a
 * separate mutation and this function never writes storyboard data.
 */
export function rankSceneMatches(input: {
  scenes: readonly SceneMatchCandidate[];
  filename?: string;
  analysisText?: string;
  contextSceneId?: string;
  sessionSceneId?: string;
  limit?: number;
}): RankedSceneMatch[] {
  const queryTokens = intakeTokens(`${input.filename ?? ""} ${input.analysisText ?? ""}`);
  return input.scenes
    .map((scene) => {
      const reasons: string[] = [];
      let score = 0;
      if (scene.id === input.sessionSceneId) {
        score = 0.995;
        reasons.push("外部生成工作階段指定此分鏡");
      } else if (scene.id === input.contextSceneId) {
        score = 0.98;
        reasons.push("素材從此分鏡帶入");
      }
      const sceneTokens = new Set(intakeTokens([
        scene.title, scene.prompt, scene.action, scene.dialogue, scene.voiceover,
      ].filter(Boolean).join(" ")));
      const overlap = queryTokens.filter((token) => sceneTokens.has(token));
      if (overlap.length) {
        const lexical = Math.min(0.82, 0.28 + overlap.length * 0.12);
        if (lexical > score) score = lexical;
        reasons.push(`名稱／內容對上：${overlap.slice(0, 4).join("、")}`);
      }
      return { sceneId: scene.id, score, reasons };
    })
    .filter((candidate) => candidate.score >= 0.28)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 3);
}

export function aspectRatioOf(width?: number, height?: number): number | undefined {
  if (!width || !height) return undefined;
  return Math.round((width / height) * 10_000) / 10_000;
}

export function shouldBlockDuplicate(input: { duplicateAssetId?: string | null; forceDuplicate?: boolean }): boolean {
  return Boolean(input.duplicateAssetId && !input.forceDuplicate);
}
