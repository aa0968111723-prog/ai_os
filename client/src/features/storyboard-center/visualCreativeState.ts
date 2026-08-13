import type { VisualChoicePreset } from "@shared/visualChoiceTypes";

export type CreativeStateFamily =
  | "character"
  | "look"
  | "action"
  | "expression"
  | "scene"
  | "prop"
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
  propIds?: string[] | null;
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
  propNames?: ReadonlyMap<string, string>;
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
    ["prop", "Prop", names(shot.propIds, input.propNames ?? new Map())],
    ["lighting", "Lighting", camera.lighting?.trim() ?? ""],
    ["camera", "Camera", [camera.shotSize, camera.angle, camera.composition].filter(Boolean).join("・")],
    ["style", "Style", input.projectStyle?.trim() ?? ""],
  ];
  return values.map(([family, label, value]) => ({ family, label, value: value || "尚未設定", empty: !value }));
}

export interface MixedCreativeStateItem extends CreativeStateItem {
  mode: "uniform" | "mixed";
  distribution: Array<{ value: string; count: number }>;
  detail: string;
}

/** Derived only from current Shot/project truth; no mixed-state persistence. */
export function buildMixedCreativeState(input: {
  shots: readonly CreativeStateShot[];
  characterNames: ReadonlyMap<string, string>;
  lookNames: ReadonlyMap<string, string>;
  sceneNames: ReadonlyMap<string, string>;
  propNames?: ReadonlyMap<string, string>;
  projectStyle?: string | null;
}): MixedCreativeStateItem[] {
  if (input.shots.length === 0) return [];
  const rows = input.shots.map((shot) => buildCreativeState({ ...input, shot }));
  return rows[0]!.map((seed, index) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const raw = row[index]!.value;
      // Entity arrays are sets; order differences are not a creative difference.
      const value = ["character", "look", "scene", "prop"].includes(seed.family)
        ? raw.split("、").sort((a, b) => a.localeCompare(b, "zh-Hant")).join("、")
        : raw;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const distribution = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh-Hant"));
    const mixed = distribution.length > 1;
    return {
      ...seed,
      value: mixed ? "MIXED" : distribution[0]!.value,
      empty: distribution.length === 1 && distribution[0]!.value === "尚未設定",
      mode: mixed ? "mixed" : "uniform",
      distribution,
      detail: distribution.map((item) => `${item.value} ×${item.count}`).join("・"),
    };
  });
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
