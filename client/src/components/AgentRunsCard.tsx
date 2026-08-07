import { useState } from "react";
import { Link } from "wouter";
import { Icon, type IconName } from "./Icon";
import { Button, Meta, Pill, Skeleton, type PillStatus } from "./ui";

/**
 * 作業台「需要注意的 AI 工作」。
 *
 * 為什麼要有這張卡：teamAssistant.agentOverview 一直有回 runs（發起人、目前步驟、
 * 錯誤摘要），但作業台只取 summary 的三個數字。使用者看到「AI 正在處理 3 份計畫」，
 * 卻不知道是哪個案、卡在誰身上、失敗的那筆為什麼失敗——只好回頭一個個開專案問人。
 * 這張卡把那些欄位攤開，讓「哪個案卡住了、誰的事在跑」在首頁就看得到。
 *
 * 刻意只顯示「需要注意的」：完成／已停止的計畫不需要人做任何事，列出來只會把
 * 真正要處理的那一筆擠到看不見的地方。
 */

/** agentOverview.runs 的一列（欄位名對齊 server/routers/teamAssistant.ts 的 agentOverview 回傳）。
 *  只宣告這張卡用得到的欄位——多餘欄位（estPoints／userId…）照樣傳得進來。 */
export interface AgentRunRow {
  id: string;
  projectId: string;
  projectTitle: string;
  goal: string;
  status: string;
  doneSteps: number;
  totalSteps: number;
  /** superjson 傳回來是 Date；測試與舊快取可能是字串 */
  updatedAt: string | Date;
  userName: string | null;
  error: string | null;
  currentStepNote: string | null;
}

/**
 * 「最近失敗」的認定窗，與 server 的 GROUP_AGENT_RECENT_MS 同為 7 天。
 * 這裡不能 import 後端常數（client 不得依賴 server，見 ADR-009），改常數時兩邊要一起改。
 * 沒有這道窗的話，三個月前失敗過一次的計畫會永遠掛在首頁上喊「需要注意」。
 */
const RECENT_FAILED_MS = 7 * 24 * 60 * 60 * 1000;

/** 預設顯示筆數：手機一屏內看得完；超過的用「顯示全部」展開，不靜默截斷 */
const VISIBLE_LIMIT = 4;

/**
 * 需要注意的狀態與它的排序權重。
 * 排序照「人要不要動手」由重到輕：失敗（卡死了）→ 待核准（等你按）→ 等待人員
 * （等某個人做事）→ 執行中（AI 自己在跑，最不需要你）。
 */
const ATTENTION: Record<string, { label: string; pill: PillStatus; icon: IconName; rank: number }> = {
  failed: { label: "失敗", pill: "failed", icon: "TriangleAlert", rank: 0 },
  awaiting_approval: { label: "待核准", pill: "queued", icon: "Bell", rank: 1 },
  waiting: { label: "等待人員", pill: "queued", icon: "Clock", rank: 2 },
  running: { label: "執行中", pill: "running", icon: "Loader", rank: 3 },
};

/**
 * 挑出需要注意的執行並排序（純函式，便於測）。
 * failed 另外套「最近」窗；done／stopped／discarded 一律不列。
 */
