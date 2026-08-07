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
  type PressureCurve,
} from "./brushes";
import { estimateBoardBytes, parseBoard, serializeBoard, type BoardDoc } from "./boardDoc";

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

/* ── 工作習慣偏好（穩定器等，跟裝置走） ── */

export const STUDIO_PREFS_KEY = "aios.studio.prefs";

export interface StudioPrefs {
  /** 線條穩定器強度 0-1（0＝關）。是「這台裝置＋這雙手」的習慣，不跟專案走 */
  stabilizer: number;
  /** 筆壓曲線校正（軟／標準／硬）：跟著手與筆走，同樣屬於裝置偏好 */
  pressureCurve: PressureCurve;
}

const DEFAULT_PREFS: StudioPrefs = { stabilizer: 0, pressureCurve: "normal" };

export function readStudioPrefs(): StudioPrefs {
  const store = storage();
  if (!store) return { ...DEFAULT_PREFS };
  try {
    const raw = store.getItem(STUDIO_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const data = JSON.parse(raw) as Partial<StudioPrefs>;
    const stabilizer = typeof data.stabilizer === "number" && Number.isFinite(data.stabilizer)
      ? Math.min(1, Math.max(0, data.stabilizer))
      : DEFAULT_PREFS.stabilizer;
    const pressureCurve = data.pressureCurve === "soft" || data.pressureCurve === "firm" || data.pressureCurve === "normal"
      ? data.pressureCurve
      : DEFAULT_PREFS.pressureCurve;
    return { stabilizer, pressureCurve };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writeStudioPrefs(prefs: StudioPrefs): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STUDIO_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 配額滿或隱私模式：這次的偏好只活在記憶體，不打斷創作
  }
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
 * 單張白板的本機存檔預算。localStorage 全站配額大約 5MB，而且是**整個網域共用**
 * （偏好、草稿、快取都在裡面）——一張白板吃掉全部，代價是站上其他功能開始寫不進去。
 */
export const MAX_BOARD_BYTES = 1_200_000;

/**
 * 寫回草稿。回傳是否真的寫成功，UI 據此顯示「本機草稿已滿」。
 *
 * 兩個刻意的設計：
 * 1. **先估大小再決定要不要序列化**。太大時直接回 false，不做那一次
 *    數百毫秒、同步卡住主執行緒的 stringify（見 estimateBoardBytes）。
 * 2. **配額滿時只犧牲「自由塗鴉」那一份**，絕不動其他鏡的草稿。
 *    為了存這一鏡而默默刪掉別鏡畫好的東西，是把資料遺失偽裝成復原——
 *    使用者看不到那些草稿消失，只會在切回去時發現畫沒了。
 */
export function writeBoard(projectId: string, shotId: string | null, doc: BoardDoc): boolean {
  const store = storage();
  if (!store) return false;
  if (estimateBoardBytes(doc) > MAX_BOARD_BYTES) return false;
  const key = boardStorageKey(projectId, shotId);
  const payload = serializeBoard(doc);
  try {
    store.setItem(key, payload);
    return true;
  } catch {
    // 自由塗鴉是暫存區，讓位給「有歸屬的那一鏡」是合理的取捨；其他鏡不動。
    const scratch = boardStorageKey(projectId, null);
    if (key === scratch) return false;
    try {
      store.removeItem(scratch);
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
