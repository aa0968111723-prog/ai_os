import { useCallback, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { MenuSurface } from "./MenuSurface";

/**
 * 頂欄待辦徽章（UX 高：頂欄完全不顯示待審/待核→多專案組長必然漏審）：
 * 作用組的「分鏡待審＋生成待核」總數。點鈴鐺展開通知清單，逐案列出是哪個專案、
 * 各差幾筆，點某一列直接跳到該專案；也保留「回作業台看全部」。0 筆不佔版面。
 * CSP 下自製下拉（無外部庫）：點外面或 Esc 關閉，比照 AccountMenu。
 */
export function PendingApprovalsBadge({ groupId }: { groupId: string }) {
  const summary = trpc.approvals.pendingSummary.useQuery({ groupId }, { refetchInterval: 60_000, enabled: !!groupId });
  // 專案名稱查詢（pendingSummary 只回 projectId）：與 Launchpad 同一條 query，react-query 會去重快取
  const projectList = trpc.projects.list.useQuery({ groupId: groupId || undefined }, { enabled: !!groupId });
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Hooks 必須無條件呼叫——close 的 useCallback 放在任何 return 之前，之後才依資料條件決定要不要渲染。
  // 外點／Esc／手機貼底 sheet 已收在 MenuSurface
  const close = useCallback(() => setOpen(false), []);

  const summ = summary.data;
  const total = summ ? summ.totalPendingApprovals + summ.totalAwaitingGenerations : 0;
  // 0 筆（或還沒載到）不佔版面——所有 hook 已在上方無條件呼叫，這裡提早 return 安全
  if (!summ || total === 0) return null;
  const titleOf = (pid: string) => projectList.data?.find((p) => p.id === pid)?.title ?? "專案";
  // 逐案列（各專案至少一筆待辦）：待辦多的排前面，讓最該處理的浮到頂
  const rows = summ.projects
    .filter((p) => p.pendingApprovals + p.awaitingGenerations > 0)
    .sort((a, b) => (b.pendingApprovals + b.awaitingGenerations) - (a.pendingApprovals + a.awaitingGenerations));
  return (
    <div className="menu-wrap">
      <button
        ref={triggerRef}
        className="status-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ color: "var(--gold-ink)", cursor: "pointer" }}
        title={`分鏡待審 ${summ.totalPendingApprovals}・生成待核准 ${summ.totalAwaitingGenerations}——點開看是哪些專案`}
      >
        <Icon name="Bell" size={14} />
        <span className="mono">{total}</span>
      </button>
      <MenuSurface open={open} onClose={close} label="待辦通知" triggerRef={triggerRef} minWidth={248}>
          <div className="menu-label" role="presentation">待辦通知</div>
          {rows.map((p) => (
            <Link
              key={p.projectId}
              href={`/p/${p.projectId}?focus=pending`}
              className="menu-item"
              role="menuitem"
              onClick={close}
              style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}
            >
              <span style={{ fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {titleOf(p.projectId)}
              </span>
              <span className="meta">
                {[
                  p.pendingApprovals > 0 ? `分鏡待審 ${p.pendingApprovals}` : null,
                  p.awaitingGenerations > 0 ? `生成待核 ${p.awaitingGenerations}` : null,
                ].filter(Boolean).join("・")}
              </span>
            </Link>
          ))}
          <div className="menu-sep" />
          <Link href="/dashboard" className="menu-item" role="menuitem" onClick={close} style={{ color: "var(--fg-secondary)" }}>
            <Icon name="ArrowRight" size={15} />回今日工作台看全部
          </Link>
      </MenuSurface>
    </div>
  );
}
