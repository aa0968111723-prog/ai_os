import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { CharCount, ConfirmButton } from "../components/interactions";
import { useLocalDraft } from "../useLocalDraft";
import { MentionInput, resolveMentions } from "../components/MentionInput";
import { flashAnchor, takePlannerFocus } from "../discuss";

/**
 * 筆記排程（需求 #10）：組內共用的「排程表＋會議筆記＋知識地圖」一頁。
 * - 組排程：可掛專案、可直連 Google 日曆自動同步（.ics 匯出保留為後備）；清單／月曆兩種檢視（真實日曆）。
 * - 筆記／會議紀錄：內容更新由後端自動留版本快照；可「從知識庫匯入」把專案知識帶進筆記。
 * - 知識地圖（知識族譜）：把專案／筆記／行程／知識庫／AI 代理／資料庫織成一張放射圖，
 *   資料由後端 knowledgeMap.graph 一次聚合（帶組隔離與資料庫 ACL），可用鏡頭／專案／型別開關聚焦。
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

/** 「團隊／個人／專案」三種鏡頭：全組看全部、我的＝我建立或被 @、專案＝聚焦某一專案。 */
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
      <p className="hint">全組共用的行程表與會議紀錄：排程可切清單／月曆並直連 Google 日曆自動同步；筆記可從知識庫匯入；知識地圖把行程、筆記、專案知識庫、AI 代理與資料庫織成一張知識族譜。</p>
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

/**
 * Google 日曆直連同步工具列：
 * - 站方已設定 OAuth（configured）→ 顯示「連結 Google 日曆」；連結後排程增刪改自動推送到
 *   個人 Google 帳戶的專屬日曆（＋每 15 分鐘背景對帳），不必再手動匯出/匯入。
 * - 未設定 → 退回原本的 .ics 匯出（後備）。
 * - OAuth 回跳帶 ?gcal=... 的一次性結果訊息在此顯示並清掉網址參數。
 */
function GoogleCalendarBar({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const status = trpc.googleCalendar.status.useQuery();
  const syncNow = trpc.googleCalendar.syncNow.useMutation({ onSettled: () => utils.googleCalendar.status.invalidate() });
  const disconnect = trpc.googleCalendar.disconnect.useMutation({ onSuccess: () => utils.googleCalendar.status.invalidate() });
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("gcal");
    if (!q) return;
    setFlash(
      q === "connected" ? "已連結 Google 日曆，首次同步進行中（幾秒內完成）"
      : q === "denied" ? "已取消 Google 授權——隨時可以再連結"
      : q === "state_mismatch" ? "授權連結已過期，請重新點「連結 Google 日曆」"
      : "連結失敗，請稍後再試",
    );
    window.history.replaceState(null, "", window.location.pathname); // 清掉一次性參數，重新整理不再重播
  }, []);

  const icsFallback = (
    <a href={`/api/schedule/${groupId}/calendar.ics`} download style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Icon name="Download" size={14} />匯出 .ics
    </a>
  );

  const st = status.data;
  if (!st) return icsFallback; // 載入中（或查詢失敗）：先給後備匯出，不擋操作
  if (!st.configured) {
    return (
      <>
        {icsFallback}
        <span className="hint" style={{ margin: 0 }}>下載後匯入個人日曆；內容更新請重新下載</span>
      </>
    );
  }
  if (!st.connected) {
    return (
      <>
        <a href="/api/google/oauth/start" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="CalendarPlus" size={14} />連結 Google 日曆（自動同步）
        </a>
        <span className="hint" style={{ margin: 0 }}>{flash ?? "連結後排程增刪改自動出現在你的 Google 日曆，免匯出匯入"}</span>
        {icsFallback}
      </>
    );
  }
  if (st.status === "error") {
    return (
      <>
        <span className="hint" style={{ margin: 0, color: "var(--danger, #b3261e)" }} title={st.lastError ?? undefined}>
          Google 日曆授權已失效
        </span>
        <a href="/api/google/oauth/start" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="CalendarPlus" size={14} />重新連結
        </a>
      </>
    );
  }
  const lastSync = st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString("zh-TW") : "排入佇列中";
  return (
    <>
      <span className="hint" style={{ margin: 0 }} title={`最後同步：${lastSync}${st.lastError ? `；上次錯誤：${st.lastError}` : ""}`}>
        <Icon name="CalendarPlus" size={13} /> 已連結 Google 日曆{st.googleEmail ? `（${st.googleEmail}）` : ""}・自動同步中
      </span>
      {flash && <span className="hint" style={{ margin: 0 }}>{flash}</span>}
      <button type="button" className="btn-sm" onClick={() => syncNow.mutate()} disabled={syncNow.isPending} title="平常不用按：增刪改會自動同步；這顆給想立即確認的人">
        {syncNow.isPending ? "同步中…" : "立即同步"}
      </button>
      {syncNow.isError && <span className="hint" style={{ margin: 0, color: "var(--danger, #b3261e)" }}>{syncNow.error.message}</span>}
      <ConfirmButton
        onConfirm={() => disconnect.mutate()}
        title="中斷 Google 日曆連結？"
        message="會撤銷授權並移除你 Google 帳戶裡的「AI Director OS・組排程」日曆（系統內排程不受影響）。"
        confirmLabel="中斷連結"
        disabled={disconnect.isPending}
        triggerClassName="btn-sm"
      >
        中斷連結
      </ConfirmButton>
    </>
  );
}

