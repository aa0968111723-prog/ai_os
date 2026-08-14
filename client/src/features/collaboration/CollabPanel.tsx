/**
 * 首頁的「團隊協作」區。
 *
 * 取代原本那一排只有名字的在場 chip——它回答不了任何一個使用者真正會問的問題。
 * 這一區要在三秒內回答五件事：
 *   1. 現在誰在線？（而且他們在哪個專案）
 *   2. 有什麼找我？
 *   3. 哪些地方有人正在工作？
 *   4. 哪些事情卡住？
 *   5. 哪些專案最近有討論？
 *
 * **刻意不做成完整社群 feed**：首頁只顯示「下一步有價值」的一兩件，其餘一律
 * 收進協作中心。把所有 collaboration UI 塞進首頁會讓它變成沒有人看的儀表板。
 */
import { Link } from "wouter";
import { trpc } from "../../api";
import { Icon, type IconName } from "../../components/Icon";
import { Card, Chip, Hint, Meta } from "../../components/ui";

/** 首頁只攤這麼多件事；其餘去協作中心 */
const HOME_ATTENTION_LIMIT = 2;

export function CollabPanel({
  groupId,
  /** 即時在場（來自既有的組房 WebSocket）：比查詢新鮮，優先用它顯示人數 */
  livePeerCount,
}: {
  groupId: string | null;
  livePeerCount?: number;
}) {
  // 聚合查詢：一支查完，不在前端拼十幾支。30 秒重取＋WS invalidate 推著走。
  const q = trpc.collaboration.summary.useQuery(
    { groupId: groupId ?? undefined },
    { enabled: Boolean(groupId), refetchInterval: 30_000 },
  );
  const s = q.data;
  if (!groupId || !s) return null;

  const online = livePeerCount ?? s.onlinePeers.length;
  const discussions = s.threads.reduce((n, t) => n + t.count, 0);
  const nothingHappening =
    online === 0 && discussions === 0 && s.unreadMentions === 0 && s.openAnnotations === 0 && s.attention.length === 0;
  // 完全沒事時不佔版面：空的協作區比沒有協作區更糟（它教使用者忽略這一塊）
  if (nothingHappening) return null;

  return (
    <Card as="section" aria-labelledby="collab-panel-title" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h2 id="collab-panel-title" style={{ margin: 0, fontSize: "var(--fs-15)" }}>
          團隊協作
        </h2>
        <span style={{ flex: "1 1 auto" }} />
        <Link
          href="/collab"
          className="btn-ghost btn-sm"
          style={{ minHeight: 44, display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          全部 <Icon name="ChevronRight" size={14} />
        </Link>
      </div>

      {/* 四個數字：每一個都是「有沒有事」的答案，不是統計看板 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }} data-testid="collab-counters">
        <CountChip icon="Users" tone="online" n={online} label={`${online} 人在線`} always />
        <CountChip icon="MessageCircle" n={discussions} label={`${discussions} 則新討論`} />
        <CountChip icon="Bell" n={s.unreadMentions} label={`${s.unreadMentions} 則提及你`} />
        <CountChip icon="TriangleAlert" n={s.openAnnotations} label={`${s.openAnnotations} 個未解決標注`} />
      </div>

      {/* 在線的人：帶「他正在哪個專案」，這才讓「誰在線」從裝飾變成可以行動的資訊 */}
      {s.onlinePeers.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }} aria-label="在線夥伴">
          {s.onlinePeers.map((p) => (
            <Chip
              key={p.userId}
              style={{ margin: 0, background: p.color, color: "#fff", borderColor: p.color }}
              title={p.projectTitles.length > 0 ? `${p.name}・正在 ${p.projectTitles[0]}` : p.name}
            >
              {p.name}
              {p.projectTitles.length > 0 && (
                <span style={{ opacity: 0.85, marginLeft: 4, fontSize: "var(--fs-11)" }}>· {p.projectTitles[0]}</span>
              )}
            </Chip>
          ))}
        </div>
      )}

      {/* 最重要的一兩件事。排序是阻塞程度，不是時間。 */}
      {s.attention.slice(0, HOME_ATTENTION_LIMIT).map((item) => (
        <AttentionRow key={item.id} item={item} />
      ))}
      {s.attention.length > HOME_ATTENTION_LIMIT && (
        <Link href="/collab">
          <Meta as="span" style={{ display: "inline-block", marginTop: 6 }}>
            還有 {s.attention.length - HOME_ATTENTION_LIMIT} 件找你 →
          </Meta>
        </Link>
      )}
    </Card>
  );
}

function CountChip({
  icon,
  n,
  label,
  tone,
  always,
}: {
  icon: IconName;
  n: number;
  label: string;
  tone?: "online";
  /** 就算是 0 也要顯示（在線人數為 0 本身就是有用的資訊） */
  always?: boolean;
}) {
  if (n === 0 && !always) return null;
  return (
    <Chip
      style={{
        margin: 0,
        ...(tone === "online" && n > 0 ? { borderColor: "var(--success-ink)", color: "var(--success-ink)" } : {}),
      }}
    >
      <Icon name={icon} size={12} /> {label}
    </Chip>
  );
}

/**
 * 一件「找我」。**一定要能直接到現場**——點下去要落在那一格／那一版／那個標注，
 * 不是落在專案首頁然後讓人自己找。深連結由伺服器的 notification.url 給。
 */
export function AttentionRow({
  item,
}: {
  item: {
    id: string;
    kind: string;
    title: string;
    body: string;
    url: string;
    projectTitle: string | null;
    actorName: string | null;
    createdAt: string;
  };
}) {
  return (
    <div
      data-testid="attention-row"
      style={{
        marginTop: 8,
        padding: "8px 10px",
        borderRadius: 10,
        background: "var(--card2)",
        border: "1px solid var(--border-soft)",
      }}
    >
      <Meta as="p" style={{ margin: 0, fontSize: "var(--fs-11)" }}>
        {[item.actorName, item.projectTitle].filter(Boolean).join(" · ")}
        {item.actorName || item.projectTitle ? " · " : ""}
        {relTime(item.createdAt)}
      </Meta>
      <p style={{ margin: "2px 0 0", fontSize: "var(--fs-13)", fontWeight: 600 }}>{item.title}</p>
      {item.body && (
        <Hint as="p" style={{ margin: "2px 0 0", fontSize: "var(--fs-12)" }}>
          {item.body.length > 80 ? `${item.body.slice(0, 80)}…` : item.body}
        </Hint>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <Link href={item.url} className="btn btn-sm" style={{ minHeight: 44 }}>
          {/* 44px：手機是一級公民，這是主要操作 */}
          查看
        </Link>
      </div>
    </div>
  );
}

/** 相對時間。伺服器給 ISO，這裡只做顯示——不在前端算業務邏輯。 */
export function relTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.round(hours / 24)} 天前`;
}
