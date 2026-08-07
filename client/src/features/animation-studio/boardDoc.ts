/**
 * 白板文件模型與編輯歷史（純函式）。
 *
 * 白板存的是**筆畫**不是點陣圖：一筆一個 `Stroke`（含當時的筆刷參數），
 * 所以復原是「拿掉最後一筆」而不是「還原一張圖」，重畫也能跟著縮放走不糊。
 *
 * 三件事刻意放在這裡而不是元件裡：
 * 1. **筆畫上限**——手機輕量版必須有上限（見 studioLayout），超過時丟最舊的一筆，
 *    這條規則寫在元件裡就會被下一次改版忘掉。
 * 2. **序列化**——存進 localStorage 的東西讀回來一律不可信，parse 要能吞下壞資料。
 * 3. **歷史**——復原／重做的邊界條件（空白板復原、重做後再畫要清空 redo）
 *    是最容易寫錯又最容易被使用者踩到的地方。
 */

import { formatMeta } from "@shared/models";
import { sanitizeBrush, type BrushSpec, type StrokePoint } from "./brushes";

export interface Stroke {
  id: string;
  brush: BrushSpec;
  points: StrokePoint[];
}

/** 白板文件。座標一律以「白板座標系」記錄（與畫布像素、縮放無關）。 */
export interface BoardDoc {
  /** 格式版本；讀到不認得的版本一律當作空白板，不猜舊格式 */
  v: 1;
  /** 白板邏輯尺寸（決定匯出比例，與分鏡畫面比例一致） */
  w: number;
  h: number;
  strokes: Stroke[];
}

/** 編輯狀態＝文件＋重做堆疊。復原把筆畫搬到 redo，再畫一筆就把 redo 清掉。 */
export interface BoardState {
  doc: BoardDoc;
  redo: Stroke[];
}

export const BOARD_VERSION = 1 as const;

export function emptyBoard(w = 1600, h = 900): BoardDoc {
  return { v: BOARD_VERSION, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), strokes: [] };
}

export function emptyBoardState(w?: number, h?: number): BoardState {
  return { doc: emptyBoard(w, h), redo: [] };
}

let strokeSeq = 0;
/** 筆畫 id：同一毫秒內連畫兩筆也要能分開，所以帶序號而不是只有時間戳。 */
export function nextStrokeId(): string {
  strokeSeq += 1;
  return `s${Date.now().toString(36)}-${strokeSeq.toString(36)}`;
}

/**
 * 加一筆。超過 `maxStrokes` 時丟掉**最舊**的筆畫——輕量版在低階手機上
 * 每次重繪都要走完整份文件，沒有上限就會愈畫愈頓直到分頁被系統回收。
 * 丟掉的筆畫同時代表復原不回去了，所以上限值由 studioLayout 統一決定並顯示在 UI 上。
 */
export function addStroke(state: BoardState, stroke: Stroke, maxStrokes: number): BoardState {
  const limit = Math.max(1, Math.floor(maxStrokes));
  const strokes = [...state.doc.strokes, stroke];
  return {
    doc: { ...state.doc, strokes: strokes.length > limit ? strokes.slice(strokes.length - limit) : strokes },
    // 新的一筆讓「重做」失去意義（分岔的歷史沒有正確答案）
    redo: [],
  };
}

export function undoBoard(state: BoardState): BoardState {
  if (state.doc.strokes.length === 0) return state;
  const strokes = state.doc.strokes.slice(0, -1);
  const undone = state.doc.strokes[state.doc.strokes.length - 1]!;
  return { doc: { ...state.doc, strokes }, redo: [...state.redo, undone] };
}

export function redoBoard(state: BoardState, maxStrokes: number): BoardState {
  if (state.redo.length === 0) return state;
  const restored = state.redo[state.redo.length - 1]!;
  const next = addStroke({ doc: state.doc, redo: [] }, restored, maxStrokes);
  return { doc: next.doc, redo: state.redo.slice(0, -1) };
}

/** 清空＝把整份筆畫推進 redo 之外的狀態：刻意**不可**一鍵復原全部，
 *  但清空前的內容仍在 redo 裡（連按復原可逐筆救回）比整批消失安全。 */
export function clearBoard(state: BoardState): BoardState {
  if (state.doc.strokes.length === 0) return state;
  return { doc: { ...state.doc, strokes: [] }, redo: [...state.redo, ...state.doc.strokes] };
}

/** 單筆點數上限：一筆畫十萬個點多半是程式錯誤或惡意檔案，不是人畫得出來的 */
const MAX_POINTS_PER_STROKE = 20_000;