function ScheduleCard({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const [view, setView] = useState<"list" | "calendar">("list");
  const [includePast, setIncludePast] = useState(false);
  // 清單檢視吃 includePast 開關；月曆檢視固定拉全部（含過去），才畫得出任意月份
  const list = trpc.schedule.list.useQuery({ groupId, includePast: view === "calendar" ? true : includePast });
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
      // 知識地圖吃獨立的聚合查詢：排程增刪也要讓地圖重抓，否則節點/計數殘留舊資料
      utils.knowledgeMap.graph.invalidate({ groupId });
      setTitle("");
      setStartAt("");
      setEndAt("");
      setNote("");
      setProjectId("");
    },
  });
  const remove = trpc.schedule.remove.useMutation({
    onSuccess: () => {
      utils.schedule.list.invalidate({ groupId });
      utils.knowledgeMap.graph.invalidate({ groupId });
    },
  });

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
  const items = (list.data?.items ?? []) as ScheduleItem[];
  // QA-017：截斷不再靜默——超過單頁上限時明確告知，避免使用者以為行程只有這些
  const scheduleTruncated = list.data?.truncated ?? false;

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
        {/* 清單／月曆切換（真實日曆）：段落式切換鈕 */}
        <div className="seg" role="tablist" aria-label="排程檢視" style={{ marginLeft: "auto" }}>
          <button role="tab" aria-selected={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
            <Icon name="FileText" size={13} /> 清單
          </button>
          <button role="tab" aria-selected={view === "calendar"} className={view === "calendar" ? "on" : ""} onClick={() => setView("calendar")}>
            <Icon name="CalendarPlus" size={13} /> 月曆
          </button>
        </div>
      </div>
      <p className="hint">拍攝、開會、上片時間都排在這裡，全組看同一份，不再翻對話記錄找時間。</p>

      {/* 頂部工具列：Google 日曆直連同步（主）＋ .ics 匯出（後備）＋（清單檢視）顯示過去行程 */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <GoogleCalendarBar groupId={groupId} />
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

      {/* 內容區：清單 or 月曆 */}
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
      ) : view === "calendar" ? (
        <CalendarView items={items} projectTitleOf={projectTitleOf} onDelete={(id) => remove.mutate({ id })} removing={remove.isPending} />
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
      {/* QA-017：超過單頁上限時明示——不再讓使用者以為行程只有這些 */}
      {scheduleTruncated && (
        <p className="hint" role="alert" style={{ color: "var(--gold-ink)", marginTop: 8 }}>
          ⚠ 行程超過單頁上限（300 筆），較晚的行程未顯示——可用專案篩選或刪除過期行程縮小範圍
        </p>
      )}
      {remove.error && <p className="error">{remove.error.message}</p>}
    </section>
  );
}

