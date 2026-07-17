import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { MentionInput, resolveMentions, type MemberLite } from "../components/MentionInput";

/**
 * 訊息中心（通訊錄協作）：私訊、群組對話、針對專案討論。
 * 左欄＝對話清單＋開新對話；右欄＝選中對話的訊息串＋輸入框。訊息走輪詢（8 秒），與站內留言一致。
 * 從通訊錄按「私訊」跳來時，經 sessionStorage 交棒要打開的對話 id（見 openConvoHandoff）。
 */

const HANDOFF_KEY = "aios_open_convo";
/** 通訊錄「私訊」→ 訊息中心：把要開啟的對話 id 放進 sessionStorage，導頁後這裡讀出並選中 */
export function setOpenConvoHandoff(conversationId: string): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, conversationId);
  } catch {
    /* 隱私模式等無 sessionStorage：略過，使用者仍可在清單點開 */
  }
}
function takeOpenConvoHandoff(): string | null {
  try {
    const v = sessionStorage.getItem(HANDOFF_KEY);
    if (v) sessionStorage.removeItem(HANDOFF_KEY);
    return v;
  } catch {
    return null;
  }
}

function relTime(d: string | Date | null): string {
  if (!d) return "";
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(d).toLocaleDateString("zh-TW");
}

export function MessagesPage({ groupId }: { groupId?: string }) {
  const me = trpc.auth.me.useQuery();
  const myId = me.data?.user.id;
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const list = trpc.messaging.list.useQuery(undefined, { refetchInterval: 8000 });

  // 從通訊錄交棒過來的對話：掛載時讀一次並選中
  useEffect(() => {
    const handoff = takeOpenConvoHandoff();
    if (handoff) setSelectedId(handoff);
  }, []);

  const conversations = list.data?.conversations ?? [];

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <h1>訊息</h1>
      <p className="sub">和團隊夥伴私訊、開群組討論，或針對某個專案聊。這裡是每個人的通訊錄——不必是組長也能用。</p>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* 左欄：對話清單 */}
        <aside className="card" style={{ flex: "1 1 300px", minWidth: 280, maxWidth: 380, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <b style={{ flex: 1 }}>對話</b>
            <button className="btn-sm primary" onClick={() => setComposing(true)}>
              <Icon name="Plus" size={14} /> 開新對話
            </button>
          </div>

          {list.isLoading ? (
            <div role="status" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 56, marginBottom: 8, borderRadius: 10 }} />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <p className="hint">還沒有對話。按「開新對話」找夥伴私訊，或開一個群組。</p>
          ) : (
            <div style={{ display: "grid", gap: 4 }}>
              {conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={selectedId === c.id ? "convo-item active" : "convo-item"}
                  style={{
                    display: "block", width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                    background: selectedId === c.id ? "var(--primary-tint)" : "transparent",
                    borderRadius: 10, padding: "8px 10px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon name={c.kind === "group" ? "MessageCircle" : "User"} size={14} />
                    <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.title}
                      {c.kind === "group" && <span className="hint" style={{ fontWeight: 400 }}>（{c.memberCount} 人）</span>}
                    </span>
                    {c.unread > 0 && (
                      <span style={{ fontSize: 11, minWidth: 18, textAlign: "center", padding: "0 5px", borderRadius: 999, background: "var(--primary-solid)", color: "#fff" }}>
                        {c.unread > 99 ? "99+" : c.unread}
                      </span>
                    )}
                  </div>
                  <div className="hint" style={{ fontSize: 12, display: "flex", gap: 6, marginTop: 2 }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.projectName && <span style={{ color: "var(--primary-ink)" }}>◧ {c.projectName} · </span>}
                      {c.lastBody ?? "尚無訊息"}
                    </span>
                    <span style={{ flex: "none" }}>{relTime(c.lastAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* 右欄：訊息串 或 佔位 */}
        <div style={{ flex: "2 1 420px", minWidth: 320 }}>
          {composing ? (
            <NewConversation
              groupId={groupId}
              onClose={() => setComposing(false)}
              onOpened={(id) => {
                setSelectedId(id);
                setComposing(false);
                utils.messaging.list.invalidate();
              }}
            />
          ) : selectedId ? (
            <Thread key={selectedId} conversationId={selectedId} myId={myId} onLeft={() => setSelectedId(null)} />
          ) : (
            <div className="empty-state card" style={{ padding: 32 }}>
              <Icon name="MessageCircle" size={28} />
              <h3 style={{ marginTop: 8 }}>選一則對話開始</h3>
              <p className="hint">從左邊挑一則對話，或按「開新對話」找夥伴。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 訊息串 ─────────────────────────────────────── */
function Thread({ conversationId, myId, onLeft }: { conversationId: string; myId: string | undefined; onLeft: () => void }) {
  const utils = trpc.useUtils();
  const thread = trpc.messaging.thread.useQuery({ conversationId }, { refetchInterval: 8000 });
  const [body, setBody] = useState("");
  const [showManage, setShowManage] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const conv = thread.data?.conversation;
  const messages = thread.data?.messages ?? [];
  const lastMsgId = messages[messages.length - 1]?.id;

  const markRead = trpc.messaging.markRead.useMutation({
    onSuccess: () => {
      utils.messaging.list.invalidate();
      utils.messaging.unreadTotal.invalidate();
    },
  });
  // 打開／有新訊息時上報已讀（audit 豁免，成本低）
  useEffect(() => {
    if (conv) markRead.mutate({ conversationId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, lastMsgId, conv?.id]);

  // 新訊息捲到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastMsgId]);

  const send = trpc.messaging.send.useMutation({
    onSuccess: () => {
      setBody("");
      utils.messaging.thread.invalidate({ conversationId });
      utils.messaging.list.invalidate();
    },
  });

  const memberLites: MemberLite[] = useMemo(
    () => (conv?.members ?? []).filter((m) => m.userId !== myId).map((m) => ({ userId: m.userId, name: m.name, groupRole: "" })),
    [conv?.members, myId],
  );
  const nameById = useMemo(() => new Map((conv?.members ?? []).map((m) => [m.userId, m.name])), [conv?.members]);

  const doSend = () => {
    const text = body.trim();
    if (!text || send.isPending) return;
    send.mutate({ conversationId, body: text, mentions: resolveMentions(text, memberLites) });
  };

  if (thread.isLoading) return <div className="card skeleton" style={{ height: 420 }} />;
  if (thread.error)
    return (
      <div className="card">
        <p className="error" role="alert">開不了這則對話：{thread.error.message}</p>
        <button className="btn-sm" onClick={onLeft}>回清單</button>
      </div>
    );
  if (!conv) return null;

  return (
    <aside className="card" style={{ display: "flex", flexDirection: "column", height: 560, padding: 0 }}>
      {/* 標頭 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}>
        <Icon name={conv.kind === "group" ? "MessageCircle" : "User"} size={16} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.title}</b>
          <div className="hint" style={{ fontSize: 11, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {conv.kind === "group" && <span>{conv.members.length} 位成員</span>}
            {conv.projectId && conv.projectName && (
              <Link href={`/p/${conv.projectId}`} style={{ color: "var(--primary-ink)" }}>◧ {conv.projectName}</Link>
            )}
          </div>
        </div>
        {conv.kind === "group" && (
          <button className="btn-sm" onClick={() => setShowManage((v) => !v)} aria-expanded={showManage}>
            <Icon name="SlidersHorizontal" size={13} /> 管理
          </button>
        )}
      </div>

      {conv.kind === "group" && showManage && (
        <GroupManage conversationId={conversationId} members={conv.members} onLeft={onLeft} onClose={() => setShowManage(false)} />
      )}

      {/* 訊息串 */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "10px 14px" }}>
        {messages.length === 0 ? (
          <p className="hint">還沒有訊息，打聲招呼吧。</p>
        ) : (
          messages.map((m) => {
            const mine = m.userId === myId;
            const mentionedMe = !!myId && Array.isArray(m.mentions) && m.mentions.includes(myId);
            return (
              <div key={m.id} className={mentionedMe ? "msg-block mentioned-me" : "msg-block"} style={{ marginBottom: 4 }}>
                <div className="msg">
                  <span className="who">{mine ? "我" : (nameById.get(m.userId) ?? "?")}</span>
                  <span style={{ flex: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{renderBody(m.body, conv.members)}</span>
                  <span className="time">{relTime(m.createdAt)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 輸入框 */}
      <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border-soft)", alignItems: "flex-end" }}>
        <MentionInput
          value={body}
          onChange={setBody}
          members={memberLites}
          placeholder="輸入訊息，打 @ 提及夥伴，Enter 送出"
          ariaLabel="訊息內容"
          maxLength={2000}
          onEnter={doSend}
        />
        <button className="primary" disabled={!body.trim() || send.isPending} onClick={doSend} aria-label="送出">
          <Icon name="ArrowRight" size={16} />
        </button>
      </div>
      {send.error && <p className="error" role="alert" style={{ padding: "0 14px 10px" }}>{send.error.message}</p>}
    </aside>
  );
}

/** 內文渲染：把仍留在文字裡的 @成員名 標色（比照留言 mark.mention） */
function renderBody(text: string, members: Array<{ userId: string; name: string }>): React.ReactNode {
  const names = members.map((m) => m.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(${escaped.join("|")})`, "g");
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<mark key={i++} className="mention">{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ── 群組管理（加人／改名／離開）────────────────── */
function GroupManage({
  conversationId,
  members,
  onLeft,
  onClose,
}: {
  conversationId: string;
  members: Array<{ userId: string; name: string }>;
  onLeft: () => void;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  // 加人的候選：所有通訊錄隊友（後端會擋非同團隊），扣掉已在群組者
  const contacts = trpc.messaging.contacts.useQuery({}, { enabled: addOpen });
  const memberIds = new Set(members.map((m) => m.userId));

  const rename = trpc.messaging.rename.useMutation({
    onSuccess: () => {
      setTitle("");
      utils.messaging.thread.invalidate({ conversationId });
      utils.messaging.list.invalidate();
    },
  });
  const addMembers = trpc.messaging.addMembers.useMutation({
    onSuccess: () => {
      utils.messaging.thread.invalidate({ conversationId });
      setAddOpen(false);
    },
  });
  const leave = trpc.messaging.leave.useMutation({
    onSuccess: () => {
      utils.messaging.list.invalidate();
      utils.messaging.unreadTotal.invalidate();
      onLeft();
    },
  });

  return (
    <div style={{ padding: "10px 14px", background: "var(--card2)", borderBottom: "1px solid var(--border-soft)", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="hint">成員：</span>
        {members.map((m) => (
          <span key={m.userId} className="chip" style={{ fontSize: 12 }}>{m.name}</span>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="改群組名稱…" maxLength={80} style={{ flex: "1 1 160px" }} />
        <button className="btn-sm" disabled={!title.trim() || rename.isPending} onClick={() => rename.mutate({ conversationId, title: title.trim() })}>
          <Icon name="Pencil" size={13} /> 改名
        </button>
        <button className="btn-sm" onClick={() => setAddOpen((v) => !v)}><Icon name="Plus" size={13} /> 加人</button>
        <button className="btn-sm danger" disabled={leave.isPending} onClick={() => leave.mutate({ conversationId })}><Icon name="Undo2" size={13} /> 離開</button>
        <button className="btn-sm" onClick={onClose} aria-label="收起管理"><Icon name="X" size={13} /></button>
      </div>

      {addOpen && (
        <div style={{ display: "grid", gap: 4, maxHeight: 180, overflowY: "auto" }}>
          {contacts.isLoading ? (
            <span className="hint">載入夥伴清單…</span>
          ) : (
            (contacts.data?.contacts ?? []).filter((c) => !memberIds.has(c.userId)).map((c) => (
              <button key={c.userId} className="btn-sm" style={{ justifyContent: "flex-start" }} disabled={addMembers.isPending} onClick={() => addMembers.mutate({ conversationId, userIds: [c.userId] })}>
                <Icon name="Plus" size={12} /> {c.name} <span className="hint">{c.email}</span>
              </button>
            ))
          )}
          {!contacts.isLoading && (contacts.data?.contacts ?? []).filter((c) => !memberIds.has(c.userId)).length === 0 && (
            <span className="hint">沒有可再加入的夥伴。</span>
          )}
        </div>
      )}
      {(rename.error || addMembers.error || leave.error) && (
        <p className="error" role="alert">{rename.error?.message ?? addMembers.error?.message ?? leave.error?.message}</p>
      )}
    </div>
  );
}

/* ── 開新對話（私訊 / 群組）─────────────────────── */
function NewConversation({ groupId, onClose, onOpened }: { groupId?: string; onClose: () => void; onOpened: (conversationId: string) => void }) {
  const [tab, setTab] = useState<"dm" | "group">("dm");
  const teamsQ = trpc.messaging.teams.useQuery();
  const teams = teamsQ.data?.teams ?? [];
  const [teamId, setTeamId] = useState("");
  useEffect(() => {
    if (teams.length && !teams.some((t) => t.teamId === teamId)) setTeamId(teams[0].teamId);
  }, [teams, teamId]);

  const [q, setQ] = useState("");
  const contacts = trpc.messaging.contacts.useQuery({ teamId: teamId || undefined, q: q.trim() || undefined });
  const list = contacts.data?.contacts ?? [];

  const openDm = trpc.messaging.openDm.useMutation({ onSuccess: (r) => onOpened(r.conversationId) });

  // 群組
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [projectId, setProjectId] = useState("");
  const projects = trpc.projects.list.useQuery(groupId ? { groupId } : undefined, { enabled: tab === "group" });
  const createGroup = trpc.messaging.createGroup.useMutation({ onSuccess: (r) => onOpened(r.conversationId) });
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <b style={{ flex: 1 }}>開新對話</b>
        <button className="btn-sm" onClick={onClose} aria-label="關閉"><Icon name="X" size={14} /></button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button className={tab === "dm" ? "btn-sm primary" : "btn-sm"} onClick={() => setTab("dm")}><Icon name="User" size={13} /> 私訊</button>
        <button className={tab === "group" ? "btn-sm primary" : "btn-sm"} onClick={() => setTab("group")}><Icon name="MessageCircle" size={13} /> 群組</button>
      </div>

      {teams.length > 1 && (
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="選擇團隊" style={{ marginBottom: 10 }}>
          {teams.map((t) => (
            <option key={t.teamId} value={t.teamId}>{t.teamName}</option>
          ))}
        </select>
      )}

      {tab === "group" && (
        <>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="群組名稱（例：某某專案討論）" maxLength={80} style={{ marginBottom: 8 }} />
          {(projects.data?.length ?? 0) > 0 && (
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="關聯專案（選填）" style={{ marginBottom: 8 }}>
              <option value="">不關聯專案</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>◧ {p.title}</option>
              ))}
            </select>
          )}
        </>
      )}

      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="用姓名或 Email 找夥伴…" aria-label="搜尋夥伴" style={{ marginBottom: 8 }} />

      <div style={{ display: "grid", gap: 4, maxHeight: 260, overflowY: "auto" }}>
        {contacts.isLoading ? (
          <span className="hint">載入夥伴…</span>
        ) : list.length === 0 ? (
          <span className="hint">{q.trim() ? "找不到符合的夥伴。" : "這個團隊還沒有其他夥伴。"}</span>
        ) : (
          list.map((c) =>
            tab === "dm" ? (
              <button key={c.userId} className="convo-item" style={{ textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: "8px 10px", borderRadius: 10, display: "flex", alignItems: "center", gap: 8 }} disabled={openDm.isPending} onClick={() => openDm.mutate({ userId: c.userId })}>
                <Icon name="User" size={14} />
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span className="hint" style={{ marginLeft: "auto", fontSize: 12 }}>{c.email}</span>
              </button>
            ) : (
              <label key={c.userId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer" }}>
                <input type="checkbox" checked={picked.has(c.userId)} onChange={() => toggle(c.userId)} style={{ width: "auto" }} />
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span className="hint" style={{ marginLeft: "auto", fontSize: 12 }}>{c.email}</span>
              </label>
            ),
          )
        )}
      </div>

      {tab === "group" && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <span className="hint" style={{ flex: 1 }}>已選 {picked.size} 人</span>
          <button
            className="primary"
            disabled={!title.trim() || picked.size === 0 || !teamId || createGroup.isPending}
            onClick={() => createGroup.mutate({ title: title.trim(), teamId, memberIds: [...picked], projectId: projectId || undefined })}
          >
            建立群組
          </button>
        </div>
      )}

      {(openDm.error || createGroup.error) && (
        <p className="error" role="alert" style={{ marginTop: 8 }}>{openDm.error?.message ?? createGroup.error?.message}</p>
      )}
    </div>
  );
}
