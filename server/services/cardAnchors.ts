/**
 * 角色定裝／場景設定／素材設定卡片錨點（生成 prompt + 知識庫注入共用）。
 *
 * 從 routers 下沉到 services（ADR-009）：generationCore 不再 import routers。
 *
 * 契約：
 * - 視覺錨點：角色只放外觀；場景放色板＋光線；素材只放外觀材質（都不放長文備註）
 * - 依呼叫端選定 id 順序組裝（DB inArray 不保證順序）
 * - 欄位截短，避免多卡撐爆圖像 prompt／知識 budget
 * - 知識庫卡片段落完整注入（有界截短後），不被 budget 腰斬半張卡
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { carriedPropIdsFor, formatPropDisplayName, type PropOwnerKind } from "../../shared/propOwnership";

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
/** 知識庫最多注入幾張素材卡 */
export const PROP_KNOWLEDGE_INJECT_MAX = 12;

export type CharacterAnchorRow = {
  id: string;
  name: string;
  appearance: string;
  notes?: string | null;
  /** 這一鏡選用的造型（Identity 不變、Look 逐鏡換；沒選就沿用角色卡本身的外觀） */
  lookName?: string | null;
  lookCostume?: string | null;
};

export type SceneAnchorRow = {
  id: string;
  name: string;
  palette: string;
  lighting?: string | null;
};

