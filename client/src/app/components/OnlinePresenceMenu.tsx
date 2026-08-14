import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { presenceLabel, presenceState } from "@shared/presence";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { MenuSurface } from "./MenuSurface";

/**
 * 頂欄「誰在線」——不必進私訊就能看到夥伴上線狀態。
 *
 * 資料源＝`dm.presence`（與聊天頁同一支、同一可訊界、同一 3 分鐘上線窗）。
 * 為什麼常駐頂欄而不是只藏在 /chat：
 * 「他現在在不在」是協作決策（要不要等、要不要改派），不該逼人先走進收件匣才知道。
 * 點人名仍進私訊——這裡只是狀態指示，不是第二套聊天。
 */
export function OnlinePresenceMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  // 30 秒輪詢：與 ChatPage 一致；分頁背景時 react-query 會停，不會空轉
  const presence = trpc.dm.presence.useQuery(undefined, { refetchInterval: 30_000 });

  const { online, recent } = useMemo(() => {
    const rows = presence.data ?? [];
    const now = Date.now();
    const on: typeof rows = [];
    const re: typeof rows = [];
    for (const p of rows) {
      const st = presenceState(p.lastActiveAt, now);
      if (st === "online") on.push(p);
      else if (st === "recent") re.push(p);
    }
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "zh-Hant");
    on.sort(byName);
    re.sort(byName);
    return { online: on, recent: re };
  }, [presence.data]);

  const count = presence.data ? online.length : null;
  const title = count === null
    ? "正在查看誰在線…"
    : count === 0
      ? "目前沒有夥伴上線——點開可看剛離開的人"
      : `${count} 位夥伴上線中——點開看名單，點人名可私訊`;

  return (
    <div className="menu-wrap online-presence">
      <button
        ref={triggerRef}
        type="button"
        className="status-chip online-presence__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="online-presence-menu"
        aria-label={title}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`presence-dot-inline${count && count > 0 ? " is-on" : ""}`} aria-hidden />
        {count != null && count > 0 && <span className="mono">{count}</span>}
        <span className="online-presence__label">在線</span>
      </button>
      <MenuSurface
        open={open}
        onClose={close}
        label="誰在線"
        id="online-presence-menu"
        triggerRef={triggerRef}
        surfaceRole="dialog"
        roving={false}
        minWidth={240}
        className="online-presence__menu"
      >
        <div className="online-presence__head" role="presentation">
          <strong>誰在線</strong>
          <span className="online-presence__hint">不必進私訊就能看</span>
        </div>

        {presence.isLoading && (
          <p className="online-presence__empty" role="status">載入中…</p>
        )}
        {presence.error && (
          <p className="online-presence__empty error" role="alert">
            暫時讀不到線上狀態——
            <button type="button" className="linkish" onClick={() => void presence.refetch()}>再試一次</button>
          </p>
        )}
        {!presence.isLoading && !presence.error && online.length === 0 && recent.length === 0 && (
          <p className="online-presence__empty" role="status">
            目前沒有夥伴在線或剛離開。開著 App 的人會出現在這裡。
          </p>
        )}

        {online.length > 0 && (
          <>
            <div className="menu-label" role="presentation">上線中 · {online.length}</div>
            {online.map((p) => (
              <Link
                key={p.userId}
                href={`/chat/${p.userId}`}
                className="menu-item online-presence__row"
                role="menuitem"
                onClick={close}
                title={`私訊 ${p.name}`}
              >
                <span className="presence-dot-inline is-on" aria-hidden />
                <span className="online-presence__name">{p.name}</span>
                <span className="online-presence__state online">{presenceLabel(p.lastActiveAt)}</span>
              </Link>
            ))}
          </>
        )}

        {recent.length > 0 && (
          <>
            <div className="menu-label" role="presentation">剛離開 · {recent.length}</div>
            {recent.map((p) => (
              <Link
                key={p.userId}
                href={`/chat/${p.userId}`}
                className="menu-item online-presence__row"
                role="menuitem"
                onClick={close}
                title={`私訊 ${p.name}`}
              >
                <span className="presence-dot-inline is-recent" aria-hidden />
                <span className="online-presence__name">{p.name}</span>
                <span className="online-presence__state recent">{presenceLabel(p.lastActiveAt)}</span>
              </Link>
            ))}
          </>
        )}

        <div className="menu-sep" role="presentation" />
        <Link href="/chat" className="menu-item" role="menuitem" onClick={close}>
          <Icon name="MessageCircle" size={15} />
          開啟私訊
        </Link>
      </MenuSurface>
    </div>
  );
}
