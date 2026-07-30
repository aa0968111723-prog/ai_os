import { useEffect, useState } from "react";
import { BRAND_NAME, BRAND_TAGLINE } from "../brand";
import { BrandLogo } from "./BrandLogo";
import { BrandReveal } from "./BrandReveal";

/**
 * Animated splash screen — fades in logo + title, then fades out when `ready`.
 *
 * Usage in App:
 *   const [splashDone, setSplashDone] = useState(false);
 *   ...
 *   {!splashDone && <SplashScreen ready={!me.isLoading} onDone={() => setSplashDone(true)} />}
 */
export function SplashScreen({
  ready = false,
  onDone,
  minMs = 900,
}: {
  /** When true, start the exit animation (e.g. auth query finished). */
  ready?: boolean;
  /** Called after the exit animation completes — unmount the splash. */
  onDone?: () => void;
  /** Minimum time to show the splash so the animation isn't cut short. */
  minMs?: number;
}) {
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");
  const [mountedAt] = useState(() => Date.now());

  // Enter → hold after CSS enter animation (~700ms)
  useEffect(() => {
    const t = setTimeout(() => setPhase("hold"), 700);
    return () => clearTimeout(t);
  }, []);

  // When ready + min time elapsed → exit
  useEffect(() => {
    if (!ready || phase === "exit") return;
    const elapsed = Date.now() - mountedAt;
    const wait = Math.max(0, minMs - elapsed);
    const t = setTimeout(() => setPhase("exit"), wait);
    return () => clearTimeout(t);
  }, [ready, phase, mountedAt, minMs]);

  // After exit animation → notify parent to unmount
  useEffect(() => {
    if (phase !== "exit") return;
    const t = setTimeout(() => onDone?.(), 420);
    return () => clearTimeout(t);
  }, [phase, onDone]);

  return (
    <div
      className={`aios-splash aios-splash--${phase}`}
      role="status"
      aria-label={`Loading ${BRAND_NAME}`}
      aria-live="polite"
    >
      <div className="aios-splash__inner">
        <BrandReveal mode="fade-rise" onceKey="splash" durationMs={720}>
          <div className="aios-splash__logo-wrap">
            {/* Pure high-res A mark for cleaner first impression on mobile */}
            <BrandLogo
              variant="mark"
              size="hero"
              priority
              decorative
              className="aios-splash__logo aios-splash__logo--mark"
            />
            <div className="aios-splash__glow" aria-hidden />
          </div>
          <p className="aios-splash__tagline">{BRAND_TAGLINE}</p>
        </BrandReveal>

        <div className="aios-splash__bar" aria-hidden>
          <div className="aios-splash__bar-fill" />
        </div>
      </div>
    </div>
  );
}
