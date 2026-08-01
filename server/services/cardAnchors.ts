/**
 * 角色定裝／場景設定卡片錨點（生成 prompt + 知識庫注入共用）。
 *
 * 從 routers 下沉到 services（ADR-009）：generationCore 不再 import routers。
 *
 * 契約：
 * - 視覺錨點：角色只放外觀；場景放色板＋光線（不放長文）
 * - 依呼叫端選定 id 順序組裝（DB inArray 不保證順序）
 * - 欄位截短，避免多卡撐爆圖像 prompt／知識 budget
 * - 知識庫卡片段落完整注入（有界截短後），不被 budget 腰斬半張卡
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";

/** 視覺／知識共用的主欄位截短上限（與 agentCore 別名摘要一致） */
export const CARD_FIELD_MAX = 160;
/** 知識庫角色卡「個性」截短 */
export const CARD_NOTES_MAX = 120;
/** 場景光線截短 */
export const CARD_LIGHTING_MAX = 120;
/** 知識庫最多注入幾張角色卡 */
export const CHAR_KNOWLEDGE_INJECT_MAX = 20;
/** 知識庫最多注入幾張場景卡 */
export const PRESET_KNOWLEDGE_INJECT_MAX = 12;

export type CharacterAnchorRow = {
  id: string;
  name: string;
  appearance: string;
  notes?: string | null;
};

export type SceneAnchorRow = {
  id: string;
  name: string;
  palette: string;
  lighting?: string | null;
};

/** 依 selectedIds 順序去重挑列；未知 id 略過 */
export function orderRowsByIds<T extends { id: string }>(rows: T[], selectedIds: string[]): T[] {
  const map = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = map.get(id);
    if (row) out.push(row);
  }
  return out;
}

/** 壓空白 + 截短（不加省略號——避免擴散模型把「…」當畫面符號） */
export function clipCardField(text: string, max: number = CARD_FIELD_MAX): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/** 視覺生成：角色定裝錨點（只外觀） */
export function formatCharacterAnchor(rows: CharacterAnchorRow[], selectedIds: string[]): string {
  const ordered = orderRowsByIds(rows, selectedIds);
  if (ordered.length === 0) return "";
  return ordered.map((c) => `${c.name}：${clipCardField(c.appearance)}`).join("；");
}

/** 視覺生成：場景設定錨點（色板＋可選光線） */
export function formatSceneAnchor(rows: SceneAnchorRow[], selectedIds: string[]): string {
  const ordered = orderRowsByIds(rows, selectedIds);
  if (ordered.length === 0) return "";
  return ordered
    .map((s) => {
      const palette = clipCardField(s.palette);
      const lighting = s.lighting?.trim() ? clipCardField(s.lighting, CARD_LIGHTING_MAX) : "";
      return lighting ? `${s.name}：色板 ${palette}、光線 ${lighting}` : `${s.name}：色板 ${palette}`;
    })
    .join("；");
}

/** 知識庫／導演：【角色定裝卡】（可含個性） */
export function formatCharacterKnowledgeBlock(chars: CharacterAnchorRow[]): string {
  if (chars.length === 0) return "";
  const shown = chars.slice(0, CHAR_KNOWLEDGE_INJECT_MAX);
  const lines = shown.map((c) => {
    const appearance = clipCardField(c.appearance);
    const notes = c.notes?.trim() ? `｜個性：${clipCardField(c.notes, CARD_NOTES_MAX)}` : "";
    return `- ${c.name}：${appearance}${notes}`;
  });
  const more =
    chars.length > CHAR_KNOWLEDGE_INJECT_MAX
      ? `\n…另有 ${chars.length - CHAR_KNOWLEDGE_INJECT_MAX} 張角色卡未注入`
      : "";
  return `【角色定裝卡】\n${lines.join("\n")}${more}`;
}

