import { useEffect, useState } from "react";
import { trpc } from "../api";

/**
 * Adobe 連結狀態（#224 PR2）：狀態查詢、撤銷，以及 OAuth 回跳的一次性訊息。
 *
 * 抽成 hook 的理由：連結卡（設定頁）與之後的修圖／剪輯面板都需要同一份「能不能用」判斷，
 * 各自呼叫 status 再各自解讀 mode/capabilities，遲早會出現「A 頁說可用、B 頁說不可用」。
 */

/** 回跳參數 → 給人看的訊息（與 Express callback 的 redirect 對齊） */
export function adobeFlashMessage(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "connected":
      return "已連結 Adobe 帳號——現在可以請 AI 直接在你的 Adobe 帳號內修圖與備稿";
    case "denied":
      return "已取消 Adobe 授權——隨時可以再連結";
    case "state_mismatch":
      return "授權連結已過期，請重新點「連結 Adobe 帳號」";
    default:
      return "連結失敗，請稍後再試";
  }
}

export function useAdobeConnection() {
  const utils = trpc.useUtils();
  const status = trpc.adobe.status.useQuery();
  const disconnect = trpc.adobe.disconnect.useMutation({ onSuccess: () => utils.adobe.status.invalidate() });

  // ?adobe=... 顯示後清掉網址參數，重新整理不再重播（與 Google 雲端回跳同一慣例）
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("adobe");
    if (!code) return;
    setFlash(adobeFlashMessage(code));
    const url = new URL(window.location.href);
    url.searchParams.delete("adobe");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const data = status.data ?? null;
  return {
    status,
    data,
    flash,
    disconnect,
    /** 已連結且沒有錯誤才算真的可用——狀態 error 時要走重新連結，不是直接送工作 */
    usable: !!data && data.connected && data.status !== "error",
    startUrl: "/api/integrations/adobe/start",
  };
}
