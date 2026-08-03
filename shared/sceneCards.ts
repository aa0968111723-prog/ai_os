/**
 * 逐鏡卡片綁定的共用規則（前後端單一真相）。
 *
 * 設計取捨——為什麼卡片本體留在專案層、只有「引用」下放到分鏡：
 * 把整張安倢複製進 12 個分鏡，改一次外觀就要改 12 次，跨鏡一致性當場毀掉。
 * 所以分鏡只存 id 引用；卡片仍是專案層的設定庫。
 *
 * 「有沒有綁」是整組判斷，不是逐欄補：只要這一鏡指定過任一種卡片，
 * 三種都以它為準。否則第 3 鏡的紅傘特寫會被全域勾選硬塞一個角色進來，
 * 逐鏡控制就失去意義——「這鏡不要人」必須表達得出來。
 */

export type SceneCardBinding = {
  characterIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
};

export type ResolvedSceneCards = {
  characterIds: string[];
  scenePresetIds: string[];
  propIds: string[];
  /** true＝用這一鏡自己的綁定；false＝這鏡沒指定，沿用呼叫端（生成台）的勾選 */
  fromScene: boolean;
};

function clean(ids: string[] | null | undefined): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 這一鏡有沒有指定過卡片（任一種非空即算） */
export function hasSceneCardBinding(scene: SceneCardBinding | null | undefined): boolean {
  if (!scene) return false;
  return (
    clean(scene.characterIds).length > 0 ||
    clean(scene.scenePresetIds).length > 0 ||
    clean(scene.propIds).length > 0
  );
}

/**
 * 這一鏡實際要用的卡片：有綁就整組用它，沒綁才退回 fallback（生成台當下的勾選）。
 * 素材的「歸屬自動帶入」仍由伺服器在送出時展開，這裡不重複那層邏輯。
 */
export function resolveSceneCards(
  scene: SceneCardBinding | null | undefined,
  fallback: SceneCardBinding | null | undefined = null,
): ResolvedSceneCards {
  const source = hasSceneCardBinding(scene) ? scene : fallback;
  return {
    characterIds: clean(source?.characterIds),
    scenePresetIds: clean(source?.scenePresetIds),
    propIds: clean(source?.propIds),
    fromScene: hasSceneCardBinding(scene),
  };
}

/** 人話摘要（分鏡表 chip／匯出用）：「安倢・禪堂・紅傘」 */
export function formatSceneCardNames(names: {
  characters?: string[];
  scenes?: string[];
  props?: string[];
}): string {
  return [...(names.characters ?? []), ...(names.scenes ?? []), ...(names.props ?? [])]
    .map((n) => n.trim())
    .filter(Boolean)
    .join("・");
}
