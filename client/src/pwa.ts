const DISMISS_KEY = "aios.installBanner.dismissedAt";
const DISMISS_DAYS = 14;

export type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let deferredInstall: BeforeInstallPromptEventLike | null = null;
let waitingWorker: ServiceWorker | null = null;
let reloadRequested = false;
let reloading = false;

const installListeners = new Set<() => void>();
const updateListeners = new Set<() => void>();

function notifyInstall() {
  for (const fn of installListeners) {
    try { fn(); } catch {}
  }
}

function notifyUpdate() {
  for (const fn of updateListeners) {
    try { fn(); } catch {}
  }
}

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
    if (typeof window === "undefined") return false;
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && Date.now() - at < DISMISS_DAYS * 86400_000;
  } catch { return false; }
}

export function dismissInstallBanner(): void {
  try { window.localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  notifyInstall();
}

/**
 * 安裝橫幅用：尊重「稍後」14 天隱藏。
 * 不要拿來控帳號選單——使用者關掉橫幅後仍應能從選單主動安裝。
 */
export function canShowInstallBanner(): boolean {
  if (typeof window === "undefined" || isStandaloneApp() || isInstallDismissed()) return false;
  return isIosDevice() || deferredInstall != null;
}

/**
 * 帳號選單／說明頁用：只要尚未以 standalone 開啟、且環境可裝就顯示。
 * 不吃 dismiss（「稍後」只關橫幅，不關入口）。
 */
export function canOfferInstall(): boolean {
  if (typeof window === "undefined" || isStandaloneApp()) return false;
  return isIosDevice() || deferredInstall != null;
}

/** @deprecated 請改用 canShowInstallBanner；保留給尚未改完的呼叫端 */
export function canShowInstallUi(): boolean {
  return canShowInstallBanner();
}

export function subscribeInstallUi(fn: () => void): () => void {
  installListeners.add(fn);
  return () => { installListeners.delete(fn); };
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const ev = deferredInstall;
  if (!ev) return "unavailable";
  deferredInstall = null;
  notifyInstall();
  try {
    await ev.prompt();
    return (await ev.userChoice).outcome;
  } catch {
    return "unavailable";
  }
}

/** 純判斷：只有「新版已安裝」且目前頁面已受舊 SW 控制時，才需要提示更新。 */
export function shouldOfferAppUpdate(workerState: string, hasController: boolean): boolean {
  return workerState === "installed" && hasController;
}

export function isAppUpdateReady(): boolean {
  return waitingWorker != null;
}

export function subscribeAppUpdate(fn: () => void): () => void {
  updateListeners.add(fn);
  return () => { updateListeners.delete(fn); };
}

function setWaitingWorker(worker: ServiceWorker | null): void {
  if (waitingWorker === worker) return;
  waitingWorker = worker;
  notifyUpdate();
}

/**
 * 使用者主動按「立即更新」後才讓 waiting worker 接管，避免編輯途中被背景更新打斷。
 * controllerchange 只在這次主動操作後重新載入，首次安裝不會誤刷新。
 */
export function applyAppUpdate(): boolean {
  if (!waitingWorker) return false;
  reloadRequested = true;
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
  return true;
}

export function bootstrapPwa(): void {
  if (typeof window === "undefined") return;

  const applyStandaloneClass = () => {
    document.documentElement.classList.toggle("is-standalone", isStandaloneApp());
  };
  applyStandaloneClass();
  try {
    window.matchMedia("(display-mode: standalone)").addEventListener("change", applyStandaloneClass);
  } catch {}

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e as BeforeInstallPromptEventLike;
    notifyInstall();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    dismissInstallBanner();
    applyStandaloneClass();
  });

  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    setWaitingWorker(null);
    if (reloadRequested && !reloading) {
      reloading = true;
      window.location.reload();
    }
  });

  const observeRegistration = (registration: ServiceWorkerRegistration) => {
    if (registration.waiting && navigator.serviceWorker.controller) {
      setWaitingWorker(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (shouldOfferAppUpdate(worker.state, !!navigator.serviceWorker.controller)) {
          setWaitingWorker(worker);
        }
      });
    });

    // 使用者回到 App 時檢查新版；失敗不影響主流程。
    window.addEventListener("focus", () => {
      void registration.update().catch(() => {});
    });
  };

  const register = () => {
    navigator.serviceWorker.register("/sw.js")
      .then(observeRegistration)
      .catch(() => {});
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
