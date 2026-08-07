import { useCallback, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/ui";
import { relSeen } from "../../push";
import { MenuSurface } from "./MenuSurface";

/**
 * 站內收件匣（頂欄鈴鐺）。
 *
 * 在此之前，「你被 @ 到了」只走 Web Push——沒訂閱裝置、關掉分頁、超過 24 小時 TTL，
 * 那則提醒就永遠消失，而真正走完「連結裝置 → 允許通知」流程的通常只有組長本人。
 * 這顆鈴鐺是保底通道：**推播只影響多快知道，不影響會不會知道。**
 *
 * 三個刻意的設計：
 *
 * 1. **0 筆時仍然顯示**（與 PendingApprovalsBadge 相反）。待核徽章是「有事才冒出來」的提示，
 *    而收件匣是一個**入口**——它得一直在，人才知道漏看的東西可以回來這裡找。
 * 2. **已讀是逐則、而且只在真的點了那一則才推進**。刻意不做 MessagePanel 那種「面板一渲染
 *    就把整個專案的水位推平」，那會讓數字在人看到內容之前就歸零。
 * 3. 未讀數走 sessionBoot 首屏就帶回來的 `notifyUnread`，不必等鈴鐺自己再打一支 API——
 *    否則登入後會有一段「明明有五則卻顯示 0」的空窗。
 */
export function NotifyBell() {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const boot = trpc.sessionBoot.bootstrap.useQuery(undefined, { refetchInterval: 60_000 });
  // 清單只在展開時才抓：收件匣可能很長，沒打開就不該為它付流量
  const list = trpc.notifications.list.useQuery({ limit: 20 }, { enabled: open });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.sessionBoot.bootstrap.invalidate();
    },
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.sessionBoot.bootstrap.invalidate();
    },
  });

  const close = useCallback(() => setOpen(false), []);

  const unread = boot.data?.notifyUnread ?? 0;
  const rows = list.data ?? [];

  /** 點某一則：先標已讀再跳頁——順序反過來的話，導航會把元件卸載掉，mutation 就送不出去 */
  const openRow = (row: { id: string; url: string; readAt: Date | string | null }) => {
    if (!row.readAt) markRead.mutate({ ids: [row.id] });
    close();
    navigate(row.url);
  };

  return (
    <div className="menu-wrap">
      <button
        ref={triggerRef}
        className="status-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ cursor: "pointer", color: unread ? "var(--danger-ink)" : undefined }}
        title={unread ? `${unread} 則未讀通知` : "通知（沒有未讀）"}
      >
        <Icon name="Inbox" size={14} />
        {unread > 0 && <span className="mono">{unread}</span>}
      </button>
      <MenuSurface open={open} onClose={close} label="通知" triggerRef={triggerRef} minWidth={288}>
        <div className="menu-label" role="presentation">
          通知
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              style={{ float: "right" }}
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              全部標為已讀
            </Button>
          )}
        </div>
        {list.isLoading && <div className="menu-item" role="presentation">載入中…</div>}
        {!list.isLoading && rows.length === 0 && (
          // 空狀態要講清楚這裡「會」有什麼，不然使用者不知道這顆鈴鐺是做什麼的
          <div className="menu-item" role="presentation" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
            <span>目前沒有通知</span>
            <span className="meta">被 @ 到、被指出哪一格要改、生成完成都會出現在這裡</span>
          </div>
        )}
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => openRow(row)}
            style={{ flexDirection: "column", alignItems: "flex-start", gap: 2, textAlign: "left" }}
          >
            <span style={{ fontWeight: row.readAt ? 400 : 600, display: "flex", alignItems: "center", gap: 6 }}>
              {!row.readAt && <span aria-label="未讀" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--danger-ink)", flex: "0 0 auto" }} />}
              {row.title}
            </span>
            <span className="meta" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.body}
            </span>
            <span className="meta">{relSeen(row.createdAt)}</span>
          </button>
        ))}
      </MenuSurface>
    </div>
  );
}
