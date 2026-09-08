import { useMemo } from "react";
import { companionNotificationPlan, companionPriorityRank, type CompanionEventKind } from "@shared/companionNotifications";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { Button, EmptyState, Meta, Skeleton } from "../components/ui";
import { composeToAssistant } from "../lib/assistantCompose";
import { openCompanionDeepLink } from "./openInBrowser";

/**
 * 任務／通知分頁。
 *
 * ## 為什麼不是完整的收件匣
 *
 * 收件匣是「所有發生過的事」；這一頁回答的是「**現在有什麼在等我**」。
 * 兩者的差別在排序：收件匣照時間，這一頁照**打擾強度**
 *（見 shared/companionNotifications.ts 的五級）。一則三天前的「等你確認」
 * 要排在十分鐘前的「有人改了專案描述」前面。
 *
 * ## 資料一律沿用既有 API
 *
 * `notifications.list` 是站內既有的收件匣查詢，這裡不另建一份。分級是**顯示層**
 * 的投影：同一批資料，換一個排序與一組「我可以幫你做什麼」的按鈕。
 */
export function CompanionTasks({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const digest = trpc.companion.digest.useQuery({ groupId }, { enabled: !!groupId, staleTime: 30_000 });
  const inbox = trpc.notifications.list.useQuery({ limit: 20 }, { staleTime: 30_000 });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate();
      void utils.notifications.unreadCount.invalidate();
    },
  });

  const totals = digest.data?.totals;

  const items = useMemo(() => {
    const rows = inbox.data ?? [];
    return [...rows]
      .map((row) => ({
        row,
        plan: companionNotificationPlan({ kind: notificationKind(row.kind) }),
      }))
      .sort((a, b) => {
        const byPriority = companionPriorityRank(a.plan.priority) - companionPriorityRank(b.plan.priority);
        if (byPriority !== 0) return byPriority;
        // 同一級照時間，新的在前——同樣重要的兩件事，先看剛發生的那件。
        return Date.parse(String(b.row.createdAt)) - Date.parse(String(a.row.createdAt));
      });
  }, [inbox.data]);

  return (
    <div className="companion-tasks">
      <h1 className="companion-tasks__title">現在在等你</h1>

      {digest.isLoading && !digest.data ? (
        <Skeleton height={72} />
      ) : totals ? (
        <section className="companion-tasks__totals" aria-label="整體狀態">
          <TotalTile label="等你確認" value={totals.awaiting} tone="warn" prompt="把等待確認的生成一個一個給我看" />
          <TotalTile label="失敗" value={totals.failed} tone="danger" prompt="把失敗的生成全部重新跑一次" />
          <TotalTile label="進行中" value={totals.running} tone="calm" prompt="現在跑到哪了？" />
        </section>
      ) : null}

      {inbox.isLoading && !inbox.data && <Skeleton height={120} />}

      {!inbox.isLoading && items.length === 0 && (
        <EmptyState
          icon={<Icon name="Check" size={26} />}
          title="沒有待辦"
          description="有事情需要你決定時，我會在這裡告訴你。"
        />
      )}

      {items.length > 0 && (
        <ul className="companion-tasks__list">
          {items.map(({ row, plan }) => (
            <li key={row.id} className={`companion-notice companion-notice--${plan.priority}`}>
              <div className="companion-notice__text">
                <strong>{row.title}</strong>
                <Meta as="span">{row.body}</Meta>
              </div>
              <div className="companion-notice__actions">
                {row.projectId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openCompanionDeepLink({ target: "project", projectId: row.projectId! })}
                    aria-label={`在瀏覽器開啟：${row.title}`}
                  >
                    <Icon name="Monitor" size={14} />
                    開啟
                  </Button>
                )}
                {!row.readAt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => markRead.mutate({ ids: [row.id] })}
                    disabled={markRead.isPending}
                  >
                    已讀
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 一格數字。點下去不是導航，而是**跟 Aios 說一句話**——這一頁上每一個數字
 * 背後都有一件可以請 AI 直接做的事，那才是 Companion 與收件匣的差別。
 */
function TotalTile({
  label,
  value,
  tone,
  prompt,
}: {
  label: string;
  value: number;
  tone: "warn" | "danger" | "calm";
  prompt: string;
}) {
  return (
    <button
      type="button"
      className={`companion-total companion-total--${tone}`}
      onClick={() => composeToAssistant(prompt, { autoSend: true })}
      disabled={value === 0}
      aria-label={`${label} ${value} 件${value > 0 ? "，點擊請 Aios 處理" : ""}`}
    >
      <span className="companion-total__value">{value}</span>
      <span className="companion-total__label">{label}</span>
    </button>
  );
}

/**
 * 既有通知的 kind → Companion 事件種類。
 *
 * 對不上的一律當 `project_updated`（informational）。**不要猜成 action_required**：
 * 猜錯的方向決定了使用者是被吵醒還是漏看，而漏看一則資訊性通知的代價
 * 遠小於半夜被一則「有人改了描述」震醒。
 */
function notificationKind(kind: string): CompanionEventKind {
  switch (kind) {
    case "generation_done":
      return "generation_completed";
    case "generation_pending_approval":
      return "approval_required";
    default:
      return "project_updated";
  }
}

export default CompanionTasks;
