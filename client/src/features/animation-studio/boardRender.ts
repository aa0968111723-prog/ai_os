/**
 * 把筆畫畫到 canvas 上。
 *
 * 這一層只吃 2D context 介面、不碰 React 也不碰 DOM 事件，因此可以用假的 ctx
 * 斷言「橡皮擦真的用 destination-out」「麥克筆真的是 multiply」——這些是肉眼
 * 看得出來、但沒有測試就會在重構時默默壞掉的東西。
 *
 * **決定性**是這裡的紅線：鉛筆的紙紋、噴槍的散點都不能用 Math.random()。
 * 白板每次縮放／切換分鏡都會整份重畫，用亂數的話同一筆畫每次長得都不一樣，
 * 看起來像畫面在抖。所以顆粒一律由「筆畫 id ＋ 點序號」推導（見 hashUnit）。
 */

import {
  resamplePath,
  smoothPoints,
  speedBetween,
  strokeWidthAt,
  taperFactor,
  type BrushSpec,
  type StrokePoint,
} from "./brushes";
import type { BoardDoc, Stroke } from "./boardDoc";

/** 白板座標 → 畫布座標的檢視變換 */
export interface BoardView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** 決定性的 0–1 偽亂數：同樣的種子永遠得到同一個值（見檔頭「決定性」） */
export function hashUnit(seed: string, index: number): number {
  let h = 2166136261 ^ index;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 取高位轉 0–1，低位在連續 index 下規律性太強（會看出斜紋）
  return ((h >>> 8) & 0xffff) / 0xffff;
}

/** #rrggbb + alpha → rgba()，避免在 canvas 上疊 globalAlpha 造成筆畫接縫變深 */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 每一段的寬度：壓力 × 速度 × 收筆，全部委派 brushes 的純函式 */
function segmentWidth(brush: BrushSpec, points: readonly StrokePoint[], i: number): number {
  const cur = points[i]!;
  const prev = points[Math.max(0, i - 1)]!;
  // 沒有時間戳時用點距近似速度：重畫存檔的筆畫時仍要有一致的粗細變化
  const approxSpeed = speedBetween({ x: prev.x, y: prev.y, t: 0 }, { x: cur.x, y: cur.y, t: 8 });
  return strokeWidthAt(brush, cur.p, approxSpeed) * taperFactor(brush, i, points.length);
}

/** 逐段畫線（壓力線寬＋決定性顆粒抖動）。colorStyle 由呼叫端決定：
 *  直接畫時帶透明度，離屏合成時畫不透明、透明度整筆一次套。 */
function paintSegments(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  pts: readonly StrokePoint[],
  view: BoardView,
  colorStyle: string,
): void {
  const { brush } = stroke;
  const toX = (x: number) => x * view.scale + view.offsetX;
  const toY = (y: number) => y * view.scale + view.offsetY;
  ctx.strokeStyle = colorStyle;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    let width = segmentWidth(brush, pts, i) * view.scale;
    let jitterX = 0;
    let jitterY = 0;
    if (brush.grain > 0) {
      // 鉛筆／粉筆：線寬與位置各抖一點點，抖幅隨顆粒度成長但不超過半個線寬
      const j1 = hashUnit(stroke.id, i);
      const j2 = hashUnit(stroke.id, i + 9973);
      width *= 1 - brush.grain * 0.45 * j1;
      const amp = brush.grain * width * 0.35;
      jitterX = (j2 - 0.5) * amp;
      jitterY = (hashUnit(stroke.id, i + 31337) - 0.5) * amp;
    }
    ctx.lineWidth = Math.max(0.35, width);
    ctx.beginPath();
    ctx.moveTo(toX(a.x) + jitterX, toY(a.y) + jitterY);
    ctx.lineTo(toX(b.x) + jitterX, toY(b.y) + jitterY);
    ctx.stroke();
  }
}

/** 離屏畫布（模組層共用一張，逐筆重用；只在真瀏覽器環境存在） */
let scratch: HTMLCanvasElement | null = null;

/**
 * 半透明筆刷的**均勻墨色**離屏合成。
 *
 * 逐段 round-cap 畫線時，每個關節的圓頭會與下一段重疊——透明度 <1 時
 * 疊兩層就變深，整條線佈滿深色小節點，這是「畫出來像麥克筆沒水」的元兇。
 * 修法：先把整筆以**不透明**畫到離屏畫布（重疊處疊了也看不出來），
 * 再以筆刷透明度一次貼回主畫布——整筆墨色均勻，麥克筆的 multiply
 * 也只在「筆與筆之間」發生（這才是麥克筆的物理）。
 *
 * 回傳 false＝環境不支援（測試的假 ctx、jsdom）——退回逐段直畫，
 * 視覺合約（multiply／線寬／位置）不變，只是關節略深。
 */
