import { useEffect, useState } from "react";
import { applyAppUpdate, isAppUpdateReady, subscribeAppUpdate } from "../pwa";

/**
 * 新版 Service Worker 已下載完成時提示使用者主動更新。
 * 不自動刷新，避免使用者正在編輯提示詞、筆記或專案內容時被中斷。
 */
export function AppUpdateBanner() {
  const [, refresh] = useState(0);
  const [updating, setUpdating] = useState(false);

  useEffect(() => subscribeAppUpdate(() => refresh((n) => n + 1)), []);

  if (!isAppUpdateReady()) return null;

  const onUpdate = () => {
    setUpdating(true);
    const started = applyAppUpdate();
    if (!started) setUpdating(false);
  };

  return (
    <aside
      className="card"
      role="status"
      aria-live="polite"
      style={{
        margin: "0 auto var(--sp-12)",
        maxWidth: 980,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-12)",
        padding: "var(--sp-12) var(--sp-16)",
        flexWrap: "wrap",
      }}
    >
      <div>
        <strong>Aios 有新版本</strong>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          更新後會重新載入目前頁面。尚未送出的文字請先確認已儲存。
        </p>
      </div>
      <button type="button" className="primary" disabled={updating} onClick={onUpdate}>
        {updating ? "更新中…" : "立即更新"}
      </button>
    </aside>
  );
}
