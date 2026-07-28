import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type BrandRevealMode = "fade-rise" | "none";

export type BrandRevealProps = {
  children: ReactNode;
  /** fade-rise：淡入 + 微上移 + 輕縮放；none：立即顯示 */
  mode?: BrandRevealMode;
  /** 播放一次後記住（sessionStorage）；換路由不重播 */
  onceKey?: string;
  className?: string;
  /** 動畫時長 ms（上限 1000） */
  durationMs?: number;
};

const STORAGE_PREFIX = "aios.brandReveal.";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function alreadyPlayed(onceKey: string | undefined): boolean {
  if (!onceKey || typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + onceKey) === "1";
  } catch {
    return false;
  }
}

function markPlayed(onceKey: string | undefined) {
  if (!onceKey || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_PREFIX + onceKey, "1");
  } catch {
    /* private mode 等：略過，頂多重播一次 */
  }
}

/**
 * 進入動畫包裝：預設 fade-rise（≤1s），支援 prefers-reduced-motion 立即顯示。
 * 動畫失敗或未播完時 children 仍應可見（結束態為 opacity 1）。
 */
export function BrandReveal({
  children,
  mode = "fade-rise",
  onceKey,
  className = "",
  durationMs = 750,
}: BrandRevealProps) {
  const duration = Math.min(1000, Math.max(0, durationMs));
  const skipAnim =
    mode === "none" || prefersReducedMotion() || alreadyPlayed(onceKey);
  const [phase, setPhase] = useState<"from" | "to">(skipAnim ? "to" : "from");
  const marked = useRef(skipAnim);

  useEffect(() => {
    if (skipAnim) {
      if (!marked.current) {
        markPlayed(onceKey);
        marked.current = true;
      }
      return;
    }
    // 下一幀再切 to，確保 from 樣式已套用
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setPhase("to"));
    });
    const t = window.setTimeout(() => {
      markPlayed(onceKey);
      marked.current = true;
    }, duration);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(t);
    };
  }, [skipAnim, onceKey, duration]);

  const animated = mode !== "none" && !skipAnim;
  const style: CSSProperties = animated
    ? {
        opacity: phase === "from" ? 0 : 1,
        transform:
          phase === "from" ? "translateY(10px) scale(0.98)" : "translateY(0) scale(1)",
        ...(phase === "from"
          ? { willChange: "opacity, transform" as const }
          : {
              transition: `opacity ${duration}ms cubic-bezier(0.16, 1, 0.3, 1), transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            }),
      }
    : {};

  return (
    <div
      className={`brand-reveal brand-reveal--${mode} brand-reveal--${phase} ${className}`.trim()}
      data-brand-reveal-phase={phase}
      style={style}
    >
      {children}
    </div>
  );
}
