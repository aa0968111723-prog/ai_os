import { useEffect, useState } from "react";
import { applyAppUpdate, isAppUpdateReady, subscribeAppUpdate } from "../pwa";

/**
 * 新版 Service Worker 已下載完成時提示使用者主動更新。
 * 不自動刷新，避免使用者正在編輯提示詞、筆記或專案內容時被中斷。
 */
export function AppUpdateBanner() {
  const [, refresh] = useState(0);
  const [updating, setUpdating] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => subscribeAppUpdate(() => refresh((n) => n + 1)), []);

  if (!isAppUpdateReady() || dismissed) return null;

  const onUpdate = () => {
    setUpdating(true);
    const started = applyAppUpdate();
    if (!started) setUpdating(false);
  };

  return (
    <aside
      className="app-update-banner"
      role="status"
      aria-live="polite"
    >
      <span className="app-update-banner__signal" aria-hidden>↑</span>
      <div className="app-update-banner__copy">
        <strong>新版已準備好</strong>
        <p className="hint app-update-banner__detail">
          更新後會重新載入目前頁面。尚未送出的文字請先確認已儲存。
        </p>
      </div>
      <div className="app-update-banner__actions">
        <button type="button" className="btn-ghost btn-sm" onClick={() => setDismissed(true)}>
          稍後
        </button>
        <button type="button" className="primary btn-sm" disabled={updating} onClick={onUpdate}>
          {updating ? "更新中…" : "更新"}
        </button>
      </div>
    </aside>
  );
}
