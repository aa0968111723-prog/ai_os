import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  normalizePressure,
  speedBetween,
  type BrushSpec,
  type StrokePoint,
} from "./brushes";
import { nextStrokeId, type BoardDoc, type Stroke } from "./boardDoc";
import { renderBoard, renderStroke } from "./boardRender";
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
}: WhiteboardCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  /** 進行中的一筆：放 ref 不放 state——每個 move 都 setState 會讓 React 成為筆跡的瓶頸 */
  const drawing = useRef<{ pointerId: number; points: StrokePoint[]; last: { x: number; y: number; t: number } } | null>(null);
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

  /** 已提交筆畫的重畫（切換分鏡、復原、縮放後） */
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || box.w === 0 || box.h === 0) return;
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    renderBoard(ctx, doc, view);
  }, [doc, view, box, dpr]);

  /** live 層只跟著尺寸走；內容由指標事件直接寫 */
  useEffect(() => {
    const canvas = liveRef.current;
    if (!canvas || box.w === 0 || box.h === 0) return;
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
  }, [box, dpr]);

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

  /** 正在畫的一筆：整筆重畫在 live 層（只有一筆，成本固定） */
  const paintLive = useCallback((points: StrokePoint[]) => {
    const canvas = liveRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    renderStroke(ctx, { id: "live", brush, points }, viewRef.current);
  }, [brush, dpr]);

  /** 橡皮擦要挖的是已提交的那一層，所以直接畫在 base 上（live 層挖自己等於沒挖） */
  const eraseOnBase = useCallback((points: StrokePoint[]) => {
    const ctx = baseRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderStroke(ctx, { id: "live-eraser", brush, points: points.slice(-2) }, viewRef.current);
  }, [brush, dpr]);

  const cancelStroke = useCallback(() => {
    drawing.current = null;
    clearLive();
  }, [clearLive]);

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
    if (panMode || readOnly) {
      // 平移／唯讀：記下起點，move 時位移檢視
      gesture.current = { dist: 0, cx: e.clientX, cy: e.clientY };
      return;
    }
    const pt = toBoard(e.clientX, e.clientY);
    const point: StrokePoint = { ...pt, p: normalizePressure(e.pressure, e.pointerType === "pen") };
    drawing.current = { pointerId: e.pointerId, points: [point], last: { x: pt.x, y: pt.y, t: e.timeStamp } };
    if (brush.engine === "eraser") eraseOnBase([point, point]);
    else paintLive([point]);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (penActive.current && e.pointerType === "touch") return;

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
      const pressure = normalizePressure(sample.pressure, e.pointerType === "pen");
      // 速度用來讓毛筆飛白；時間戳缺漏時 speedBetween 會回 0（不會變成無限大）
      const speed = speedBetween(active.last, { x: pt.x, y: pt.y, t: sample.timeStamp });
      active.last = { x: pt.x, y: pt.y, t: sample.timeStamp };
      // 速度也壓一點壓力：沒有壓感的滑鼠也畫得出快細慢粗
      const p = e.pointerType === "pen" ? pressure : Math.max(0.2, Math.min(1, pressure - Math.min(0.3, speed * 0.15)));
      active.points.push({ x: pt.x, y: pt.y, p });
    }
    if (brush.engine === "eraser") eraseOnBase(active.points);
    else paintLive(active.points);
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
    onStrokeEnd({ id: nextStrokeId(), brush, points: active.points });
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
      onPointerLeave={(e) => { if (drawing.current?.pointerId === e.pointerId) finishStroke(e); }}
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
