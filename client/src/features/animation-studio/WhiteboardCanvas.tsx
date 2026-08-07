import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  applyPressureCurve,
  BUILTIN_BRUSHES,
  normalizePressure,
  simplifyStroke,
  speedBetween,
  stabilizeNext,
  tiltBoost,
  type BrushSpec,
  type PressureCurve,
  type StrokePoint,
} from "./brushes";
import { nextStrokeId, type BoardDoc, type Stroke } from "./boardDoc";
import { renderBoard, renderStroke, withAlpha } from "./boardRender";
import type { SketchPreview } from "./sketchReplay";
import { clampZoom, fitBoardToBox, type StudioLayout } from "./studioLayout";

export interface BoardView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface WhiteboardCanvasProps {
  doc: BoardDoc;
  brush: BrushSpec;
  layout: StudioLayout;
  /** 「手」工具：拖曳＝平移而不是畫線（桌機用滑鼠平移的唯一方式） */
  panMode: boolean;
  view: BoardView;
  onViewChange: (view: BoardView) => void;
  onStrokeEnd: (stroke: Stroke) => void;
  /** 描圖底圖：這一鏡目前的畫面。畫在 canvas 之下，不會被匯出也不會被橡皮擦擦掉 */
  referenceUrl?: string | null;
  referenceOpacity?: number;
  /** 唯讀（專案檢視者）：仍可縮放平移，但不能落筆 */
  readOnly?: boolean;
  /** AI 正在畫的那一筆（逐點前綴＋筆尖）：畫在 live 層，不進文件。null＝沒有在畫 */
  aiPreview?: SketchPreview | null;
  /** 線條穩定器強度 0-1（0＝關）：抖動修正，見 brushes.stabilizeNext */
  stabilizer?: number;
  /** 筆壓曲線校正（只影響觸控筆），見 brushes.applyPressureCurve */
  pressureCurve?: PressureCurve;
}

/**
 * 手繪大白板。
 *
 * 分成三層而不是全部畫在一張 canvas 上，是為了讓「描圖」與「橡皮擦」同時成立：
 *
 *   ① 紙面（CSS 白色方框）  ② 參考圖 <img>  ③ 筆畫 canvas（透明）
 *
 * 橡皮擦用 `destination-out` 挖掉的只有第三層，露出來的是紙面與參考圖——
 * 若把參考圖畫進 canvas，擦掉線條的同時會把描圖底稿一起擦掉。
 *
 * 另外有一張浮在最上的 live canvas 專門畫「正在畫的那一筆」：
 * 每次 pointermove 只重畫這一筆（而不是整份文件），
 * 所以白板上已經有幾百筆時，筆跡跟手的延遲仍然是常數。
 */
