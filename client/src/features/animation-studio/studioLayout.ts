/**
 * 桌面版／手機輕量版的差異，全部收斂在這一個函式。
 *
 * 「輕量化」如果只是 CSS 上把面板藏起來，手機仍要付出同樣的記憶體與重繪成本——
 * 白板每畫一筆都要重走整份筆畫，低階機很快就頓到不能畫。所以輕量版真正減的是：
 *
 * 1. **筆畫上限**與**復原深度**（記憶體與重繪成本）
 * 2. **渲染像素比**（DPR 3 的手機畫 2000×1200 的白板＝2160 萬像素／幀）
 * 3. **同時在畫面上的面板數**（分鏡帶與 AI 欄改成貼底 sheet，一次只出現一個）
 *
 * 斷點 820px 沿用全站手機斷點（styles.mobile-tokens.css 的 `max-width: 820px`），
 * 兩邊各寫一個數字遲早會錯開。粗指標（觸控）在窄視窗下也走輕量版——
 * 平板橫向雖然夠寬，但手指的觸控目標需求與手機相同。
 */

/** 全站手機斷點：與 styles.mobile-tokens.css／styles.mobile-fab-01.css 一致 */
export const STUDIO_MOBILE_BREAKPOINT = 820;
/** 輕量版的媒體查詢字串（元件用 useMatchMedia 訂閱，與 CSS 同一條件） */
export const STUDIO_LITE_QUERY = `(max-width: ${STUDIO_MOBILE_BREAKPOINT}px)`;

export type StudioMode = "desktop" | "lite";

export interface StudioLayout {
  mode: StudioMode;
  /** 白板最多保留幾筆（超過丟最舊；UI 會把這個數字講給使用者聽） */
  maxStrokes: number;
  /** 可復原的步數（＝ redo 堆疊上限） */
  maxUndo: number;
  /** canvas 的 devicePixelRatio 上限 */
  maxDpr: number;
  /** 匯出 PNG 的長邊上限（手機上傳頻寬與記憶體都吃緊） */
  exportMaxEdge: number;
  /** 分鏡帶：桌機是常駐的橫向軌道，手機是叫出來的貼底 sheet */
  shotStrip: "rail" | "sheet";
  /** 筆刷櫃：桌機側邊直欄，手機底部橫向 dock */
  brushShelf: "column" | "dock";
  /** AI 欄：桌機常駐右欄，手機收進 sheet */
  aiPanel: "column" | "sheet";
  /** 是否顯示進階筆刷參數（壓力／速度／顆粒／收筆四條滑桿） */
  showBrushTuning: boolean;
}

export interface StudioEnv {
  viewportWidth: number;
  /** matchMedia("(pointer: coarse)")；未知時視為 false */
  coarsePointer?: boolean;
  devicePixelRatio?: number;
}

/**
 * 決定版面模式與各項預算。純函式：測試裡直接餵視窗寬度就能斷言
 * 「iPhone 上不會拿到桌機的筆畫上限」，不需要真的開一個瀏覽器。
 */
export function resolveStudioLayout(env: StudioEnv): StudioLayout {
  const narrow = env.viewportWidth <= STUDIO_MOBILE_BREAKPOINT;
  // 觸控裝置即使視窗寬一點（平板橫向 1024）也走輕量版：手指的操作預算和手機一樣
  const lite = narrow || (!!env.coarsePointer && env.viewportWidth <= 1100);
  const dpr = Number.isFinite(env.devicePixelRatio) && (env.devicePixelRatio as number) > 0 ? (env.devicePixelRatio as number) : 1;
  if (lite) {
    return {
      mode: "lite",
      maxStrokes: 400,
      maxUndo: 20,
      maxDpr: Math.min(2, dpr),
      exportMaxEdge: 1280,
      shotStrip: "sheet",
      brushShelf: "dock",
      aiPanel: "sheet",
      showBrushTuning: false,
    };
  }
  return {
    mode: "desktop",
    maxStrokes: 2000,
    maxUndo: 60,
    maxDpr: Math.min(2, dpr),
    exportMaxEdge: 2048,
    shotStrip: "rail",
    brushShelf: "column",
    aiPanel: "column",
    showBrushTuning: true,
  };
}

/**
 * 白板顯示尺寸：在給定的容器裡「整張放得下」的縮放與置中位移。
 * 兩個版本共用同一套（手機只是容器比較小），所以放在這裡而不是元件裡。
 */
export function fitBoardToBox(
  board: { w: number; h: number },
  box: { w: number; h: number },
): { scale: number; offsetX: number; offsetY: number } {
  if (board.w <= 0 || board.h <= 0 || box.w <= 0 || box.h <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(box.w / board.w, box.h / board.h);
  return {
    scale,
    offsetX: (box.w - board.w * scale) / 2,
    offsetY: (box.h - board.h * scale) / 2,
  };
}

/** 縮放上下限：放到看不見筆尖或大到只剩一個像素都不是有用的狀態 */
export const STUDIO_ZOOM = { min: 0.25, max: 6 } as const;

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(STUDIO_ZOOM.max, Math.max(STUDIO_ZOOM.min, scale));
}
