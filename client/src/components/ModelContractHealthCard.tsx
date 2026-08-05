/**
 * 模型契約健康——僅管理員後台使用。
 * 一般創作者的「模型指南」不應出現 404／逾時／失敗／NIM 等稽核用語。
 */
import { trpc } from "../api";
import { Icon } from "./Icon";
import { Card, Hint, Meta } from "./ui";

type HealthKey =
  | "live_ok"
  | "live_timeout"
  | "live_fail"
  | "openapi_404"
  | "needs_source"
  | "nim_no_key"
  | "never_probed";

const HEALTH_META: Record<HealthKey, { short: string; hint: string; tone: string }> = {
  live_ok: { short: "實測✓", hint: "站內曾合法生成並取回成品", tone: "ok" },
  live_timeout: { short: "逾時", hint: "已送出但輪詢超時", tone: "warn" },
  live_fail: { short: "失敗", hint: "最近 live 失敗", tone: "bad" },
  openapi_404: { short: "404", hint: "OpenAPI 端點不存在", tone: "bad" },
  needs_source: { short: "需素材", hint: "要圖／音／影／zip", tone: "info" },
  nim_no_key: { short: "NIM", hint: "走 NVIDIA NIM", tone: "mute" },
  never_probed: { short: "未測", hint: "尚無合法生成紀錄", tone: "mute" },
};

const ORDER: HealthKey[] = [
  "live_ok", "needs_source", "never_probed", "live_timeout", "live_fail", "openapi_404", "nim_no_key",
];

export function ModelContractHealthCard() {
  const contractSummary = trpc.models.contractSummary.useQuery(undefined, {
    staleTime: 60_000,
  });

  if (contractSummary.isLoading) {
    return (
      <Card data-fb="模型契約健康">
        <h2>模型契約健康</h2>
        <Meta>載入中…</Meta>
      </Card>
    );
  }
  if (contractSummary.error || !contractSummary.data) {
    return (
      <Card data-fb="模型契約健康">
        <h2>模型契約健康</h2>
        <p className="error">契約快照載入失敗——{contractSummary.error?.message ?? "無資料"}</p>
      </Card>
    );
  }

  const data = contractSummary.data;
  return (
    <Card data-fb="模型契約健康">
      <h2>模型契約健康</h2>
      <Hint layer="always">
        站務專用稽核（與 MCP／生成警告同源）。一般創作者的「模型指南」不顯示此區塊。
      </Hint>
      <Meta as="p" style={{ margin: "6px 0 10px" }}>
        {data.modelCount} 模型 · 更新 {new Date(data.generatedAt).toLocaleString("zh-TW")}
      </Meta>
      <div className="model-health-stats" role="list">
        {ORDER.map((key) => {
          const n = data.counts?.[key] ?? 0;
          if (!n) return null;
          const meta = HEALTH_META[key];
          return (
            <div
              key={key}
              role="listitem"
              className={`model-health-stat tone-${meta.tone}`}
              title={meta.hint}
              style={{ cursor: "default" }}
            >
              <strong>{n}</strong>
              <span>{meta.short}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
