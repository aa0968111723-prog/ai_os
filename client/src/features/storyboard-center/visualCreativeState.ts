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
  /**
   * 比對用的結構化鍵（**不是**給人看的字串）。
   *
   * 為什麼不能拿 value 當鍵：value 是「把 id 換成名字後的顯示字串」，會在兩種情況說謊——
   *  1. 卡片剛被刪掉、或那一頁卡片還沒載完 → 該 id 查不到名字被丟掉，
   *     於是「角色 A＋已刪的 B」和「只有角色 A」projection 完全相同，
   *     兩個真的不一樣的鏡會被算成 uniform，使用者以為統一了其實沒有。
   *  2. 兩張不同的卡剛好同名（「路人」×2）→ 兩個不同綁定被折成同一個值。
   * 鍵一律用排序後的 id 清單，顯示才用名字。
   */
  key: string;
  /** 有綁定但查不到名字的 id 數（載入中／已刪除／權限外）——UI 據此不要謊稱「尚未設定」 */
  unresolved: number;
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

/** 實體列：顯示用名字（查不到就明說），比對用排序後的 id */
function entityCell(
  ids: readonly string[] | null | undefined,
  lookup: ReadonlyMap<string, string>,
): { value: string; key: string; unresolved: number } {
  const list = [...new Set(ids ?? [])];
  const resolved = list.map((id) => lookup.get(id)).filter((value): value is string => !!value);
  const unresolved = list.length - resolved.length;
  const parts = [...resolved];
  // 查不到名字的仍要現身，否則「A＋已刪的 B」看起來會等於「只有 A」
  if (unresolved > 0) parts.push(unresolved === list.length ? "讀取中或已刪除" : `＋${unresolved} 個讀取中或已刪除`);
  return {
    value: parts.join("、"),
    key: list.slice().sort().join("|"),
    unresolved,
  };
}

/** 純文字列：顯示與比對是同一個值 */
function textCell(text: string): { value: string; key: string; unresolved: number } {
  return { value: text, key: text, unresolved: 0 };
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
  const values: Array<[CreativeStateFamily, string, ReturnType<typeof textCell>]> = [
    ["character", "角色", entityCell(shot.characterIds, input.characterNames)],
    ["look", "Look", entityCell(shot.lookIds, input.lookNames)],
    ["action", "動作", textCell(shot.action?.trim() ?? "")],
    ["expression", "表情", textCell(shot.performance?.emotion?.trim() ?? "")],
    ["scene", "Scene", entityCell(shot.scenePresetIds, input.sceneNames)],
    ["prop", "Prop", entityCell(shot.propIds, input.propNames ?? new Map())],
    ["lighting", "Lighting", textCell(camera.lighting?.trim() ?? "")],
    ["camera", "Camera", textCell([camera.shotSize, camera.angle, camera.composition].filter(Boolean).join("・"))],
    ["style", "Style", textCell(input.projectStyle?.trim() ?? "")],
  ];
  return values.map(([family, label, cell]) => ({
    family,
    label,
    value: cell.value || "尚未設定",
    // 有綁定但名字還沒讀到 ≠ 沒有綁定：empty 只在真的沒有綁定時成立
    empty: !cell.key,
    key: cell.key,
    unresolved: cell.unresolved,
  }));
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
    /*
     * 分群一律用結構化的 key（實體＝排序後的 id 清單），顯示才用名字。
     * 拿顯示字串分群會在「同名不同卡」與「卡片查不到名字」時把不同的鏡折成同一群，
     * 於是 UI 顯示 uniform、使用者按下套用，才發現有幾鏡根本不是那樣。
     * id 清單本來就是集合，排序後比對＝順序差異不算創作差異（沿用 v3 的正確意圖）。
     */
    const counts = new Map<string, { count: number; value: string; unresolved: number }>();
    for (const row of rows) {
      const cell = row[index]!;
      const existing = counts.get(cell.key);
      if (existing) existing.count += 1;
      else counts.set(cell.key, { count: 1, value: cell.value, unresolved: cell.unresolved });
    }
    const distribution = [...counts.values()]
      .map((item) => ({ value: item.value, count: item.count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh-Hant"));
    const mixed = distribution.length > 1;
    const unresolved = [...counts.values()].reduce((sum, item) => sum + item.unresolved, 0);
    return {
      ...seed,
      value: mixed ? "MIXED" : distribution[0]!.value,
      // 只有「所有鏡都真的沒有綁定」才算空
      empty: counts.size === 1 && [...counts.keys()][0] === "",
      unresolved,
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
