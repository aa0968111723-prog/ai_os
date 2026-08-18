/**
 * 逐鏡造型與角色的歸屬關係。
 *
 * Identity（角色卡）與 Look（造型卡）是兩層：一鏡可以沒有造型（用角色預設外觀），
 * 但不能留下「角色已不在這一鏡、造型卻還掛著」的孤兒——畫面上看得到、生成時被忽略、
 * 任何 UI 都刪不掉，角色一加回來它就復活。
 *
 * 這一層是純函式：伺服器在 setCards／scenes.update 寫入前呼叫，
 * 不依賴某個前端記得把 orphanedLookIds 一併送上。
 */

export function lookOwnerMap(
  rows: readonly { id: string; characterId: string }[],
): Map<string, string> {
  return new Map(rows.map((row) => [row.id, row.characterId]));
}

/** 只留下「主人還在這一鏡」的造型；全被清掉時回 null（與卡片欄「空即 null」同口徑）。 */
export function keepLooksOwnedByCharacters(
  lookIds: readonly string[] | null | undefined,
  lookOwnerById: ReadonlyMap<string, string>,
  characterIds: readonly string[] | null | undefined,
): string[] | null {
  const chars = new Set(characterIds ?? []);
  const kept = [...new Set(lookIds ?? [])].filter((id) => {
    const owner = lookOwnerById.get(id);
    return Boolean(owner && chars.has(owner));
  });
  return kept.length ? kept : null;
}

export function looksChanged(
  before: readonly string[] | null | undefined,
  after: readonly string[] | null | undefined,
): boolean {
  const a = [...(before ?? [])];
  const b = [...(after ?? [])];
  if (a.length !== b.length) return true;
  return a.some((id, i) => id !== b[i]);
}

/** 明確寫入的造型裡，有沒有主人不在這一鏡的（API 應拒絕，不要靜默吞）。 */
export function unboundLookIds(
  lookIds: readonly string[] | null | undefined,
  lookOwnerById: ReadonlyMap<string, string>,
  characterIds: readonly string[] | null | undefined,
): string[] {
  const chars = new Set(characterIds ?? []);
  return [...new Set(lookIds ?? [])].filter((id) => {
    const owner = lookOwnerById.get(id);
    return !owner || !chars.has(owner);
  });
}
