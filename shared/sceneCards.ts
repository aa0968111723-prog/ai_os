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

/* ------------------------------------------------------------------ *
 * 文字腳本裡的卡片行：「角色卡：安倢・師父」
 *
 * 為什麼名字可以寫回、而 id 從來不出現在文字裡：
 * 使用者寫的是劇本，不是資料庫。要他在「畫面：」旁邊貼一串 UUID，這條路就白開了。
 * 代價是名字要回推卡片——所以規則刻意嚴格：**整行要嘛全中，要嘛一張都不動**。
 * 半套用才是真正的災難：寫了三個名字、只認得兩個，靜默存兩張，等於系統替他刪了一個角色。
 * ------------------------------------------------------------------ */

/** 輸出一律用「・」；讀回時多收幾種手打常見的分隔符 */
const NAME_JOIN = "・";
const NAME_SPLIT_RE = /[・、，,／/]+/;

/**
 * 明確解除綁定的字。
 *
 * 留白**不是**解除：文字腳本的整套契約是「省略＝維持原值」，而卡片綁定被誤清的代價
 * 遠高於旁白被誤清——旁白重打一次就有，綁定要回到分鏡表逐格重勾。所以要解除得說出口。
 */
export const CARD_CLEAR_TOKEN = "無";

export type SceneCardKind = "characters" | "scenePresets" | "props";

/** 三種卡片的固定順序（文字腳本的行序、逐一處理的迴圈都用這個，不各自寫一份） */
export const SCENE_CARD_KINDS: readonly SceneCardKind[] = ["characters", "scenePresets", "props"];

/** 卡片種類 → 分鏡表上的欄名 */
export const SCENE_CARD_COLUMN = {
  characters: "characterIds",
  scenePresets: "scenePresetIds",
  props: "propIds",
} as const satisfies Record<SceneCardKind, keyof SceneCardBinding>;

/** 一張卡在文字裡可以被寫成哪些名字（素材卡有「安倢的紅傘」與「紅傘」兩種寫法） */
export type CardLookupEntry = { id: string; names: readonly string[] };

/** 名字陣列 → 一行文字 */
export function formatCardNames(names: readonly string[]): string {
  return names.map((n) => n.trim()).filter(Boolean).join(NAME_JOIN);
}

export type CardLineIntent =
  /** 這一鏡沒有這一行——維持原值 */
  | { kind: "absent" }
  /** 有這一行但留白——同樣維持原值（見 CARD_CLEAR_TOKEN 的理由） */
  | { kind: "blank" }
  /** 寫了「無」——這才是解除 */
  | { kind: "clear" }
  /** 這一行就是整份名單（不是附加） */
  | { kind: "set"; names: string[] };

export function parseCardLine(value: string | null | undefined): CardLineIntent {
  if (value === undefined || value === null) return { kind: "absent" };
  const raw = value.trim();
  if (!raw) return { kind: "blank" };
  if (raw === CARD_CLEAR_TOKEN) return { kind: "clear" };
  const names = raw.split(NAME_SPLIT_RE).map((n) => n.trim()).filter(Boolean);
  return names.length ? { kind: "set", names } : { kind: "blank" };
}

export type CardLineOutcome =
  /** 不動這一鏡的這一種卡；warning 有值代表「看得懂但不照做」，要講給使用者聽 */
  | { kind: "keep"; warning?: string }
  /** 整行解析成功——ids 就是這一鏡這一種卡的完整名單（空陣列＝解除） */
  | { kind: "set"; ids: string[] };

/**
 * 一行卡片文字 → 卡片 id。
 *
 * 任一個名字查不到、或對到不只一張同名卡，**整行都不套用**並回報原因。
 * 這是刻意的：部分套用會把「我打錯一個字」變成「系統刪掉我兩個角色」，
 * 而使用者看到的畫面只會寫「更新 1 鏡」。
 */
export function resolveCardLine(
  value: string | null | undefined,
  entries: readonly CardLookupEntry[],
  opts: { max: number; human: string; currentCount: number },
): CardLineOutcome {
  const intent = parseCardLine(value);
  if (intent.kind === "absent") return { kind: "keep" };
  if (intent.kind === "blank") {
    // 只在真的有東西會被誤清時才出聲——沒綁卡的鏡留白是常態，警告會洗版
    return opts.currentCount > 0
      ? {
          kind: "keep",
          warning: `「${opts.human}」留白＝維持原本綁定；要解除請寫「${opts.human}：${CARD_CLEAR_TOKEN}」`,
        }
      : { kind: "keep" };
  }
  if (intent.kind === "clear") return { kind: "set", ids: [] };

  const byName = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const name of entry.names) {
      const key = name.trim();
      if (!key) continue;
      const bucket = byName.get(key) ?? new Set<string>();
      bucket.add(entry.id);
      byName.set(key, bucket);
    }
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const name of intent.names) {
    const hit = byName.get(name);
    if (!hit?.size) {
      return { kind: "keep", warning: `「${opts.human}」裡找不到「${name}」，整行不套用（其餘名字也沒動）` };
    }
    if (hit.size > 1) {
      return {
        kind: "keep",
        warning: `「${opts.human}」的「${name}」對到不只一張同名卡，整行不套用——請寫完整名稱，或到分鏡表那一列改`,
      };
    }
    const id = [...hit][0]!;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length > opts.max) {
    return { kind: "keep", warning: `「${opts.human}」列了 ${ids.length} 張，單鏡最多 ${opts.max} 張，整行不套用` };
  }
  return { kind: "set", ids };
}
