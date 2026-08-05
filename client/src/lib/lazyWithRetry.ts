import { lazy, type ComponentType } from "react";
import { isChunkLoadError } from "./crashReport";

/**
 * 路由層 lazy 的韌性包裝。
 *
 * 為什麼需要：`lazy()` 的 import 一旦 reject，錯誤會一路冒到全站 ErrorBoundary，
 * 整個 App 變成「畫面出了點狀況」——即使只是某一支 chunk 沒抓到。專案頁的 chunk
 * 是全站最大的一支（~500 KB），手機網路不穩時最容易中；而重新部署後舊 hash 檔案
 * 會消失，停在舊分頁的使用者一點進去就必中。
 *
 * 策略：
 * 1) 先重試一次（隔一小段時間）——蓋掉單純的網路抖動。
 * 2) 仍失敗且看起來是 chunk 問題 → 強制繞過快取重載一次頁面，換到新版 index.html。
 *    用 sessionStorage 記住已經重載過，避免真的壞掉時無限重整。
 * 3) 已經重載過還是失敗 → 把錯誤丟出去，交給 ErrorBoundary 顯示可回報的詳情。
 */
const RELOAD_KEY = "aios.chunkReloadedAt";
const RELOAD_COOLDOWN_MS = 30_000;

function alreadyReloadedRecently(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(RELOAD_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < RELOAD_COOLDOWN_MS;
  } catch {
    return false; // 無痕／封鎖儲存時退回「沒重載過」，最差就是多重整一次
  }
}

function markReloaded(): void {
  try { window.sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* 記不住就算了 */ }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 與 React.lazy 的簽名對齊
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (first) {
      await delay(400);
      try {
        return await factory();
      } catch (second) {
        if (isChunkLoadError(second) && !alreadyReloadedRecently()) {
          markReloaded();
          const url = new URL(window.location.href);
          url.searchParams.set("_r", String(Date.now()));
          window.location.replace(url.toString());
          // 重載途中先卡住，不要讓 ErrorBoundary 閃一下錯誤畫面
          await delay(10_000);
        }
        throw second;
      }
    }
  });
}
