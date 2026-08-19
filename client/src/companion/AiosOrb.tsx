import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { orbAccessibleLabel, type OrbState } from "@shared/companionOrb";
import { useOrbMotion } from "./useOrbMotion";

/**
 * AIOS Orb — Companion 的主體。
 *
 * ## 視覺出處
 *
 * 不是「隨便一顆漸層球」。品牌識別是 `client/public/icon.svg`：暖米紙底、
 * 一圈金環（#c9a24b）、中央留白。Orb 把那個標記變成活的——金環還是金環，
 * 只是現在會呼吸、會轉、會在任務跑的時候變成進度環；中央的留白變成一層玻璃，
 * 底下透出 board 四色（coral／amber／mint／navy，見 styles.mobile-tokens.css 檔頭）
 * 的低飽和光流。
 *
 * 刻意**沒有**的東西：滿版霓虹、彩虹漸層、賽博龐克掃描線、爆炸粒子。
 * 那些在截圖裡好看，在手裡拿三分鐘會累。
 *
 * ## 為什麼零 requestAnimationFrame
 *
 * 整顆球是 SVG ＋ CSS keyframes：transform 與 opacity 都在合成執行緒上跑，
 * 主執行緒在 idle 時**一幀都不用做事**。用 canvas 畫粒子的話，60fps 等於
 * 每秒 60 次 JS ＋ 重繪，而這顆球會在螢幕上停留數十分鐘。
 *
 * 唯一的例外是聆聽時的音量圈：它寫的是一個 CSS 變數（`--orb-amp`），
 * 由呼叫端節流到約 15Hz，不觸發 React 重繪也不重排。
 *
 * ## 降級
 *
 * 播什麼由 `useOrbMotion()` 決定（見該檔）。`still` 時所有 keyframes 都不掛，
 * 球仍然是球、顏色仍然對、進度環仍然畫得出來——只是不動。
 *
 * ## 它不是純視覺物件
 *
 * `role="button"` ＋ `aria-label` 由 `orbAccessibleLabel()` 產生，TalkBack／
 * VoiceOver 會唸「AIOS 助手，目前待機，雙擊開始對話」。鍵盤 Enter／Space 等同點擊。
 */
export interface AiosOrbProps {
  state: OrbState;
  /** 0–1；只有 executing 會畫成進度環 */
  progress?: number;
  /** 邊長（px）。首頁大球 208、分頁列小球 40。 */
  size?: number;
  /** 點一下：開始／打開對話 */
  onTap?: () => void;
  /** 按住：直接語音輸入。按住開始與放開各呼叫一次。 */
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  /** 上滑：快捷面板；下滑：關閉／最小化 */
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  /** 聆聽時的即時音量（0–1）；只在 state="listening" 有作用 */
  amplitude?: number;
  className?: string;
}

/** 按住多久算「按住」而不是「點一下」。300ms 是拇指自然停留的上緣。 */
const HOLD_MS = 300;
/** 位移超過這個距離就不是點擊，是滑動。 */
const SWIPE_PX = 36;
/** 位移超過這個距離就取消「按住」判定（手指在滑，不是在按）。 */
const HOLD_CANCEL_PX = 16;