function paintUniformInk(ctx: CanvasRenderingContext2D, stroke: Stroke, pts: readonly StrokePoint[], view: BoardView): boolean {
  if (typeof document === "undefined") return false;
  const target = (ctx as Partial<CanvasRenderingContext2D>).canvas;
  if (!target || typeof ctx.getTransform !== "function" || typeof ctx.drawImage !== "function") return false;
  let sctx: CanvasRenderingContext2D | null = null;
  let t: DOMMatrix;
  try {
    if (!scratch) scratch = document.createElement("canvas");
    if (scratch.width !== target.width || scratch.height !== target.height) {
      scratch.width = target.width;
      scratch.height = target.height;
    }
    sctx = scratch.getContext("2d");
    t = ctx.getTransform();
  } catch {
    return false;
  }
  if (!sctx || !t) return false;

  const { brush } = stroke;
  // 這一筆在裝置像素座標的包圍盒（含線寬與顆粒抖動的餘裕），離屏只清、只貼這一塊
  const pad = (brush.size * (1 + brush.grain) + 4) * view.scale;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const pt of pts) {
    const x = pt.x * view.scale + view.offsetX;
    const y = pt.y * view.scale + view.offsetY;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bx = Math.max(0, Math.floor((minX - pad) * t.a + t.e));
  const by = Math.max(0, Math.floor((minY - pad) * t.d + t.f));
  const bw = Math.min(target.width - bx, Math.ceil((maxX - minX + pad * 2) * t.a));
  const bh = Math.min(target.height - by, Math.ceil((maxY - minY + pad * 2) * t.d));
  if (bw <= 0 || bh <= 0) return true; // 完全在畫布外：不畫也是畫完了

  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(bx, by, bw, bh);
  sctx.setTransform(t);
  sctx.lineCap = "round";
  sctx.lineJoin = "round";
  sctx.globalCompositeOperation = "source-over";
  paintSegments(sctx, stroke, pts, view, withAlpha(brush.color, 1));

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = brush.opacity;
  ctx.globalCompositeOperation = brush.engine === "marker" ? "multiply" : "source-over";
  ctx.drawImage(scratch!, bx, by, bw, bh, bx, by, bw, bh);
  ctx.restore();
  return true;
}

/**
 * 畫一筆。`view` 是白板座標→畫布座標的變換；線寬也跟著縮放，
 * 否則放大後線條會維持螢幕粗細（看起來像貼上去的貼紙，不像放大的畫）。
 */
export function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, view: BoardView): void {
  const { brush } = stroke;
  const pts = brush.engine === "spray" ? stroke.points : smoothPoints(stroke.points);
  if (pts.length === 0) return;
  const toX = (x: number) => x * view.scale + view.offsetX;
  const toY = (y: number) => y * view.scale + view.offsetY;

  // 半透明線刷（鉛筆／麥克筆／毛筆）走均勻墨色合成；不支援的環境退回逐段直畫
  if (
    brush.engine !== "eraser" && brush.engine !== "spray" &&
    brush.opacity < 0.999 && pts.length > 1 &&
    paintUniformInk(ctx, stroke, pts, view)
  ) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (brush.engine === "eraser") {
    // 橡皮擦＝挖掉已畫的像素。用白色蓋不行：白板底色可能是參考圖或紙紋。
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0, 0, 0, 1)";
  } else if (brush.engine === "marker") {
    // 麥克筆／螢光筆疊在一起要變深，這是 multiply 的定義
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = withAlpha(brush.color, brush.opacity);
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = withAlpha(brush.color, brush.opacity);
  }

  if (brush.engine === "spray") {
    renderSpray(ctx, stroke, view);
    ctx.restore();
    return;
  }

  // 單點（點一下沒有拖曳）：畫一個圓點，否則使用者會覺得「點了沒反應」
  if (pts.length === 1) {
    const only = pts[0]!;
    const w = strokeWidthAt(brush, only.p) * view.scale;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(toX(only.x), toY(only.y), Math.max(0.4, w / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // 橡皮擦固定全不透明（濃度值對它無意義，見 BrushSpec 註解）
  paintSegments(ctx, stroke, pts, view, brush.engine === "eraser" ? "rgba(0, 0, 0, 1)" : withAlpha(brush.color, brush.opacity));
  ctx.restore();
}

/** 噴槍：沿路徑等距蓋章，每個章是一圈散點（散佈同樣是決定性的） */
function renderSpray(ctx: CanvasRenderingContext2D, stroke: Stroke, view: BoardView): void {
  const { brush } = stroke;
  const spacing = Math.max(1, brush.size * 0.22);
  const path = resamplePath(stroke.points, spacing);
  ctx.fillStyle = withAlpha(brush.color, Math.min(1, brush.opacity));
  const dotsPerStamp = 6 + Math.round(brush.grain * 10);
  for (let i = 0; i < path.length; i += 1) {
    const pt = path[i]!;
    const radius = (strokeWidthAt(brush, pt.p) * taperFactor(brush, i, path.length)) / 2;
    for (let d = 0; d < dotsPerStamp; d += 1) {
      const seed = i * 97 + d;
      const angle = hashUnit(stroke.id, seed) * Math.PI * 2;
      // sqrt 讓散點在圓面積上均勻分布（不 sqrt 會全部擠在圓心）
      const dist = Math.sqrt(hashUnit(stroke.id, seed + 5011)) * radius;
      const x = (pt.x + Math.cos(angle) * dist) * view.scale + view.offsetX;
      const y = (pt.y + Math.sin(angle) * dist) * view.scale + view.offsetY;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.3, brush.size * 0.03 * view.scale), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** 整份白板重畫（切換分鏡、縮放、復原後都走這裡） */
export function renderBoard(ctx: CanvasRenderingContext2D, doc: BoardDoc, view: BoardView): void {
  for (const stroke of doc.strokes) renderStroke(ctx, stroke, view);
}

/**
 * 白板紙面：白底＋外框。畫在筆畫之下，讓「白板邊界」看得見——
 * 沒有邊界的話使用者不知道畫出去的部分不會被匯出。
 */
export function renderPaper(
  ctx: CanvasRenderingContext2D,
  doc: BoardDoc,
  view: BoardView,
  paperColor = "#ffffff",
): void {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = paperColor;
  ctx.fillRect(view.offsetX, view.offsetY, doc.w * view.scale, doc.h * view.scale);
  ctx.restore();
}
