import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "../api";
import { Icon, type IconName } from "../components/Icon";
import { ChatEmptyState, focusChatPartnerPicker } from "../components/ChatEmptyState";
import { setPlannerFocus } from "../discuss";

type Thread = inferRouterOutputs<AppRouter>["dm"]["threads"][number];
type Peer = inferRouterOutputs<AppRouter>["dm"]["peers"][number];
type HistoryItem = inferRouterOutputs<AppRouter>["dm"]["history"]["items"][number];

/** 私訊 @了 這個字就觸發 AI 助手回覆——與後端 dmAssistant.DM_ASSISTANT_TRIGGER 同字串 */
const ASSISTANT_TRIGGER = "@助手";

/** 可標注的物件型別（與後端 dmCore.DM_REF_TYPES 同步） */
type DmRefType = "project" | "database" | "schedule" | "note";
const REF_LABEL: Record<DmRefType, string> = { project: "專案", database: "資料庫", schedule: "排程", note: "筆記" };
const REF_ICON: Record<DmRefType, IconName> = { project: "Film", database: "Database", schedule: "Clock", note: "FileText" };
type PendingRef = { refType: DmRefType; refId: string; title: string };
type PendingAttach = { id: string; kind: string; title: string; mime: string; url: string };

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
  const peerSearchRef = useRef<HTMLInputElement>(null);
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
  const focusPartnerPicker = () => {
    setQ("");
    focusChatPartnerPicker(peerSearchRef.current);
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <h1>私訊</h1>
      <p className="sub">與同組夥伴（或開發者）一對一聊天——只有你們兩位看得到。可傳圖／影片、標注專案・資料庫・排程・筆記、或 @助手 問 AI；外部 AI 也能透過 MCP 私訊工具幫你收發。</p>
      <div className={`dm-layout ${peerId ? "has-peer" : ""}`}>
        <aside className="dm-list card" id="dm-partner-picker" aria-label="對話與夥伴選擇器">
          <input
            ref={peerSearchRef}
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
          <ChatEmptyState onStart={focusPartnerPicker} />
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
  const [, navigate] = useLocation();
  const history = trpc.dm.history.useQuery({ peerId }, { refetchInterval: 5_000, retry: 1 });
  // 往前翻頁：更舊的訊息累積在本地（元件以 key=peerId 重建，不會串到別的對象）
  const [older, setOlder] = useState<HistoryItem[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  // 私訊 2.0：待送的附件（上傳完成待綁定）／標注卡；標注 picker 開關與分頁；上傳狀態
  const [pendingAttach, setPendingAttach] = useState<PendingAttach | null>(null);
  const [pendingRef, setPendingRef] = useState<PendingRef | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const [refTab, setRefTab] = useState<DmRefType>("project");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const stickBottom = useRef(true);

  // 標注 picker 資料源（展開才抓）：專案／資料庫／排程／筆記，範圍過濾在伺服器
  const mentionables = trpc.dm.mentionables.useQuery(undefined, { enabled: refPickerOpen });

  const items = useMemo(() => [...older, ...(history.data?.items ?? [])], [older, history.data?.items]);
  const hasMore = olderHasMore ?? history.data?.hasMore ?? false;

  const send = trpc.dm.send.useMutation({
    onSuccess: () => {
      setDraft("");
      setPendingAttach(null);
      setPendingRef(null);
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

  // 上傳圖／影片／檔案 → /api/dm/upload（對象界同 dm.send）→ 存成待送附件；截圖以貼上觸發同一路徑
  const uploadAttachment = async (file: File | Blob, filename?: string) => {
    setUploadErr(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file, filename ?? (file instanceof File ? file.name : "附件"));
      fd.append("peerId", peerId);
      const res = await fetch("/api/dm/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `上傳失敗 ${res.status}`);
      }
      const data = (await res.json()) as { attachment: PendingAttach };
      setPendingAttach(data.attachment);
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "上傳失敗，請再試一次。");
    } finally {
      setUploading(false);
    }
  };

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

  // 送得出＝有文字、或有待送附件、或有標注（純空訊息不送）；上傳中／送出中不送
  const canSend = (draft.trim().length > 0 || !!pendingAttach || !!pendingRef) && !send.isPending && !uploading;
  const submit = () => {
    if (!canSend) return;
    send.mutate({
      peerId,
      body: draft.trim(),
      refType: pendingRef?.refType,
      refId: pendingRef?.refId,
      attachmentId: pendingAttach?.id,
    });
  };

  // 貼上截圖／圖片：剪貼簿有圖檔就攔下改走上傳（OS 截圖 → Ctrl/⌘+V 即附上）
  const onPaste = (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (file) {
      e.preventDefault();
      const ext = (file.type.split("/")[1] || "png").split(";")[0];
      void uploadAttachment(file, file.name || `截圖.${ext}`);
    }
  };

  const insertAssistant = () => {
    setDraft((b) => (b.includes(ASSISTANT_TRIGGER) ? b : `${ASSISTANT_TRIGGER} ${b}`.trimStart()));
    textRef.current?.focus();
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
  const refItems: Array<{ id: string; title: string }> =
    refTab === "project" ? (mentionables.data?.projects ?? [])
    : refTab === "database" ? (mentionables.data?.databases ?? []).map((d) => ({ id: d.id, title: d.name }))
    : refTab === "schedule" ? (mentionables.data?.schedules ?? []).map((s) => ({ id: s.id, title: s.title }))
    : (mentionables.data?.notes ?? []);
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
            // AI 助手回覆：不分左右，一律靠左的 AI 氣泡（收發雙方都看得到這則回覆）
            const isAssistant = m.kind === "assistant";
            const rowClass = isAssistant ? "assistant" : m.fromMe ? "mine" : "theirs";
            return (
              <div key={m.id}>
                {showDay && <div className="dm-day"><span>{day}</span></div>}
                <div className={`dm-row ${rowClass}`}>
                  <div className={`dm-bubble${isAssistant ? " assistant" : ""}`}>
                    {isAssistant && (
                      <span className="dm-ai-tag"><Icon name="Sparkles" size={11} style={{ marginRight: 3 }} />AI 助手</span>
                    )}
                    {m.attachment && <MessageAttachment att={m.attachment} />}
                    {m.body && <span className="dm-bubble-body">{m.body}</span>}
                    {m.ref && (
                      <button
                        type="button"
                        className="ref-card"
                        title={m.ref.route ? "打開這個項目" : undefined}
                        disabled={!m.ref.route}
                        onClick={() => {
                          const ref = m.ref;
                          if (!ref?.route) return;
                          // 排程／筆記：順便寫 sessionStorage 交棒，與 URL ?focus= 雙保險（舊訊息 route 只有 /planner 時仍能高亮）
                          if ((ref.refType === "schedule" || ref.refType === "note") && ref.refId) {
                            setPlannerFocus(ref.refType, ref.refId);
                          }
                          navigate(ref.route);
                        }}
                      >
                        <Icon name={REF_ICON[m.ref.refType as DmRefType] ?? "FileText"} size={14} />
                        <span className="ref-title">{REF_LABEL[m.ref.refType as DmRefType] ?? "標注"}・{m.ref.title}</span>
                        {m.ref.route && <span className="ref-go">查看</span>}
                      </button>
                    )}
                    <span className="dm-time">{bubbleTime(m.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 待送的附件／標注：讓人看清「即將附上什麼」，可取消 */}
      {pendingAttach && (
        <div className="compose-ctx">
          <Icon name={pendingAttach.kind === "image" ? "Image" : pendingAttach.kind === "video" ? "Film" : "FileText"} size={12} />
          <span>附件：{pendingAttach.title}</span>
          <button type="button" className="msg-action" aria-label="移除附件" onClick={() => setPendingAttach(null)}><Icon name="X" size={12} /></button>
        </div>
      )}
      {pendingRef && (
        <div className="compose-ctx">
          <Icon name={REF_ICON[pendingRef.refType]} size={12} />
          <span>標注{REF_LABEL[pendingRef.refType]}：{pendingRef.title}</span>
          <button type="button" className="msg-action" aria-label="取消標注" onClick={() => setPendingRef(null)}><Icon name="X" size={12} /></button>
        </div>
      )}

      {/* 工具列：上傳圖/影片、標注、問 AI 助手 */}
      <div className="dm-tools" role="group" aria-label="訊息工具">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadAttachment(f);
            e.target.value = ""; // 允許連續挑同一檔
          }}
        />
        <button type="button" className="chip" disabled={uploading} title="上傳圖片／影片／檔案（也可直接貼上截圖）" onClick={() => fileRef.current?.click()}>
          <Icon name="Image" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />{uploading ? "上傳中…" : "圖/影片"}
        </button>
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button type="button" className={`chip${refPickerOpen ? " on" : ""}`} aria-expanded={refPickerOpen} title="標注一個專案／資料庫／排程／筆記" onClick={() => setRefPickerOpen((v) => !v)}>
            <Icon name="Tag" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />標注
          </button>
          {refPickerOpen && (
            // 向上展開（mention-pop 預設 bottom），避免被 .dm-thread { overflow:hidden } 裁切底部
            <div className="mention-pop dm-ref-pop" role="dialog" aria-label="標注項目" style={{ width: 280, maxHeight: 300 }}>
              <div className="dm-ref-tabs" role="tablist">
                {(["project", "database", "schedule", "note"] as DmRefType[]).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={refTab === t} className={refTab === t ? "on" : ""} onClick={() => setRefTab(t)}>
                    {REF_LABEL[t]}
                  </button>
                ))}
              </div>
              <div style={{ overflowY: "auto", maxHeight: 220 }}>
                {mentionables.isError ? (
                  <span className="error" style={{ padding: "8px 12px", display: "block" }}>
                    載入失敗：{mentionables.error.message}
                    <button type="button" className="btn-sm" style={{ marginLeft: 6 }} onClick={() => mentionables.refetch()}>重試</button>
                  </span>
                ) : mentionables.isLoading ? (
                  <span className="hint" style={{ padding: "8px 12px" }}>載入中…</span>
                ) : refItems.length === 0 ? (
                  <span className="hint" style={{ padding: "8px 12px", display: "block" }}>
                    沒有可標注的{REF_LABEL[refTab]}。
                    {refTab === "project" && "（僅顯示你所在組的未封存專案）"}
                    {refTab === "database" && "（僅顯示你看得到的資料表）"}
                    {(refTab === "schedule" || refTab === "note") && "（請先在筆記排程頁新增）"}
                  </span>
                ) : (
                  refItems.slice(0, 30).map((it) => (
                    <button key={it.id} type="button" role="option" aria-selected="false"
                      onClick={() => { setPendingRef({ refType: refTab, refId: it.id, title: it.title }); setRefPickerOpen(false); }}>
                      <Icon name={REF_ICON[refTab]} size={12} style={{ marginRight: 5 }} />{it.title}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </span>
        <button type="button" className="chip" title="在這段對話裡問 AI 助手（讀近期對話後回答）" onClick={insertAssistant}>
          <Icon name="Sparkles" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />問 AI 助手
        </button>
      </div>

      <div className="dm-compose">
        <textarea
          ref={textRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            // Enter 送出、Shift+Enter 換行（輸入法組字中的 Enter 不觸發）
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="輸入訊息…（Enter 送出、Shift+Enter 換行；可貼上截圖）"
          aria-label="訊息內容"
          rows={2}
          maxLength={2000}
        />
        <button className="primary" onClick={submit} disabled={!canSend} aria-label="送出訊息">
          <Icon name="Send" size={15} />
        </button>
      </div>
      {uploadErr && <p className="error" role="alert" style={{ margin: "4px 12px 8px" }}>{uploadErr}</p>}
      {send.error && <p className="error" role="alert" style={{ margin: "4px 12px 8px" }}>{send.error.message}</p>}
    </section>
  );
}

/** 私訊附件渲染：圖片顯縮圖（點開新分頁）、影片／音訊內嵌播放、其他檔給下載連結 */
function MessageAttachment({ att }: { att: NonNullable<HistoryItem["attachment"]> }) {
  if (att.kind === "image") {
    return (
      <a href={att.url} target="_blank" rel="noreferrer" className="dm-attach-img" title={att.title}>
        <img src={att.url} alt={att.title} loading="lazy" />
      </a>
    );
  }
  if (att.kind === "video") {
    return <video className="dm-attach-media" src={att.url} controls preload="metadata" aria-label={att.title} />;
  }
  if (att.kind === "audio") {
    return <audio className="dm-attach-media" src={att.url} controls preload="none" aria-label={att.title} />;
  }
  return (
    <a href={att.url} target="_blank" rel="noreferrer" className="ref-card" title="下載附件">
      <Icon name="FileText" size={14} />
      <span className="ref-title">{att.title}</span>
      <span className="ref-go"><Icon name="Download" size={13} /></span>
    </a>
  );
}
