import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { CharCount, ConfirmButton } from "../components/interactions";
import { MentionInput, resolveMentions } from "../components/MentionInput";
import { flashAnchor, takePlannerFocus } from "../discuss";

/**
 * 筆記排程（需求 #10）：組內共用的「排程表＋會議筆記」一頁。
 * 上半是組排程（可掛專案、可匯出 .ics 到個人日曆），下半是筆記／會議紀錄
 * （內容更新由後端自動留版本快照）。groupId 由 App 頂欄的組別選單傳入。
 */

/** 排程列的形狀（依 schedule.list 契約；superjson 下日期是 Date，顯示前仍防禦性包 new Date） */
type ScheduleItem = {
  id: string;
  projectId: string | null;
  title: string;
  startsAt: string | Date;
  endsAt: string | Date | null;
  note: string | null;
  ownerId: string | null;
  ownerName: string | null;
  sourceMessageId?: string | null;
  mentions?: string[] | null;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
/** HH:mm（排程清單的時間欄） */
function fmtTime(d: string | Date): string {
  const t = new Date(d);
  return `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
}
/** 日期＋時分（筆記的更新時間） */
function fmtDateTime(d: string | Date): string {
  return `${new Date(d).toLocaleDateString("zh-TW")} ${fmtTime(d)}`;
}

export function PlannerPage({ groupId }: { groupId: string }) {
  // 由留言的排程/筆記引用卡跳來：sessionStorage 交棒了目標 id，這裡輪詢直到該列渲染出來再高亮
  useEffect(() => {
    const target = takePlannerFocus();
    if (!target) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (flashAnchor(target) || tries > 20) window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  if (!groupId) {
    return (
      <div>
        <h1>筆記排程</h1>
        <div className="empty-state" style={{ marginTop: "var(--sp-32)" }}>
          <h3>請先選擇組別</h3>
          <p>用頂欄的組別選單選一個組，就能看到這個組的排程與會議筆記。</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <h1>筆記排程</h1>
      <p className="hint">全組共用的行程表與會議紀錄：排程可匯出到個人日曆；筆記內容更新會自動保留版本快照。</p>
      {/* key 綁組別：切換作用組時整卡重掛，表單草稿不會帶到別的組 */}
      <ScheduleCard key={`sch-${groupId}`} groupId={groupId} />
      <NotesCard key={`note-${groupId}`} groupId={groupId} />
      <p style={{ marginTop: 24 }}>
        <Link href="/">回作業台</Link>
      </p>
    </div>
  );
}

/* ────────────────────────── (1) 組排程 ────────────────────────── */

function ScheduleCard({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const [includePast, setIncludePast] = useState(false);
  const list = trpc.schedule.list.useQuery({ groupId, includePast });
  // 專案下拉＋列表上的專案名對照；與筆記卡同 key，react-query 只會打一次
  const projects = trpc.projects.list.useQuery({ groupId });
  const members = trpc.projects.groupMembers.useQuery({ groupId }).data ?? [];

  // 新增列的欄位
  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState(""); // datetime-local 原始值
  const [endAt, setEndAt] = useState("");
  const [note, setNote] = useState("");
  const [projectId, setProjectId] = useState("");

  const add = trpc.schedule.add.useMutation({
    onSuccess: () => {
      utils.schedule.list.invalidate({ groupId });
      setTitle("");
      setStartAt("");
      setEndAt("");
      setNote("");
      setProjectId("");
    },
  });
  const remove = trpc.schedule.remove.useMutation({ onSuccess: () => utils.schedule.list.invalidate({ groupId }) });

  const endInvalid = !!startAt && !!endAt && new Date(endAt) < new Date(startAt);
  const canAdd = !!title.trim() && !!startAt && !endInvalid && !add.isPending;
  const submit = () => {
    if (!canAdd) return;
    // @提及：從標題與備註內文反推被 @ 的同組成員
    const mentions = resolveMentions(`${title} ${note}`, members);
    add.mutate({
      groupId,
      projectId: projectId || undefined,
      title: title.trim(),
      startsAt: new Date(startAt).toISOString(),
      endsAt: endAt ? new Date(endAt).toISOString() : undefined,
      note: note.trim() || undefined,
      mentions: mentions.length ? mentions : undefined,
    });
  };

  const projectTitleOf = (pid: string | null) => (pid ? (projects.data ?? []).find((p) => p.id === pid)?.title ?? null : null);

  // 依日期分組（list 已按 startsAt 升冪，同一天必相鄰，掃一遍即可）
  const groups: Array<{ label: string; items: ScheduleItem[] }> = [];
  for (const ev of (list.data ?? []) as ScheduleItem[]) {
    const label = new Date(ev.startsAt).toLocaleDateString("zh-TW");
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(ev);
    else groups.push({ label, items: [ev] });
  }

  return (
    <section className="card" style={{ marginTop: 16 }} data-fb="排程卡">
      <h2>組排程</h2>
      <p className="hint">拍攝、開會、上片時間都排在這裡，全組看同一份，不再翻對話記錄找時間。</p>

      {/* 頂部工具列：.ics 匯出＋顯示過去行程 */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <a href={`/api/schedule/${groupId}/calendar.ics`} download style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="Download" size={14} />匯出 .ics（匯入 Google 日曆）
        </a>
        <span className="hint" style={{ margin: 0 }}>下載後匯入個人日曆；內容更新請重新下載</span>
        <span className="spacer" />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0 }} title="預設只顯示未來與最近 24 小時內的行程">
          <input type="checkbox" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} />
          顯示過去行程
        </label>
      </div>

      {/* 新增列 */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 4 }}>
        <div style={{ flex: "2 1 200px", minWidth: 160 }}>
          <label htmlFor="sch-title">標題（可 @ 提及夥伴）</label>
          <MentionInput value={title} onChange={setTitle} members={members} maxLength={120}
            ariaLabel="排程標題" placeholder="例：週會・腳本審稿（@人 可通知）" onEnter={submit} />
        </div>
        <div style={{ flex: "1 1 185px" }}>
          <label htmlFor="sch-start">開始（必填）</label>
          <input id="sch-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </div>
        <div style={{ flex: "1 1 185px" }}>
          <label htmlFor="sch-end">結束（選填）</label>
          <input id="sch-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </div>
        <div style={{ flex: "1 1 150px" }}>
          <label htmlFor="sch-project">掛在專案（選填）</label>
          <select id="sch-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">不掛專案</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: "2 1 180px" }}>
          <label htmlFor="sch-note">備註（選填）</label>
          <input id="sch-note" value={note} maxLength={500} placeholder="例：地點、要先準備什麼" onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="primary" style={{ flex: "none" }} disabled={!canAdd} onClick={submit}>
          {add.isPending ? "加入中…" : "加入"}
        </button>
      </div>
      {endInvalid && <p className="hint" style={{ marginTop: 6 }}>結束時間要晚於開始時間</p>}
      {add.error && <p className="error">{add.error.message}</p>}

      {/* 清單：依日期分組 */}
      {list.isLoading ? (
        <div style={{ marginTop: 12 }} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="gen-row">
              <div className="skeleton" style={{ height: 14 }} />
            </div>
          ))}
        </div>
      ) : list.error ? (
        <p className="error">{list.error.message}</p>
      ) : groups.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 12 }}>
          <h3>{includePast ? "還沒有任何行程" : "接下來沒有排程"}</h3>
          <p>用上面的欄位加第一筆——開會、拍攝、上片都行。</p>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {groups.map((g) => (
            <div key={g.label} style={{ marginTop: 10 }}>
              <h3 style={{ fontSize: "var(--fs-13)", color: "var(--fg-secondary)", margin: "0 0 2px" }}>{g.label}</h3>
              {g.items.map((ev) => {
                const projTitle = projectTitleOf(ev.projectId);
                return (
                  <div key={ev.id} id={`schedule-${ev.id}`} className="gen-row" style={{ gridTemplateColumns: "auto 1fr auto", alignItems: "center" }}>
                    <span className="mono" style={{ fontSize: "var(--fs-12)", whiteSpace: "nowrap" }}>
                      <Icon name="Clock" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                      {fmtTime(ev.startsAt)}
                      {ev.endsAt ? `–${fmtTime(ev.endsAt)}` : ""}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "var(--fs-14)", fontWeight: 600 }}>
                        {ev.title}
                        {projTitle && <span className="chip" style={{ margin: "0 0 0 8px" }}>{projTitle}</span>}
                        {ev.mentions?.length ? <span className="chip" style={{ margin: "0 0 0 6px" }} title="有 @提及夥伴"><Icon name="Bell" size={11} style={{ verticalAlign: "-1px" }} /> {ev.mentions.length}</span> : null}
                      </div>
                      {(ev.note || ev.ownerName) && (
                        <div className="meta">{[ev.ownerName, ev.note].filter(Boolean).join("・")}</div>
                      )}
                      {/* 雙向回連：由留言轉來的排程 → 一鍵回到那個專案的留言區 */}
                      {ev.sourceMessageId && ev.projectId && (
                        <Link href={`/p/${ev.projectId}`} className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                          <Icon name="MessageCircle" size={11} />來自留言
                        </Link>
                      )}
                    </div>
                    <ConfirmButton
                      onConfirm={() => remove.mutate({ id: ev.id })}
                      message={`刪除行程「${ev.title}」？`}
                      triggerClassName="btn-sm"
                      triggerStyle={{ color: "var(--danger-ink)" }}
                      disabled={remove.isPending}
                    >
                      刪除
                    </ConfirmButton>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {remove.error && <p className="error">{remove.error.message}</p>}
    </section>
  );
}

/* ─────────────────────── (2) 筆記・會議紀錄 ─────────────────────── */

function NotesCard({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.notes.list.useQuery({ groupId });
  const projects = trpc.projects.list.useQuery({ groupId });
  const members = trpc.projects.groupMembers.useQuery({ groupId }).data ?? [];

  // 表單（新增／編輯共用）：editingId 有值＝編輯模式，全文以 notes.get 載入後才可改
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [projectId, setProjectId] = useState("");
  // 全文抓回來只填一次表單，避免 refetch 覆蓋使用者正在改的字（沿用知識庫的 seeded 模式）
  const seededRef = useRef(false);
  const full = trpc.notes.get.useQuery({ id: editingId ?? "" }, { enabled: !!editingId });
  useEffect(() => {
    if (editingId && full.data && !seededRef.current) {
      seededRef.current = true;
      setTitle(full.data.title);
      setContent(full.data.content);
      setProjectId(full.data.projectId ?? "");
    }
  }, [editingId, full.data]);
  /** 編輯模式下全文還在載入時，內容區先鎖住 */
  const contentReady = !editingId || seededRef.current;

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    seededRef.current = false;
    setTitle("");
    setContent("");
    setProjectId("");
  };
  const openNew = () => {
    setEditingId(null);
    seededRef.current = false;
    setTitle("");
    setContent("");
    setProjectId("");
    setFormOpen(true);
  };
  const openEdit = (n: { id: string; title: string; projectId: string | null }) => {
    seededRef.current = false;
    setEditingId(n.id);
    setTitle(n.title);
    setContent("");
    setProjectId(n.projectId ?? "");
    setFormOpen(true);
  };

  const add = trpc.notes.add.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate({ groupId });
      closeForm();
    },
  });
  const update = trpc.notes.update.useMutation({
    onSuccess: (_row, vars) => {
      utils.notes.list.invalidate({ groupId });
      utils.notes.get.invalidate({ id: vars.id });
      closeForm();
    },
  });
  const remove = trpc.notes.remove.useMutation({ onSuccess: () => utils.notes.list.invalidate({ groupId }) });

  const saving = add.isPending || update.isPending;
  const canSave = !!title.trim() && !!content.trim() && contentReady && !saving;
  const save = () => {
    if (!canSave) return;
    const t = title.trim();
    if (editingId) update.mutate({ id: editingId, title: t, content });
    else {
      const mentions = resolveMentions(`${t} ${content}`, members);
      add.mutate({ groupId, projectId: projectId || undefined, title: t, content, mentions: mentions.length ? mentions : undefined });
    }
  };

  const projectTitleOf = (pid: string | null) => (pid ? (projects.data ?? []).find((p) => p.id === pid)?.title ?? null : null);

  return (
    <section className="card" style={{ marginTop: 16 }} data-fb="筆記卡">
      <h2>筆記・會議紀錄</h2>
      <p className="hint">會議決議、待辦、想法都記在這裡，全組共用；內容更新會自動保留版本快照，不怕改壞。</p>

      {list.isLoading ? (
        <div style={{ marginTop: 8 }} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="gen-row">
              <div className="skeleton" style={{ height: 14 }} />
            </div>
          ))}
        </div>
      ) : list.error ? (
        <p className="error">{list.error.message}</p>
      ) : list.data && list.data.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          {list.data.map((n) => {
            const projTitle = projectTitleOf(n.projectId);
            return (
              <div key={n.id} id={`note-${n.id}`} className="gen-row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-14)", fontWeight: 600 }}>
                    {n.title}
                    {projTitle && <span className="chip" style={{ margin: "0 0 0 8px" }}>{projTitle}</span>}
                    {n.mentions?.length ? <span className="chip" style={{ margin: "0 0 0 6px" }} title="有 @提及夥伴"><Icon name="Bell" size={11} style={{ verticalAlign: "-1px" }} /> {n.mentions.length}</span> : null}
                  </div>
                  <div className="meta">{n.excerpt}{n.chars > n.excerpt.length ? "…" : ""}（{n.chars.toLocaleString()} 字）</div>
                  <div className="meta">{fmtDateTime(n.updatedAt)} 更新・{n.creatorName}</div>
                  {n.sourceMessageId && n.projectId && (
                    <Link href={`/p/${n.projectId}`} className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                      <Icon name="MessageCircle" size={11} />來自留言
                    </Link>
                  )}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="btn-sm" onClick={() => openEdit(n)}>編輯</button>
                  <ConfirmButton
                    onConfirm={() => remove.mutate({ id: n.id })}
                    message={`刪除筆記「${n.title}」？`}
                    triggerClassName="btn-sm"
                    triggerStyle={{ color: "var(--danger-ink)" }}
                    disabled={remove.isPending}
                  >
                    刪除
                  </ConfirmButton>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state" style={{ marginTop: 8 }}>
          <h3>還沒有筆記</h3>
          <p>開完會記一份，決議和待辦全組都看得到。</p>
        </div>
      )}
      {remove.error && <p className="error">{remove.error.message}</p>}

      {formOpen ? (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
          <label htmlFor="note-title">標題{!editingId && "（可 @ 提及夥伴）"}</label>
          {editingId ? (
            <input id="note-title" value={title} maxLength={120} placeholder="例：0716 週會紀錄" onChange={(e) => setTitle(e.target.value)} />
          ) : (
            <MentionInput value={title} onChange={setTitle} members={members} maxLength={120} ariaLabel="筆記標題" placeholder="例：0716 週會紀錄（@人 可通知）" />
          )}
          <label htmlFor="note-content">內容{!editingId && "（可打 @名字 提及）"}</label>
          <textarea
            id="note-content"
            value={contentReady ? content : ""}
            disabled={!contentReady || saving}
            maxLength={40000}
            placeholder={contentReady ? "會議重點、決議、待辦…" : "載入全文中…"}
            style={{ minHeight: 160 }}
            onChange={(e) => setContent(e.target.value)}
          />
          {/* 即時字數（與知識庫同款）：maxLength 會把超長貼上靜默截尾，計數＋觸頂警示讓截斷不再無聲 */}
          {contentReady && <CharCount value={content} max={40000} />}
          <label htmlFor="note-project">掛在專案（選填）</label>
          <select
            id="note-project"
            value={projectId}
            disabled={!!editingId}
            title={editingId ? "編輯時不能改掛的專案" : undefined}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">不掛專案</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          {editingId && <p className="hint" style={{ marginTop: 4 }}>內容更新會自動保留版本快照</p>}
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button className="primary" disabled={!canSave} onClick={save}>
              {saving ? "儲存中…" : "儲存"}
            </button>
            <button onClick={closeForm}>取消</button>
          </div>
          {(add.error || update.error || full.error) && (
            <p className="error">{add.error?.message ?? update.error?.message ?? full.error?.message}</p>
          )}
        </div>
      ) : (
        <button style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={openNew}>
          <Icon name="Plus" size={14} />新增筆記
        </button>
      )}
    </section>
  );
}
