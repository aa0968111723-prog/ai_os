/**
 * 拆分鏡時把設定卡指派給每一鏡：LLM 用代號（char1／preset1／prop1），伺服器再翻回 id。
 *
 * 為什麼不讓 LLM 直接吐 UUID：模型會捏造看起來像 UUID 的字串，寫進去就是壞引用。
 * 代號＋白名單解析＝解析不到就丟掉，永遠不會寫入不存在的卡片（與 agentPlanning 同一套思路）。
 */
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { MAX_GENERATE_CHARACTERS, MAX_GENERATE_PROPS, MAX_GENERATE_SCENE_PRESETS } from "../../shared/cardLimits";
import { formatPropDisplayName } from "../../shared/propOwnership";
import type { CardLookupEntry, SceneCardKind } from "../../shared/sceneCards";
import { clipCardField } from "./cardAnchors";

/** 每種卡片最多列給模型幾張（提示詞不能被卡片清單灌爆） */
export const SCENE_CARD_ALIAS_MAX = 20;

export type CardAlias = { ref: string; id: string; name: string };

export type ProjectCardAliases = {
  characters: CardAlias[];
  scenePresets: CardAlias[];
  props: CardAlias[];
  /** 給 LLM 讀的代號區塊；沒有任何卡片時為空字串（呼叫端據此整段略過） */
  text: string;
};

/** 讀本專案的卡片並編上代號（char1、preset1、prop1…） */
export async function loadProjectCardAliases(projectId: string): Promise<ProjectCardAliases> {
  const [characterRows, sceneRows, propRows] = await Promise.all([
    db
      .select({ id: schema.characters.id, name: schema.characters.name, appearance: schema.characters.appearance })
      .from(schema.characters)
      .where(eq(schema.characters.projectId, projectId))
      .orderBy(asc(schema.characters.createdAt))
      .limit(SCENE_CARD_ALIAS_MAX),
    db
      .select({ id: schema.scenePresets.id, name: schema.scenePresets.name, palette: schema.scenePresets.palette })
      .from(schema.scenePresets)
      .where(eq(schema.scenePresets.projectId, projectId))
      .orderBy(asc(schema.scenePresets.createdAt))
      .limit(SCENE_CARD_ALIAS_MAX),
    db
      .select({ id: schema.props.id, name: schema.props.name, appearance: schema.props.appearance })
      .from(schema.props)
      .where(eq(schema.props.projectId, projectId))
      .orderBy(asc(schema.props.createdAt))
      .limit(SCENE_CARD_ALIAS_MAX),
  ]);

  const characters = characterRows.map((row, i) => ({ ref: `char${i + 1}`, id: row.id, name: row.name }));
  const scenePresets = sceneRows.map((row, i) => ({ ref: `preset${i + 1}`, id: row.id, name: row.name }));
  const props = propRows.map((row, i) => ({ ref: `prop${i + 1}`, id: row.id, name: row.name }));

  const lines: string[] = [];
  if (characterRows.length) {
    lines.push("角色卡（characterRefs 用這些代號）：");
    lines.push(
      ...characterRows.map((row, i) => `char${i + 1}=「${row.name}」${clipCardField(row.appearance, 60)}`),
    );
  }
  if (sceneRows.length) {
    lines.push("場景卡（scenePresetRefs 用這些代號）：");
    lines.push(...sceneRows.map((row, i) => `preset${i + 1}=「${row.name}」${clipCardField(row.palette, 40)}`));
  }
  if (propRows.length) {
    lines.push("素材卡（propRefs 用這些代號）：");
    lines.push(...propRows.map((row, i) => `prop${i + 1}=「${row.name}」${clipCardField(row.appearance, 40)}`));
  }

  return { characters, scenePresets, props, text: lines.join("\n") };
}