/** 月曆檢視：真正的月份網格（週日起始），行程落在各自那天；點某天在下方展開當日行程。 */
function CalendarView({
  items,
  projectTitleOf,
  onDelete,
  removing,
}: {
  items: ScheduleItem[];
  projectTitleOf: (pid: string | null) => string | null;
  onDelete: (id: string) => void;
  removing: boolean;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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

  // 6×7 月曆矩陣（含前後月補格）
  const weeks = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(1 - first.getDay());
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
  }, [cursor]);

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
                  onConfirm={() => onDelete(ev.id)}
                  message={`刪除行程「${ev.title}」？`}
                  triggerClassName="btn-sm"
                  triggerStyle={{ color: "var(--danger-ink)" }}
                  disabled={removing}
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
      // 知識地圖吃獨立的聚合查詢：筆記增刪改也要讓地圖重抓，否則節點/計數殘留舊資料
      utils.knowledgeMap.graph.invalidate({ groupId });
      clearTitleDraft();
      clearContentDraft();
      closeForm();
    },
  });
  const update = trpc.notes.update.useMutation({
    onSuccess: (_row, vars) => {
      utils.notes.list.invalidate({ groupId });
      utils.notes.get.invalidate({ id: vars.id });
      utils.knowledgeMap.graph.invalidate({ groupId });
      clearTitleDraft();
      clearContentDraft();
      closeForm();
    },
  });
  const remove = trpc.notes.remove.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate({ groupId });
      utils.knowledgeMap.graph.invalidate({ groupId });
    },
  });

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
            <KnowledgeImport
              projects={projects.data ?? []}
              disabled={saving}
              onImport={(imported, kbTitle) => {
                const block = `【知識庫：${kbTitle}】\n${imported}`;
                const next = content.trim() ? `${content.trimEnd()}\n\n${block}` : block;
                // 匯入可能讓內容超過 40000 字上限——與 textarea maxLength 一致，先在此截斷不靜默溢出
                setContent(next.slice(0, 40000));
                if (!title.trim()) setTitle(kbTitle.slice(0, 120));
              }}
            />
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

/* ─────────────────────── (3) 知識地圖・心智圖（知識族譜） ─────────────────────── */

type MapLens = Lens;

/** 葉節點的五種型別：筆記／行程（本頁上方兩卡）＋知識庫／AI 代理（掛專案）＋資料庫（組相關） */
type LeafKind = "note" | "schedule" | "knowledge" | "agent" | "db";

/** 點節點後詳情面板的導航動作：anchor＝跳到本頁上方那筆；project＝進專案頁；db＝資料庫頁（可帶 ?open= 深連結） */
type MapNav =
  | { type: "anchor"; anchorId: string }
  | { type: "project"; projectId: string }
  | { type: "db"; tableId?: string }
  | null;

type MapLeaf = { id: string; kind: LeafKind; label: string; sub: string; nav: MapNav };
type MapSelection = { label: string; sub: string; nav: MapNav };

/** knowledgeMap.graph 的回傳形狀（superjson 下日期是 Date，顯示前仍防禦性包 new Date） */
type MapGraphData = {
  projects: Array<{ id: string; title: string; status: string; updatedAt: string | Date }>;
  notes: Array<{ id: string; projectId: string | null; title: string; createdBy: string; mentions: string[] | null; updatedAt: string | Date }>;
  schedule: Array<{ id: string; projectId: string | null; title: string; startsAt: string | Date; createdBy: string; mentions: string[] | null }>;
  knowledge: Array<{ id: string; projectId: string; kind: string; title: string; chars: number; createdBy: string; createdAt: string | Date }>;
  agents: Array<{ id: string; projectId: string; goal: string; status: string; estPoints: number; userId: string; updatedAt: string | Date }>;
  databases: Array<{ id: string; scope: string; name: string; rowCount: number; agentAccess: string; createdBy: string; updatedAt: string | Date }>;
};

const KNOWLEDGE_KIND_LABEL: Record<string, string> = { transcript: "師父開示稿", testimony: "見證故事", script: "腳本", note: "其他筆記" };
const AGENT_STATUS_LABEL: Record<string, string> = { awaiting_approval: "待核准", running: "執行中", done: "已完成", failed: "失敗", stopped: "已停止" };
const DB_SCOPE_LABEL: Record<string, string> = { personal: "個人", group: "組", team: "團隊", global: "全站" };
const DB_AGENT_ACCESS_LABEL: Record<string, string> = { none: "不開放 AI", read: "AI 唯讀", write: "AI 可查可寫" };
const LEAF_TOGGLES: Array<{ kind: LeafKind; label: string }> = [
  { kind: "note", label: "筆記" },
  { kind: "schedule", label: "行程" },
  { kind: "knowledge", label: "知識" },
  { kind: "agent", label: "AI 代理" },
  { kind: "db", label: "資料庫" },
];

