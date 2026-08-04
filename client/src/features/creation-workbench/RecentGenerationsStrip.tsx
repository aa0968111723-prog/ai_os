import { trpc } from "../../api";
import { Button, Meta, Pill, type PillStatus } from "../../components/ui";
import { revealWorkbenchAnchor } from "./workbenchNav";

const STATUS_LABEL: Record<string, string> = {
  queued: "排隊中",
  running: "生成中…",
  done: "完成 ✓",
  failed: "失敗",
  awaiting_approval: "待核准",
  rejected: "已駁回",
};

/** Map cost-gate statuses onto existing Pill palettes (same mapping as GenerationList). */
const STATUS_PILL: Record<string, PillStatus> = {
  awaiting_approval: "queued",
  rejected: "failed",
};

const DEFAULT_LIMIT = 5;
const MIN_LIMIT = 3;
const MAX_LIMIT = 5;

function clampLimit(n: number): number {
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(n)));
}

function snippet(g: { name?: string | null; prompt: string }, max = 28): string {
  const text = (g.name?.trim() || g.prompt || "").trim();
  if (text.length <= max) return text || "（無提示詞）";
  return `${text.slice(0, max)}…`;
}

/**
 * P2 (#400): compact recent-generation strip under the generate form.
 * Shares `generation.listByProject` query key with GenerationList (cache + invalidate).
 * Client-slices to 3–5 items; full history stays in the resource drawer.
 */
export function RecentGenerationsStrip({
  projectId,
  limit = DEFAULT_LIMIT,
}: {
  projectId: string;
  /** How many recent rows to show (clamped 3–5; default 5). */
  limit?: number;
}) {
  const take = clampLimit(limit);
  // Same input key as GenerationList so submit invalidation refreshes this strip.
  const list = trpc.generation.listByProject.useQuery(
    { projectId },
    {
      refetchInterval: (query) =>
        query.state.data?.some((g) => g.status === "queued" || g.status === "running")
          ? 8000
          : 45_000,
      refetchIntervalInBackground: true,
    },
  );

  const items = (list.data ?? []).slice(0, take);

  return (
    <section
      data-testid="recent-generations-strip"
      aria-label="最近生成"
      style={{ marginTop: 12 }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginBottom: items.length ? 8 : 0,
        }}
      >
        <Meta as="span" style={{ fontSize: 12, fontWeight: 600 }}>
          最近生成
        </Meta>
        {list.isLoading && !list.data ? (
          <Meta as="span" style={{ fontSize: 12 }}>
            載入中…
          </Meta>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => revealWorkbenchAnchor("#sec-generations", { projectId })}
        >
          全部紀錄
        </Button>
      </div>

      {items.length > 0 ? (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {items.map((g) => {
            const pillStatus: PillStatus =
              STATUS_PILL[g.status] ?? (g.status as PillStatus);
            const label = STATUS_LABEL[g.status] ?? g.status;
            const title = snippet(g);
            const showThumb =
              g.kind === "image" && !!g.resultUrl && g.status === "done";

            return (
              <li
                key={g.id}
                data-testid="recent-generation-item"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                  padding: "4px 0",
                }}
              >
                {showThumb ? (
                  <img
                    src={g.resultUrl!}
                    alt=""
                    style={{
                      width: 40,
                      height: 28,
                      borderRadius: 4,
                      objectFit: "cover",
                      background: "var(--muted)",
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                <Pill status={pillStatus} style={{ flexShrink: 0, fontSize: 11 }}>
                  {label}
                </Pill>
                <Meta
                  as="span"
                  title={g.name?.trim() || g.prompt}
                  style={{
                    fontSize: 12,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {title}
                </Meta>
              </li>
            );
          })}
        </ul>
      ) : list.isLoading || list.isError ? null : (
        <Meta as="p" style={{ margin: "4px 0 0", fontSize: 12 }}>
          尚無生成紀錄
        </Meta>
      )}
    </section>
  );
}
