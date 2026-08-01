import { Component, type CSSProperties, type ReactNode } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Button, Hint, Meta } from "./ui";

/**
 * 素材儲存健康的全站警示橫幅（素材保護）。
 *
 * 為什麼需要這一條橫幅：
 * 伺服器「沒掛到持久磁碟」或「這次開機掛到另一顆卷」時，素材照樣寫得進去、頁面一切正常，
 * 直到下一次重新部署才整批消失——在那之前使用者完全沒有任何警訊。假綠燈就是這樣來的。
 *
 * 這支元件掛在 App.tsx 最外層，任何登入頁面都會看到；未登入 / 狀態正常 / 查詢失敗時自己渲染 null。
 * 降級時紅色、醒目、可一鍵「我已了解（刻意換卷）」解除（只有開發者看得到按鈕）。
 */

const BANNER: CSSProperties = {
  background: "var(--danger-bg, #3b0a0a)",
  color: "var(--danger-fg, #fecaca)",
  borderBottom: "1px solid var(--danger-border, #7f1d1d)",
  padding: "10px 16px",
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  fontSize: 14,
  lineHeight: 1.45,
  position: "sticky",
  top: 0,
  zIndex: 1000,
};

const ACTIONS: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 8,
};

export function StorageAlertBanner() {
  const health = trpc.system.storageHealth.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });
  const ack = trpc.system.acknowledgeVolumeChange.useMutation({
    onSuccess: () => health.refetch(),
  });

  if (health.isLoading || health.isError || !health.data?.degraded) return null;

  const note = health.data.note || "儲存層異常，素材可能無法永久保存。";
  const isVolumeChanged = health.data.degradeReason === "volume-changed";

  return (
    <div style={BANNER} role="alert" data-testid="storage-alert-banner">
      <Icon name="warning" size={20} style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>素材儲存異常</strong>
        <div style={{ marginTop: 4 }}>{note}</div>
        <div style={ACTIONS}>
          {isVolumeChanged && (
            <Button
              size="sm"
              variant="danger"
              disabled={ack.isPending}
              onClick={() => ack.mutate()}
            >
              {ack.isPending ? "處理中…" : "我已了解，這是我刻意換的新卷"}
            </Button>
          )}
          <Hint>請立刻把重要素材下載到本機；通知管理員檢查 Zeabur Volume 掛載路徑是否為 /data。</Hint>
        </div>
      </div>
    </div>
  );
}

/** Error boundary so a broken health query never takes down the whole app */
export class StorageAlertBannerBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
