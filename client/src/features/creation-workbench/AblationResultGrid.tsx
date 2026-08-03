import type { PromptSectionKey } from "@shared/promptSections";
import { PROMPT_SECTIONS } from "@shared/promptSections";
import { trpc } from "../../api";
import { AssetImg, AssetVideo } from "../../components/MediaFallback";
import { Card, Meta, Skeleton } from "../../components/ui";

/**
 * 消融實測的結果並排。
 *
 * 這是整個影響力量測唯一有結論的地方：**看圖**。
 * 基準擺第一格，其餘每格少一段設定——差得多＝那一段真的在起作用；
 * 看起來差不多＝它其實沒發揮。文字說明再多都取代不了兩張圖擺在一起。
 */

const SECTION_TITLE: Record<string, string> = {
  baseline: "完整版（基準）",
  ...Object.fromEntries(PROMPT_SECTIONS.map((section) => [section.key, `拿掉「${section.title}」`])),
};

const STATUS_LABEL: Record<string, string> = {
  queued: "排隊中",
  running: "生成中",
  awaiting_approval: "等待核准",
  rejected: "已駁回",
  failed: "失敗",
};

function sectionTitle(section: string): string {
  return SECTION_TITLE[section as PromptSectionKey | "baseline"] ?? section;
}

export function AblationResultGrid({
  projectId,
  runId,
  seedPinned,
}: {
  projectId: string;
  runId: string;
  seedPinned: boolean;
}) {
  const result = trpc.generation?.ablationResult?.useQuery?.(
    { projectId, runId },
    {
      // 圖還沒生完就繼續問；全部收斂後停止輪詢，不要空轉打伺服器
      refetchInterval: (query) => {
        const rows = query.state.data;
        if (!rows?.length) return 4_000;
        return rows.some((row) => row.status === "queued" || row.status === "running") ? 4_000 : false;
      },
    },
  ) ?? { data: undefined, isLoading: false, error: null };

  const rows = result.data ?? [];
  if (!rows.length) {
    return result.isLoading ? <Skeleton style={{ height: 96, marginTop: 8 }} /> : null;
  }

  // 基準永遠排第一格：其餘每一格都是「跟它比」
  const ordered = [...rows].sort((a, b) => Number(b.section === "baseline") - Number(a.section === "baseline"));
  const pending = ordered.filter((row) => row.status === "queued" || row.status === "running").length;

  return (
    <div data-testid="ablation-result-grid" style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>實測結果並排</strong>
        <Meta>
          {pending ? `${pending} 張生成中…` : "全部完成"}
          ・{seedPinned ? "同一顆 seed" : "未固定 seed，差異含噪聲"}
        </Meta>
      </div>

      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
        {ordered.map((row) => (
          <li key={row.id}>
            <Card
              variant="quiet"
              style={{
                padding: 6,
                borderRadius: 10,
                // 基準用主色描邊，一眼看得出「其他格是在跟誰比」
                borderColor: row.section === "baseline" ? "var(--primary-border)" : undefined,
              }}
            >
              <div style={{ aspectRatio: "1 / 1", borderRadius: 8, overflow: "hidden", background: "var(--muted)", display: "grid", placeItems: "center" }}>
                {row.resultUrl && row.kind === "video" ? (
                  <AssetVideo src={row.resultUrl} muted controls style={{ width: "100%", height: "100%", objectFit: "cover" }} fallbackLabel="結果已失效" />
                ) : row.resultUrl ? (
                  <AssetImg
                    src={row.resultUrl}
                    alt={sectionTitle(row.section)}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    fallbackLabel="結果已失效"
                  />
                ) : (
                  <Meta style={{ fontSize: 12, textAlign: "center", padding: 8 }}>
                    {row.status === "failed" ? row.error?.slice(0, 60) || "生成失敗" : STATUS_LABEL[row.status] ?? row.status}
                  </Meta>
                )}
              </div>
              <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.4, fontWeight: row.section === "baseline" ? 600 : 400 }}>
                {sectionTitle(row.section)}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Meta as="p" style={{ margin: "6px 0 0" }}>
        跟基準差得越多，代表那一段設定的影響力越大；看起來差不多就是它其實沒發揮
        {seedPinned ? "。" : "——但這次沒固定 seed，差異裡混著噪聲，別只憑一張圖下判斷。"}
      </Meta>
    </div>
  );
}
