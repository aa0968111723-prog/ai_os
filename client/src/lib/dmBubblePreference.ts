/**
 * 私訊「聊天小球球」偏好的存取層。
 *
 * 儲存位置沿用站內既有前例（見 densityPreference.ts / agentPlannerPreference.ts）：localStorage。
 * 這代表偏好**綁裝置而非綁帳號**——手機與電腦要各自設定一次。
 * 之所以先這樣做而不是加資料庫欄位：
 *   1. 不動 auth schema、不需 migration，在多條分支並行開發時風險最低
 *   2. 使用者真正要的行為（自己能開關）localStorage 就能完整達成
 * 跨裝置同步列為後續工作，屆時只要換掉這個模組的實作，呼叫端不必改。
 *
 * 預設開啟（true）——新使用者直接看到小球球，需要時可到「連結手機與電腦」關掉。
 */
export const DM_BUBBLE_STORAGE_KEY = "aios.dmBubble.enabled";

const listeners = new Set<(enabled: boolean) => void>();

export function readDmBubbleEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(DM_BUBBLE_STORAGE_KEY);
    if (raw === null) return true; // 預設開啟
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

export function writeDmBubbleEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DM_BUBBLE_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // 隱私模式／儲存空間被封鎖時只維持當次頁面選擇，不讓例外冒泡打斷互動。
  }
  for (const listener of listeners) listener(enabled);
}

/** 訂閱變更；回傳解除訂閱函式。同時涵蓋本分頁切換與其他分頁的 storage 事件。 */
export function subscribeDmBubbleEnabled(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== DM_BUBBLE_STORAGE_KEY) return;
    listener(readDmBubbleEnabled());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
