import { parseBoard, type BoardDoc } from "./boardDoc";
import type { SketchBoardDoc } from "@shared/boardSketch";

/**
 * 伺服器的 AI 草圖 → 白板文件，**必經 parseBoard 防禦閘**。
 *
 * parseBoard 收的是白板的「儲存格式」（點列扁平化成 [x,y,p,…]、筆畫在 `s` 鍵下），
 * 與展開器輸出的執行期形狀不同——這一層就是兩種形狀之間的橋。橋的存在理由是
 * 讓 AI 產的文件與 localStorage 讀回的走**同一道**不可信輸入閘（筆刷過 sanitizeBrush、
 * 點數上限、壞值丟棄），而不是繞過它另開一條「信任伺服器」的路。
 *
 * 教訓入檔：第一版直接 `parseBoard(JSON.stringify(doc))` 餵執行期形狀，parseBoard
 * 找不到 `s` 鍵回 null，整個功能靜默不動作——測試只斷言「形狀相容」卻沒真的
 * 呼叫 parseBoard。所以 sketchImport.test.ts 必須是「展開器輸出 → 本函式 → 非 null
 * 且筆數相同」的整條斷言。
 */
export function boardDocFromSketch(doc: SketchBoardDoc): BoardDoc | null {
  const stored = {
    v: 1,
    w: doc.w,
    h: doc.h,
    s: doc.strokes.map((stroke) => ({
      i: stroke.id,
      b: stroke.brush,
      p: stroke.points.flatMap((pt) => [pt.x, pt.y, pt.p]),
    })),
  };
  return parseBoard(JSON.stringify(stored));
}

/**
 * 白板剩餘的筆畫空間。addStroke 超過上限丟**最舊**的筆——對手繪是對的
 * （畫不下去比默默消失好解釋），對 AI 重播是災難：AI 灌滿上限會把使用者
 * 已畫的東西一筆一筆擠掉。所以重播前先算「還放得下幾筆」，超出的部分
 * 裁掉並誠實告知，絕不動使用者已有的筆畫。
 */
export function clampSketchToCapacity(
  doc: BoardDoc,
  currentStrokeCount: number,
  maxStrokes: number,
): { doc: BoardDoc; clipped: number } {
  const available = Math.max(0, maxStrokes - currentStrokeCount);
  if (doc.strokes.length <= available) return { doc, clipped: 0 };
  return {
    doc: { ...doc, strokes: doc.strokes.slice(0, available) },
    clipped: doc.strokes.length - available,
  };
}
