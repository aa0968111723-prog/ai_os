/**
 * 「收錄筆刷」的規則（純函式）。
 *
 * 心智模型只有一條：**內建筆刷是範本，收藏的筆刷是你的**。
 * - 調整內建筆刷 → 只影響這次落筆，不會改到內建（下次點回來還是原本的手感）。
 * - 收藏 → 把現在調好的參數存成一支新的、屬於你的筆。
 * - 調整自己的筆 → 直接記住（那就是你的筆，沒有「要不要存」這個問題）。
 *
 * 這幾條寫在元件的 onChange 裡就會互相打架（最典型的災情是調了內建筆刷，
 * 換一支再換回來，手感回不去也說不清為什麼），所以獨立成可測的函式。
 */

import { nextBrushId, sanitizeBrush, type BrushSpec } from "./brushes";
import { MAX_SAVED_BRUSHES } from "./studioStorage";

export interface CollectResult {
  saved: BrushSpec[];
  /** 新收藏的筆刷 id；沒收成（已達上限）時為 null */
  id: string | null;
  /** 沒收成的原因，直接顯示給使用者 */
  error?: string;
}

/** 把現在調好的參數收藏成一支新筆刷。名稱留空時用筆尖種類當名字。 */
export function collectBrush(saved: readonly BrushSpec[], draft: BrushSpec, name: string): CollectResult {
  if (saved.length >= MAX_SAVED_BRUSHES) {
    return { saved: [...saved], id: null, error: `收藏已滿（最多 ${MAX_SAVED_BRUSHES} 支），先刪掉不用的再收` };
  }
  const id = nextBrushId(saved);
  const brush = sanitizeBrush({ ...draft, id, name: name.trim() || draft.name, builtin: undefined }, id);
  // sanitizeBrush 只在輸入帶 builtin 時才補旗標，這裡再明確剝一次：收藏的筆一定是可刪可改的
  const mine: BrushSpec = { ...brush, builtin: undefined };
  return { saved: [...saved, mine], id };
}

/** 調整自己的筆刷＝直接記住。傳進來的若是內建筆刷則原樣回傳（內建不可變）。 */
export function updateSavedBrush(saved: readonly BrushSpec[], brush: BrushSpec): BrushSpec[] {
  if (brush.builtin) return [...saved];
  if (!saved.some((b) => b.id === brush.id)) return [...saved];
  return saved.map((b) => (b.id === brush.id ? { ...sanitizeBrush(brush, b.id), builtin: undefined } : b));
}

export function removeSavedBrush(saved: readonly BrushSpec[], id: string): BrushSpec[] {
  return saved.filter((b) => b.id !== id);
}

export function renameSavedBrush(saved: readonly BrushSpec[], id: string, name: string): BrushSpec[] {
  const clean = name.trim().slice(0, 24);
  if (!clean) return [...saved];
  return saved.map((b) => (b.id === id ? { ...b, name: clean } : b));
}

/**
 * 選了一支筆之後拿來畫的「工作副本」。
 * 一定要複製：直接拿內建筆刷物件去調整會就地改到 BUILTIN_BRUSHES（凍結物件在
 * strict mode 下丟例外，非 strict 下更糟——整站的內建筆刷被默默改掉）。
 */
export function workingCopy(brush: BrushSpec): BrushSpec {
  return { ...brush };
}

/** 使用者調過參數了嗎（決定要不要顯示「收藏這支筆刷」） */
export function isTuned(base: BrushSpec, draft: BrushSpec): boolean {
  return (
    base.size !== draft.size ||
    base.opacity !== draft.opacity ||
    base.pressure !== draft.pressure ||
    base.speed !== draft.speed ||
    base.grain !== draft.grain ||
    base.taper !== draft.taper ||
    base.color !== draft.color
  );
}
