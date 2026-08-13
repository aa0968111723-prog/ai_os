import type { VisualChoicePreset } from "@shared/visualChoiceTypes";

export type CreativeStateFamily =
  | "character"
  | "look"
  | "action"
  | "expression"
  | "scene"
  | "lighting"
  | "camera"
  | "style";

export interface CreativeStateItem {
  family: CreativeStateFamily;
  label: string;
  value: string;
  empty: boolean;
}

export interface CreativeStateShot {
  characterIds?: string[] | null;
  lookIds?: string[] | null;
  scenePresetIds?: string[] | null;
  action?: string | null;
  camera?: Record<string, string | undefined> | null;
  performance?: Record<string, string | undefined> | null;
}

function names(ids: readonly string[] | null | undefined, lookup: ReadonlyMap<string, string>): string {
  return (ids ?? []).map((id) => lookup.get(id)).filter((value): value is string => !!value).join("、");
}

export function buildCreativeState(input: {
  shot: CreativeStateShot;
  characterNames: ReadonlyMap<string, string>;
  lookNames: ReadonlyMap<string, string>;
  sceneNames: ReadonlyMap<string, string>;
  projectStyle?: string | null;
}): CreativeStateItem[] {
  const { shot } = input;
  const camera = shot.camera ?? {};
  const values: Array<[CreativeStateFamily, string, string]> = [
    ["character", "角色", names(shot.characterIds, input.characterNames)],
    ["look", "Look", names(shot.lookIds, input.lookNames)],
    ["action", "動作", shot.action?.trim() ?? ""],
    ["expression", "表情", shot.performance?.emotion?.trim() ?? ""],
    ["scene", "Scene", names(shot.scenePresetIds, input.sceneNames)],
    ["lighting", "Lighting", camera.lighting?.trim() ?? ""],
    ["camera", "Camera", [camera.shotSize, camera.angle, camera.composition].filter(Boolean).join("・")],
    ["style", "Style", input.projectStyle?.trim() ?? ""],
  ];
  return values.map(([family, label, value]) => ({ family, label, value: value || "尚未設定", empty: !value }));
}

export function presetMatchesShot(
  preset: VisualChoicePreset,
  shot: CreativeStateShot,
  projectStyle?: string | null,
): boolean {
  if (preset.family === "style") return preset.label === projectStyle || preset.structured.styleHint === projectStyle;
  if (preset.structured.action !== undefined && shot.action !== preset.structured.action) return false;
  if (preset.structured.camera) {
    for (const [key, value] of Object.entries(preset.structured.camera)) {
      if (shot.camera?.[key] !== value) return false;
    }
  }
  if (preset.structured.performance) {
    for (const [key, value] of Object.entries(preset.structured.performance)) {
      if (shot.performance?.[key] !== value) return false;
    }
  }
  return !!(preset.structured.action !== undefined || preset.structured.camera || preset.structured.performance);
}

/** Freeze belongs to one operation only: copy ids at Apply, never into UI state. */
export function snapshotOperationTargets(selectedIds: readonly string[]): string[] {
  return [...new Set(selectedIds)];
}

export function summarizeTargetImpact(
  shots: ReadonlyArray<{ id: string; assetId?: string | null; reviewStatus?: string | null }>,
  targetIds: readonly string[],
) {
  const target = new Set(targetIds);
  const rows = shots.filter((shot) => target.has(shot.id));
  return {
    total: rows.length,
    draft: rows.filter((shot) => !shot.assetId && shot.reviewStatus !== "approved").length,
    withVisual: rows.filter((shot) => !!shot.assetId && shot.reviewStatus !== "approved").length,
    approved: rows.filter((shot) => shot.reviewStatus === "approved").length,
  };
}
