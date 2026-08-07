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

function sanitizePoint(input: unknown): StrokePoint | null {
  const raw = input as Partial<StrokePoint> | null;
  if (!raw) return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const p = Number(raw.p);
  return { x, y, p: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5 };
}

export function serializeBoard(doc: BoardDoc): string {
  return JSON.stringify(doc);
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
  const obj = data as Partial<BoardDoc> | null;
  if (!obj || obj.v !== BOARD_VERSION || !Array.isArray(obj.strokes)) return null;
  const w = Number(obj.w);
  const h = Number(obj.h);
  const strokes: Stroke[] = [];
  for (const item of obj.strokes) {
    const rawStroke = item as Partial<Stroke> | null;
    if (!rawStroke || !Array.isArray(rawStroke.points)) continue;
    const points = rawStroke.points
      .slice(0, MAX_POINTS_PER_STROKE)
      .map(sanitizePoint)
      .filter((pt): pt is StrokePoint => pt !== null);
    if (points.length === 0) continue;
    strokes.push({
      id: typeof rawStroke.id === "string" && rawStroke.id ? rawStroke.id : nextStrokeId(),
      brush: sanitizeBrush(rawStroke.brush),
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
