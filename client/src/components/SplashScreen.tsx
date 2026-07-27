import { useEffect, useState } from "react";

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
      aria-label="Loading AI Director OS"
      aria-live="polite"
    >
      <div className="aios-splash__inner">
        <div className="aios-splash__logo-wrap">
          <img
            className="aios-splash__logo"
            src="/icons/icon-512.png"
            alt=""
            width={200}
            height={200}
            draggable={false}
          />
          <div className="aios-splash__glow" aria-hidden />
        </div>

        <h1 className="aios-splash__title">AI Director OS</h1>
        <p className="aios-splash__tagline">Create · Collaborate · Deliver</p>

        <div className="aios-splash__bar" aria-hidden>
          <div className="aios-splash__bar-fill" />
        </div>
      </div>
    </div>
  );
}
