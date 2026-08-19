import { MAX_GENERATE_CHARACTERS } from "./cardLimits";

/**
 * 角色卡「生成時帶入」→ generateInto 來源圖。
 * 只認勾選 id；空定裝／回收桶（沒有 referenceUrl）略過——0/6 與沒有活圖都不得 500。
 */
export type StudioCharacterRef = {
  id: string;
  name: string;
  referenceAssetId?: string | null;
  referenceUrl?: string | null;
};

export function pickStudioReferenceAssetId(
  characters: readonly StudioCharacterRef[],
  selectedIds: readonly string[],
): string | undefined {
  for (const id of selectedIds) {
    const card = characters.find((row) => row.id === id);
    const assetId = card?.referenceAssetId?.trim();
    if (assetId && card?.referenceUrl) return assetId;
  }
  return undefined;
}

/** 只帶角色卡勾選。未勾選（0/6）不發明第二份清單。 */
export function cardBringInPayload(
  characters: readonly StudioCharacterRef[],
  selectedIds: readonly string[],
): { characterIds?: string[]; sourceAssetId?: string } {
  const characterIds = selectedIds.slice(0, MAX_GENERATE_CHARACTERS);
  const sourceAssetId = pickStudioReferenceAssetId(characters, characterIds);
  return {
    ...(characterIds.length ? { characterIds } : {}),
    ...(sourceAssetId ? { sourceAssetId } : {}),
  };
}
