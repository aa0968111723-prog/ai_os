import { MAX_GENERATE_CHARACTERS } from "./cardLimits";

/**
 * 單格工作室「生成時帶入角色參考圖」：從勾選角色挑第一張可用定裝圖。
 * 空定裝／回收桶（沒有 referenceUrl）一律略過——generate 路徑不得因此 500。
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

/** 工作台已勾選就沿用；否則預設帶入本專案角色（上限 6），讓 0/6 的小華在工作室仍能勾上。 */
export function defaultStudioBringInIds(
  characters: readonly StudioCharacterRef[],
  parentCharIds?: readonly string[] | null,
  max = MAX_GENERATE_CHARACTERS,
): string[] {
  const allowed = new Set(characters.map((row) => row.id));
  if (parentCharIds?.length) {
    return parentCharIds.filter((id) => allowed.has(id)).slice(0, max);
  }
  return characters.map((row) => row.id).slice(0, max);
}

export function studioGenerateCardPayload(
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
