import { Link } from "wouter";
import { trpc } from "../../api";
import { AssetAudio, AssetImg, AssetVideo } from "../../components/MediaFallback";
import { Icon } from "../../components/Icon";
import { Card, Meta, Skeleton } from "../../components/ui";
import { ModelBaseChip } from "./ModelBaseInfo";

/**
 * 同題並跑的結果並排。
 *
 * 這是整個競技場唯一有結論的地方：**看成品**。目錄寫的「擅長」是文字宣稱，
 * 只有把自己的題目丟給幾顆模型同場跑一次，才知道哪顆適合自己。
 * 所以這裡除了成品，還要把「花了幾點、跑了幾秒」擺在同一格——那兩件事跟畫面一樣是決策依據。
 */

const STATUS_LABEL: Record<string, string> = {
  queued: "排隊中",
  running: "生成中",
  awaiting_approval: "等待組長核准",
  rejected: "已駁回",
  failed: "失敗",
  done: "完成",
};

export function ModelArenaResults({ projectId, runId }: { projectId: string; runId: string }) {
  const result = trpc.generation?.benchResult?.useQuery?.(
    { projectId, runId },
    {
      // 還有在跑的就繼續問；全部收斂後停止輪詢，不空轉打伺服器
      refetchInterval: (query) => {
        const rows = query.state.data;
        if (!rows?.length) return 4_000;
        return rows.some((row) => row.status === "queued" || row.status === "running") ? 4_000 : false;
      },
    },
  ) ?? { data: undefined, isLoading: false, error: null };

  const rows = result.data ?? [];
  if (!rows.length) {
    return result.isLoading ? <Skeleton style={{ height: 120, marginTop: 8 }} /> : null;
  }

  const pending = rows.filter((row) => row.status === "queued" || row.status === "running").length;
  const settled = rows.filter((row) => row.status === "done");
  const fastest = settled.reduce<typeof settled[number] | null>(
    (best, row) => (row.elapsedSeconds != null && (best?.elapsedSeconds == null || row.elapsedSeconds < best.elapsedSeconds) ? row : best),
    null,
  );
  const cheapest = rows.reduce<typeof rows[number] | null>(
    (best, row) => (best == null || row.points < best.points ? row : best),
    null,
  );

  return (
    <div data-testid="arena-result-grid" style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>同題並跑結果</strong>
        <Meta>{pending ? `${pending} 顆還在跑…（完成會自動出現）` : "全部收斂"}</Meta>
      </div>

      <ul className="model-arena-grid">
        {rows.map((row) => (
          /* 得獎那一格用外框標出來：整個功能最有價值的結論本來只是那行小字尾巴的「· 最快」，
             掃過去看不見。文字保持原樣（測試逐字比對），這裡只加視覺。 */
          <li
            key={row.id}
            className={[fastest?.id === row.id ? "is-fastest" : "", cheapest?.id === row.id ? "is-cheapest" : ""].filter(Boolean).join(" ") || undefined}
          >
            <Card variant="quiet" style={{ padding: 8, borderRadius: 12, height: "100%" }}>
              <div className="model-arena-grid__media">
                {row.resultUrl && row.kind === "video" ? (
                  <AssetVideo src={row.resultUrl} muted controls style={{ width: "100%", height: "100%", objectFit: "cover" }} fallbackLabel="結果已失效" />
                ) : row.resultUrl && row.kind === "audio" ? (
                  <AssetAudio src={row.resultUrl} controls style={{ width: "100%" }} fallbackLabel="結果已失效" />
                ) : row.resultUrl ? (
                  <AssetImg src={row.resultUrl} alt={row.modelLabel} style={{ width: "100%", height: "100%", objectFit: "cover" }} fallbackLabel="結果已失效" />
                ) : row.resultText ? (
                  <p className="model-arena-grid__text">{row.resultText.slice(0, 400)}</p>
                ) : (
                  <Meta style={{ fontSize: 12, textAlign: "center", padding: 8 }}>
                    {row.status === "failed"
                      ? row.error?.slice(0, 80) || "生成失敗（已自動退點）"
                      : STATUS_LABEL[row.status] ?? row.status}
                  </Meta>
                )}
              </div>
              <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
                <b style={{ fontSize: "var(--fs-13)" }}>{row.modelLabel}</b>
                <ModelBaseChip modelId={row.modelId} />
                <Meta className="mono" style={{ fontSize: 11 }}>
                  {row.points} 點
                  {row.elapsedSeconds != null ? ` · ${row.elapsedSeconds} 秒` : ` · ${STATUS_LABEL[row.status] ?? row.status}`}
                  {fastest?.id === row.id ? " · 最快" : ""}
                  {cheapest?.id === row.id ? " · 最省" : ""}
                </Meta>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Meta as="p" style={{ margin: "8px 0 0" }}>
        成品同時也在專案的生成紀錄裡（可收藏、重試、回填分鏡）——
        <Link href="/dashboard">到今日工作台繼續用</Link>。
      </Meta>
      {result.error ? <p className="error">結果讀取失敗——{result.error.message}</p> : null}
      {settled.length >= 2 ? (
        <Meta as="p" style={{ margin: "4px 0 0" }}>
          <Icon name="Info" size={11} /> 一次比較只是一個樣本：題材換了結論也可能換，重要決定建議跑兩三題再下判斷。
        </Meta>
      ) : null}
    </div>
  );
}