export function WhiteboardCanvas({
  doc,
  brush,
  layout,
  panMode,
  view,
  onViewChange,
  onStrokeEnd,
  referenceUrl,
  referenceOpacity = 0.35,
  readOnly,
  aiPreview,
  stabilizer = 0,
  pressureCurve = "normal",
}: WhiteboardCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  /** 進行中的一筆：放 ref 不放 state——每個 move 都 setState 會讓 React 成為筆跡的瓶頸。
   *  brush 凍結在落筆當下（筆尾橡皮擦時是橡皮擦）——畫到一半換筆不影響這一筆。 */
  const drawing = useRef<{ pointerId: number; points: StrokePoint[]; last: { x: number; y: number; t: number }; brush: BrushSpec } | null>(null);
  /** 手勢中的指標（兩指＝縮放平移）；同時用來做基本的手掌排除 */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  const penActive = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const dpr = Math.min(layout.maxDpr, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);

  // 容器尺寸：白板要跟著版面（手機轉向、桌機拉視窗、面板開合）即時重算
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setBox({ w: host.clientWidth, h: host.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  /**
   * 已提交筆畫的畫布狀態：畫到第幾筆、當時用的是哪個檢視。
   * 有了它才能分辨「又畫了一筆」（只畫新的那筆）與「復原／換鏡／縮放」（整份重畫）。
   */
  const drawn = useRef<{ count: number; last: Stroke | null; view: BoardView; w: number; h: number } | null>(null);
  const rasterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 把 base 畫布重畫到目前的檢視。
   *
   * `mode: "auto"` 會在「只是又多了幾筆」時只畫新增的部分——
   * 每提交一筆就整份重畫是 O(全部筆畫)，白板畫滿之後每一筆放手都會頓一下。
   */
  const raster = useCallback((mode: "auto" | "full" = "auto") => {
    const canvas = baseRef.current;
    if (!canvas || box.w === 0 || box.h === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const v = viewRef.current;
    const prev = drawn.current;
    const sameView = !!prev && prev.view.scale === v.scale && prev.view.offsetX === v.offsetX && prev.view.offsetY === v.offsetY;
    const sameSize = !!prev && prev.w === box.w && prev.h === box.h;
    // 「只是追加」＝先前畫過的最後一筆仍在同一個位置上（用參考比對，不必逐點比）
    const appended =
      mode === "auto" && sameView && sameSize && !!prev &&
      doc.strokes.length >= prev.count &&
      (prev.count === 0 || doc.strokes[prev.count - 1] === prev.last);

    if (!appended) {
      canvas.width = Math.round(box.w * dpr);
      canvas.height = Math.round(box.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, box.w, box.h);
      renderBoard(ctx, doc, v);
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let i = prev!.count; i < doc.strokes.length; i += 1) renderStroke(ctx, doc.strokes[i]!, v);
    }
    // 重畫完畢：CSS 的暫時位移歸零（縮放途中用它頂著，見下方 useEffect）
    canvas.style.transform = "";
    drawn.current = {
      count: doc.strokes.length,
      last: doc.strokes[doc.strokes.length - 1] ?? null,
      view: { ...v },
      w: box.w,
      h: box.h,
    };
  }, [box.h, box.w, doc, dpr]);

  /** 筆畫或容器尺寸變了：立刻重畫（追加時只畫新的那幾筆） */
  useEffect(() => {
    raster("auto");
  }, [raster]);

  /**
   * 縮放／平移時**不重畫**，先用 CSS transform 把既有的點陣圖搬過去，
   * 停下來之後才重新光柵化一次。
   *
   * 兩指縮放每秒會發出幾十次檢視變更；每次都重走整份筆畫，
   * 就是「一縮放就整個卡住」的來源。位移貼圖是 GPU 的工作，成本與筆畫數無關；
   * 代價只有縮放途中那一下略糊，手一放就變清楚。
   */
  useEffect(() => {
    const canvas = baseRef.current;
    const prev = drawn.current;
    if (!canvas || !prev) return;
    const sameView = prev.view.scale === view.scale && prev.view.offsetX === view.offsetX && prev.view.offsetY === view.offsetY;
    if (sameView) return;
    const s = view.scale / prev.view.scale;
    canvas.style.transformOrigin = "0 0";
    canvas.style.transform = `translate(${view.offsetX - prev.view.offsetX * s}px, ${view.offsetY - prev.view.offsetY * s}px) scale(${s})`;
    if (rasterTimer.current) clearTimeout(rasterTimer.current);
    rasterTimer.current = setTimeout(() => raster("full"), 140);
    return () => {
      if (rasterTimer.current) clearTimeout(rasterTimer.current);
    };
  }, [view, raster]);

  /** live 層只跟著尺寸走；內容由指標事件直接寫 */
  useEffect(() => {
    const canvas = liveRef.current;
    if (!canvas || box.w === 0 || box.h === 0) return;
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
  }, [box, dpr]);

  /**
   * AI 逐點作畫的預覽：正在長出來的那一筆＋筆尖游標，畫在 live 層。
   * 跟手繪共用同一張 live canvas 沒有衝突——重播中輸入被面板鎖住，
   * 但仍防禦性讓路：使用者真的在落筆時不動 live 層（他的筆跡優先）。
   * 筆尖用螢幕尺寸（不隨縮放變大變小）：它是游標不是筆畫。
   */
  useEffect(() => {
    if (drawing.current) return;
    const canvas = liveRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || box.w === 0 || box.h === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    if (!aiPreview) return;
    const pts = aiPreview.stroke.points.slice(0, Math.max(1, aiPreview.visible));
    if (pts.length === 0) return;
    renderStroke(ctx, { ...aiPreview.stroke, points: pts }, view);
    const tip = pts[pts.length - 1]!;
    const tx = tip.x * view.scale + view.offsetX;
    const ty = tip.y * view.scale + view.offsetY;
    const color = aiPreview.stroke.brush.color;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    ctx.arc(tx, ty, 9, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(color, 0.16);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(tx, ty, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(color, 0.95);
    ctx.fill();
    ctx.restore();
  }, [aiPreview, view, box, dpr]);

  const toBoard = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current;
    const v = viewRef.current;
    if (!host) return { x: 0, y: 0 };
    const rect = host.getBoundingClientRect();
    return {
      x: (clientX - rect.left - v.offsetX) / v.scale,
      y: (clientY - rect.top - v.offsetY) / v.scale,
    };
  }, []);

  const clearLive = useCallback(() => {
    const canvas = liveRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  /** 正在畫的一筆：整筆重畫在 live 層（只有一筆，成本固定）。
   *  筆刷吃這一筆凍結的那支（筆尾橡皮擦），不吃當下選中的。 */
  const paintLive = useCallback((points: StrokePoint[], strokeBrush: BrushSpec) => {
    const canvas = liveRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    renderStroke(ctx, { id: "live", brush: strokeBrush, points }, viewRef.current);
  }, [dpr]);

  /** 橡皮擦要挖的是已提交的那一層，所以直接畫在 base 上（live 層挖自己等於沒挖） */
  const eraseOnBase = useCallback((points: StrokePoint[], strokeBrush: BrushSpec) => {
    const ctx = baseRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderStroke(ctx, { id: "live-eraser", brush: strokeBrush, points: points.slice(-2) }, viewRef.current);
  }, [dpr]);

  const cancelStroke = useCallback(() => {
    drawing.current = null;
    clearLive();
  }, [clearLive]);

  /** 觸控筆的完整壓力管線：正規化 → 使用者的筆壓曲線 → 傾斜側鋒 */
  const penPressure = useCallback(
    (raw: number | undefined, tiltX: number | undefined, tiltY: number | undefined) =>
      tiltBoost(applyPressureCurve(normalizePressure(raw, true), pressureCurve), tiltX, tiltY),
    [pressureCurve],
  );

  /** 觸控筆懸浮游標：落筆前就看得到筆刷會多粗、落在哪（Apple Pencil／Wacom 的懸浮） */
  const hovering = useRef(false);
  const paintHoverCursor = useCallback((clientX: number, clientY: number) => {
    if (aiPreview) return; // live 層正在演 AI 的筆，游標讓路
    const canvas = liveRef.current;
    const ctx = canvas?.getContext("2d");
    const host = hostRef.current;
    if (!canvas || !ctx || !host) return;
    const rect = host.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const r = Math.max(1.5, (brush.size * viewRef.current.scale) / 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = brush.engine === "eraser" ? "rgba(120, 120, 128, 0.65)" : withAlpha(brush.color, 0.55);
    ctx.lineWidth = 1;
    ctx.stroke();
    hovering.current = true;
  }, [aiPreview, brush, dpr]);

  const clearHoverCursor = useCallback(() => {
    if (!hovering.current) return;
    hovering.current = false;
    if (!drawing.current && !aiPreview) clearLive();
  }, [aiPreview, clearLive]);

  const startGesture = useCallback(() => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    gesture.current = {
      dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
      cx: (a!.x + b!.x) / 2,
      cy: (a!.y + b!.y) / 2,
    };
    cancelStroke();
  }, [cancelStroke]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "pen") penActive.current = true;
    // 手掌排除：觸控筆在畫的時候，手掌落下的觸控點一律不算
    if (penActive.current && e.pointerType === "touch") return;
    if (pointers.current.size >= 2) {
      startGesture();
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    // 落筆前先把「縮放途中用 CSS 頂著」的畫布補畫回來：橡皮擦是直接畫在這張畫布上的，
    // 底圖還停在舊檢視時擦出來的痕跡會整片偏掉。
    if (rasterTimer.current) {
      clearTimeout(rasterTimer.current);
      rasterTimer.current = null;
      raster("full");
    }
    if (panMode || readOnly) {
      // 平移／唯讀：記下起點，move 時位移檢視
      gesture.current = { dist: 0, cx: e.clientX, cy: e.clientY };
      return;
    }
    const pt = toBoard(e.clientX, e.clientY);
    const isPen = e.pointerType === "pen";
    // 手寫板的橡皮擦手勢：筆尾（bit 32）翻筆就擦；側鍵（bit 2，S-Pen／Wacom 按著落筆）也算——
    // 兩者都不必去筆刷櫃換工具
    const eraserTail = isPen && (e.buttons & (32 | 2)) !== 0;
    const strokeBrush = eraserTail
      ? (BUILTIN_BRUSHES.find((b) => b.engine === "eraser") ?? brush)
      : brush;
    const pressure = isPen
      ? penPressure(e.pressure, e.tiltX, e.tiltY)
      : normalizePressure(e.pressure, false);
    const point: StrokePoint = { ...pt, p: pressure };
    drawing.current = { pointerId: e.pointerId, points: [point], last: { x: pt.x, y: pt.y, t: e.timeStamp }, brush: strokeBrush };
    if (strokeBrush.engine === "eraser") eraseOnBase([point, point], strokeBrush);
    else paintLive([point], strokeBrush);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (penActive.current && e.pointerType === "touch") return;

    // 觸控筆懸浮（還沒落筆）：畫筆刷游標，滑鼠／手指沒有懸浮這回事
    if (e.pointerType === "pen" && !drawing.current && pointers.current.size === 0 && !panMode && !readOnly) {
      paintHoverCursor(e.clientX, e.clientY);
      return;
    }

    // 兩指：縮放＋平移
    if (pointers.current.size >= 2 && gesture.current) {
      const pts = [...pointers.current.values()];
      const [a, b] = pts;
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const cx = (a!.x + b!.x) / 2;
      const cy = (a!.y + b!.y) / 2;
      const prev = gesture.current;
      const host = hostRef.current;
      if (host && prev.dist > 0 && dist > 0) {
        const rect = host.getBoundingClientRect();
        const v = viewRef.current;
        const nextScale = clampZoom(v.scale * (dist / prev.dist));
        const ratio = nextScale / v.scale;
        // 以兩指中點為錨：縮放後那個點還留在同一根手指底下
        const anchorX = prev.cx - rect.left;
        const anchorY = prev.cy - rect.top;
        onViewChange({
          scale: nextScale,
          offsetX: anchorX - (anchorX - v.offsetX) * ratio + (cx - prev.cx),
          offsetY: anchorY - (anchorY - v.offsetY) * ratio + (cy - prev.cy),
        });
      }
      gesture.current = { dist, cx, cy };
      return;
    }

    // 單指／滑鼠平移
    if ((panMode || readOnly) && gesture.current && pointers.current.has(e.pointerId)) {
      const v = viewRef.current;
      onViewChange({ scale: v.scale, offsetX: v.offsetX + (e.clientX - gesture.current.cx), offsetY: v.offsetY + (e.clientY - gesture.current.cy) });
      gesture.current = { dist: 0, cx: e.clientX, cy: e.clientY };
      return;
    }

    const active = drawing.current;
    if (!active || active.pointerId !== e.pointerId) return;
    // 合併事件：高刷新率螢幕上一個 move 可能夾帶好幾個真實取樣點，
    // 只取最後一點會讓快速畫線變成折線
    const raw = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
    for (const sample of raw.length ? raw : [e.nativeEvent]) {
      const pt = toBoard(sample.clientX, sample.clientY);
      const isPen = e.pointerType === "pen";
      // 手寫板的壓力管線：筆壓曲線校正＋傾斜側鋒（見 penPressure）
      const pressure = isPen
        ? penPressure(sample.pressure, sample.tiltX, sample.tiltY)
        : normalizePressure(sample.pressure, false);
      // 速度用來讓毛筆飛白；時間戳缺漏時 speedBetween 會回 0（不會變成無限大）
      const speed = speedBetween(active.last, { x: pt.x, y: pt.y, t: sample.timeStamp });
      active.last = { x: pt.x, y: pt.y, t: sample.timeStamp };
      // 速度也壓一點壓力：沒有壓感的滑鼠也畫得出快細慢粗
      const p = isPen ? pressure : Math.max(0.2, Math.min(1, pressure - Math.min(0.3, speed * 0.15)));
      // 線條穩定器：新點只朝目標走一部分，抖動被吸收（strength=0 時原樣通過）
      active.points.push(stabilizeNext(active.points[active.points.length - 1] ?? null, { x: pt.x, y: pt.y, p }, stabilizer));
    }
    if (active.brush.engine === "eraser") {
      // 橡皮擦不吃預測點：擦掉的像素收不回來，預測錯了就是真的擦錯
      eraseOnBase(active.points, active.brush);
      return;
    }
    // 預測筆跡（瀏覽器的手寫延遲補償）：只畫在 live 層墊在筆尖前面，
    // 絕不進文件——預測錯的尾巴會在下一個 move 被真實筆跡蓋掉
    let preview = active.points;
    if (typeof e.nativeEvent.getPredictedEvents === "function") {
      const predicted = e.nativeEvent.getPredictedEvents();
      if (predicted.length > 0) {
        const lastP = active.points[active.points.length - 1]!.p;
        preview = active.points.concat(predicted.map((s) => {
          const pt = toBoard(s.clientX, s.clientY);
          return { x: pt.x, y: pt.y, p: lastP };
        }));
      }
    }
    paintLive(preview, active.brush);
  };

  const finishStroke = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (e.pointerType === "pen") penActive.current = false;
    const active = drawing.current;
    if (!active || active.pointerId !== e.pointerId) return;
    drawing.current = null;
    clearLive();
    if (active.points.length === 0) return;
    // 抽稀只在放手時做一次：畫的當下每個取樣點都要用（手感），存進文件的不必——
    // 共線的冗餘點佔了一半以上的體積與重畫成本（見 brushes.simplifyStroke）
    onStrokeEnd({ id: nextStrokeId(), brush: active.brush, points: simplifyStroke(active.points) });
  };

  /** 滾輪：ctrl/⌘＝以游標為錨縮放；一般滾動＝平移（與繪圖軟體慣例一致） */
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    if (!host) return;
    const v = viewRef.current;
    if (e.ctrlKey || e.metaKey) {
      const rect = host.getBoundingClientRect();
      const anchorX = e.clientX - rect.left;
      const anchorY = e.clientY - rect.top;
      const nextScale = clampZoom(v.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      const ratio = nextScale / v.scale;
      onViewChange({
        scale: nextScale,
        offsetX: anchorX - (anchorX - v.offsetX) * ratio,
        offsetY: anchorY - (anchorY - v.offsetY) * ratio,
      });
      return;
    }
    onViewChange({ scale: v.scale, offsetX: v.offsetX - e.deltaX, offsetY: v.offsetY - e.deltaY });
  };

  // 首次量到容器大小時把白板整張放進畫面（使用者不必自己找白板在哪）
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current || box.w === 0 || box.h === 0) return;
    fittedRef.current = true;
    const fit = fitBoardToBox({ w: doc.w, h: doc.h }, { w: box.w - 32, h: box.h - 32 });
    onViewChange({ scale: fit.scale, offsetX: fit.offsetX + 16, offsetY: fit.offsetY + 16 });
  }, [box, doc.w, doc.h, onViewChange]);

  const paperStyle = {
    left: `${view.offsetX}px`,
    top: `${view.offsetY}px`,
    width: `${doc.w * view.scale}px`,
    height: `${doc.h * view.scale}px`,
  };

  return (
    <div
      ref={hostRef}
      className="studio-board"
      data-mode={layout.mode}
      data-tool={panMode ? "pan" : brush.engine}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
      onPointerLeave={(e) => {
        if (drawing.current?.pointerId === e.pointerId) finishStroke(e);
        else clearHoverCursor(); // 筆離開白板：懸浮游標不能留在原地
      }}
      onWheel={onWheel}
    >
      {/* 紙面：白板的邊界要看得見，否則畫出去的部分不會被匯出這件事沒人知道 */}
      <div className="studio-board__paper" style={paperStyle} aria-hidden="true" />
      {referenceUrl && (
        <img
          className="studio-board__reference"
          src={referenceUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{ ...paperStyle, opacity: referenceOpacity }}
        />
      )}
      <canvas ref={baseRef} className="studio-board__canvas" style={{ width: box.w, height: box.h }} />
      <canvas ref={liveRef} className="studio-board__canvas studio-board__canvas--live" style={{ width: box.w, height: box.h }} />
      <span className="sr-only" role="status">
        {readOnly ? "唯讀模式：可縮放檢視，不能落筆" : `目前筆刷 ${brush.name}，白板已有 ${doc.strokes.length} 筆`}
      </span>
    </div>
  );
}
