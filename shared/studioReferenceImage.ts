import { MAX_GENERATE_CHARACTERS } from "./cardLimits";

/**
 * 角色卡「生成時帶入」→ generateInto 來源圖。
 * 只認該角色自己的同專案定裝參考圖。空定裝不得把 已選 0/6 加一，也不得改掛任意 1/50。
 */
export type StudioCharacterRef = {
  id: string;
  name: string;
  referenceAssetId?: string | null;
  referenceUrl?: string | null;
};

/** 活著的定裝圖：有 id，且不是回收桶（referenceUrl === null）。新增回傳沒帶 url 仍算已綁。 */
export function characterHasLiveSheet(
  card?: Pick<StudioCharacterRef, "referenceAssetId" | "referenceUrl"> | null,
): boolean {
  const id = card?.referenceAssetId?.trim();
  if (!id) return false;
  if (card?.referenceUrl === null || card?.referenceUrl === "") return false;
  return true;
}

/** 已選只計「自己有定裝圖」的卡。0 refs 的小華不進 1/6。 */
export function selectableBringInIds(
  characters: readonly StudioCharacterRef[],
  selectedIds: readonly string[],
  max = MAX_GENERATE_CHARACTERS,
): string[] {
  return selectedIds
    .filter((id) => characterHasLiveSheet(characters.find((row) => row.id === id)))
    .slice(0, max);
}

export function pickStudioReferenceAssetId(
  characters: readonly StudioCharacterRef[],
  selectedIds: readonly string[],
): string | undefined {
  for (const id of selectableBringInIds(characters, selectedIds)) {
    const card = characters.find((row) => row.id === id);
    const assetId = card?.referenceAssetId?.trim();
    if (assetId && characterHasLiveSheet(card)) return assetId;
  }
  return undefined;
}

/** 只帶有定裝圖的勾選。未勾選／0 refs＝空 payload，不發明第二份清單。 */
export function cardBringInPayload(
  characters: readonly StudioCharacterRef[],
  selectedIds: readonly string[],
): { characterIds?: string[]; sourceAssetId?: string } {
  const characterIds = selectableBringInIds(characters, selectedIds);
  const sourceAssetId = pickStudioReferenceAssetId(characters, characterIds);
  return {
    ...(characterIds.length ? { characterIds } : {}),
    ...(sourceAssetId ? { sourceAssetId } : {}),
  };
}

/** 明示來源必須是勾選角色自己的定裝圖，否則當成 stray 1/50 丟掉。 */
export function honorExplicitCharacterSheet(
  characters: readonly StudioCharacterRef[],
  selectedIds: readonly string[],
  explicitSourceAssetId?: string | null,
): string | undefined {
  const owned = pickStudioReferenceAssetId(characters, selectedIds);
  const explicit = explicitSourceAssetId?.trim();
  if (explicit && explicit === owned) return explicit;
  return owned;
}
