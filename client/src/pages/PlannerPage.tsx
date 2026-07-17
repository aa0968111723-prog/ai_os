import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { CharCount, ConfirmButton } from "../components/interactions";
import { useLocalDraft } from "../useLocalDraft";
import { MentionInput, resolveMentions } from "../components/MentionInput";
import { flashAnchor, takePlannerFocus } from "../discuss";

/**
 * 筆記排程（需求 #10）：組內共用的「排程表＋會議筆記＋知識地圖」一頁。
 * - 組排程：可掛專案、可匯出 .ics 到個人日曆；清單／月曆兩種檢視（真實日曆）。
 * - 筆記／會議紀錄：內容更新由後端自動留版本快照；可「從知識庫匯入」把專案知識帶進筆記。
 * - 知識地圖（心智圖）：把專案／筆記／行程織成一張放射圖，並可用「全組／我的／專案」三種鏡頭聚焦。
 * groupId 由 App 頂欄的組別選單傳入。
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
  createdBy?: string;
  sourceMessageId?: string | null;
  mentions?: string[] | null;
};

/** 筆記清單列的形狀（依 notes.list 契約） */
type NoteItem = {
  id: string;
  projectId: string | null;
  title: string;
  chars: number;
  excerpt: string;
  updatedAt: string | Date;
  createdBy: string;
  creatorName: string;
  sourceMessageId?: string | null;
  mentions?: string[] | null;
};

/**
 * 知識地圖鏡頭（三者互斥）：
 * - all（全組）＝這個組的全部；
 * - mine（我的）＝「我建立的」筆記／行程（createdBy＝我）；
 * - mentioned（提及我）＝「我被 @ 提及的」筆記／行程（mentions 含我）。
 * 「我的」與「提及我」是兩個各自獨立的述詞——被別人 @ 但非我建立的項目只會出現在「提及我」，
 * 不會出現在「我的」（避免把兩者混為一談誤導使用者）。搭配「聚焦專案」下拉＝專案維度。
 */
type Lens = "all" | "mine" | "mentioned";

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
/** 本地日期鍵 YYYY-M-D（月曆把行程歸到哪一天用；用本地時區，不用 toISOString 以免跨日偏移） */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
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
      <p className="hint">全組共用的行程表與會議紀錄：排程可切清單／月曆並匯出到個人日曆；筆記可從知識庫匯入；知識地圖把三者織成一張心智圖。</p>
      {/* key 綁組別：切換作用組時整卡重掛，表單草稿不會帶到別的組 */}
      <ScheduleCard key={`sch-${groupId}`} groupId={groupId} />
      <NotesCard key={`note-${groupId}`} groupId={groupId} />
      <KnowledgeMapCard key={`map-${groupId}`} groupId={groupId} />
      <p style={{ marginTop: 24 }}>
        <Link href="/">回作業台</Link>
      </p>
    </div>
  );
}

/* ────────────────────────── (1) 組排程（清單／月曆） ────────────────────────── */

