/**
 * 崩潰診斷：把 ErrorBoundary 攔到的錯誤變成「使用者可以直接截圖／複製給我們」的一段文字。
 *
 * 背景：全站 ErrorBoundary 只顯示「畫面出了點狀況」，真正的 stack 只進 console。
 * 手機（尤其是安裝成 PWA 的 Android）要開 console 得接 USB 除錯，實務上拿不到——
 * 於是回報永遠停在「壞了」，沒有任何可行動的資訊。錯誤摘要必須看得見。
 */

/** 動態 import 失敗（chunk 載入失敗）——與「程式碼有 bug」是完全不同的故障，要分開處理。 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  if (pick(error, "name") === "ChunkLoadError") return true;
  const msg = safeStr(pick(error, "message")) || safeStr(error);
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Loading chunk \S+ failed/i.test(msg) ||
    /Loading CSS chunk/i.test(msg)
  );
}

/**
 * 正式包壓縮後的 React 內部錯誤（#185 等）。
 * 訊息本身對使用者沒有意義，還會附一串 react.dev 說明連結——不該直接攤在 UI 上。
 * 技術細節仍進 buildCrashReport.detail，回報時可複製。
 */
export function isMinifiedReactError(error: unknown): boolean {
  if (!error) return false;
  const msg = safeStr(pick(error, "message")) || safeStr(error);
  return /Minified React error #\d+/i.test(msg);
}

/** 從 minified 訊息抽出錯誤碼（沒有就回 null）。 */
export function minifiedReactErrorCode(error: unknown): string | null {
  const msg = safeStr(pick(error, "message")) || safeStr(error);
  const m = msg.match(/Minified React error #(\d+)/i);
  return m?.[1] ?? null;
}

/**
 * 給 UI 顯示用的一行摘要。
 * minified React 錯誤只露「React 內部錯誤 #N」，絕不把 error.message 原樣渲染。
 * 其他錯誤仍用 report.headline（含真實訊息，方便截圖回報）。
 */
export function displayCrashHeadline(error: unknown, report: CrashReport | null): string {
  if (isMinifiedReactError(error)) {
    const code = minifiedReactErrorCode(error);
    return code ? `React 內部錯誤 #${code}` : "React 內部錯誤";
  }
  return report?.headline ?? "（無法取得錯誤摘要）";
}

export type CrashReport = {
  /** 一行摘要，直接顯示在錯誤卡片上 */
  headline: string;
  /** 完整內容，給「複製錯誤詳情」按鈕 */
  detail: string;
};

/** 從錯誤 + React componentStack 組出可回報的文字。任何欄位缺失都不能讓這支再炸一次。 */
export function buildCrashReport(
  error: unknown,
  componentStack?: string | null,
  ctx: { url?: string; userAgent?: string; at?: string } = {},
): CrashReport {
  const name = safeStr(pick(error, "name")) || "Error";
  const message = safeStr(pick(error, "message")) || safeStr(error) || "（沒有錯誤訊息）";
  const headline = `${name}: ${message}`.slice(0, 300);

  const stack = safeStr(pick(error, "stack"));
  const lines = [
    headline,
    ctx.at ? `時間：${ctx.at}` : null,
    ctx.url ? `頁面：${ctx.url}` : null,
    ctx.userAgent ? `瀏覽器：${ctx.userAgent}` : null,
    stack ? `\n--- stack ---\n${clip(stack, 4000)}` : null,
    componentStack ? `\n--- 元件路徑 ---\n${clip(componentStack, 2000)}` : null,
  ].filter((l): l is string => typeof l === "string" && l.length > 0);

  return { headline, detail: lines.join("\n") };
}

/** 讀屬性本身就可能爆（getter 會 throw、Proxy 會擋）——診斷路徑不容許這種二次崩潰。 */
function pick(o: unknown, key: string): unknown {
  if (o == null) return undefined;
  try { return (o as Record<string, unknown>)[key]; } catch { return undefined; }
}

function safeStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try { return String(v); } catch { return ""; }
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…（已截斷）` : s;
}