/** 知識庫／導演：【場景設定卡】 */
export function formatSceneKnowledgeBlock(presets: SceneAnchorRow[]): string {
  if (presets.length === 0) return "";
  const shown = presets.slice(0, PRESET_KNOWLEDGE_INJECT_MAX);
  const lines = shown.map((s) => {
    const palette = clipCardField(s.palette);
    const lighting = s.lighting?.trim() ? `｜光線 ${clipCardField(s.lighting, CARD_LIGHTING_MAX)}` : "";
    return `- ${s.name}：色板 ${palette}${lighting}`;
  });
  const more =
    presets.length > PRESET_KNOWLEDGE_INJECT_MAX
      ? `\n…另有 ${presets.length - PRESET_KNOWLEDGE_INJECT_MAX} 張場景卡未注入`
      : "";
  return `【場景設定卡】\n${lines.join("\n")}${more}`;
}

/** DB：選定角色 → 視覺錨點 */
export async function buildCharacterAnchor(projectId: string, characterIds: string[]): Promise<string> {
  if (characterIds.length === 0) return "";
  const ids = [...new Set(characterIds)];
  const rows = await db
    .select({
      id: schema.characters.id,
      name: schema.characters.name,
      appearance: schema.characters.appearance,
      notes: schema.characters.notes,
    })
    .from(schema.characters)
    .where(and(eq(schema.characters.projectId, projectId), inArray(schema.characters.id, ids)));
  return formatCharacterAnchor(rows, characterIds);
}

/** DB：選定場景 → 視覺錨點（順序＝selectedIds） */
export async function buildSceneAnchor(projectId: string, presetIds: string[]): Promise<string> {
  if (presetIds.length === 0) return "";
  const ids = [...new Set(presetIds)];
  const rows = await db
    .select({
      id: schema.scenePresets.id,
      name: schema.scenePresets.name,
      palette: schema.scenePresets.palette,
      lighting: schema.scenePresets.lighting,
    })
    .from(schema.scenePresets)
    .where(and(eq(schema.scenePresets.projectId, projectId), inArray(schema.scenePresets.id, ids)));
  return formatSceneAnchor(rows, presetIds);
}

/**
 * 卡片參考圖 → 生成來源（QA 2026-08-01）。
 *
 * 「圖生圖／參考圖」這類模型需要一張來源圖。使用者在角色定裝卡／場景設定卡上綁的參考圖，
 * 語意上就是那張圖——先前卻只當縮圖用，選了這類模型又沒另外挑素材就直接失敗。
 *
 * 取用順序＝呼叫端勾選的順序（角色優先於場景）：第一張綁得到的參考圖就是來源。
 * 這裡只回 assetId，同組／軟刪／型別相容仍由 submitGenerationCore 既有那幾關把守。
 */
/**
 * 從一批卡片列中挑出「第一張綁得到的參考圖」，順序＝使用者勾選的順序（DB inArray 不保證順序）。
 * 抽成純函式才測得到這條順序規則——它決定同時勾多張卡時用誰的圖。
 */
export function pickFirstReference(
  rows: Array<{ id: string; referenceAssetId: string | null }>,
  orderedIds: string[],
): string | null {
  const byId = new Map(rows.map((r) => [r.id, r.referenceAssetId]));
  for (const id of orderedIds) {
    const ref = byId.get(id);
    if (ref) return ref;
  }
  return null;
}

export async function resolveCardReferenceSource(
  projectId: string,
  selected: { characterIds?: string[]; scenePresetIds?: string[] },
): Promise<{ assetId: string; from: "character" | "scene" } | null> {
  const charIds = selected.characterIds ?? [];
  if (charIds.length > 0) {
    const rows = await db
      .select({ id: schema.characters.id, referenceAssetId: schema.characters.referenceAssetId })
      .from(schema.characters)
      .where(and(eq(schema.characters.projectId, projectId), inArray(schema.characters.id, [...new Set(charIds)])));
    const ref = pickFirstReference(rows, charIds);
    if (ref) return { assetId: ref, from: "character" };
  }
  const sceneIds = selected.scenePresetIds ?? [];
  if (sceneIds.length > 0) {
    const rows = await db
      .select({ id: schema.scenePresets.id, referenceAssetId: schema.scenePresets.referenceAssetId })
      .from(schema.scenePresets)
      .where(and(eq(schema.scenePresets.projectId, projectId), inArray(schema.scenePresets.id, [...new Set(sceneIds)])));
    const ref = pickFirstReference(rows, sceneIds);
    if (ref) return { assetId: ref, from: "scene" };
  }
  return null;
}
