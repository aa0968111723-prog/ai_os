import { Component, type CSSProperties, type ReactNode } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Button, Hint, Meta } from "./ui";

/**
 * 素材儲存健康的全站警示橫幅（素材保護）。
 *
 * 為什麼需要這一條橫幅：
 * 伺服器「沒掛到持久磁碟」或「這次開機掛到另一顆卷」時，素材照樣寫得進去、頁面一切正常，
 * 直到下一次重新部署才整批消失——在那之前使用者完全沒有警覺。過去三道「沒掛 Volume」
 * 警報全是假綠燈（Dockerfile 在映像層就建了 /data，程式用「目錄存不存在」判斷，在容器裡永遠成立）。
 * 這條橫幅直接讀 /api/ready 與 storageHealth，只要 persistent=false 或 degraded=true 就全站紅色出現。
 */
export function StorageAlertBanner() {
  const health = trpc.system.storageHealth.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });

  if (health.isLoading || health.isError || !health.data) return null;
  const { persistent, degraded, reasons, degradeReason } = health.data;
  if (persistent && !degraded) return null;

  const msg = degradeReason || reasons?.[0] || "儲存層異常";
  return (
    <div
      role="alert"
      style={{
        background: "#7f1d1d",
        color: "#fecaca",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 14,
        borderBottom: "1px solid #991b1b",
      }}
    >
      <Icon name="alert" size={18} />
      <div style={{ flex: 1 }}>
        <strong>素材儲存異常</strong>：{msg}。新上傳的素材可能在下次部署後遺失，請立刻下載重要檔案並通知開發者。
      </div>
    </div>
  );
}

export class StorageErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
