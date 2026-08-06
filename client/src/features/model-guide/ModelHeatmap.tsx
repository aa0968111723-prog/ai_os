import { useMemo, useState } from "react";
import {
  buildHeatmapContext,
  heatmapCell,
  HEATMAP_METRICS,
  rowAverage,
  type HeatmapRow,
} from "@shared/modelHeatmap";
import { modelBaseSpecFor } from "@shared/modelBase";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button, Card, Chip, Hint, Meta, Skeleton } from "../../components/ui";
import { ModelBaseDetail } from "./ModelBaseInfo";

/**
 * 分析熱力圖：同一類模型攤開來，強弱長在哪裡。
 *
 * 清單一次只看得到一顆模型，比較表一次看得到四顆——都回答不了「這一類裡誰在哪個面向強」。
 * 熱力圖把「模型 × 指標」攤成一張圖，顏色深＝這格分數高，掃一眼就看得出哪一排整體強、
 * 哪一格特別弱。
 *
 * 誠實規則（分數怎麼算見 shared/modelHeatmap）：
 * - **沒有資料的格子畫成斜線空格，不是 0 分。** 未公開的文字窗口與很短的窗口是兩件事。
 * - 規格欄與「我的實測」欄分開標示：別人的成功率不是這顆模型的性質，這裡只用你自己的紀錄。
 * - 相對指標（點數／速度／用量）在目前這批模型內比較，換一批顏色就會變——這是比較工具，不是評分表。
 */

/** 分數 → 色深。0 分也要看得出來（很淺但有底），與「沒有資料」的斜線格明顯不同。 */
function cellStyle(score: number | null) {
  if (score == null) return { className: "is-empty", style: undefined };
  const pct = Math.round(8 + score * 62); // 8%–70%：最深也讀得到字
  return {
    className: "",
    style: { background: `color-mix(in srgb, var(--primary) ${pct}%, transparent)` },
  };
}