export type PropAnchorRow = {
  id: string;
  name: string;
  appearance: string;
  notes?: string | null;
  /** 歸屬主人的名字（有就寫成「安倢的紅傘」，讓模型把物件綁在對的人／地上） */
  ownerName?: string | null;
  ownerKind?: PropOwnerKind | null;
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

/**
 * 視覺生成：角色定裝錨點（只外觀；「外觀鎖定」指令提高擴散模型對身份的注意力）。
 *
 * Identity/Look 分層（Story-first §14）：角色卡的 appearance 是「不會變的身份」（臉、髮、體型），
 * 這一鏡選用的造型（服裝、配件）接在同一句後面成為「造型鎖定」。
 * 為什麼放在同一個錨點而不是另開一個 marker：造型是這個角色的外觀，不是獨立實體——
 * 拆開會讓模型把服裝當成畫面裡另一個東西，也會讓消融測試的三段錨點語意變糊。
 */
export function formatCharacterAnchor(rows: CharacterAnchorRow[], selectedIds: string[]): string {
  const ordered = orderRowsByIds(rows, selectedIds);
  if (ordered.length === 0) return "";
  return ordered
    .map((c) => {
      const base = `外觀鎖定 ${c.name}：${clipCardField(c.appearance)}`;
      const costume = c.lookCostume?.trim() || c.lookName?.trim() || "";
      return costume ? `${base}，造型鎖定：${clipCardField(costume)}` : base;
    })
    .join("；");
}

/** 視覺生成：場景設定錨點（色板＋可選光線；「光影鎖定」指令提高跨鏡光影一致性） */
export function formatSceneAnchor(rows: SceneAnchorRow[], selectedIds: string[]): string {
  const ordered = orderRowsByIds(rows, selectedIds);
  if (ordered.length === 0) return "";
  return ordered
    .map((s) => {
      const palette = clipCardField(s.palette);
      const lighting = s.lighting?.trim() ? clipCardField(s.lighting, CARD_LIGHTING_MAX) : "";
      return lighting
        ? `光影鎖定 ${s.name}：色板 ${palette}、光線 ${lighting}`
        : `光影鎖定 ${s.name}：色板 ${palette}`;
    })
    .join("；");
}

/**
 * 視覺生成：素材設定錨點（只外觀材質；「材質鎖定」指令提高道具跨鏡一致性；備註不進畫面）。
 * 有歸屬的物件寫成「安倢的紅傘」——把物件綁在對的人／地上，避免傘飄到別人手裡。
 */
export function formatPropAnchor(rows: PropAnchorRow[], selectedIds: string[]): string {
  const ordered = orderRowsByIds(rows, selectedIds);
  if (ordered.length === 0) return "";
  return ordered
    .map((p) => `材質鎖定 ${formatPropDisplayName(p.name, p.ownerName)}：${clipCardField(p.appearance)}`)
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

/** 知識庫／導演：【素材設定卡】（可含用途備註） */
export function formatPropKnowledgeBlock(props: PropAnchorRow[]): string {
  if (props.length === 0) return "";
  const shown = props.slice(0, PROP_KNOWLEDGE_INJECT_MAX);
  const lines = shown.map((p) => {
    const appearance = clipCardField(p.appearance);
    const notes = p.notes?.trim() ? `｜用途：${clipCardField(p.notes, CARD_NOTES_MAX)}` : "";
    return `- ${formatPropDisplayName(p.name, p.ownerName)}：${appearance}${notes}`;
  });
  const more =
    props.length > PROP_KNOWLEDGE_INJECT_MAX
      ? `\n…另有 ${props.length - PROP_KNOWLEDGE_INJECT_MAX} 張素材卡未注入`
      : "";
  return `【素材設定卡】\n${lines.join("\n")}${more}`;
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

/** DB：選定素材 → 視覺錨點（順序＝selectedIds） */
export async function buildPropAnchor(projectId: string, propIds: string[]): Promise<string> {
  if (propIds.length === 0) return "";
  const ids = [...new Set(propIds)];
  const rows = await db
    .select({
      id: schema.props.id,
      name: schema.props.name,
      appearance: schema.props.appearance,
      notes: schema.props.notes,
      ownerKind: schema.props.ownerKind,
      ownerName: sql<string | null>`coalesce(${schema.characters.name}, ${schema.scenePresets.name})`,
    })
    .from(schema.props)
    .leftJoin(
      schema.characters,
      and(eq(schema.characters.id, schema.props.ownerId), eq(schema.props.ownerKind, "character")),
    )
    .leftJoin(
      schema.scenePresets,
      and(eq(schema.scenePresets.id, schema.props.ownerId), eq(schema.props.ownerKind, "scene")),
    )
    .where(and(eq(schema.props.projectId, projectId), inArray(schema.props.id, ids)));
  return formatPropAnchor(rows, propIds);
}

/**
 * 勾了角色／場景卡 → 它們名下的素材卡自動一起帶入（歸屬的實際效用）。
 *
 * 只回 id；與明確勾選的合併、去重、截上限交給 shared/propOwnership 的純函式，
 * 前端預覽與後端注入才會算出同一份清單。
 */
export async function resolveCarriedPropIds(
  projectId: string,
  selected: { characterIds?: string[]; scenePresetIds?: string[] },
): Promise<string[]> {
  const ownerIds = [...new Set([...(selected.characterIds ?? []), ...(selected.scenePresetIds ?? [])])];
  if (ownerIds.length === 0) return [];
  const rows = await db
    .select({ id: schema.props.id, ownerKind: schema.props.ownerKind, ownerId: schema.props.ownerId })
    .from(schema.props)
    .where(and(eq(schema.props.projectId, projectId), inArray(schema.props.ownerId, ownerIds)))
    .orderBy(asc(schema.props.createdAt));
  return carriedPropIdsFor(rows, selected);
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
  selected: { characterIds?: string[]; scenePresetIds?: string[]; propIds?: string[] },
): Promise<{ assetId: string; from: "character" | "scene" | "prop" } | null> {
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
  // 素材卡排最後：道具是配角，有角色／場景參考圖時該以它們為底
  const propIds = selected.propIds ?? [];
  if (propIds.length > 0) {
    const rows = await db
      .select({ id: schema.props.id, referenceAssetId: schema.props.referenceAssetId })
      .from(schema.props)
      .where(and(eq(schema.props.projectId, projectId), inArray(schema.props.id, [...new Set(propIds)])));
    const ref = pickFirstReference(rows, propIds);
    if (ref) return { assetId: ref, from: "prop" };
  }
  return null;
}
