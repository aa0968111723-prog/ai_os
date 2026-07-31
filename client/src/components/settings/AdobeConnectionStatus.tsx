import type { AdobeConnectionView } from "@shared/adobe";
import { Icon } from "../Icon";
import { Badge, Hint, Meta } from "../ui";

/**
 * Adobe 連結狀態顯示（#224 PR2）：純顯示元件，不含任何呼叫——
 * 設定頁、之後的修圖面板與代理設定都用同一塊，狀態說法才會一致。
 */
export function AdobeConnectionStatus({ data }: { data: AdobeConnectionView | null }) {
  if (!data) return <Meta as="p">載入中…</Meta>;

  if (!data.configured) {
    return (
      <Hint layer="always">
        站方尚未設定 Adobe 正式整合（管理員需設 ADOBE_CLIENT_ID／SECRET／REDIRECT_URI）——
        設定前可把 ADOBE_MODE 留在模擬模式，流程完全跑得動，只是不會真的動到 Adobe 帳號。
      </Hint>
    );
  }

  const capabilities = [
    { key: "photoEdit", label: "修圖", on: data.capabilities.photoEdit },
    { key: "timelineRender", label: "時間軸算圖", on: data.capabilities.timelineRender },
    { key: "assetBrowse", label: "素材瀏覽", on: data.capabilities.assetBrowse },
  ];

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {data.status === "error" ? (
        <Meta style={{ margin: 0, color: "var(--danger-ink, #a33)" }} title={data.lastError ?? undefined}>
          授權已失效{data.email ? `（${data.email}）` : ""}——請重新連結
        </Meta>
      ) : data.connected ? (
        <Meta style={{ margin: 0 }}>
          <Icon name="Check" size={13} /> 已連結{data.email ? `（${data.email}）` : ""}
          {data.lastUsedAt ? `・最近使用 ${new Date(data.lastUsedAt).toLocaleDateString()}` : ""}
        </Meta>
      ) : (
        <Meta style={{ margin: 0 }}>尚未連結 Adobe 帳號</Meta>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Badge title={data.mode === "mock" ? "模擬模式：不會真的呼叫 Adobe" : "正式模式：會在你的 Adobe 帳號內執行"}>
          {data.mode === "mock" ? "模擬模式" : "正式模式"}
        </Badge>
        {capabilities.map((c) => (
          <Badge key={c.key} title={c.on ? `${c.label}：可用` : `${c.label}：目前模式尚未開放`}>
            {c.on ? "✓" : "—"} {c.label}
          </Badge>
        ))}
      </div>

      {data.connected && (
        <Meta style={{ margin: 0 }}>授權範圍：{data.scopes.join("、")}</Meta>
      )}
    </div>
  );
}
