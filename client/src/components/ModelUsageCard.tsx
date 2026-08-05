/**
 * 模型指南頂欄：我的使用量（近 30 天）
 * 取代「站內契約健康」——一般創作者要看的是自己用了什麼，不是 404／逾時／NIM。
 */
import { Link } from "wouter";
import { trpc } from "../api";
import { getModel } from "@shared/models";
import { Icon } from "./Icon";
import { Card, Hint, Meta, Skeleton } from "./ui";

export function ModelUsageCard() {
  const usage = trpc.models.myUsage.useQuery({ days: 30 }, { staleTime: 60_000 });

  if (usage.isLoading) {
    return (
      <Card as="section" className="model-usage-overview" data-fb="模型使用量" style={{ marginBottom: "var(--sp-16)", padding: "12px 16px" }}>
        <Skeleton style={{ height: 56 }} />
      </Card>
    );
  }

  if (usage.error) {
    return (
      <Card as="section" className="model-usage-overview" data-fb="模型使用量" style={{ marginBottom: "var(--sp-16)", padding: "12px 16px" }}>
        <b style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="Star" size={16} />我的使用量
        </b>
        <p className="error" style={{ marginTop: 8 }}>載入失敗——{usage.error.message}</p>
      </Card>
    );
  }

  const data = usage.data;
  if (!data) return null;

  const empty = data.models.length === 0;

  return (
    <Card as="section" className="model-usage-overview" data-fb="模型使用量" style={{ marginBottom: "var(--sp-16)", padding: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <b style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="Star" size={16} />我的使用量
        </b>
        <Meta>近 {data.days} 天</Meta>
        {!empty && (
          <Meta>
            {data.totalSubmits.toLocaleString()} 次 · 完成 {data.totalDone.toLocaleString()} · {data.totalPoints.toLocaleString()} 點
          </Meta>
        )}
      </div>
      {empty ? (
        <Hint layer="always" style={{ margin: 0 }}>
          還沒有生成紀錄——用下方「怎麼選模型」挑一個，到工作台跑一輪就會出現在這裡。
        </Hint>
      ) : (
        <div className="model-health-stats" role="list">
          {data.models.map((row) => {
            const m = getModel(row.modelId);
            const label = m?.label ?? row.modelId;
            return (
              <div
                key={row.modelId}
                role="listitem"
                className="model-health-stat tone-info"
                title={`${label}：${row.submits} 次、完成 ${row.done}、${row.points} 點`}
                style={{ cursor: "default", textAlign: "left", minWidth: 0 }}
              >
                <strong style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                  {label}
                </strong>
                <span>
                  {row.submits} 次 · {row.points} 點
                </span>
              </div>
            );
          })}
        </div>
      )}
      {!empty && (
        <Meta as="p" style={{ margin: "10px 0 0", fontSize: 12 }}>
          <Link href="/dashboard">到工作台繼續用</Link>
        </Meta>
      )}
    </Card>
  );
}
