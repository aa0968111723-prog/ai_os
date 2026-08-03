/**
 * 素材設定卡的「歸屬」——前後端共用規則（單一真相）。
 *
 * 一張素材卡可以是：
 * - 某個角色的**隨身物品**（安倢的紅傘）→ ownerKind="character"
 * - 某個場景的**場上物件**（禪堂的佛龕）→ ownerKind="scene"
 * - 誰都不屬於的**獨立物件**（活動主視覺牌）→ ownerKind=null
 *
 * 歸屬不只是標籤：勾了主人（角色卡／場景卡），它的物件會**自動一起帶入**生成，
 * 使用者不必記得「畫安倢就要順便勾紅傘」。自動帶入仍受單次上限約束，
 * 且**明確勾選優先**——手動勾的絕不會被自動帶入的擠掉。
 */

export const PROP_OWNER_KINDS = ["character", "scene"] as const;
export type PropOwnerKind = (typeof PROP_OWNER_KINDS)[number];

export const PROP_OWNER_LABEL: Record<PropOwnerKind, string> = {
  character: "角色隨身",
  scene: "場景物件",
};

/** 卡片列最小形狀（client 用 list 回傳列、server 用 DB 列，欄位相同即可） */
export type PropOwnerRow = {
  id: string;
  ownerKind?: PropOwnerKind | null;
  ownerId?: string | null;
};

/** 歸屬顯示名：有主人就「主人的物件」，否則原名（注入與 UI 共用，兩邊不分岔） */
export function formatPropDisplayName(name: string, ownerName?: string | null): string {
  const owner = ownerName?.trim();
  return owner ? `${owner}的${name}` : name;
}

/**
 * 依勾選的角色／場景卡，挑出應自動帶入的素材卡 id。
 *
 * 順序＝主人被勾選的順序（角色先於場景），同一主人下依卡片原順序——
 * 這樣超過上限被截斷時，截掉的是「比較後面才勾的主人」的物件，符合直覺。
 */
export function carriedPropIdsFor(
  props: PropOwnerRow[],
  selected: { characterIds?: string[]; scenePresetIds?: string[] },
): string[] {
  const owners: Array<{ kind: PropOwnerKind; id: string }> = [
    ...(selected.characterIds ?? []).map((id) => ({ kind: "character" as const, id })),
    ...(selected.scenePresetIds ?? []).map((id) => ({ kind: "scene" as const, id })),
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const owner of owners) {
    for (const prop of props) {
      if (prop.ownerKind !== owner.kind || prop.ownerId !== owner.id) continue;
      if (seen.has(prop.id)) continue;
      seen.add(prop.id);
      out.push(prop.id);
    }
  }
  return out;
}

/**
 * 明確勾選 ＋ 自動帶入 → 實際注入的素材卡 id（去重、截到上限）。
 * 明確勾選一律排前面：上限吃緊時被丟掉的是自動帶入的，不是使用者親手勾的。
 */
export function mergePropIdsWithCarried(
  explicitIds: string[],
  carriedIds: string[],
  max: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...explicitIds, ...carriedIds]) {
    if (out.length >= max) break; // 先判上限再放，max=0 才不會漏出一張
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** UI 提示用：這次會自動多帶幾張（已扣掉本來就勾了的與超出上限的） */
export function countExtraCarriedProps(
  explicitIds: string[],
  carriedIds: string[],
  max: number,
): number {
  const merged = mergePropIdsWithCarried(explicitIds, carriedIds, max);
  const explicit = new Set(explicitIds);
  return merged.filter((id) => !explicit.has(id)).length;
}