/**
 * 知識地圖（知識族譜）：中心＝這個組，往外一圈是「專案／組層級／資料庫」分支，
 * 再往外是掛在其下的筆記（藍）、行程（琥珀）、知識（綠）、AI 代理（紫）與資料庫（青）。
 * 資料改吃後端聚合端點 knowledgeMap.graph（一次撈齊六類、全帶組隔離與資料庫 ACL），
 * 前端只負責過濾（鏡頭／專案聚焦／型別開關）、佈局與導航——點節點開詳情面板，
 * 面板可跳到本頁那筆、進專案頁或深連結開某個資料庫（/databases?open=id）。
 */
function KnowledgeMapCard({ groupId }: { groupId: string }) {
  const [, setLocation] = useLocation();
  const me = trpc.auth.me.useQuery();
  const meId = me.data?.user.id ?? "";
  const graphQ = trpc.knowledgeMap.graph.useQuery({ groupId });

  const [lens, setLensRaw] = useState<MapLens>("all");
  const [focusProject, setFocusProjectRaw] = useState(""); // ""＝全部專案
  const [types, setTypes] = useState<Record<LeafKind, boolean>>({ note: true, schedule: true, knowledge: true, agent: true, db: true });
  const [selected, setSelected] = useState<MapSelection | null>(null);
  // 換鏡頭／聚焦／開關型別時把選取清掉——面板殘留上一個視角的節點會誤導
  const setLens = (v: MapLens) => { setLensRaw(v); setSelected(null); };
  const setFocusProject = (v: string) => { setFocusProjectRaw(v); setSelected(null); };
  const toggleType = (k: LeafKind) => { setTypes((t) => ({ ...t, [k]: !t[k] })); setSelected(null); };

  const data = graphQ.data as MapGraphData | undefined;

  const graph = useMemo(() => {
    if (!data) return null;
    // 鏡頭：全組看全部；「我的」＝我建立的（各型別皆適用）；「提及我」只有筆記／行程有 @提及語意
    const inLens = (createdBy: string, mentions?: string[] | null) => {
      if (lens === "all") return true;
      if (lens === "mine") return createdBy === meId;
      return Array.isArray(mentions) && mentions.includes(meId);
    };
    const projTitle = (pid: string | null) => (pid ? data.projects.find((p) => p.id === pid)?.title ?? "（已移除專案）" : null);

    const noteRows = data.notes.filter((n) => types.note && inLens(n.createdBy, n.mentions) && (!focusProject || n.projectId === focusProject));
    const schedRows = data.schedule.filter((e) => types.schedule && inLens(e.createdBy, e.mentions) && (!focusProject || e.projectId === focusProject));
    const knowRows = data.knowledge.filter((k) => types.knowledge && inLens(k.createdBy) && (!focusProject || k.projectId === focusProject));
    const agentRows = data.agents.filter((a) => types.agent && inLens(a.userId) && (!focusProject || a.projectId === focusProject));
    // 資料庫不掛專案：聚焦某專案時不畫（避免誤導成「這庫屬於這個專案」）
    const dbRows = focusProject ? [] : data.databases.filter((d) => types.db && inLens(d.createdBy));

    // 分支：key＝專案 id 或 "__group"（組層級／未掛專案）；資料庫獨立一支
    const branches = new Map<string, { key: string; label: string; kind: "project" | "bucket"; projectId: string | null; leaves: MapLeaf[] }>();
    const branchOf = (pid: string | null) => {
      const key = pid ?? "__group";
      let b = branches.get(key);
      if (!b) {
        b = { key, label: pid ? projTitle(pid) ?? "專案" : "組層級", kind: pid ? "project" : "bucket", projectId: pid, leaves: [] };
        branches.set(key, b);
      }
      return b;
    };
    // 葉順序：知識（沉澱）→ 筆記 → 行程 → 代理（動態）——同分支內按「知識脈絡」由靜到動排
    for (const k of knowRows)
      branchOf(k.projectId).leaves.push({
        id: `k-${k.id}`,
        kind: "knowledge",
        label: k.title,
        sub: `知識庫・${KNOWLEDGE_KIND_LABEL[k.kind] ?? k.kind}・${k.chars.toLocaleString()} 字`,
        nav: { type: "project", projectId: k.projectId },
      });
    for (const n of noteRows)
      branchOf(n.projectId).leaves.push({
        id: `n-${n.id}`,
        kind: "note",
        label: n.title,
        sub: `筆記・${fmtDateTime(n.updatedAt)} 更新`,
        nav: { type: "anchor", anchorId: `note-${n.id}` },
      });
    for (const e of schedRows)
      branchOf(e.projectId).leaves.push({
        id: `s-${e.id}`,
        kind: "schedule",
        label: e.title,
        sub: `行程・${fmtDateTime(e.startsAt)}`,
        nav: { type: "anchor", anchorId: `schedule-${e.id}` },
      });
    for (const a of agentRows)
      branchOf(a.projectId).leaves.push({
        id: `a-${a.id}`,
        kind: "agent",
        label: a.goal,
        sub: `AI 代理・${AGENT_STATUS_LABEL[a.status] ?? a.status}・估 ${a.estPoints} 點`,
        nav: { type: "project", projectId: a.projectId },
      });

    const dbLeaves: MapLeaf[] = dbRows.map((d) => ({
      id: `d-${d.id}`,
      kind: "db",
      label: d.name,
      sub: `資料庫・${DB_SCOPE_LABEL[d.scope] ?? d.scope}・${d.rowCount.toLocaleString()} 列・${DB_AGENT_ACCESS_LABEL[d.agentAccess] ?? d.agentAccess}`,
      nav: { type: "db", tableId: d.id },
    }));

    const contentBranches = [...branches.values()].filter((b) => b.leaves.length > 0);
    // 分支多時先排「內容多」的；資料庫分支固定保留一席，其餘不畫（避免過度擁擠）
    contentBranches.sort((a, b) => b.leaves.length - a.leaves.length);
    const maxContent = dbLeaves.length > 0 ? 9 : 10;
    const shownBranches: Array<{ key: string; label: string; kind: "project" | "bucket" | "dbhub"; projectId: string | null; leaves: MapLeaf[] }> =
      contentBranches.slice(0, maxContent);
    const hiddenBranchCount = contentBranches.length - Math.min(contentBranches.length, maxContent);
    if (dbLeaves.length > 0) shownBranches.push({ key: "__db", label: "資料庫", kind: "dbhub", projectId: null, leaves: dbLeaves });

    return {
      shownBranches,
      hiddenBranchCount,
      counts: { note: noteRows.length, schedule: schedRows.length, knowledge: knowRows.length, agent: agentRows.length, db: dbRows.length },
    };
  }, [data, lens, focusProject, types, meId]);

  // 佈局幾何（固定 viewBox，SVG 依容器寬縮放）
  const W = 920;
  const H = 560;
  const cx = W / 2;
  const cy = H / 2;
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

  const layout = useMemo(() => {
    if (!graph) return null;
    const { shownBranches } = graph;
    const B = shownBranches.length;
    const RB = 165; // 分支節點半徑
    const RL = 258; // 葉節點半徑
    type LayoutNode = {
      id: string;
      type: "group" | "project" | "bucket" | "dbhub" | "more" | LeafKind;
      label: string;
      x: number;
      y: number;
      selection?: MapSelection;
    };
    const nodes: LayoutNode[] = [];
    const edges: Array<{ x1: number; y1: number; x2: number; y2: number; kind: "branch" | "leaf" }> = [];
    nodes.push({ id: "group", type: "group", label: "本組", x: cx, y: cy });
    if (B === 0) return { nodes, edges };
    shownBranches.forEach((b, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / B;
      const bx = cx + RB * Math.cos(a);
      const by = cy + RB * Math.sin(a);
      edges.push({ x1: cx, y1: cy, x2: bx, y2: by, kind: "branch" });
      // 分支節點也可點：專案分支→進專案；資料庫分支→開資料庫頁；組層級只顯示統計
      const branchNav: MapNav = b.kind === "project" && b.projectId ? { type: "project", projectId: b.projectId } : b.kind === "dbhub" ? { type: "db" } : null;
      nodes.push({
        id: `b-${b.key}`,
        type: b.kind,
        label: clip(b.label, 12),
        x: bx,
        y: by,
        selection: { label: b.label, sub: `${b.kind === "dbhub" ? "資料庫" : b.kind === "project" ? "專案" : "組層級"}・${b.leaves.length} 個節點`, nav: branchNav },
      });
      // 葉節點：在分支角度附近扇形展開；最多 6 片，其餘收成一顆「+N」
      const shownLeaves = b.leaves.slice(0, 6);
      const extra = b.leaves.length - shownLeaves.length;
      const total = shownLeaves.length + (extra > 0 ? 1 : 0);
      const fan = Math.min(Math.PI * 0.7, 0.36 * Math.max(1, total)); // 扇形總開角
      const leafPos = (j: number) => {
        const off = total > 1 ? -fan / 2 + (fan * j) / (total - 1) : 0;
        const la = a + off;
        return { lx: cx + RL * Math.cos(la), ly: cy + RL * Math.sin(la) };
      };
      shownLeaves.forEach((leaf, j) => {
        const { lx, ly } = leafPos(j);
        edges.push({ x1: bx, y1: by, x2: lx, y2: ly, kind: "leaf" });
        nodes.push({ id: leaf.id, type: leaf.kind, label: clip(leaf.label, 11), x: lx, y: ly, selection: { label: leaf.label, sub: leaf.sub, nav: leaf.nav } });
      });
      if (extra > 0) {
        const { lx, ly } = leafPos(shownLeaves.length);
        edges.push({ x1: bx, y1: by, x2: lx, y2: ly, kind: "leaf" });
        nodes.push({
          id: `more-${b.key}`,
          type: "more",
          label: `+${extra}`,
          x: lx,
          y: ly,
          selection: { label: `${b.label}：還有 ${extra} 個節點`, sub: "地圖每支最多畫 6 片葉子，其餘請進來源頁看全部", nav: branchNav },
        });
      }
    });
    return { nodes, edges };
  }, [graph]);

  /** 詳情面板的「前往」：按 nav 型別跳頁或跳到上方那筆 */
  const go = (nav: MapNav) => {
    if (!nav) return;
    if (nav.type === "anchor") flashAnchor(nav.anchorId);
    else if (nav.type === "project") setLocation(`/p/${nav.projectId}`);
    else setLocation(nav.tableId ? `/databases?open=${nav.tableId}` : "/databases");
  };
  const navLabel = (nav: MapNav) =>
    !nav ? null : nav.type === "anchor" ? "跳到上方那筆" : nav.type === "project" ? "開啟專案" : nav.tableId ? "開啟資料庫" : "開啟資料庫頁";

  const counts = graph?.counts;

  return (
    <section className="card" style={{ marginTop: 16 }} data-fb="知識地圖卡">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>知識地圖・心智圖</h2>
      </div>
      <p className="hint">
        本組知識族譜一張圖：中心是本組，往外是專案／組層級／資料庫分支，再往外是筆記（藍）、行程（琥珀）、知識庫（綠）、AI 代理（紫）與資料庫（青）。
        點任一節點看詳情，一鍵跳到那筆、進專案頁或打開資料庫。
      </p>

      {/* 鏡頭：全組／我的／提及我 ＋ 專案聚焦（團隊／個人／專案三個維度） */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <div className="seg" role="tablist" aria-label="鏡頭">
          <button role="tab" aria-selected={lens === "all"} className={lens === "all" ? "on" : ""} onClick={() => setLens("all")}>全組</button>
          <button role="tab" aria-selected={lens === "mine"} className={lens === "mine" ? "on" : ""} onClick={() => setLens("mine")}>我的</button>
          <button role="tab" aria-selected={lens === "mentioned"} className={lens === "mentioned" ? "on" : ""} onClick={() => setLens("mentioned")}>提及我</button>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="SlidersHorizontal" size={13} style={{ color: "var(--fg-secondary)" }} />
          <select value={focusProject} onChange={(e) => setFocusProject(e.target.value)} style={{ minWidth: 150 }} aria-label="聚焦專案">
            <option value="">全部專案</option>
            {(data?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </div>
        {counts && (
          <span className="hint" style={{ margin: 0 }}>
            筆記 {counts.note}・行程 {counts.schedule}・知識 {counts.knowledge}・代理 {counts.agent}・資料庫 {counts.db}
            {graph && graph.hiddenBranchCount > 0 ? `・另有 ${graph.hiddenBranchCount} 個分支未畫（過密）` : ""}
          </span>
        )}
      </div>

      {/* 圖例＝型別開關：點一下顯示／隱藏該型別的葉節點 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        {LEAF_TOGGLES.map((t) => (
          <button key={t.kind} type="button" className={`map-toggle${types[t.kind] ? " on" : ""}`} aria-pressed={types[t.kind]} onClick={() => toggleType(t.kind)}>
            <span className={`map-dot ${t.kind}`} /> {t.label}
          </button>
        ))}
        <span className="map-legend"><span className="map-dot proj" /> 專案</span>
        <span className="map-legend"><span className="map-dot bucket" /> 組層級</span>
      </div>
      {lens === "mentioned" && (
        <p className="hint" style={{ marginTop: 6 }}>「提及我」只適用有 @提及 的筆記與行程；知識、代理與資料庫在此鏡頭下不顯示。</p>
      )}

      {graphQ.isLoading ? (
        <div className="skeleton" style={{ height: 320, marginTop: 12, borderRadius: "var(--r-12)" }} aria-hidden="true" />
      ) : graphQ.error ? (
        <p className="error">{graphQ.error.message}</p>
      ) : !graph || graph.shownBranches.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 12 }}>
          <h3>這張地圖還是空的</h3>
          <p>
            先在上面加幾筆行程或筆記（可掛專案），或在專案裡累積知識庫、跑 AI 代理、建資料庫，這裡就會長出對應的族譜節點。
            {lens !== "all" && "或把鏡頭切回「全組」。"}
          </p>
        </div>
      ) : (
        <div className="map-wrap" style={{ marginTop: 12 }}>
          <svg viewBox={`0 0 ${W} ${H}`} className="map-svg" role="img" aria-label="知識地圖">
            {layout?.edges.map((e, i) => (
              <line key={`e-${i}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} className={`map-edge ${e.kind}`} />
            ))}
            {layout?.nodes.map((n) => {
              if (n.type === "group") {
                return (
                  <g key={n.id} className="map-node group">
                    <circle cx={n.x} cy={n.y} r={34} />
                    <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central">{n.label}</text>
                  </g>
                );
              }
              if (n.type === "project" || n.type === "bucket" || n.type === "dbhub" || n.type === "more") {
                const w = Math.max(56, n.label.length * 13 + 22);
                return (
                  <g
                    key={n.id}
                    className={`map-node ${n.type} clickable`}
                    onClick={() => setSelected(n.selection ?? null)}
                    style={{ cursor: "pointer" }}
                  >
                    <rect x={n.x - w / 2} y={n.y - 15} width={w} height={30} rx={15} />
                    <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central">{n.label}</text>
                  </g>
                );
              }
              // note / schedule / knowledge / agent / db 葉節點
              return (
                <g key={n.id} className={`map-node ${n.type} clickable`} onClick={() => setSelected(n.selection ?? null)} style={{ cursor: "pointer" }}>
                  <circle cx={n.x} cy={n.y} r={6} />
                  <text x={n.x} y={n.y - 12} textAnchor="middle">{n.label}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* 節點詳情面板：點節點顯示；「前往」按 nav 型別跳頁 */}
      {selected && (
        <div className="map-detail" role="status">
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong style={{ fontSize: "var(--fs-14)", display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{selected.label}</strong>
            <span className="hint" style={{ margin: 0 }}>{selected.sub}</span>
          </div>
          {selected.nav && (
            <button className="btn-sm primary" onClick={() => go(selected.nav)}>
              {navLabel(selected.nav)}
            </button>
          )}
          <button className="btn-sm btn-ghost" onClick={() => setSelected(null)} aria-label="關閉詳情">關閉</button>
        </div>
      )}
    </section>
  );
}