function resolveRefs(refs: string[] | undefined, aliases: CardAlias[], max: number): string[] {
  if (!refs?.length) return [];
  const byRef = new Map(aliases.map((a) => [a.ref.toLowerCase(), a.id]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    const id = byRef.get(String(raw ?? "").trim().toLowerCase());
    // 解析不到＝模型捏的代號，直接丟掉（絕不寫入不存在的卡片引用）
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** 一鏡的 refs → 實際卡片 id（未知代號丟棄、去重、各自截到單次生成上限） */
export function resolveSceneCardRefs(
  aliases: ProjectCardAliases,
  refs: { characterRefs?: string[]; scenePresetRefs?: string[]; propRefs?: string[] },
): { characterIds: string[]; scenePresetIds: string[]; propIds: string[] } {
  return {
    characterIds: resolveRefs(refs.characterRefs, aliases.characters, MAX_GENERATE_CHARACTERS),
    scenePresetIds: resolveRefs(refs.scenePresetRefs, aliases.scenePresets, MAX_GENERATE_SCENE_PRESETS),
    propIds: resolveRefs(refs.propRefs, aliases.props, MAX_GENERATE_PROPS),
  };
}

/**
 * 文字腳本的卡片行要靠**名字**回推卡片，所以要一份「名字 → id」的完整名冊。
 *
 * 與 loadProjectCardAliases 的差別在用途，不是重複：那份是給 LLM 讀的代號清單，
 * 會截到 SCENE_CARD_ALIAS_MAX（提示詞不能被卡片清單灌爆）。這份不能截——
 * 截掉的那張卡在文字裡就變成「找不到這個名字」，使用者明明在畫面上看得到它。
 *
 * 素材卡收兩種寫法：顯示名（「安倢的紅傘」）與原名（「紅傘」）。原名撞名時
 * resolveCardLine 會判成有歧義並整行不套用，不會擲骰子挑一張。
 */
export async function loadSceneCardLookup(
  projectId: string,
): Promise<Record<SceneCardKind, CardLookupEntry[]>> {
  const [characterRows, sceneRows, propRows] = await Promise.all([
    db
      .select({ id: schema.characters.id, name: schema.characters.name })
      .from(schema.characters)
      .where(eq(schema.characters.projectId, projectId))
      .orderBy(asc(schema.characters.createdAt)),
    db
      .select({ id: schema.scenePresets.id, name: schema.scenePresets.name })
      .from(schema.scenePresets)
      .where(eq(schema.scenePresets.projectId, projectId))
      .orderBy(asc(schema.scenePresets.createdAt)),
    db
      .select({
        id: schema.props.id,
        name: schema.props.name,
        ownerKind: schema.props.ownerKind,
        ownerCharacterName: schema.characters.name,
        ownerSceneName: schema.scenePresets.name,
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
      .where(eq(schema.props.projectId, projectId))
      .orderBy(asc(schema.props.createdAt)),
  ]);

  return {
    characters: characterRows.map((row) => ({ id: row.id, names: [row.name] })),
    scenePresets: sceneRows.map((row) => ({ id: row.id, names: [row.name] })),
    props: propRows.map((row) => {
      const ownerName =
        row.ownerKind === "character" ? row.ownerCharacterName : row.ownerKind === "scene" ? row.ownerSceneName : null;
      const display = formatPropDisplayName(row.name, ownerName);
      return { id: row.id, names: display === row.name ? [row.name] : [display, row.name] };
    }),
  };
}

/**
 * 空陣列存 null（與 generations 同口徑：null＝沒指定，[]會被誤讀成「指定了空的」）。
 * 同時去重：直呼 API 可以送重複 id，存進去會讓同一張卡在 UI 與提示詞裡出現兩次。
 */
export function sceneCardColumns(resolved: {
  characterIds: string[];
  scenePresetIds: string[];
  propIds: string[];
}): { characterIds: string[] | null; scenePresetIds: string[] | null; propIds: string[] | null } {
  const uniq = (ids: string[]) => [...new Set(ids)];
  return {
    characterIds: resolved.characterIds.length ? uniq(resolved.characterIds) : null,
    scenePresetIds: resolved.scenePresetIds.length ? uniq(resolved.scenePresetIds) : null,
    propIds: resolved.propIds.length ? uniq(resolved.propIds) : null,
  };
}
