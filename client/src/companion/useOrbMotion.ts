import { useEffect, useState } from "react";
import { orbMotionPlan, type OrbMotionPlan, type OrbMotionTier } from "@shared/companionOrb";

/**
 * 這一格裝置現在能播多少動畫。
 *
 * ## 為什麼要「現在」而不是「開機時」
 *
 * 三件事會在使用期間改變答案：
 * 1. 使用者在系統設定裡打開「減少動態」——不重開 App 也該立刻生效。
 * 2. 手機掉到 20% 進入省電模式。
 * 3. App 被切到背景（最重要的一項：看不到的動畫是純粹的電費）。
 *
 * 三者都有事件可監聽，所以這裡不是一次性偵測，而是一個會變的值。
 *
 * ## 為什麼不量 FPS 自己降級
 *
 * 量 FPS 要先播一段才知道卡——那段就是使用者看到的第一印象。而且量測本身
 * （每幀記時間戳）在低階機上也是成本。改用**靜態能力訊號**：核心數、記憶體、
 * 省電旗標。測不準的代價是偶爾對某支中階機保守了一點，而那比開場先卡三秒好。
 */
export function useOrbMotion(userOverride?: OrbMotionTier): OrbMotionPlan {
  const [plan, setPlan] = useState<OrbMotionPlan>(() => computePlan(userOverride, false));

  useEffect(() => {
    if (typeof window === "undefined") return;
    let disposed = false;
    // Battery API 是 optional：拿不到就當作沒有省電訊號，不要因此降級所有裝置。
    let battery: BatteryLike | null = null;

    const sync = () => {
      if (disposed) return;
      const saveBattery = !!battery && !battery.charging && battery.level <= 0.2;
      setPlan((prev) => {
        const next = computePlan(userOverride, document.visibilityState === "hidden", saveBattery);
        // tier 沒變就沿用同一個物件：Orb 的 useEffect 依賴它，換物件＝重建整個粒子系統。
        return prev.tier === next.tier ? prev : next;
      });
    };

    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    motionQuery?.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);

    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    void nav.getBattery?.().then((b) => {
      if (disposed || !b) return;
      battery = b;
      b.addEventListener?.("levelchange", sync);
      b.addEventListener?.("chargingchange", sync);
      sync();
    }).catch(() => undefined);

    sync();
    return () => {
      disposed = true;
      motionQuery?.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [userOverride]);

  return plan;
}

interface BatteryLike {
  level: number;
  charging: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
}

function computePlan(
  userOverride: OrbMotionTier | undefined,
  backgrounded: boolean,
  saveBattery = false,
): OrbMotionPlan {
  if (typeof window === "undefined") return orbMotionPlan({ userOverride: "still" });
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return orbMotionPlan({
    ...(userOverride ? { userOverride } : {}),
    backgrounded,
    saveBattery,
    prefersReducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    ...(typeof navigator.hardwareConcurrency === "number" ? { cores: navigator.hardwareConcurrency } : {}),
    ...(typeof nav.deviceMemory === "number" ? { memoryGb: nav.deviceMemory } : {}),
    saveData: nav.connection?.saveData ?? false,
  });
}