export function selectAttentionRuns(runs: readonly AgentRunRow[], nowMs: number = Date.now()): AgentRunRow[] {
  return runs
    .filter((r) => {
      if (!(r.status in ATTENTION)) return false;
      if (r.status !== "failed") return true;
      return new Date(r.updatedAt).getTime() >= nowMs - RECENT_FAILED_MS;
    })
    .sort((a, b) => {
      const byRank = ATTENTION[a.status].rank - ATTENTION[b.status].rank;
      if (byRank !== 0) return byRank;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
}

/** 相對時間（站內慣例：各頁各自持有一份小工具，避免為此拉出共用模組） */
function relTime(d: string | Date): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(d).toLocaleDateString("zh-TW");
}

export function AgentRunsCard({
  runs,
  isLoading = false,
  errorMessage = null,
  onRetry,
  listLimit,
}: {
  runs: readonly AgentRunRow[] | undefined;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  /** 後端清單上限（agentOverview.listLimit）：回傳筆數頂到它就代表還有更早的沒回來 */
  listLimit?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (errorMessage) {
    return (
      <p className="error" role="alert">
        AI 代理狀況暫時載入不了——
        {onRetry && (
          <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={onRetry}>
            再試一次
          </Button>
        )}
      </p>
    );
  }

  // 還沒有任何資料才鋪骨架：背景輪詢（8 秒一次）時已有內容，不該整塊閃回骨架
  if (isLoading && !runs) {
    return (
      <section className="bento-card" aria-busy="true" aria-label="AI 代理狀況載入中">
        <Skeleton height={18} width="45%" />
        <Skeleton height={64} />
      </section>
    );
  }

  if (!runs || runs.length === 0) return null;

  const attention = selectAttentionRuns(runs);
  if (attention.length === 0) {
    // 全部正常時不佔版面：一句話讓人知道「有在看，只是沒事」，而不是空白得像壞掉
    return (
      <Meta as="p" style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
        <Icon name="CheckCircle2" size={14} />
        AI 代理都在正常進度上，沒有卡住或待你處理的計畫。
      </Meta>
    );
  }

  const visible = expanded ? attention : attention.slice(0, VISIBLE_LIMIT);
  const hidden = attention.length - visible.length;
  // 後端清單封頂（預設 30）＝更早的執行根本沒回來，這件事必須說，否則畫面在說謊
  const serverCapped = listLimit !== undefined && runs.length >= listLimit;

  return (
    <section className="bento-card" aria-labelledby="agent-runs-title">
      <div className="bento-card__head">
        <h3 id="agent-runs-title">
          <Icon name="Bot" size={17} style={{ color: "var(--primary-ink)" }} />
          需要注意的 AI 工作
        </h3>
        <Meta as="span">{attention.length} 筆</Meta>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {visible.map((run) => {
          const meta = ATTENTION[run.status];
          const step = run.currentStepNote;
          return (
            <li key={run.id}>
              <Link
                href={`/p/${run.projectId}`}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  minHeight: 44,
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-12)",
                  background: "var(--card2)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span style={{ color: "var(--fg-secondary)", paddingTop: 2, flex: "0 0 auto" }}>
                  <Icon name={meta.icon} size={16} />
                </span>
                {/* minWidth:0 是長標題／長錯誤訊息不把卡片撐出橫向捲軸的關鍵 */}
                <span style={{ minWidth: 0, flex: "1 1 auto", display: "grid", gap: 4 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "var(--fs-14)", overflowWrap: "anywhere" }}>{run.projectTitle}</strong>
                    <Pill status={meta.pill}>{meta.label}</Pill>
                  </span>
                  <span
                    style={{
                      fontSize: "var(--fs-13)",
                      color: "var(--fg-secondary)",
                      overflowWrap: "anywhere",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {step ? `目前：${step}` : `目標：${run.goal}`}
                  </span>
                  {run.status === "failed" && (
                    /* 錯誤摘要是這張卡最該讓人看到的東西；後端沒留訊息時也要給下一步，
                       不能只丟一個「失敗」讓人不知道去哪查 */
                    <span style={{ fontSize: "var(--fs-13)", color: "var(--danger-ink)", overflowWrap: "anywhere" }}>
                      失敗原因：{run.error || "AI 沒有留下訊息——點進專案看執行紀錄。"}
                    </span>
                  )}
                  <Meta as="span" style={{ fontSize: "var(--fs-12)" }}>
                    {run.userName ?? "已離開的成員"} 發起
                    {run.totalSteps > 0 ? `・進度 ${run.doneSteps}/${run.totalSteps} 步` : ""}
                    ・{relTime(run.updatedAt)}
                  </Meta>
                </span>
                <Icon name="ChevronRight" size={17} />
              </Link>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <Button size="sm" onClick={() => setExpanded(true)}>
          顯示全部（還有 {hidden} 筆）
        </Button>
      )}
      {serverCapped && (
        <Meta as="p" style={{ margin: 0 }}>
          這裡最多列最近 {listLimit} 筆計畫，更早的請到各專案頁看。
        </Meta>
      )}
    </section>
  );
}
