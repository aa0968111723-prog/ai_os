/**
 * 連戲承接（重構需求 §8）：把上一鏡的設定接到這一鏡。
 *
 * 為什麼做成「明確的一次性套用」而不是持久 🔒 自動跟隨：
 *   自動跟隨要在每次讀取／生成時即時解析「我跟的那一鏡現在是什麼」，
 *   而上一鏡本身也可能在跟更前面一鏡——一條鏈上任何一環改動都要級聯重算，
 *   還得處理插鏡／刪鏡／換序造成的「我在跟誰」漂移。那是一整套推導系統，
 *   而它換來的好處，一顆「從上一鏡承接」按鈕就能給。
 *
 *   更重要的是可預期性：使用者按下去、看到差異、東西就定在那裡不會再自己動。
 *   隱形的自動跟隨會讓「我明明調好了，怎麼又變回去」變成常態客訴。
 *
 * 所以這裡回傳的是「要寫進這一鏡的 patch」與「人看得懂的差異」，
 * 與 §12 direct_shot 的變更預覽同一套思路。
 */
import { SHOT_DIRECTION_FIELD_LABEL, type ShotCamera } from "./story";

/** 可承接的面向。順序＝UI 呈現順序。 */
export const CONTINUITY_ASPECTS = ["characters", "looks", "location", "camera"] as const;
export type ContinuityAspect = (typeof CONTINUITY_ASPECTS)[number];

export const ASPECT_LABEL: Record<ContinuityAspect, string> = {
  characters: "角色",
  looks: "造型",
  location: "場景",
  camera: "攝影風格",
};

/**
 * 攝影風格只承接「整部片該一致」的欄位，不承接「這一鏡獨有」的。
 *
 * 鏡別／運鏡刻意排除：那正是每一鏡要不一樣的地方——全片都用同一個鏡別
 * 就不叫分鏡了。光線與構圖屬於作品調性，跨鏡一致才對。
 */
export const CAMERA_CONTINUITY_FIELDS = ["lighting", "composition", "focalLength"] as const;

/** 承接來源與目標都只需要這幾欄——直接吃 scenes 的列 */
export interface ContinuityShot {
  characterIds: string[] | null;
  lookIds: string[] | null;
  scenePresetIds: string[] | null;
  camera: ShotCamera | null;
}

export interface ContinuityPatch {
  characterIds?: string[];
  lookIds?: string[];
  scenePresetIds?: string[];
  camera?: ShotCamera | null;
}

const sameIds = (a: string[] | null | undefined, b: string[] | null | undefined) =>
  JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

/**
 * 算出「把 prev 的指定面向接到 cur」要寫什麼、以及會改到什麼。
 *
 * 沒有差異的面向不會進 patch——這樣呼叫端能據此判斷「其實沒東西要承接」，
 * 而不是送出一個什麼都沒改的寫入還回報成功。
 */
export function buildContinuityPatch(
  prev: ContinuityShot,
  cur: ContinuityShot,
  aspects: readonly ContinuityAspect[],
): { patch: ContinuityPatch; changes: string[] } {
  const patch: ContinuityPatch = {};
  const changes: string[] = [];
  const want = new Set(aspects);

  if (want.has("characters") && !sameIds(prev.characterIds, cur.characterIds)) {
    patch.characterIds = [...(prev.characterIds ?? [])];
    changes.push(`角色：${cur.characterIds?.length ?? 0} → ${prev.characterIds?.length ?? 0} 位`);
  }
  if (want.has("looks") && !sameIds(prev.lookIds, cur.lookIds)) {
    patch.lookIds = [...(prev.lookIds ?? [])];
    changes.push(`造型：${cur.lookIds?.length ?? 0} → ${prev.lookIds?.length ?? 0} 套`);
  }
  if (want.has("location") && !sameIds(prev.scenePresetIds, cur.scenePresetIds)) {
    patch.scenePresetIds = [...(prev.scenePresetIds ?? [])];
    changes.push(`場景：${cur.scenePresetIds?.length ?? 0} → ${prev.scenePresetIds?.length ?? 0} 個`);
  }
  if (want.has("camera")) {
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(cur.camera ?? {})) {
      if (typeof v === "string" && v.trim()) merged[k] = v.trim();
    }
    const fieldChanges: string[] = [];
    for (const f of CAMERA_CONTINUITY_FIELDS) {
      const from = (cur.camera?.[f] ?? "").trim();
      const to = (prev.camera?.[f] ?? "").trim();
      if (from === to) continue;
      if (to) merged[f] = to;
      else delete merged[f];
      fieldChanges.push(`${SHOT_DIRECTION_FIELD_LABEL[f] ?? f} ${from || "－"}→${to || "－"}`);
    }
    if (fieldChanges.length) {
      patch.camera = Object.keys(merged).length ? (merged as ShotCamera) : null;
      changes.push(...fieldChanges);
    }
  }

  return { patch, changes };
}
