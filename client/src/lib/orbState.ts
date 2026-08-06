/**
 * 手機 Orb（底部導航中央 AI 球）狀態機（MOB-T2）。
 *
 * 視覺在 styles.mobile-tokens.css：html[data-orb-state] 驅動四態動畫，
 * 只在 ≤820 有樣式——桌機沒有 .mobile-nav，本屬性等於無感。
 * 這裡只負責把狀態寫上 <html>，呼叫端（生成送出等）不必知道視覺細節。
 *
 * speaking/error 屬「一次性回饋」：短暫播放後自動回 idle，
 * 避免使用者離開頁面後球一直搖或一直紅。
 */
export type OrbState = "idle" | "thinking" | "speaking" | "error";

const TRANSIENT_MS: Partial<Record<OrbState, number>> = {
  speaking: 2600,
  error: 1600,
};

let revertTimer: ReturnType<typeof setTimeout> | undefined;

export function setOrbState(state: OrbState): void {
  if (typeof document === "undefined") return;
  clearTimeout(revertTimer);
  document.documentElement.setAttribute("data-orb-state", state);
  const ttl = TRANSIENT_MS[state];
  if (ttl) {
    revertTimer = setTimeout(() => {
      document.documentElement.setAttribute("data-orb-state", "idle");
    }, ttl);
  }
}

/** App 啟動時掛一次預設值（bootstrap 呼叫） */
export function installOrbState(): void {
  if (typeof document === "undefined") return;
  if (!document.documentElement.hasAttribute("data-orb-state")) {
    document.documentElement.setAttribute("data-orb-state", "idle");
  }
}
