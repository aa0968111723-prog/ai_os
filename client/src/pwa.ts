const DISMISS_KEY = "aios.installBanner.dismissedAt";
const DISMISS_DAYS = 14;
export type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
let deferredInstall: BeforeInstallPromptEventLike | null = null;
const listeners = new Set<() => void>();
function notify() { for (const fn of listeners) { try { fn(); } catch {} } }
export function isStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches
    || window.matchMedia?.("(display-mode: window-controls-overlay)").matches
    || (navigator as { standalone?: boolean }).standalone === true;
}
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
export function isInstallDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && Date.now() - at < DISMISS_DAYS * 86400_000;
  } catch { return false; }
}
export function dismissInstallBanner(): void {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  notify();
}
export function canShowInstallUi(): boolean {
  if (typeof window === "undefined" || isStandaloneApp() || isInstallDismissed()) return false;
  return isIosDevice() || deferredInstall != null;
}
export function subscribeInstallUi(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const ev = deferredInstall;
  if (!ev) return "unavailable";
  deferredInstall = null; notify();
  try {
    await ev.prompt();
    return (await ev.userChoice).outcome;
  } catch { return "unavailable"; }
}
export function bootstrapPwa(): void {
  if (typeof window === "undefined") return;
  const apply = () => document.documentElement.classList.toggle("is-standalone", isStandaloneApp());
  apply();
  try { window.matchMedia("(display-mode: standalone)").addEventListener("change", apply); } catch {}
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e as BeforeInstallPromptEventLike;
    notify();
  });
  window.addEventListener("appinstalled", () => { deferredInstall = null; dismissInstallBanner(); apply(); });
  if ("serviceWorker" in navigator) {
    const reg = () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); };
    if (document.readyState === "complete") reg();
    else window.addEventListener("load", reg, { once: true });
  }
}