function ScheduleCard({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const [view, setView] = useState<"list" | "calendar">("list");
  const [includePast, setIncludePast] = useState(false);
  // 清單檢視吃 includePast 開關；月曆檢視改由 CalendarView 自己用「可見月份範圍」查詢，
  // 故清單查詢只在清單檢視啟用（月曆時不必多打一次）。
  const list = trpc.schedule.list.useQuery({ groupId, includePast }, { enabled: view === "list" });
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
  // 沉默 disable 會讓人不知道卡在哪個欄位——比照生成鈕的 disableReason，在按鈕旁講人話
  const addDisabledReason =
    !title.trim() ? "先填標題"
    : !startAt ? "先選開始時間"
    : endInvalid ? "結束時間要晚於開始時間"
    : null;
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
  const items = (list.data ?? []) as ScheduleItem[];

  // 依日期分組（list 已按 startsAt 升冪，同一天必相鄰，掃一遍即可）
  const groups: Array<{ label: string; items: ScheduleItem[] }> = [];
  for (const ev of items) {
    const label = new Date(ev.startsAt).toLocaleDateString("zh-TW");
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(ev);
    else groups.push({ label, items: [ev] });
  }

  return (
    <section className="card" style={{ marginTop: 16 }} data-fb="排程卡">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>組排程</h2>
        {/* 清單／月曆切換（真實日曆）：段落式切換鈕。用 radiogroup/radio 語意（單選群組），
            不用 tablist——沒有對應的 tabpanel/aria-controls，radio 才是正確的無障礙角色。 */}
        <div className="seg" role="radiogroup" aria-label="排程檢視" style={{ marginLeft: "auto" }}>
          <button role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
            <Icon name="FileText" size={13} /> 清單
          </button>
          <button role="radio" aria-checked={view === "calendar"} className={view === "calendar" ? "on" : ""} onClick={() => setView("calendar")}>
            <Icon name="CalendarPlus" size={13} /> 月曆
          </button>
        </div>
      </div>
      <p className="hint">拍攝、開會、上片時間都排在這裡，全組看同一份，不再翻對話記錄找時間。</p>

      {/* 頂部工具列：.ics 匯出＋（清單檢視）顯示過去行程 */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <a href={`/api/schedule/${groupId}/calendar.ics`} download style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="Download" size={14} />匯出 .ics（匯入 Google 日曆）
        </a>
        <span className="hint" style={{ margin: 0 }}>下載後匯入個人日曆；內容更新請重新下載</span>
        <span className="spacer" />
        {view === "list" && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0 }} title="預設只顯示未來與最近 24 小時內的行程">
            <input type="checkbox" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} />
            顯示過去行程
          </label>
        )}
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
        {addDisabledReason && <span className="hint" style={{ alignSelf: "center" }}>{addDisabledReason}</span>}
      </div>
      {/* 結束早於開始屬輸入錯誤：用 .error 樣式即時顯示，別讓人當成普通提示忽略 */}
      {endInvalid && <p className="error" role="alert" style={{ marginTop: 6 }}>結束時間要晚於開始時間</p>}
      {add.error && <p className="error">{add.error.message}</p>}

      {/* 內容區：清單 or 月曆（月曆自帶「可見月份範圍」查詢，與清單檢視解耦） */}
      {view === "calendar" ? (
        <CalendarView groupId={groupId} projectTitleOf={projectTitleOf} remove={remove} />
      ) : list.isLoading ? (
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

/** 月曆檢視：真正的月份網格（週日起始），行程落在各自那天；點某天在下方展開當日行程。
 *  自帶「可見月份範圍」查詢——只抓網格涵蓋的日期，翻月即重查，不再全時間拉 300 筆被 asc 截斷。 */
function CalendarView({
  groupId,
  projectTitleOf,
  remove,
}: {
  groupId: string;
  projectTitleOf: (pid: string | null) => string | null;
  remove: ReturnType<typeof trpc.schedule.remove.useMutation>;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // 網格起點（該月 1 號往前補到週日）與上界（起點 +42 天）——同時當作查詢視窗 [from, to]
  const gridStart = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gs = new Date(first);
    gs.setDate(1 - first.getDay());
    return gs;
  }, [cursor]);
  const gridEnd = useMemo(() => {
    const ge = new Date(gridStart);
    ge.setDate(gridStart.getDate() + 42); // 6 週 × 7 天（上界，涵蓋尾端整天）
    return ge;
  }, [gridStart]);
  // 查詢鍵是穩定的 ISO 字串（由 cursor 決定），翻月才重查、同月不抖動
  const q = trpc.schedule.list.useQuery({ groupId, from: gridStart.toISOString(), to: gridEnd.toISOString() });
  const items = (q.data ?? []) as ScheduleItem[];

  // 行程依「天」歸位（用開始時間的本地日）
  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleItem[]>();
    for (const ev of items) {
      const k = dayKey(new Date(ev.startsAt));
      (m.get(k) ?? m.set(k, []).get(k)!).push(ev);
    }
    for (const arr of m.values()) arr.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    return m;
  }, [items]);

  // 6×7 月曆矩陣（含前後月補格），由 gridStart 展開
  const weeks = useMemo(() => {
    const out: Date[][] = [];
    for (let w = 0; w < 6; w++) {
      const row: Date[] = [];
      for (let d = 0; d < 7; d++) {
        const dt = new Date(gridStart);
        dt.setDate(gridStart.getDate() + w * 7 + d);
        row.push(dt);
      }
      out.push(row);
    }
    return out;
  }, [gridStart]);

  const monthLabel = `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;
  const todayKey = dayKey(today);
  const selectedItems = selectedKey ? byDay.get(selectedKey) ?? [] : [];
  const goMonth = (delta: number) => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
    setSelectedKey(null);
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <button className="btn-sm" onClick={() => goMonth(-1)} aria-label="上個月">
          <Icon name="ChevronRight" size={14} style={{ transform: "rotate(180deg)" }} />
        </button>
        <strong style={{ fontSize: "var(--fs-15)" }}>{monthLabel}</strong>
        <button className="btn-sm" onClick={() => goMonth(1)} aria-label="下個月">
          <Icon name="ChevronRight" size={14} />
        </button>
        <button className="btn-sm btn-ghost" onClick={() => { setCursor(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedKey(null); }}>
          回本月
        </button>
        {q.isFetching && <span className="hint" style={{ margin: 0 }}>載入中…</span>}
        {q.error && <span className="error" style={{ margin: 0 }}>{q.error.message}</span>}
      </div>
      <div className="cal-grid">
        {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
          <div key={d} className="cal-head">{d}</div>
        ))}
        {weeks.flat().map((dt) => {
          const k = dayKey(dt);
          const inMonth = dt.getMonth() === cursor.getMonth();
          const evs = byDay.get(k) ?? [];
          const isToday = k === todayKey;
          const isSel = k === selectedKey;
          return (
            <button
              key={k}
              type="button"
              className={`cal-cell${inMonth ? "" : " out"}${isToday ? " today" : ""}${isSel ? " sel" : ""}`}
              onClick={() => setSelectedKey(evs.length ? k : null)}
              aria-label={`${dt.getMonth() + 1}/${dt.getDate()}${evs.length ? `，${evs.length} 筆行程` : ""}`}
            >
              <span className="cal-daynum">{dt.getDate()}</span>
              <span className="cal-events">
                {evs.slice(0, 3).map((ev) => (
                  <span key={ev.id} className="cal-ev" title={ev.title}>
                    <span className="cal-ev-time">{fmtTime(ev.startsAt)}</span> {ev.title}
                  </span>
                ))}
                {evs.length > 3 && <span className="cal-more">+{evs.length - 3}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {/* 選定某天 → 展開當日全部行程（含刪除、回連） */}
      {selectedKey && selectedItems.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <h3 style={{ fontSize: "var(--fs-13)", color: "var(--fg-secondary)", margin: "0 0 2px" }}>
            {new Date(selectedItems[0].startsAt).toLocaleDateString("zh-TW")}・{selectedItems.length} 筆
          </h3>
          {selectedItems.map((ev) => {
            const projTitle = projectTitleOf(ev.projectId);
            return (
              <div key={ev.id} id={`schedule-${ev.id}`} className="gen-row" style={{ gridTemplateColumns: "auto 1fr auto", alignItems: "center" }}>
                <span className="mono" style={{ fontSize: "var(--fs-12)", whiteSpace: "nowrap" }}>
                  <Icon name="Clock" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                  {fmtTime(ev.startsAt)}{ev.endsAt ? `–${fmtTime(ev.endsAt)}` : ""}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-14)", fontWeight: 600 }}>
                    {ev.title}
                    {projTitle && <span className="chip" style={{ margin: "0 0 0 8px" }}>{projTitle}</span>}
                  </div>
                  {(ev.note || ev.ownerName) && <div className="meta">{[ev.ownerName, ev.note].filter(Boolean).join("・")}</div>}
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
      )}
    </div>
  );
}

/* ─────────────────────── (2) 筆記・會議紀錄（可從知識庫匯入） ─────────────────────── */

function NotesCard({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.notes.list.useQuery({ groupId });
  const projects = trpc.projects.list.useQuery({ groupId });
  const members = trpc.projects.groupMembers.useQuery({ groupId }).data ?? [];

  // 表單（新增／編輯共用）：editingId 有值＝編輯模式，全文以 notes.get 載入後才可改
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // 標題/內容改用本地草稿（比照知識庫 useLocalDraft）：開會逐字稿可打到 4 萬字，
  // 切組（key 重掛）、誤點返回、手機切背景被回收、當機重整——沒有草稿就是整篇無聲消失。
  // 新增模式以組為 key、編輯模式以該筆為 key；儲存成功才清草稿。
  const draftScope = editingId ? `note-edit-${editingId}` : `note-new-${groupId}`;
  const [title, setTitle, clearTitleDraft] = useLocalDraft(`${draftScope}-title`, "");
  const [content, setContent, clearContentDraft] = useLocalDraft(`${draftScope}-content`, "");
  const [projectId, setProjectId] = useState("");
  // 全文抓回來只填一次表單，避免 refetch 覆蓋使用者正在改的字（沿用知識庫的 seeded 模式）；
  // 只填「沒有本地草稿」的欄位——上次編輯到一半離開的字比伺服器舊值更該保留
  const seededRef = useRef(false);
  // 從知識庫匯入時的提示（截斷／已達上限）——不讓匯入靜默丟字（稽核 #12）
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const full = trpc.notes.get.useQuery({ id: editingId ?? "" }, { enabled: !!editingId });
  useEffect(() => {
    if (editingId && full.data && !seededRef.current) {
      seededRef.current = true;
      if (!title) setTitle(full.data.title);
      if (!content) setContent(full.data.content);
      setProjectId(full.data.projectId ?? "");
    }
    // title/content 刻意不入依賴：這個效果只在「全文剛到」時播種一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, full.data]);
  /** 編輯模式下全文還在載入時，內容區先鎖住 */
  const contentReady = !editingId || seededRef.current;

  // 關表單不清草稿：誤點「取消」還救得回來；只有儲存成功才 clear
  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    seededRef.current = false;
    setProjectId("");
    setImportNotice(null);
  };
  const openNew = () => {
    setEditingId(null);
    seededRef.current = false;
    setProjectId("");
    setFormOpen(true);
  };
  const openEdit = (n: { id: string; title: string; projectId: string | null }) => {
    seededRef.current = false;
    setEditingId(n.id);
    setProjectId(n.projectId ?? "");
    setFormOpen(true);
  };

  const add = trpc.notes.add.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate({ groupId });
      clearTitleDraft();
      clearContentDraft();
      closeForm();
    },
  });
  const update = trpc.notes.update.useMutation({
    onSuccess: (_row, vars) => {
      utils.notes.list.invalidate({ groupId });
      utils.notes.get.invalidate({ id: vars.id });
      clearTitleDraft();
      clearContentDraft();
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
      <p className="hint">會議決議、待辦、想法都記在這裡，全組共用；內容更新會自動保留版本快照，不怕改壞。可從專案知識庫一鍵匯入既有內容。</p>

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
          <p className="hint" style={{ marginTop: 4 }}>（編輯中的內容會自動暫存在本機——切組、重整、手機切換都不會不見）</p>

          {/* 從知識庫匯入：把某專案知識庫的一筆全文附加到內容尾端（4.4「匯入知識」） */}
          {contentReady && (
            <>
              <KnowledgeImport
                projects={projects.data ?? []}
                disabled={saving}
                onImport={(imported, kbTitle) => {
                  const block = `【知識庫：${kbTitle}】\n${imported}`;
                  const base = content.trim() ? `${content.trimEnd()}\n\n${block}` : block;
                  // 已達上限：什麼都加不進去——據實說，不要靜默 no-op（稽核 #12）
                  if (content.length >= 40000) {
                    setImportNotice("筆記已達 40,000 字上限，無法再匯入內容（可先精簡內容再匯入）。");
                    return;
                  }
                  const next = base.slice(0, 40000);
                  const dropped = base.length - next.length;
                  setContent(next);
                  if (!title.trim()) setTitle(kbTitle.slice(0, 120));
                  setImportNotice(dropped > 0 ? `已匯入，但超過 40,000 字上限，截斷了約 ${dropped.toLocaleString()} 字。` : null);
                }}
              />
              {importNotice && <p className="hint" role="status" style={{ marginTop: 4, color: "var(--gold-ink)" }}>{importNotice}</p>}
            </>
          )}

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
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="primary" disabled={!canSave} onClick={save}>
              {saving ? "儲存中…" : "儲存"}
            </button>
            <button onClick={closeForm}>取消</button>
            {!canSave && !saving && (
              <span className="hint">
                {!contentReady ? "全文載入中…" : !title.trim() ? "先填標題" : !content.trim() ? "先填內容" : ""}
              </span>
            )}
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

/** 從知識庫匯入：選專案 → 選一筆知識 → 把全文附加到筆記內容（用 utils.knowledge.get 取全文）。 */
function KnowledgeImport({
  projects,
  disabled,
  onImport,
}: {
  projects: Array<{ id: string; title: string }>;
  disabled: boolean;
  onImport: (content: string, title: string) => void;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [pid, setPid] = useState("");
  const [kid, setKid] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kb = trpc.knowledge.list.useQuery({ projectId: pid }, { enabled: open && !!pid });

  const doImport = async () => {
    if (!kid) return;
    setBusy(true);
    setErr(null);
    try {
      const full = await utils.knowledge.get.fetch({ id: kid });
      onImport(full.content, full.title);
      setKid("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="btn-sm"
        style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }}
        disabled={disabled || projects.length === 0}
        title={projects.length === 0 ? "這個組還沒有專案知識庫可匯入" : undefined}
        onClick={() => setOpen(true)}
      >
        <Icon name="Sparkles" size={13} />從知識庫匯入
      </button>
    );
  }
  return (
    <div style={{ marginTop: 8, border: "1px solid var(--border-soft)", borderRadius: "var(--r-12)", padding: "var(--sp-12)", background: "var(--card2)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Icon name="Sparkles" size={13} style={{ color: "var(--primary-ink)" }} />
        <strong style={{ fontSize: "var(--fs-13)" }}>從知識庫匯入</strong>
        <button type="button" className="btn-sm btn-ghost" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)}>收合</button>
      </div>
      <p className="hint" style={{ marginTop: 4 }}>選一個專案的知識（開示稿／見證／腳本…），把全文附加到這則筆記的內容尾端。</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 6 }}>
        <div style={{ flex: "1 1 180px" }}>
          <label>專案</label>
          <select value={pid} onChange={(e) => { setPid(e.target.value); setKid(""); }}>
            <option value="">選專案…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: "2 1 220px" }}>
          <label>知識</label>
          <select value={kid} disabled={!pid || kb.isLoading} onChange={(e) => setKid(e.target.value)}>
            <option value="">{!pid ? "先選專案" : kb.isLoading ? "載入中…" : (kb.data?.length ?? 0) === 0 ? "此專案沒有知識" : "選一筆知識…"}</option>
            {(kb.data ?? []).map((k) => (
              <option key={k.id} value={k.id}>{k.title}（{k.chars.toLocaleString()} 字）</option>
            ))}
          </select>
        </div>
        <button type="button" className="primary btn-sm" disabled={!kid || busy || disabled} onClick={doImport}>
          {busy ? "匯入中…" : "匯入到內容"}
        </button>
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

/* ─────────────────────── (3) 知識地圖・心智圖 ─────────────────────── */

type MapLens = Lens;

/**
 * 知識地圖（心智圖）：中心＝這個組，往外一圈是「專案」與「組層級」節點，
 * 再往外是掛在其下的筆記（藍）與行程（琥珀）。放射佈局＋可用「全組／我的／專案」聚焦。
 * 純前端從既有 notes.list / schedule.list / projects.list 織出，不新增後端查詢。
 */
function KnowledgeMapCard({ groupId }: { groupId: string }) {
  const [, setLocation] = useLocation();
  const me = trpc.auth.me.useQuery();
  const meId = me.data?.user.id ?? "";
  // 行程視窗：以「今天」為中心 ±1 年，一次算好（空依賴 memo）讓查詢鍵穩定、不每次 render 抖動。
  // 避免 includePast 全時間 asc+limit(300) 在忙碌組別回「最舊 300 筆」而漏掉近期行程（稽核 #5）。
  const schedWindow = useMemo(() => {
    const now = new Date();
    return {
      from: new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString(),
      to: new Date(now.getFullYear() + 1, now.getMonth() + 1, 0, 23, 59, 59).toISOString(),
    };
  }, []);
  const notes = trpc.notes.list.useQuery({ groupId });
  const schedule = trpc.schedule.list.useQuery({ groupId, from: schedWindow.from, to: schedWindow.to });
  const projects = trpc.projects.list.useQuery({ groupId });

  const [lens, setLens] = useState<MapLens>("all");
  const [focusProject, setFocusProject] = useState(""); // ""＝全部專案

  // me 一併納入 loading/error 閘門：身分載入慢／失敗時，別讓「我的／提及我」顯示成空地圖，
  // 而與「真的沒資料」無法區分（稽核 #10）。identityMissing＝需要身分卻拿不到。
  const loading = notes.isLoading || schedule.isLoading || projects.isLoading || me.isLoading;
  const anyError = notes.error ?? schedule.error ?? projects.error ?? me.error;
  const identityMissing = lens !== "all" && !meId;
  // 資料量觸及後端上限（筆記 200／行程視窗 300）：據實提示「部分較舊項目未納入」，不讓截斷無聲。
  const truncated = notes.data?.length === 200 || schedule.data?.length === 300;

  const graph = useMemo(() => {
    if (loading || anyError) return null;
    const inLens = (createdBy: string | undefined, mentions: string[] | null | undefined) => {
      if (lens === "all") return true;
      if (lens === "mine") return createdBy === meId;
      return Array.isArray(mentions) && mentions.includes(meId);
    };
    const projTitle = (pid: string | null) => (pid ? (projects.data ?? []).find((p) => p.id === pid)?.title ?? "（已移除專案）" : null);

    // 依鏡頭 ＋（可選）聚焦專案過濾
    const noteRows = ((notes.data ?? []) as NoteItem[]).filter(
      (n) => inLens(n.createdBy, n.mentions) && (!focusProject || n.projectId === focusProject),
    );
    const schedRows = ((schedule.data ?? []) as ScheduleItem[]).filter(
      (e) => inLens(e.createdBy, e.mentions) && (!focusProject || e.projectId === focusProject),
    );

    // 分支：key＝專案 id 或 "__group"（組層級／未掛專案）
    type Leaf = { id: string; kind: "note" | "schedule"; label: string; refId: string };
    const branches = new Map<string, { key: string; label: string; projectId: string | null; leaves: Leaf[] }>();
    const branchOf = (pid: string | null) => {
      const key = pid ?? "__group";
      let b = branches.get(key);
      if (!b) {
        b = { key, label: pid ? projTitle(pid) ?? "專案" : "組層級", projectId: pid, leaves: [] };
        branches.set(key, b);
      }
      return b;
    };
    for (const n of noteRows) branchOf(n.projectId).leaves.push({ id: `n-${n.id}`, kind: "note", label: n.title, refId: n.id });
    for (const e of schedRows) branchOf(e.projectId).leaves.push({ id: `s-${e.id}`, kind: "schedule", label: e.title, refId: e.id });

    const branchList = [...branches.values()].filter((b) => b.leaves.length > 0);
    // 分支多時先排「內容多」的，最多畫 10 個分支，其餘不畫（避免過度擁擠）
    branchList.sort((a, b) => b.leaves.length - a.leaves.length);
    const shownBranches = branchList.slice(0, 10);
    const hiddenBranchCount = branchList.length - shownBranches.length;

    return { shownBranches, hiddenBranchCount, totalNotes: noteRows.length, totalSched: schedRows.length };
  }, [loading, anyError, notes.data, schedule.data, projects.data, lens, focusProject, meId]);

  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

  const layout = useMemo(() => {
    if (!graph) return null;
    const { shownBranches } = graph;
    const B = shownBranches.length;
    // 半徑隨分支數成長，給圓周更多空間；標題依 B 收更短——內圈膠囊才不會在分支多時互撞（稽核 #4）。
    const RB = 150 + Math.min(B, 10) * 8; // 158..230
    const RL = RB + 104;
    const margin = 80; // 外圈葉標籤的留白
    const W = 2 * (RL + margin);
    const H = 2 * (RL + 52);
    const cx = W / 2;
    const cy = H / 2;
    const branchClip = B > 8 ? 6 : B > 5 ? 9 : 12;
    const slot = (2 * Math.PI) / B; // 每個分支「自己的」角楔（相鄰分支中心相距一個 slot）
    type Node = { id: string; type: "group" | "project" | "bucket" | "note" | "schedule" | "more"; label: string; full: string; x: number; y: number; refId?: string; projectId?: string | null; tx?: number; ty?: number; tAnchor?: "start" | "middle" | "end"; tBaseline?: "auto" | "middle" | "hanging" };
    const nodes: Node[] = [];
    const edges: Array<{ x1: number; y1: number; x2: number; y2: number; kind: "branch" | "leaf" }> = [];
    nodes.push({ id: "group", type: "group", label: "本組", full: "本組", x: cx, y: cy });
    shownBranches.forEach((b, i) => {
      const a = -Math.PI / 2 + i * slot; // 分支主軸角
      const bx = cx + RB * Math.cos(a);
      const by = cy + RB * Math.sin(a);
      edges.push({ x1: cx, y1: cy, x2: bx, y2: by, kind: "branch" });
      nodes.push({ id: `b-${b.key}`, type: b.projectId ? "project" : "bucket", label: clip(b.label, branchClip), full: b.label, x: bx, y: by, projectId: b.projectId });
      // 葉節點：最多 6 片、其餘收成一顆「+N」。扇形總開角『鎖在自己的角楔內』（slot*0.82 < slot），
      // 因此相鄰分支的葉圈永遠不會互相侵入、疊字（稽核 #1：固定 0.7π 扇形會超出角楔造成重疊）。
      const shownLeaves = b.leaves.slice(0, 6);
      const extra = b.leaves.length - shownLeaves.length;
      const total = shownLeaves.length + (extra > 0 ? 1 : 0);
      const fan = Math.min(slot * 0.82, 0.34 * Math.max(1, total));
      const place = (idx: number, node: Omit<Node, "x" | "y">) => {
        const off = total > 1 ? -fan / 2 + (fan * idx) / (total - 1) : 0;
        const la = a + off;
        const lx = cx + RL * Math.cos(la);
        const ly = cy + RL * Math.sin(la);
        edges.push({ x1: bx, y1: by, x2: lx, y2: ly, kind: "leaf" });
        // 標籤沿半徑「往外」擺放並依方位對齊（右側靠左起、左側靠右收、上下置中）——
        // 讓同分支相鄰葉的字往外流開、減少互疊，尤其正上／正下方分支（稽核 #4 標籤擁擠）。
        const dirX = Math.cos(la);
        const dirY = Math.sin(la);
        const tAnchor: Node["tAnchor"] = dirX > 0.35 ? "start" : dirX < -0.35 ? "end" : "middle";
        const tx = lx + dirX * 9 + (tAnchor === "start" ? 4 : tAnchor === "end" ? -4 : 0);
        const ty = ly + dirY * 9 + (tAnchor === "middle" ? (dirY >= 0 ? 6 : -4) : 0);
        const tBaseline: Node["tBaseline"] = tAnchor === "middle" ? (dirY >= 0 ? "hanging" : "auto") : "middle";
        nodes.push({ ...node, x: lx, y: ly, tx, ty, tAnchor, tBaseline });
      };
      shownLeaves.forEach((leaf, j) => place(j, { id: leaf.id, type: leaf.kind, label: clip(leaf.label, 11), full: leaf.label, refId: leaf.refId }));
      if (extra > 0) place(shownLeaves.length, { id: `more-${b.key}`, type: "more", label: `+${extra}`, full: `還有 ${extra} 筆`, projectId: b.projectId });
    });
    return { nodes, edges, W, H };
  }, [graph]);

  type MapNode = { type: string; full: string; refId?: string; projectId?: string | null };
  const clickNode = (n: MapNode) => {
    if (n.type === "note" && n.refId) flashAnchor(`note-${n.refId}`);
    else if (n.type === "schedule" && n.refId) flashAnchor(`schedule-${n.refId}`);
    else if ((n.type === "project" || n.type === "more") && n.projectId) setLocation(`/p/${n.projectId}`);
  };
  // 節點是否可操作（可鍵盤聚焦＋點擊）：葉一律可、專案／+N 需有 projectId、組層級與中心不可。
  const isClickable = (n: MapNode) =>
    n.type === "note" || n.type === "schedule" || ((n.type === "project" || n.type === "more") && !!n.projectId);
  const ariaLabelOf = (n: MapNode) =>
    n.type === "note" ? `筆記：${n.full}（跳至上方對應筆記）`
    : n.type === "schedule" ? `行程：${n.full}（跳至上方對應行程）`
    : n.type === "project" ? `專案：${n.full}（開啟專案頁）`
    : n.type === "more" ? `${n.full}（開啟專案頁）`
    : n.full;

  return (
    <section className="card" style={{ marginTop: 16 }} data-fb="知識地圖卡">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>知識地圖・心智圖</h2>
      </div>
      <p className="hint">把專案、筆記、行程織成一張放射心智圖：中心是本組，往外是專案／組層級，再往外是筆記（藍）與行程（琥珀）。點筆記／行程節點會跳到上方對應那筆，點專案節點進專案頁。</p>

      {/* 鏡頭：全組／我的／提及我 ＋ 專案聚焦（團隊／個人／專案三個維度） */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <div className="seg" role="radiogroup" aria-label="知識地圖鏡頭">
          <button role="radio" aria-checked={lens === "all"} className={lens === "all" ? "on" : ""} onClick={() => setLens("all")}>全組</button>
          <button role="radio" aria-checked={lens === "mine"} className={lens === "mine" ? "on" : ""} onClick={() => setLens("mine")}>我的</button>
          <button role="radio" aria-checked={lens === "mentioned"} className={lens === "mentioned" ? "on" : ""} onClick={() => setLens("mentioned")}>提及我</button>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="SlidersHorizontal" size={13} style={{ color: "var(--fg-secondary)" }} />
          <select value={focusProject} onChange={(e) => setFocusProject(e.target.value)} style={{ minWidth: 150 }} aria-label="聚焦專案">
            <option value="">全部專案</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </div>
        {graph && (
          <span className="hint" style={{ margin: 0 }}>
            筆記 {graph.totalNotes}・行程 {graph.totalSched}
            {graph.hiddenBranchCount > 0 ? `・另有 ${graph.hiddenBranchCount} 個分支未畫（過密）` : ""}
            {truncated ? "・資料量較大，部分較舊項目未納入" : ""}
          </span>
        )}
      </div>

      {/* 圖例 */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <span className="map-legend"><span className="map-dot note" /> 筆記</span>
        <span className="map-legend"><span className="map-dot sched" /> 行程</span>
        <span className="map-legend"><span className="map-dot proj" /> 專案</span>
        <span className="map-legend"><span className="map-dot bucket" /> 組層級</span>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 320, marginTop: 12, borderRadius: "var(--r-12)" }} aria-hidden="true" />
      ) : anyError ? (
        <p className="error">{anyError.message}</p>
      ) : identityMissing ? (
        <div className="empty-state" style={{ marginTop: 12 }}>
          <h3>需要確認你的身分</h3>
          <p>「{lens === "mine" ? "我的" : "提及我"}」要用你的身分來篩選，但目前拿不到——請重新整理頁面，或先把鏡頭切回「全組」。</p>
        </div>
      ) : !graph || graph.shownBranches.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 12 }}>
          <h3>這張地圖還是空的</h3>
          <p>先在上面加幾筆行程或筆記（可掛專案），這裡就會長出對應的心智圖節點。{lens !== "all" && "或把鏡頭切回「全組」。"}</p>
        </div>
      ) : (
        <div className="map-wrap" style={{ marginTop: 12 }}>
          {/* role=group（非 img）讓節點留在無障礙樹裡；可操作節點各自 role=button＋可 Tab 聚焦＋Enter/Space 觸發（稽核 #6） */}
          <svg viewBox={`0 0 ${layout?.W ?? 800} ${layout?.H ?? 640}`} className="map-svg" role="group" aria-label="知識地圖：可用 Tab 逐一聚焦節點，Enter／Space 開啟或跳至對應項目">
            {layout?.edges.map((e, i) => (
              <line key={`e-${i}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} className={`map-edge ${e.kind}`} />
            ))}
            {layout?.nodes.map((n) => {
              const clickable = isClickable(n);
              const a11y = clickable
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": ariaLabelOf(n),
                    onClick: () => clickNode(n),
                    onKeyDown: (e: KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        clickNode(n);
                      }
                    },
                    style: { cursor: "pointer" as const },
                  }
                : { "aria-hidden": true as const };
              if (n.type === "group") {
                return (
                  <g key={n.id} className="map-node group" aria-hidden="true">
                    <circle cx={n.x} cy={n.y} r={34} />
                    <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central">{n.label}</text>
                  </g>
                );
              }
              if (n.type === "project" || n.type === "bucket" || n.type === "more") {
                const w = Math.max(56, n.label.length * 13 + 22);
                return (
                  <g key={n.id} className={`map-node ${n.type}${clickable ? " clickable" : ""}`} {...a11y}>
                    <rect x={n.x - w / 2} y={n.y - 15} width={w} height={30} rx={15} />
                    <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central">{n.label}</text>
                  </g>
                );
              }
              // note / schedule 葉節點：標籤沿半徑往外擺、依方位對齊（見 layout 的 place）
              return (
                <g key={n.id} className={`map-node ${n.type} clickable`} {...a11y}>
                  <circle cx={n.x} cy={n.y} r={6} />
                  <text x={n.tx ?? n.x} y={n.ty ?? n.y - 12} textAnchor={n.tAnchor ?? "middle"} dominantBaseline={n.tBaseline ?? "auto"}>{n.label}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}
