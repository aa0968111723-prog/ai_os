import { pointsToTwd } from "../../shared/money";
import type { ModelEntry } from "../../shared/models";
import { WHITEBOARD_IMAGE_MODES, type WhiteboardImageMode } from "../../shared/whiteboardImage";
import { estimatePointsFor } from "./modelResolve";
import {
  modelHealthStatus,
  selectAiGenerationModel,
  type AiModelDecision,
} from "./aiModelPolicy";

export const WHITEBOARD_COMPOSITION_GUIDANCE = [
  "Treat the attached whiteboard sketch as a composition and layout reference, not as a casual doodle.",
  "Preserve the relative subject positions, camera framing, horizon/vanishing direction, action flow, negative space, and major shape relationships from the sketch.",
  "Replace sketch lines, arrows, annotations, and rough marks with a formal, high-detail finished storyboard/project image.",
  "Deliver a coherent cinematic frame with intentional camera, lighting, materials, anatomy, environment, and production-ready detail.",
  "Do not show the whiteboard, construction lines, UI, labels, or readable text unless the user explicitly requests them.",
].join(" ");

const MODE_CONFIG: Record<WhiteboardImageMode, {
  preference: "speed" | "quality";
  minimumTier?: "flagship";
  requireHealthy?: boolean;
}> = {
  fast: { preference: "speed" },
  quality: { preference: "quality" },
  ultra: { preference: "quality", minimumTier: "flagship", requireHealthy: true },
};

// Keep the shared resolver in charge, but exclude restoration/upscaling endpoints
// that cannot turn a composition sketch into a finished storyboard frame.
const WHITEBOARD_CREATIVE_EDIT_MODELS = new Set([
  "fal-ai/nano-banana-2/edit",
  "fal-ai/flux-2/pro/edit",
  "fal-ai/bytedance/seedream/v4.5/edit",
  "fal-ai/flux-pro/kontext/max",
  "fal-ai/nano-banana-pro/edit",
  "fal-ai/flux-kontext/dev",
  "fal-ai/flux-pro/kontext",
  "fal-ai/qwen-image-edit",
  "fal-ai/qwen-image-edit-plus",
  "fal-ai/flux/dev/image-to-image",
]);

export interface WhiteboardImageDecision {
  mode: WhiteboardImageMode;
  model: ModelEntry;
  selection: AiModelDecision;
  estimatedPoints: number;
  estimatedTwd: number;
  health: string;
  noSilentDowngrade: boolean;
}

export function selectWhiteboardImageModel(mode: WhiteboardImageMode): WhiteboardImageDecision {
  const config = MODE_CONFIG[mode];
  const selection = selectAiGenerationModel({
    category: "image-to-image",
    sourceKind: "image",
    preference: config.preference,
    requireVerified: true,
    minimumTier: config.minimumTier,
    requireHealthy: config.requireHealthy,
    allowedModelIds: WHITEBOARD_CREATIVE_EDIT_MODELS,
  });
  const estimatedPoints = estimatePointsFor(selection.model);
  return {
    mode,
    model: selection.model,
    selection,
    estimatedPoints,
    estimatedTwd: pointsToTwd(estimatedPoints),
    health: modelHealthStatus(selection.model, "image"),
    noSilentDowngrade: mode === "ultra",
  };
}

export function whiteboardImageModeInfo(mode: WhiteboardImageMode) {
  return WHITEBOARD_IMAGE_MODES.find((item) => item.id === mode)!;
}
