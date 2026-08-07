import type { BoardDoc } from "./boardDoc";

/**
 * 白板 → AI 畫草圖用的現況摘要（畫布感知）。
 *
 * AI 只拿得到**純數字**：筆數、3×3 區域的相對筆墨量、是否已有構圖外框。
 * 刻意不送筆畫本身也不送任何自由文字——座標點列對 LLM 是雜訊（它讀不出
 * 「這是一座山」），而數字摘要沒有讓白板內容夾帶提示詞注入的通道。
 * 形狀對應 shared/boardSketch 的 SketchBoardState，伺服器用 zod 再驗一次。
 *
 * 純函式、不碰 DOM：摘要規則（取樣、正規化、外框判定）要能被測試咬住。
 */

export interface BoardSummary {
  strokeCount: number;
  /** 3×3 區域的相對筆墨量 0-100（列優先：左上、上、右上、左、中央、右、左下、下、右下） */
  cells: number[];
  hasFrame: boolean;
}

/** 每筆最多取樣的點數：摘要要的是「哪裡有東西」，不需要每個取樣點都算 */
const SAMPLE_PER_STROKE = 64;

/**
 * 外框判定：一筆的包圍盒同時蓋住白板寬與高的 82% 以上，就當作構圖外框。
 * 對到 AI 自己畫的 frame（inset 內縮貼邊繞一圈）與使用者手畫的大外框；
 * 誤判的代價很小——只是提示 AI「別再畫第二個框」。
 */
const FRAME_COVER_RATIO = 0.82;

export function summarizeBoard(doc: BoardDoc): BoardSummary {
  const counts = new Array<number>(9).fill(0);
  let hasFrame = false;

  for (const stroke of doc.strokes) {
    const pts = stroke.points;
    if (pts.length === 0) continue;
    const step = Math.max(1, Math.floor(pts.length / SAMPLE_PER_STROKE));
    let minX = Infinity; let maxX = -Infinity;
    let minY = Infinity; let maxY = -Infinity;
    for (let i = 0; i < pts.length; i += step) {
      const pt = pts[i]!;
      const col = Math.min(2, Math.max(0, Math.floor((pt.x / doc.w) * 3)));
      const row = Math.min(2, Math.max(0, Math.floor((pt.y / doc.h) * 3)));
      counts[row * 3 + col]! += 1;
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    if (maxX - minX >= doc.w * FRAME_COVER_RATIO && maxY - minY >= doc.h * FRAME_COVER_RATIO) {
      hasFrame = true;
    }
  }

  // 相對量：以最滿的一格為 100。絕對點數沒有意義——取樣密度隨筆刷與畫法變，
  // 「哪裡相對比較滿、哪裡空著」才是 AI 決定畫在哪裡需要的資訊。
  const max = Math.max(1, ...counts);
  return {
    strokeCount: doc.strokes.length,
    cells: counts.map((c) => Math.round((c / max) * 100)),
    hasFrame,
  };
}
