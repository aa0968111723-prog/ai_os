/**
 * 協作中心：把散落各處的協作訊號收成一個地方。
 *
 * 資訊架構刻意只有四個分頁，而且**不是四個不同的系統**——它們是同一支聚合查詢的四個切面：
 *   找我   誰在等我動（依阻塞程度排序，不是依時間）
 *   討論   依「專案 × 內容物件」分組（Shot 03 兩則、Shot 08 五則），不是一條全專案 feed
 *   任務   既有 project_tasks（含 taskType='approval'）
 *   動態   發生過什麼——與收件匣的「有什麼等我處理」是兩件事，不混為一談
 *
 * 資料來源全部是既有系統：notifications／messages／project_tasks／realtime 房間。
 * 沒有第二套留言系統，也沒有第二套通知系統。
 */
import { useEffect, useState } from "react";
import { registerAssistantFocus, registerAssistantPage } from "../lib/assistantContext";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { AttentionRow, relTime } from "../features/collaboration/CollabPanel";
import { Button, Card, Chip, EmptyState, Hint, Meta, Skeleton } from "../components/ui";

const TABS = [
  { key: "attention", label: "找我" },
  { key: "threads", label: "討論" },
  { key: "tasks", label: "任務" },
  { key: "decisions", label: "決策" },
  { key: "activity", label: "動態" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function CollaborationCenter({ groupId }: { groupId: string | null }) {
  const [tab, setTab] = useState<TabKey>("attention");
  // 助手頁面感知：協作中心以任務為主體，分頁一起報（快捷因此是任務型）
  useEffect(() => registerAssistantPage({ pageType: "tasks" }), []);
  useEffect(() => registerAssistantFocus({ entityType: "task", activeTab: tab }), [tab]);
  const q = trpc.collaboration.summary.useQuery(
    { groupId: groupId ?? undefined },
    { enabled: Boolean(groupId), refetchInterval: 30_000 },
  );
  const s = q.data;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Card as="section">
        <h1 style={{ margin: 0, fontSize: "var(--fs-18)" }}>協作中心</h1>
        <Hint as="p" style={{ margin: "4px 0 0" }}>
          誰在線、有什麼找你、哪裡正在討論、什麼卡住了——都在這裡。
        </Hint>
        {s && s.onlinePeers.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }} aria-label="在線夥伴">
            {s.onlinePeers.map((p) => (
              <Chip
                key={p.userId}
                style={{ margin: 0, background: p.color, color: "#fff", borderColor: p.color }}
                title={p.projectTitles[0] ? `${p.name}・正在 ${p.projectTitles[0]}` : p.name}
              >
                {p.name}
                {p.projectTitles[0] && (
                  <span style={{ opacity: 0.85, marginLeft: 4, fontSize: "var(--fs-11)" }}>· {p.projectTitles[0]}</span>
                )}
              </Chip>
            ))}
          </div>
        )}
      </Card>

      <div role="tablist" aria-label="協作中心分頁" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <Button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            variant={tab === t.key ? "primary" : "ghost"}
            size="sm"
            /* 44px：分頁切換是手機上最常按的東西 */
            style={{ minHeight: 44 }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "attention" && s && s.attention.length > 0 ? ` ${s.attention.length}` : ""}
            {t.key === "tasks" && s && s.myTasks + s.pendingApprovals > 0 ? ` ${s.myTasks + s.pendingApprovals}` : ""}
          </Button>
        ))}
      </div>

      {q.isLoading && <Skeleton style={{ height: 120, borderRadius: "var(--r-12)" }} />}
      {!groupId && <EmptyState title="還沒有團隊" description="被加進團隊之後，這裡會顯示夥伴的動態。" />}

      {s && tab === "attention" && (
        <Card as="section" aria-label="找我">
          <Meta as="p" style={{ margin: "0 0 6px" }}>
            依「誰被卡住」排序：需要我決策 &gt; 阻塞別人 &gt; 被提及 &gt; 指派任務 &gt; 一般更新。
          </Meta>
          {s.attention.length === 0 ? (
            <EmptyState title="沒有事情等你" description="被 @、被指派、待你核准的事都會出現在這裡。" />
          ) : (
            s.attention.map((item) => <AttentionRow key={item.id} item={item} />)
          )}
        </Card>
      )}

      {s && tab === "threads" && (
        <Card as="section" aria-label="討論">
          <Meta as="p" style={{ margin: "0 0 6px" }}>
            依專案與內容物件分組——「Shot 08 有 5 則」比「這個專案有 23 則」有用得多。
          </Meta>
          {s.threads.length === 0 ? (
            <EmptyState title="最近沒有討論" description="在分鏡、素材或生成版本上留言，就會出現在這裡。" />
          ) : (
            groupByProject(s.threads).map(([projectId, list]) => (
              <div key={projectId} style={{ marginTop: 10 }}>
                <strong style={{ fontSize: "var(--fs-13)" }}>{list[0].projectTitle}</strong>
                {list.map((t) => (
                  <Link key={`${t.refType}-${t.refId}`} href={threadUrl(projectId, t)}>
                    <div
                      data-testid="thread-row"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px",
                        minHeight: 44,
                        marginTop: 4,
                        borderRadius: 8,
                        background: "var(--card2)",
                        border: "1px solid var(--border-soft)",
                      }}
                    >
                      <span style={{ flex: "1 1 auto", fontSize: "var(--fs-13)" }}>{t.label}</span>
                      <Chip style={{ margin: 0 }}>
                        <Icon name="MessageCircle" size={12} /> {t.count}
                      </Chip>
                      {t.openAnnotations > 0 && (
                        <Chip style={{ margin: 0, borderColor: "var(--warn-ink, var(--border-soft))" }}>
                          <Icon name="TriangleAlert" size={12} /> {t.openAnnotations}
                        </Chip>
                      )}
                      <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>{relTime(t.lastAt)}</Meta>
                    </div>
                  </Link>
                ))}
              </div>
            ))
          )}
        </Card>
      )}

      {s && tab === "tasks" && (
        <Card as="section" aria-label="任務">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <Chip style={{ margin: 0 }}>指派給我 {s.myTasks}</Chip>
            <Chip style={{ margin: 0 }}>待我核准 {s.pendingApprovals}</Chip>
          </div>
          {s.attention.filter((a) => a.kind === "task" || a.kind === "approval").length === 0 ? (
            <EmptyState title="沒有待辦" description="留言可以直接轉成任務；AI 產出的計畫也會落在這裡。" />
          ) : (
            s.attention
              .filter((a) => a.kind === "task" || a.kind === "approval")
              .map((item) => <AttentionRow key={item.id} item={item} />)
          )}
        </Card>
      )}

      {s && tab === "decisions" && (
        <Card as="section" aria-label="決策">
          <Meta as="p" style={{ margin: "0 0 6px" }}>
            真正定案的內容。撤銷是劃線不是消失——「曾經定過又推翻」本身就是紀錄。
          </Meta>
          {s.recentDecisions.length === 0 ? (
            <EmptyState title="還沒有定案" description="在留言上按「轉決策」，把討論的結論保存下來。" />
          ) : (
            s.recentDecisions.map((d) => (
              <div key={d.id} data-testid="decision-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
                <p style={{ margin: 0, fontSize: "var(--fs-13)", textDecoration: d.revokedAt ? "line-through" : undefined, opacity: d.revokedAt ? 0.6 : 1 }}>
                  ✓ {d.title}
                </p>
                <Meta as="p" style={{ margin: "2px 0 0", fontSize: "var(--fs-11)" }}>
                  {[d.decidedByName, d.projectTitle].filter(Boolean).join(" · ")} · {relTime(d.at)}
                  {d.revokedAt ? " ·（已撤銷）" : ""}
                </Meta>
                {d.sourceMessageId && (
                  <Link href={`/p/${d.projectId}?focus=messages&mid=${d.sourceMessageId}`}>
                    <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>看原討論 →</Meta>
                  </Link>
                )}
              </div>
            ))
          )}
        </Card>
      )}

      {s && tab === "activity" && (
        <Card as="section" aria-label="動態">
          <Meta as="p" style={{ margin: "0 0 6px" }}>
            最近發生了什麼。動態不等於通知——這裡不會因為你看過就消失。
          </Meta>
          {s.recentActivity.length === 0 ? (
            <EmptyState title="最近沒有動靜" description="夥伴的留言、標注與 AI 產出都會出現在這裡。" />
          ) : (
            s.recentActivity.map((a) => (
              <div key={a.id} data-testid="activity-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
                <Meta as="p" style={{ margin: 0, fontSize: "var(--fs-11)" }}>
                  {[a.actorName, a.projectTitle].filter(Boolean).join(" · ")} · {relTime(a.at)}
                </Meta>
                <p style={{ margin: "2px 0 0", fontSize: "var(--fs-13)" }}>{a.summary}</p>
              </div>
            ))
          )}
        </Card>
      )}

      {s && s.activeProjects.length > 0 && (
        <Card as="section" aria-label="最近有討論的專案">
          <Meta as="p" style={{ margin: "0 0 6px" }}>最近有人在的專案</Meta>
          {s.activeProjects.map((p) => (
            <Link key={p.projectId} href={`/p/${p.projectId}`}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px",
                  minHeight: 44,
                  marginTop: 4,
                  borderRadius: 8,
                  background: "var(--card2)",
                }}
              >
                <span style={{ flex: "1 1 auto", fontSize: "var(--fs-13)" }}>{p.title}</span>
                {p.onlineCount > 0 && (
                  <Chip style={{ margin: 0, borderColor: "var(--success-ink)", color: "var(--success-ink)" }}>
                    <Icon name="Users" size={12} /> {p.onlineCount}
                  </Chip>
                )}
                {p.messages > 0 && (
                  <Chip style={{ margin: 0 }}>
                    <Icon name="MessageCircle" size={12} /> {p.messages}
                  </Chip>
                )}
                {p.openAnnotations > 0 && (
                  <Chip style={{ margin: 0 }}>
                    <Icon name="TriangleAlert" size={12} /> {p.openAnnotations}
                  </Chip>
                )}
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

type Thread = {
  projectId: string;
  projectTitle: string;
  refType: string | null;
  refId: string | null;
  label: string;
  count: number;
  openAnnotations: number;
  lastAt: string;
};

/** 依專案收攏（保持伺服器給的時間順序） */
export function groupByProject(threads: Thread[]): Array<[string, Thread[]]> {
  const map = new Map<string, Thread[]>();
  for (const t of threads) {
    const list = map.get(t.projectId);
    if (list) list.push(t);
    else map.set(t.projectId, [t]);
  }
  return [...map.entries()];
}

/**
 * 討論串的深連結：綁到具體內容物件時要落在**那一格**，不是專案首頁。
 * 這是「找得到內容」與「自己去翻」的差別。
 */
export function threadUrl(projectId: string, t: Pick<Thread, "refType" | "refId">): string {
  if (t.refType === "scene" && t.refId) return `/p/${projectId}?focus=annotation&sceneId=${t.refId}`;
  if (t.refType && t.refId) return `/p/${projectId}?focus=${t.refType}&refId=${t.refId}`;
  return `/p/${projectId}?focus=messages`;
}
