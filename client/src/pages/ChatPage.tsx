import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "../api";
import { Icon } from "../components/Icon";

type Thread = inferRouterOutputs<AppRouter>["dm"]["threads"][number];
type Peer = inferRouterOutputs<AppRouter>["dm"]["peers"][number];
type HistoryItem = inferRouterOutputs<AppRouter>["dm"]["history"]["items"][number];

/** 相對時間（比照通訊錄 relTime；對話串清單的時間戳用） */
function relTime(d: string | Date | null): string {
  if (!d) return "";
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(d).toLocaleDateString("zh-TW");
}

/** 訊息氣泡上的時刻（同日只顯示時分；跨日由日期分隔列標示） */
function bubbleTime(d: Date): string {
  return new Date(d).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function dayKey(d: Date): string {
  return new Date(d).toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}

/**
 * 站內私訊（通訊錄 1:1 聊天）。人人可用——可訊對象＝同組夥伴＋開發者（後端 dmCore 守界）。
 * 左欄：對話串（未讀數）＋可發起新對話的夥伴名單；右欄：聊天視窗（輪詢 5 秒、聚焦即已讀）。
 * 手機：未選對象顯示清單、選了顯示對話（CSS .dm-layout 媒體查詢切換）。
 */
export function ChatPage({ peerId }: { peerId?: string }) {
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const threads = trpc.dm.threads.useQuery(undefined, { refetchInterval: 15_000 });
  const peers = trpc.dm.peers.useQuery();

  const threadPeerIds = useMemo(() => new Set((threads.data ?? []).map((t) => t.peerId)), [threads.data]);
  const needle = q.trim().toLowerCase();
  const filteredThreads = (threads.data ?? []).filter(
    (t) => !needle || t.peerName.toLowerCase().includes(needle) || t.peerEmail.toLowerCase().includes(needle),
  );
  // 「發起新對話」名單：還沒有對話串的夥伴（搜尋同時過濾兩邊）
  const newPeers = (peers.data ?? []).filter(
    (p) => !threadPeerIds.has(p.userId) && (!needle || p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle)),
  );

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <h1>私訊</h1>
      <p className="sub">與同組夥伴（或開發者）一對一聊天——只有你們兩位看得到。外部 AI 也能透過 MCP 私訊工具幫你收發。</p>
      <div className={`dm-layout ${peerId ? "has-peer" : ""}`}>
        <aside className="dm-list card" aria-label="對話清單">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋夥伴…"
            aria-label="搜尋夥伴"
            style={{ width: "100%", marginBottom: 8 }}
          />
          {threads.isLoading ? (
            <div className="skeleton" style={{ height: 120, borderRadius: 8 }} role="status" aria-label="載入中" />
          ) : (
            <>
              {filteredThreads.map((t) => (
                <ThreadItem key={t.peerId} t={t} active={t.peerId === peerId} onOpen={() => navigate(`/chat/${t.peerId}`)} />
              ))}
              {filteredThreads.length === 0 && needle === "" && (
                <p className="hint" style={{ fontSize: 12 }}>還沒有對話——從下面的夥伴名單挑一位開始聊。</p>
              )}
              {newPeers.length > 0 && (
                <>
                  <div className="menu-label" style={{ padding: "8px 2px 4px" }}>發起新對話</div>
                  {newPeers.map((p) => (
                    <button key={p.userId} className="dm-item" onClick={() => navigate(`/chat/${p.userId}`)}>
                      <span className="dm-item-name">
                        {p.name}
                        {p.isSuperAdmin && <span className="dm-chip">開發者</span>}
                      </span>
                      <span className="dm-item-sub">{p.sharedGroups[0] ?? p.email}</span>
                    </button>
                  ))}
                </>
              )}
              {filteredThreads.length === 0 && newPeers.length === 0 && (
                <p className="hint" style={{ fontSize: 12 }}>{needle ? "沒有符合的夥伴。" : "目前沒有可私訊的夥伴。"}</p>
              )}
            </>
          )}
        </aside>
        {peerId ? (
          // key=peerId：換對象時強制重建對話視窗，翻頁游標／草稿不殘留到別人身上
          <Conversation key={peerId} peerId={peerId} onBack={() => navigate("/chat")} />
        ) : (
          <section className="dm-thread card dm-empty">
            <div className="empty-state" style={{ margin: "auto" }}>
              <Icon name="MessageCircle" size={32} style={{ color: "var(--fg-secondary)" }} />
              <h3>選一位夥伴開始聊</h3>
              <p className="hint">左邊挑一個對話，或從「發起新對話」找同組夥伴。</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ThreadItem({ t, active, onOpen }: { t: Thread; active: boolean; onOpen: () => void }) {
  return (
    <button className={`dm-item ${active ? "active" : ""}`} onClick={onOpen} aria-current={active}>
      <span className="dm-item-name">
        <span style={{ fontWeight: t.unread > 0 ? 700 : 600 }}>{t.peerName}</span>
        {t.unread > 0 && <span className="dm-unread">{t.unread > 99 ? "99+" : t.unread}</span>}
        <span className="dm-item-time">{relTime(t.lastAt)}</span>
      </span>
      <span className="dm-item-sub" style={{ fontWeight: t.unread > 0 ? 600 : 400 }}>
        {t.lastFromMe ? "我：" : ""}{t.lastBody}
      </span>
    </button>
  );
}

function Conversation({ peerId, onBack }: { peerId: string; onBack: () => void }) {
  const utils = trpc.useUtils();
  const history = trpc.dm.history.useQuery({ peerId }, { refetchInterval: 5_000, retry: 1 });
  // 往前翻頁：更舊的訊息累積在本地（元件以 key=peerId 重建，不會串到別的對象）
  const [older, setOlder] = useState<HistoryItem[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);

  const items = useMemo(() => [...older, ...(history.data?.items ?? [])], [older, history.data?.items]);
  const hasMore = olderHasMore ?? history.data?.hasMore ?? false;

  const send = trpc.dm.send.useMutation({
    onSuccess: () => {
      setDraft("");
      stickBottom.current = true;
      utils.dm.history.invalidate({ peerId });
      utils.dm.threads.invalidate();
    },
  });
  const markRead = trpc.dm.markRead.useMutation({
    onSuccess: () => {
      utils.dm.unread.invalidate();
      utils.dm.threads.invalidate();
    },
  });

  // 已讀上報：視窗聚焦且對話有對方來訊時（新訊息抵達或重新聚焦都會再報一次水位）
  const lastFromPeerAt = items.length ? items.filter((m) => !m.fromMe).at(-1)?.createdAt : undefined;
  const lastFromPeerKey = lastFromPeerAt ? new Date(lastFromPeerAt).getTime() : 0;
  useEffect(() => {
    if (!lastFromPeerKey) return;
    const report = () => {
      if (document.hasFocus()) markRead.mutate({ peerId });
    };
    report();
    window.addEventListener("focus", report);
    return () => window.removeEventListener("focus", report);
    // markRead.mutate 是穩定參照；以「對方最後來訊時刻」當依賴，新來訊才重報
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId, lastFromPeerKey]);

  // 自動捲到底：初載與新訊息時；使用者捲上去看舊訊息時不打擾（stickBottom）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const loadOlder = async () => {
    const earliest = items[0];
    if (!earliest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await utils.client.dm.history.query({ peerId, before: new Date(earliest.createdAt), limit: 50 });
      const el = scrollRef.current;
      const prevHeight = el?.scrollHeight ?? 0;
      stickBottom.current = false;
      setOlder((cur) => [...page.items, ...cur]);
      setOlderHasMore(page.hasMore);
      // 維持視覺位置：prepend 後把捲軸往下推「新增的高度」
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  const canSend = draft.trim().length > 0 && !send.isPending;
  const submit = () => {
    if (canSend) send.mutate({ peerId, body: draft.trim() });
  };

  if (history.error) {
    return (
      <section className="dm-thread card">
        <button className="btn-sm dm-back" onClick={onBack}><Icon name="Undo2" size={13} /> 返回</button>
        <p className="error" role="alert" style={{ margin: "auto" }}>{history.error.message}</p>
      </section>
    );
  }

  const peer = history.data?.peer;
  let lastDay = "";
  return (
    <section className="dm-thread card" aria-label={peer ? `與 ${peer.name} 的對話` : "對話"}>
      <header className="dm-head">
        <button className="btn-sm dm-back" onClick={onBack} aria-label="返回對話清單"><Icon name="Undo2" size={13} /></button>
        <div style={{ minWidth: 0 }}>
          <b>{peer?.name ?? "…"}</b>
          {peer?.email && <div className="hint" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{peer.email}</div>}
        </div>
      </header>
      <div
        className="dm-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {hasMore && (
          <div style={{ textAlign: "center", marginBottom: 4 }}>
            <button className="btn-sm" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? "載入中…" : "載入更早的訊息"}</button>
          </div>
        )}
        {history.isLoading ? (
          <div className="skeleton" style={{ height: 160, borderRadius: 8 }} role="status" aria-label="訊息載入中" />
        ) : items.length === 0 ? (
          <p className="hint" style={{ textAlign: "center", marginTop: 24 }}>還沒有訊息——打個招呼吧 🙏</p>
        ) : (
          items.map((m) => {
            const day = dayKey(m.createdAt);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id}>
                {showDay && <div className="dm-day"><span>{day}</span></div>}
                <div className={`dm-row ${m.fromMe ? "mine" : "theirs"}`}>
                  <div className="dm-bubble">
                    {m.body}
                    <span className="dm-time">{bubbleTime(m.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="dm-compose">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter 送出、Shift+Enter 換行（輸入法組字中的 Enter 不觸發）
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="輸入訊息…（Enter 送出、Shift+Enter 換行）"
          aria-label="訊息內容"
          rows={2}
          maxLength={2000}
        />
        <button className="primary" onClick={submit} disabled={!canSend} aria-label="送出訊息">
          <Icon name="Send" size={15} />
        </button>
      </div>
      {send.error && <p className="error" role="alert" style={{ margin: "4px 12px 8px" }}>{send.error.message}</p>}
    </section>
  );
}