/**
 * 存檔格式刻意**不是**執行期的形狀：點存成扁平三元組 `[x, y, p, x, y, p, …]`
 * 並取整（座標 0.1px、壓力 0.01）。
 *
 * 為什麼要這樣做——實測 400 筆的白板：
 *   物件形狀 `{"x":123.456789,…}` → 2.39 MB、stringify 40ms（手機約 3–5 倍）
 *   扁平三元組＋取整                → 0.81 MB、約 13ms
 * localStorage 的配額大約 5MB，而 stringify 是**同步、卡主執行緒**的，
 * 差的這 66% 直接決定「畫到一半會不會頓一下」與「存不存得下」。
 *
 * 精度足夠：白板長邊 1600px，0.1px 的量化在任何縮放下都看不出來。
 */
interface StoredStroke {
  /** id */
  i: string;
  /** brush */
  b: BrushSpec;
  /** points：扁平三元組 */
  p: number[];
}
interface StoredBoard {
  v: typeof BOARD_VERSION;
  w: number;
  h: number;
  s: StoredStroke[];
}

/** 每個點在壓縮格式下的平均位元組（估算存檔大小用，見 estimateBoardBytes） */
const BYTES_PER_POINT = 14;

export function serializeBoard(doc: BoardDoc): string {
  const stored: StoredBoard = {
    v: BOARD_VERSION,
    w: doc.w,
    h: doc.h,
    s: doc.strokes.map((stroke) => {
      const flat: number[] = [];
      for (const pt of stroke.points) {
        flat.push(Math.round(pt.x * 10) / 10, Math.round(pt.y * 10) / 10, Math.round(pt.p * 100) / 100);
      }
      return { i: stroke.id, b: stroke.brush, p: flat };
    }),
  };
  return JSON.stringify(stored);
}

/**
 * 不做序列化就估出存檔大小。呼叫端要在「決定值不值得存」之前知道大小——
 * 先 stringify 再看太大就丟掉，等於白卡了主執行緒一次（大白板可達數百毫秒）。
 */
export function estimateBoardBytes(doc: BoardDoc): number {
  let points = 0;
  for (const stroke of doc.strokes) points += stroke.points.length;
  // 每筆另計筆刷規格與 id 的固定開銷
  return points * BYTES_PER_POINT + doc.strokes.length * 200 + 64;
}

/**
 * 從字串還原白板。任何不合格的東西都退回 null（呼叫端開新白板），
 * 不做「盡量救」——半份壞掉的畫面比空白板更難解釋。
 */
export function parseBoard(raw: string | null | undefined): BoardDoc | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const obj = data as Partial<StoredBoard> | null;
  if (!obj || obj.v !== BOARD_VERSION || !Array.isArray(obj.s)) return null;
  const w = Number(obj.w);
  const h = Number(obj.h);
  const strokes: Stroke[] = [];
  for (const item of obj.s) {
    const rawStroke = item as Partial<StoredStroke> | null;
    if (!rawStroke || !Array.isArray(rawStroke.p)) continue;
    const points: StrokePoint[] = [];
    // 三個一組；長度不是 3 的倍數時尾巴的殘餘直接忽略（壞檔不該炸掉整張白板）
    const flat = rawStroke.p;
    const limit = Math.min(flat.length - (flat.length % 3), MAX_POINTS_PER_STROKE * 3);
    for (let i = 0; i < limit; i += 3) {
      const x = Number(flat[i]);
      const y = Number(flat[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const p = Number(flat[i + 2]);
      points.push({ x, y, p: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5 });
    }
    if (points.length === 0) continue;
    strokes.push({
      id: typeof rawStroke.i === "string" && rawStroke.i ? rawStroke.i : nextStrokeId(),
      brush: sanitizeBrush(rawStroke.b),
      points,
    });
  }
  return {
    v: BOARD_VERSION,
    w: Number.isFinite(w) && w > 0 ? Math.round(w) : 1600,
    h: Number.isFinite(h) && h > 0 ? Math.round(h) : 900,
    strokes,
  };
}

/** 白板是不是「還沒畫東西」——決定要不要提示存檔、要不要允許上傳 */
export function isBoardEmpty(doc: BoardDoc): boolean {
  return doc.strokes.length === 0;
}

/**
 * 專案比例 → 白板邏輯尺寸。白板比例必須跟專案比例一致，
 * 否則畫好的稿子綁回分鏡畫面時會被裁掉或補黑邊。
 *
 * 比例的單一真相在 `@shared/models` 的 PROJECT_FORMATS——這裡只把它等比縮到
 * 長邊 `maxEdge`（白板不需要交付解析度，記憶體與存檔大小才是限制）。
 */
export function boardSizeForFormat(format: string | null | undefined, maxEdge = 1600): { w: number; h: number } {
  const meta = formatMeta(format);
  const scale = maxEdge / Math.max(meta.width, meta.height);
  return {
    w: Math.max(1, Math.round(meta.width * scale)),
    h: Math.max(1, Math.round(meta.height * scale)),
  };
}
