import { UI_DENSITY_DEFAULT, uiDensitySchema, type UiDensity } from "@shared/uiDensity";

/**
 * 介面密度偏好的存取層。
 *
 * 儲存位置沿用站內既有前例（見 `agentPlannerPreference.ts`）：localStorage。
 * 這代表偏好**綁裝置而非綁帳號**——手機與電腦要各自設定一次。
 * 之所以先這樣做而不是加資料庫欄位：
 *   1. 不動 auth schema、不需 migration，在多條分支並行開發時風險最低
 *   2. 使用者真正要的行為（自己能開關、新帳號預設引導）localStorage 就能完整達成
 * 跨裝置同步列為後續工作，屆時只要換掉這個模組的實作，呼叫端不必改。
 *
 * 讀不到或值不合法時一律回 `guide`——寧可多顯示說明，也不要讓新手面對空白介面。
 */
export const UI_DENSITY_STORAGE_KEY = "aios.uiDensity";

/** 同分頁內的變更廣播（storage 事件只跨分頁，同頁改完不會自己收到）。 */
const listeners = new Set<(density: UiDensity) => void>();

export function readUiDensity(): UiDensity {
  if (typeof window === "undefined") return UI_DENSITY_DEFAULT;
  try {
    const parsed = uiDensitySchema.safeParse(window.localStorage.getItem(UI_DENSITY_STORAGE_KEY));
    return parsed.success ? parsed.data : UI_DENSITY_DEFAULT;
  } catch {
    return UI_DENSITY_DEFAULT;
  }
}

export function writeUiDensity(density: UiDensity): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(UI_DENSITY_STORAGE_KEY, density);
  } catch {
    // 隱私模式／儲存空間被封鎖時只維持當次頁面選擇，不讓例外冒泡打斷互動。
  }
  for (const listener of listeners) listener(density);
}

/** 訂閱變更；回傳解除訂閱函式。同時涵蓋本分頁切換與其他分頁的 storage 事件。 */
export function subscribeUiDensity(listener: (density: UiDensity) => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== UI_DENSITY_STORAGE_KEY) return;
    listener(readUiDensity());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
