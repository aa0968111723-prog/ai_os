/**
 * PostHog，延後載入。
 *
 * ## 為什麼不能靜態 import
 *
 * `posthog-js` 是 247KB 原始碼，而 `main.tsx` 靜態 `import "./posthog"`，
 * 所以它整包躺在**首屏 entry chunk** 裡。手機 4G 上，這代表使用者要先下載完
 * 一個分析函式庫，畫面才會動——為了一件使用者完全不在乎的事付 LCP 的錢。
 *
 * DECISIONS.md D-006 已記載首屏 JS 超標；分析工具是最不該佔那個額度的東西。
 *
 * ## 這個模組怎麼運作
 *
 * 對外仍是 `export default` 一個有 `capture` / `identify` / `reset` 的物件，
 * **所有呼叫端一行都不用改**。差別只在時機：
 *
 * 1. 首屏只載這幾十行的代理，不載 posthog-js。
 * 2. 瀏覽器閒下來（`requestIdleCallback`，或退回 2 秒 timeout）才動態 import 本體。
 * 3. 本體到位前的呼叫進 queue，到位後照原順序重播——所以「載入完成前就登入成功」
 *    這種早期事件不會掉。
 *
 * queue 有上限：分析事件掉幾筆是可接受的，記憶體無限成長不是。
 *
 * ## 為什麼不是「第一次呼叫才載」
 *
 * 那會把 247KB 的下載塞進使用者剛按下按鈕的那一刻（登入、建專案），
 * 正好是最需要頻寬的時候。閒置時預載、呼叫時已經在了，才是對的順序。
 */

type Queued =
  | { method: "capture"; args: [string, Record<string, unknown>?] }
  | { method: "identify"; args: [string, Record<string, unknown>?] }
  | { method: "reset"; args: [] };

/** 站內實際用到的 API 面（全庫 grep 只有這三個）。加新方法時要一併加進代理。 */
interface PosthogLike {
  capture(event: string, properties?: Record<string, unknown>): void;
  identify(id: string, properties?: Record<string, unknown>): void;
  reset(): void;
}

const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST;

/** 本體到位前的暫存。上限 50：分析掉幾筆無妨，記憶體漏光不行。 */
const QUEUE_MAX = 50;
const queue: Queued[] = [];
let real: PosthogLike | null = null;
let loading = false;

function flush() {
  if (!real) return;
  for (const item of queue.splice(0)) {
    // 逐筆 try：某一筆事件的形狀有問題不該讓後面的全部跟著沉沒
    try {
      if (item.method === "capture") real.capture(...item.args);
      else if (item.method === "identify") real.identify(...item.args);
      else real.reset();
    } catch { /* 分析失敗絕不影響使用者流程 */ }
  }
}

function enqueue(item: Queued) {
  if (real) {
    try {
      if (item.method === "capture") real.capture(...item.args);
      else if (item.method === "identify") real.identify(...item.args);
      else real.reset();
    } catch { /* 同上 */ }
    return;
  }
  if (queue.length < QUEUE_MAX) queue.push(item);
}

async function load() {
  if (loading || real) return;
  loading = true;
  try {
    const mod = await import("posthog-js");
    const client = mod.default;
    client.init(posthogKey, {
      api_host: posthogHost,
      defaults: "2026-05-30",
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
    });
    real = client as unknown as PosthogLike;
    flush();
  } catch {
    // 載不到就永遠當作沒有分析（例如被廣告攔截器擋掉）——清掉 queue 免得一直長
    queue.length = 0;
  }
}

if (!posthogKey || !posthogHost) {
  // Vitest deliberately runs without production analytics credentials.
  if (import.meta.env.DEV && import.meta.env.MODE !== "test") {
    const variable = !posthogKey ? "VITE_POSTHOG_KEY" : "VITE_POSTHOG_HOST";
    throw new Error(
      `${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`,
    );
  }
} else if (typeof window !== "undefined") {
  // 閒置時預載：不跟首屏的 JS/CSS/字型/API 搶頻寬，但在使用者按到任何按鈕之前就位。
  const idle = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(() => { void load(); }, { timeout: 4000 });
  else window.setTimeout(() => { void load(); }, 2000);
}

const proxy: PosthogLike = {
  capture: (event, properties) => enqueue({ method: "capture", args: [event, properties] }),
  identify: (id, properties) => enqueue({ method: "identify", args: [id, properties] }),
  reset: () => enqueue({ method: "reset", args: [] }),
};

export default proxy;