export function ModelHeatmap({
  category,
  categories,
  onCategoryChange,
  onCompare,
  comparedIds,
  compareFull,
}: {
  category: string;
  categories: ReadonlyArray<{ id: string; label: string; hint?: string }>;
  onCategoryChange: (id: string) => void;
  onCompare: (id: string) => void;
  comparedIds: string[];
  compareFull: boolean;
}) {
  const models = trpc.models.byCategory.useQuery({ category }, { placeholderData: (prev) => prev });
  const analytics = trpc.models?.analytics?.useQuery?.({ days: 90 }, { staleTime: 60_000 }) ?? {
    data: undefined,
    isLoading: false,
    error: null,
  };
  const [showLive, setShowLive] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const usageById = useMemo(() => {
    const map = new Map<string, HeatmapRow["usage"]>();
    for (const row of analytics.data?.models ?? []) {
      map.set(row.modelId, { submits: row.submits, done: row.done, failed: row.failed, avgSeconds: row.avgSeconds });
    }
    return map;
  }, [analytics.data]);

  const metrics = HEATMAP_METRICS.filter((m) => showLive || m.source === "spec");
  const metricIds = metrics.map((m) => m.id);

  const rows: HeatmapRow[] = useMemo(
    () =>
      (models.data ?? []).map((m) => ({
        id: m.id,
        points: m.points,
        verified: m.verified,
        health: m.health,
        textEncoderLimit: m.textEncoderLimit,
        supportsNegativePrompt: m.supportsNegativePrompt,
        supportsSeed: m.supportsSeed,
        usage: usageById.get(m.id) ?? null,
      })),
    [models.data, usageById],
  );

  const ctx = useMemo(() => buildHeatmapContext(rows), [rows]);
  const labelById = new Map((models.data ?? []).map((m) => [m.id, m.label] as const));
  const ordered = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const sa = rowAverage(a, metricIds, ctx);
        const sb = rowAverage(b, metricIds, ctx);
        return (sb ?? -1) - (sa ?? -1);
      }),
    [rows, metricIds, ctx],
  );

  const liveCount = rows.filter((r) => (r.usage?.submits ?? 0) > 0).length;

  return (
    <div className="model-heatmap" data-testid="model-heatmap">
      <Hint layer="always" style={{ marginTop: 0 }}>
        一格＝一個「模型 × 指標」，<b>顏色越深分數越高</b>；斜線格代表這項沒有資料（不是 0 分）。
        點任何一列可以展開它的底層模型，或直接把它加進比較／競技場。
      </Hint>

      <div className="model-heatmap__filters">
        <span className="eyebrow cjk">類別</span>
        {categories.map((c) => (
          <Chip key={c.id} selected={category === c.id} title={c.hint} onClick={() => onCategoryChange(c.id)} style={{ cursor: "pointer" }}>
            {c.label}
          </Chip>
        ))}
        <span className="spacer" />
        <Chip
          selected={showLive}
          title="把「我的成功率／完成速度／使用量」三欄加進圖裡（只用你自己的生成紀錄）"
          onClick={() => setShowLive((v) => !v)}
          style={{ cursor: "pointer" }}
        >
          含我的實測
        </Chip>
      </div>

      {models.isLoading && <Skeleton className="card" height={220} />}
      {models.isError && (
        <p className="error">
          熱力圖載入失敗——
          <Button size="sm" onClick={() => models.refetch()}>重試</Button>
        </p>
      )}

      {!models.isLoading && ordered.length > 0 && (
        <div className="model-heatmap__scroll">
          <table className="model-heatmap__table">
            <thead>
              <tr>
                <th scope="col">模型</th>
                {metrics.map((m) => (
                  <th key={m.id} scope="col" title={`${m.hint}｜深色＝${m.highMeans}`}>
                    <span>{m.label}</span>
                    <small>{m.source === "live" ? "我的實測" : "規格"}</small>
                  </th>
                ))}
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => {
                const spec = modelBaseSpecFor(row.id, category);
                const open = openId === row.id;
                const inCompare = comparedIds.includes(row.id);
                return [
                  <tr key={row.id} className={open ? "is-open" : ""}>
                    <th scope="row">
                      <button type="button" className="model-heatmap__name" aria-expanded={open} onClick={() => setOpenId(open ? null : row.id)}>
                        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={12} />
                        <span>
                          <b>{labelById.get(row.id) ?? row.id}</b>
                          <small>{spec.baseModel}</small>
                        </span>
                      </button>
                    </th>
                    {metrics.map((m) => {
                      const cell = heatmapCell(m.id, row, ctx);
                      const painted = cellStyle(cell.score);
                      return (
                        <td
                          key={m.id}
                          className={`model-heatmap__cell ${painted.className}`}
                          style={painted.style}
                          title={`${labelById.get(row.id) ?? row.id}｜${m.label}：${cell.display}`}
                        >
                          {cell.display}
                        </td>
                      );
                    })}
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={compareFull && !inCompare}
                        title={compareFull && !inCompare ? "一次最多 4 個——先移掉一個" : "加入並排比較與實測競技場"}
                        onClick={() => onCompare(row.id)}
                      >
                        {inCompare ? "已選入" : "加入比較"}
                      </Button>
                    </td>
                  </tr>,
                  open ? (
                    <tr key={`${row.id}-detail`} className="model-heatmap__detail">
                      <td colSpan={metrics.length + 2}>
                        <ModelBaseDetail modelId={row.id} category={category} />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      <Card variant="quiet" style={{ marginTop: 10, padding: "8px 12px" }}>
        <div className="model-heatmap__legend">
          <span className="eyebrow cjk">圖例</span>
          {[0.1, 0.35, 0.6, 0.85, 1].map((score) => (
            <span key={score} className="model-heatmap__swatch" style={cellStyle(score).style} />
          ))}
          <Meta>低 → 高</Meta>
          <span className="model-heatmap__swatch is-empty" />
          <Meta>沒有資料</Meta>
        </div>
        <Meta as="p" style={{ margin: "6px 0 0" }}>
          點數、速度與用量是<b>在目前這批模型內</b>相對比較，換個類別顏色就會變。
          {showLive
            ? liveCount
              ? `　實測欄取自你近 ${analytics.data?.days ?? 90} 天的生成紀錄（這一類有 ${liveCount} 顆跑過）。`
              : "　實測欄還是空的——這一類你還沒跑過，去競技場跑一輪就會長出來。"
            : ""}
        </Meta>
      </Card>
    </div>
  );
}
