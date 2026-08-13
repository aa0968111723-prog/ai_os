import type { VisualChoiceFamily, VisualChoicePreview } from "./visualChoiceTypes";

const CAMERA_MOTIF: Record<string, Extract<VisualChoicePreview, { kind: "composition" }>['motif']> = {
  "camera.wide": "wide",
  "camera.full": "full",
  "camera.medium": "medium",
  "camera.close": "close",
  "camera.extreme_close": "extreme-close",
  "camera.low_angle": "low-angle",
  "camera.high_angle": "high-angle",
  "camera.eye_level": "eye-level",
  "camera.over_shoulder": "over-shoulder",
  "camera.slow_push": "push-in",
  "camera.static": "static",
};

const LIGHTING_PALETTE: Record<string, readonly [string, string, ...string[]]> = {
  "lighting.morning_soft": ["#f7d7a1", "#fff4dd", "#a8c9d8"],
  "lighting.daylight": ["#8ecdf4", "#f6e9ad", "#d9f1ff"],
  "lighting.overcast": ["#788695", "#c9d0d5", "#eef1f2"],
  "lighting.golden_hour": ["#7d3950", "#ed8738", "#ffd37a"],
  "lighting.blue_hour": ["#172b4d", "#405a84", "#9aa8c7"],
  "lighting.night": ["#090d1d", "#1b2854", "#8da2d8"],
  "lighting.rainy": ["#233449", "#5e768b", "#c7d7df"],
  "lighting.warm_indoor": ["#5a2d26", "#b85d3f", "#f0c184"],
  "lighting.cool_indoor": ["#203b55", "#4a7895", "#c4e4ea"],
  "lighting.foggy": ["#87989b", "#c6d0ce", "#eef0e9"],
};

const STYLE_PALETTE: Record<string, readonly [string, string, ...string[]]> = {
  "style.healing_picturebook": ["#df8f84", "#f3d8a8", "#91b7a4"],
  "style.cinematic_anime": ["#18213d", "#5676a5", "#ec8b62"],
  "style.soft_watercolor": ["#b6c9e2", "#e9b8bd", "#f2e4c6"],
  "style.graphic_manga": ["#171717", "#f7f4ec", "#c64545"],
  "style.realistic_film": ["#272b2b", "#7a796c", "#c2a873"],
  "style.rough_storyboard": ["#2d3440", "#aeb5bd", "#f5f2e9"],
  "style.dreamy_softfocus": ["#8f8db8", "#d9b8d0", "#f3d8cf"],
  "style.high_contrast": ["#090909", "#626262", "#f5f0dd"],
};

const ACTION_ENERGY: Record<string, "still" | "gentle" | "dynamic"> = {
  "action.standing": "still",
  "action.walking": "gentle",
  "action.running": "dynamic",
  "action.looking_back": "gentle",
  "action.pointing": "dynamic",
  "action.sitting": "still",
  "action.reaching": "gentle",
  "action.thinking": "still",
  "action.reacting": "dynamic",
  "action.crouching": "gentle",
};

/**
 * Starter preview manifest. Replace any entry with an image resource later;
 * preset ids and React rendering stay unchanged.
 */
export function starterPreviewFor(input: {
  id: string;
  family: VisualChoiceFamily;
  label: string;
  description?: string;
  fallbackIcon?: string;
}): VisualChoicePreview {
  const alt = input.description ? `${input.label}：${input.description}` : input.label;
  const camera = CAMERA_MOTIF[input.id];
  if (camera) return { kind: "composition", motif: camera, alt };
  const lighting = LIGHTING_PALETTE[input.id];
  if (lighting) return { kind: "swatch", colors: lighting, alt };
  const style = STYLE_PALETTE[input.id];
  if (style) return { kind: "swatch", colors: style, alt };
  if (input.family === "action") {
    return { kind: "pose", motif: input.id.replace("action.", ""), energy: ACTION_ENERGY[input.id] ?? "gentle", alt };
  }
  if (input.family === "expression") {
    return { kind: "expression", motif: input.id.replace("expression.", ""), alt };
  }
  return { kind: "fallback", icon: input.fallbackIcon ?? "•", alt };
}