export function AiosOrb({
  state,
  progress,
  size = 208,
  onTap,
  onHoldStart,
  onHoldEnd,
  onSwipeUp,
  onSwipeDown,
  amplitude,
  className,
}: AiosOrbProps) {
  const motion = useOrbMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gesture = useRef<{ x: number; y: number; held: boolean; id: number } | null>(null);

  /**
   * 音量寫成 CSS 變數而不是 state。
   *
   * setState 會讓整顆球（含 18 顆粒子節點）重繪，一秒十五次。寫變數只讓
   * 合成執行緒重算一個 scale，主執行緒的成本接近零。
   */
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const amp = state === "listening" && typeof amplitude === "number"
      ? Math.min(1, Math.max(0, amplitude))
      : 0;
    node.style.setProperty("--orb-amp", amp.toFixed(2));
  }, [amplitude, state]);

  const clearHold = useCallback(() => {
    clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // 只認主鍵／單指：多指縮放與右鍵選單不該被當成對球下指令。
    if (event.button !== 0) return;
    gesture.current = { x: event.clientX, y: event.clientY, held: false, id: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (!onHoldStart) return;
    clearHold();
    holdTimer.current = setTimeout(() => {
      if (!gesture.current) return;
      gesture.current.held = true;
      onHoldStart();
    }, HOLD_MS);
  }, [clearHold, onHoldStart]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId || start.held) return;
    const dx = Math.abs(event.clientX - start.x);
    const dy = Math.abs(event.clientY - start.y);
    // 手指開始滑就取消「按住」倒數：不然滑到一半會突然開始錄音。
    if (dx > HOLD_CANCEL_PX || dy > HOLD_CANCEL_PX) clearHold();
  }, [clearHold]);

  const finishGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    gesture.current = null;
    clearHold();
    if (!start || start.id !== event.pointerId) return;
    if (start.held) {
      onHoldEnd?.();
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) > SWIPE_PX && Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0) onSwipeUp?.();
      else onSwipeDown?.();
      return;
    }
    if (Math.abs(dx) < SWIPE_PX && Math.abs(dy) < SWIPE_PX) onTap?.();
  }, [clearHold, onHoldEnd, onSwipeDown, onSwipeUp, onTap]);

  /**
   * 指標被系統搶走（來電、通知下拉）時要把「按住」收乾淨。
   * 少了這一段，錄音會在使用者接完電話後還開著。
   */
  const onPointerCancel = useCallback(() => {
    const held = gesture.current?.held;
    gesture.current = null;
    clearHold();
    if (held) onHoldEnd?.();
  }, [clearHold, onHoldEnd]);

  useEffect(() => clearHold, [clearHold]);

  const label = orbAccessibleLabel(state, progress);
  const ring = useMemo(() => ringGeometry(progress), [progress]);
  const particles = useMemo(
    () => Array.from({ length: motion.particles }, (_, index) => index),
    [motion.particles],
  );

  return (
    <div
      ref={rootRef}
      className={["orb", `orb--${state}`, `orb--motion-${motion.tier}`, className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
      data-orb-state={state}
      data-motion-tier={motion.tier}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-live="polite"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={onPointerCancel}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onTap?.();
      }}
    >
      {/* 外圈光暈：純 CSS，state 換色。success 的擴散也是這一層。 */}
      <span className="orb__halo" aria-hidden="true" />

      {/* 玻璃球體：底層 board 四色光流 + 上層高光 */}
      <span className="orb__glass" aria-hidden="true">
        <span className="orb__flow orb__flow--a" />
        <span className="orb__flow orb__flow--b" />
        <span className="orb__flow orb__flow--c" />
        <span className="orb__sheen" />
      </span>

      {/* 內部粒子：只有 full tier 掛節點。reduced/still 連 DOM 都不建。 */}
      {particles.length > 0 && (
        <span className="orb__particles" aria-hidden="true">
          {particles.map((index) => (
            <span
              key={index}
              className="orb__particle"
              style={{
                // 每顆粒子的軌道半徑、起始角、週期都不同，才不會看起來像時鐘刻度。
                "--p-angle": `${(index * 360) / particles.length}deg`,
                "--p-radius": `${28 + (index % 5) * 7}%`,
                "--p-delay": `${(index % 7) * -1.3}s`,
                "--p-duration": `${11 + (index % 4) * 3}s`,
              } as React.CSSProperties}
            />
          ))}
        </span>
      )}

      {/*
        金環（品牌識別）＋ 進度環。
        兩者是同一個圓：executing 時外環從裝飾變成資訊，這是刻意的——
        使用者不需要學一個新的形狀，只要注意到它被填了一段。
      */}
      <svg className="orb__ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="orb__ring-track" cx="50" cy="50" r={RING_RADIUS} />
        {ring && (
          <circle
            className="orb__ring-progress"
            cx="50"
            cy="50"
            r={RING_RADIUS}
            strokeDasharray={`${ring.dash} ${ring.gap}`}
          />
        )}
      </svg>

      {/* 聆聽時的音量圈：scale 由 --orb-amp 驅動 */}
      <span className="orb__listen" aria-hidden="true" />
    </div>
  );
}

/** SVG viewBox 是 0–100，半徑 44 讓 4 單位的描邊不會被裁掉。 */
const RING_RADIUS = 44;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * 進度環的 dash 幾何。
 *
 * 回 null＝不畫進度環（沒有進度就不要畫一個 0% 的環，那看起來像壞掉的載入中）。
 */
function ringGeometry(progress?: number): { dash: number; gap: number } | null {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  const ratio = Math.min(1, Math.max(0, progress));
  const dash = RING_CIRCUMFERENCE * ratio;
  return { dash, gap: RING_CIRCUMFERENCE - dash };
}

export default AiosOrb;
