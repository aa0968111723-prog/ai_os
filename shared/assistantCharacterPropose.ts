import { CHAR_NAME_MAX } from "./cardLimits";
import { isAddCharacterIntent } from "./assistantExecution";
import { isXiaohuaName, XIAOHUA_LOCKED_APPEARANCE } from "./characterIdentityLock";
import { nameKey } from "./story";

/** Name-only create: confirm card still writes; appearance can be filled later. */
export const PENDING_CHARACTER_APPEARANCE = "待補外觀描述";

/** Phrases that describe a look, not a character name. */
const APPEARANCE_PHRASE_RE =
  /粉橘|短髮|長髮|白帽|針織|年輕男性|年輕女性|女孩|男孩|化工|外觀|定裝|帽T|大二/;

export type ProposedAddCharacter = {
  type: "add_character";
  name: string;
  appearance: string;
  notes?: string;
};

export type ExistingCharacterCard = {
  name: string;
  appearance?: string | null;
};

function lockAppearance(name: string, appearance: string): string {
  if (isXiaohuaName(name)) return XIAOHUA_LOCKED_APPEARANCE;
  const trimmed = appearance.trim();
  return trimmed || PENDING_CHARACTER_APPEARANCE;
}

/**
 * When the user lists names ("幫我新增角色 小華、媽媽、禪定龜龜") the model
 * often replies「無法直接建立角色」with actions=[]. Propose confirm cards
 * instead — same path as create_project, but confirm-only (not direct).
 *
 * Same-name cards still emit a confirm card (reuse vs update appearance).
 * 小華 always uses the locked female look, never 年輕男性.
 */
export function proposeAddCharacterActions(
  message: string,
  existingCards: readonly ExistingCharacterCard[] = [],
): ProposedAddCharacter[] {
  if (!isAddCharacterIntent(message)) {
    const xiaohua = existingCards.find((card) => isXiaohuaName(card.name));
    if (
      !xiaohua
      || !/小華/.test(message)
      || !/年輕男性|男性|男生|他|粉橘|短髮|女孩|女生|外觀|定裝/.test(message)
    ) {
      return [];
    }
    return [{
      type: "add_character" as const,
      name: xiaohua.name,
      appearance: lockAppearance(xiaohua.name, ""),
    }];
  }
  return extractCharacterNames(message, existingCards).slice(0, 6).map((name) => ({
    type: "add_character" as const,
    name,
    appearance: lockAppearance(name, ""),
  }));
}

/**
 * Merge model-proposed add_character rows with deterministic cards.
 * Always keep a same-name confirm card; lock 小華 to the female appearance.
 */
export function mergeAddCharacterProposals(
  fromModel: readonly ProposedAddCharacter[],
  message: string,
  existingCards: readonly ExistingCharacterCard[] = [],
): ProposedAddCharacter[] {
  const proposed = proposeAddCharacterActions(message, existingCards);
  const byName = new Map<string, ProposedAddCharacter>();
  const put = (row: ProposedAddCharacter) => {
    const name = row.name.trim();
    if (!name) return;
    byName.set(nameKey(name), {
      type: "add_character",
      name,
      appearance: lockAppearance(name, row.appearance ?? ""),
      ...(row.notes?.trim() ? { notes: row.notes.trim() } : {}),
    });
  };
  for (const row of fromModel) put(row);
  for (const row of proposed) {
    const key = nameKey(row.name);
    const prev = byName.get(key);
    if (!prev) put(row);
    else if (isXiaohuaName(row.name)) put({ ...prev, appearance: XIAOHUA_LOCKED_APPEARANCE });
  }
  return [...byName.values()].slice(0, 6);
}

/**
 * 「新增角色」must never become an append to 素材清單 / add_database_row.
 * Project assistant currently keeps both; live then shows only the DB card.
 */
export function dropMisroutedCharacterDatabaseActions<T extends { type: string }>(
  message: string,
  actions: readonly T[],
): T[] {
  const wantsCharacter =
    isAddCharacterIntent(message)
    || actions.some((action) => action.type === "add_character")
    || proposeAddCharacterActions(message).length > 0;
  if (!wantsCharacter) return [...actions];
  return actions.filter((action) => action.type !== "add_database_row");
}

export function collectAddCharacterProposals(
  message: string,
  rawActions: ReadonlyArray<{ type: string; name?: string; appearance?: string; notes?: string }>,
  existingCards: readonly ExistingCharacterCard[] = [],
): ProposedAddCharacter[] {
  const fromModel = rawActions.flatMap((action): ProposedAddCharacter[] => {
    if (action.type !== "add_character" || !action.name?.trim()) return [];
    return [{
      type: "add_character",
      name: action.name.trim(),
      appearance: action.appearance ?? "",
      ...(action.notes?.trim() ? { notes: action.notes.trim() } : {}),
    }];
  });
  return mergeAddCharacterProposals(fromModel, message, existingCards);
}

export function addCharacterConfirmLabel(
  name: string,
  appearance: string,
  existing?: ExistingCharacterCard | null,
): string {
  const locked = lockAppearance(name, appearance);
  if (existing && nameKey(existing.name) === nameKey(name)) {
    const from = (existing.appearance ?? "").trim() || "（空）";
    if (from !== locked) return `更新角色「${name}」外觀：${from} → ${locked}`;
    return `沿用角色「${name}」（已存在）`;
  }
  return `新增角色「${name}」`;
}

function isAppearancePhrase(token: string): boolean {
  if (isXiaohuaName(token)) return false;
  return APPEARANCE_PHRASE_RE.test(token) && !/媽媽|禪定/.test(token);
}

export function extractCharacterNames(
  message: string,
  existingCards: readonly ExistingCharacterCard[] = [],
): string[] {
  const matched = message.match(
    /(?:新增|建立|加|更新|改定裝|改外觀)\s*(?:角色|定裝)(?:卡)?[：:\s]*(.+)$/u,
  );
  const rest = (matched?.[1] ?? "").replace(/[。．.！!？?]+$/u, "").trim();
  const seen = new Set<string>();
  const names: string[] = [];
  const push = (raw: string) => {
    const stripped = raw.replace(/[「」『』《》【】"'“”]/g, " ").trim();
    const beforeLook = stripped.split(/[／/]/)[0]?.trim() ?? "";
    const name = beforeLook.split(/[：:]/)[0]?.trim().split(/\s+/)[0]?.trim() ?? "";
    if (!name || name.length > CHAR_NAME_MAX || isAppearancePhrase(name)) return;
    const key = nameKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  if (rest) {
    for (const raw of rest.split(/[,，、／/]/)) push(raw.trim());
  }
  if (/小華/.test(message)) push("小華");
  for (const card of existingCards) {
    if (isXiaohuaName(card.name) && /小華/.test(message)) push(card.name);
  }
  return names;
}
