/**
 * 創作室的本機存放層：**收藏的筆刷**與**每一鏡的白板草稿**。
 *
 * 為什麼是 localStorage 而不是資料庫（沿用站內既有前例，見 `lib/densityPreference.ts`）：
 * 手繪草稿是「想到就畫、畫壞就擦」的東西，每一筆都打 API 會讓筆跡卡頓，
 * 也會把還沒成形的塗鴉塞進團隊的素材庫。真正要留下來的稿子有明確的出口——
 * 「存成這一鏡的畫面」會上傳成專案素材並綁到分鏡上（見 StudioAiPanel）。
 * 代價是草稿**綁裝置**：手機畫的不會出現在電腦上，這件事 UI 要講清楚。
 *
 * 所有讀取都當作外部輸入處理（使用者改得動、舊版格式、寫壞的 JSON），
 * 一律經過 sanitize；所有寫入都可能因隱私模式／配額失敗，一律不讓例外冒泡。
 */

import {
  BUILTIN_BRUSHES,
  sanitizeBrush,
  type BrushSpec,
} from "./brushes";
import { parseBoard, serializeBoard, type BoardDoc } from "./boardDoc";

export const BRUSH_LIBRARY_KEY = "aios.studio.brushes";
const BOARD_KEY_PREFIX = "aios.studio.board.";
/** 收藏上限：筆刷櫃是「常用的幾支」，不是無限倉庫；也順便擋住無意義的無限成長 */
export const MAX_SAVED_BRUSHES = 24;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 讀「我收藏的筆刷」（不含內建）。壞掉的項目個別跳過，不讓一筆壞資料清空整櫃。 */
export function readSavedBrushes(): BrushSpec[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(BRUSH_LIBRARY_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .slice(0, MAX_SAVED_BRUSHES)
      .map((item, i) => sanitizeBrush(item, `my.${i + 1}`))
      // builtin 旗標不可從儲存帶進來：否則手改一筆就能造出「刪不掉的假內建筆刷」
      .map((brush) => ({ ...brush, builtin: undefined }) as BrushSpec);
  } catch {
    return [];
  }
}

export function writeSavedBrushes(brushes: readonly BrushSpec[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(BRUSH_LIBRARY_KEY, JSON.stringify(brushes.slice(0, MAX_SAVED_BRUSHES)));
  } catch {
    // 配額滿或隱私模式：這次的收藏只存在記憶體裡，不打斷創作
  }
}

/** 完整筆刷櫃＝內建在前、收藏在後（順序即 UI 呈現順序） */
export function allBrushes(saved: readonly BrushSpec[]): BrushSpec[] {
  return [...BUILTIN_BRUSHES, ...saved];
}

/**
 * 每一鏡一份白板草稿。key 帶專案與分鏡 id——沒有選分鏡時的自由塗鴉存在 `_free`，
 * 這樣「還沒決定要畫哪一鏡」的靈感不會在選了分鏡之後消失。
 */
export function boardStorageKey(projectId: string, shotId: string | null): string {
  return `${BOARD_KEY_PREFIX}${projectId}.${shotId ?? "_free"}`;
}

export function readBoard(projectId: string, shotId: string | null): BoardDoc | null {
  const store = storage();
  if (!store) return null;
  try {
    return parseBoard(store.getItem(boardStorageKey(projectId, shotId)));
  } catch {
    return null;
  }
}

/**
 * 寫回草稿。配額滿時**先清掉這個專案其他鏡的草稿再試一次**——
 * 直接放棄會讓使用者以為畫好的東西有存到（畫面上還在），關掉分頁才發現全沒了。
 * 回傳是否真的寫成功，UI 據此顯示「本機草稿已滿」。
 */
export function writeBoard(projectId: string, shotId: string | null, doc: BoardDoc): boolean {
  const store = storage();
  if (!store) return false;
  const key = boardStorageKey(projectId, shotId);
  const payload = serializeBoard(doc);
  try {
    store.setItem(key, payload);
    return true;
  } catch {
    try {
      for (const other of listBoardKeys(store, projectId)) {
        if (other !== key) store.removeItem(other);
      }
      store.setItem(key, payload);
      return true;
    } catch {
      return false;
    }
  }
}

export function clearStoredBoard(projectId: string, shotId: string | null): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(boardStorageKey(projectId, shotId));
  } catch {
    // 清不掉就留著；下次寫入會覆蓋
  }
}

/** 這個專案底下所有草稿的 key（清理用） */
function listBoardKeys(store: Storage, projectId: string): string[] {
  const prefix = `${BOARD_KEY_PREFIX}${projectId}.`;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/** 這個專案有草稿的分鏡 id（分鏡帶用來標「這一鏡有手稿」） */
export function shotsWithDraft(projectId: string): Set<string> {
  const store = storage();
  if (!store) return new Set();
  const prefix = `${BOARD_KEY_PREFIX}${projectId}.`;
  const ids = new Set<string>();
  try {
    for (const key of listBoardKeys(store, projectId)) {
      const id = key.slice(prefix.length);
      if (id && id !== "_free") ids.add(id);
    }
  } catch {
    return ids;
  }
  return ids;
}
