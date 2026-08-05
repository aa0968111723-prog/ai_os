import { Icon } from "./Icon";
import { Card, Hint, Meta } from "./ui";

/** 契約健康（與 shared/modelContract 對齊；指南顯示中文） */
export type HealthKey =
  | "live_ok"
  | "live_timeout"
  | "live_fail"
  | "openapi_404"
  | "needs_source"
  | "nim_no_key"
  | "never_probed"
  | "unknown";

export const HEALTH_META: Record<
  HealthKey,
  { label: string; short: string; hint: string; tone: "ok" | "warn" | "bad" | "mute" | "info" }
> = {
  live_ok: { label: "已實測成功", short: "實測✓", hint: "站內曾合法生成並取回成品", tone: "ok" },
  live_timeout: { label: "曾逾時", short: "逾時", hint: "已送出但輪詢超時（可能已計點，勿連點重跑）", tone: "warn" },
  live_fail: { label: "實測失敗", short: "失敗", hint: "最近 live 失敗（契約／輸入問題）", tone: "bad" },
  openapi_404: { label: "端點異常", short: "404", hint: "OpenAPI 端點不存在，建議換同類模型", tone: "bad" },
  needs_source: { label: "需素材", short: "需素材", hint: "要圖／音／影／zip，無法空提示詞開工", tone: "info" },
  nim_no_key: { label: "NIM", short: "NIM", hint: "走 NVIDIA NIM，非 fal 佇列", tone: "mute" },
  never_probed: { label: "未實測", short: "未測", hint: "尚無合法生成紀錄（可能因預算）", tone: "mute" },
  unknown: { label: "未知", short: "—", hint: "尚無契約快照", tone: "mute" },
};

const HEALTH_ORDER: HealthKey[] = [
  "live_ok",
  "needs_source",
  "never_probed",
  "live_timeout",
  "live_fail",
  "openapi_404",
  "nim_no_key",
  "unknown",
];

type Props = {
  modelCount: number;
  generatedAt: string;
  counts: Partial<Record<HealthKey, number>>;
  healthFilter: HealthKey | "";
  onFilter: (key: HealthKey | "") => void;
  onJumpCatalog: () => void;
};

/**
 * 站內契約健康總覽。
 * 4 欄 grid，避免手機 flex wrap 時最後一顆（如 NIM）孤行。
 */
export function ModelHealthOverview({
  modelCount,
  generatedAt,
  counts,
  healthFilter,
  onFilter,
  onJumpCatalog,
}: Props) {
  return (
    <Card
      as="section"
      className="model-health-overview"
      data-fb="模型契約健康"
      style={{ marginBottom: "var(--sp-16)", padding: "12px 16px" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <b style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="CheckCircle2" size={16} />站內契約健康
        </b>
        <Meta>
          {modelCount} 模型 · 更新 {new Date(generatedAt).toLocaleString("zh-TW")}
        </Meta>
        <span className="spacer" />
        <Hint as="span" style={{ margin: 0 }}>與 MCP／生成警告同源（不自動 verified）</Hint>
      </div>
      <div
        className="model-health-stats"
        role="list"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 8,
        }}
      >
        {HEALTH_ORDER.map((key) => {
          const n = counts[key] ?? 0;
          const meta = HEALTH_META[key];
          const empty = n === 0;
          if (key === "unknown" && empty) return null;
          return (
            <button
              key={key}
              type="button"
              role="listitem"
              className={`model-health-stat tone-${meta.tone}${healthFilter === key ? " is-selected" : ""}`}
              title={empty ? `${meta.hint}（目前 0）` : meta.hint}
              disabled={empty}
              style={{
                minWidth: 0,
                width: "100%",
                alignItems: "center",
                textAlign: "center",
                opacity: empty ? 0.42 : undefined,
                cursor: empty ? "default" : undefined,
              }}
              onClick={() => {
                if (empty) return;
                onFilter(healthFilter === key ? "" : key);
                requestAnimationFrame(() => onJumpCatalog());
              }}
            >
              <strong>{n}</strong>
              <span>{meta.short}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
