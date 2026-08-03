import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import { ConfirmButton } from "../components/interactions";
import { MentionInput, resolveMentions } from "../components/MentionInput";
import { flashAnchor, takePlannerFocus } from "../discuss";

/**
 * 筆記排程 — calendar-first restore (click-date-to-add).
 * Full Notes + KnowledgeMap restore follows in a subsequent PR.
 * groupId comes from the top-bar group selector.
 */

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

const pad2 = (n: number) => String(n).padStart(2, "0");

function fmtTime(d: string | Date): string {
  const t = new Date(d);
  return `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
}

/** Local day key YYYY-M-D (avoids UTC shift from toISOString) */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function toDatetimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function PlannerPage({ groupId }: { groupId: string }) {
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
      <p className="hint">
        全組共用的行程表：可切清單／月曆，點月曆上的日期即可快速新增行程；支援 Google 日曆直連同步。
      </p>
      <ScheduleCard key={`sch-${groupId}`} groupId={groupId} />
      <section className="card" style={{ marginTop: 16 }}>
        <h2>筆記・會議紀錄</h2>
        <p className="hint">完整筆記卡（含從知識庫匯入、本地草稿、版本快照）將在後續 PR 完整恢復。目前請先使用組排程。</p>
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>知識地圖・心智圖</h2>
        <p className="hint">知識族譜（專案／筆記／行程／知識庫／AI 代理／資料庫）將在後續 PR 完整恢復。</p>
      </section>
      <p style={{ marginTop: 24 }}>
        <Link href="/">回作業台</Link>
      </p>
    </div>
  );
}

/* ────────────────────────── Google 日曆工具列 ────────────────────────── */

function GoogleCalendarBar({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const status = trpc.googleCalendar.status.useQuery();
  const syncNow = trpc.googleCalendar.syncNow.useMutation({
    onSettled: () => utils.googleCalendar.status.invalidate(),
  });
  const disconnect = trpc.googleCalendar.disconnect.useMutation({
    onSuccess: () => utils.googleCalendar.status.invalidate(),
  });
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("gcal");
    if (!q) return;
    setFlash(
      q === "connected"
        ? "已連結 Google 日曆，首次同步進行中（幾秒內完成）"
        : q === "denied"
          ? "已取消 Google 授權——隨時可以再連結"
          : q === "state_mismatch"
            ? "授權連結已過期，請重新點「連結 Google 日曆」"
            : "連結失敗，請稍後再試",
    );
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const icsFallback = (
    <a
      href={`/api/schedule/${groupId}/calendar.ics`}
      download
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <Icon name="Download" size={14} />匯出 .ics
    </a>
  );

  const st = status.data;
  if (!st) return icsFallback;
  if (!st.configured) {
    return (
      <>
        {icsFallback}
        <span className="hint" style={{ margin: 0 }}>
          下載後匯入個人日曆；內容更新請重新下載
        </span>
      </>
    );
  }
  if (!st.connected) {
    return (
      <>
        <a href="/api/google/oauth/start" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="CalendarPlus" size={14} />連結 Google 日曆（自動同步）
        </a>
        <span className="hint" style={{ margin: 0 }}>
          {flash ?? "連結後排程增刪改自動出現在你的 Google 日曆，免匯出匯入"}
        </span>
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
      <span
        className="hint"
        style={{ margin: 0 }}
        title={`最後同步：${lastSync}${st.lastError ? `；上次錯誤：${st.lastError}` : ""}`}
      >
        <Icon name="CalendarPlus" size={13} /> 已連結 Google 日曆
        {st.googleEmail ? `（${st.googleEmail}）` : ""}・自動同步中
      </span>
      {flash && <span className="hint" style={{ margin: 0 }}>{flash}</span>}
      <button
        type="button"
        className="btn-sm"
        onClick={() => syncNow.mutate()}
        disabled={syncNow.isPending}
        title="平常不用按：增刪改會自動同步；這顆給想立即確認的人"
      >
        {syncNow.isPending ? "同步中…" : "立即同步"}
      </button>
      {syncNow.isError && (
        <span className="hint" style={{ margin: 0, color: "var(--danger, #b3261e)" }}>
          {syncNow.error.message}
        </span>
      )}
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

/* ────────────────────────── 組排程（清單／月曆） ────────────────────────── */

function ScheduleCard({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const [view, setView] = useState<"list" | "calendar">("calendar");
  const [includePast, setIncludePast] = useState(false);
  const list = trpc.schedule.list.useQuery({
    groupId,
    includePast: view === "calendar" ? true : includePast,
  });
  const projects = trpc.projects.list.useQuery({ groupId });
  const members = trpc.projects.groupMembers.useQuery({ groupId }).data ?? [];

  const formRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState("");
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
  const remove = trpc.schedule.remove.useMutation({
    onSuccess: () => utils.schedule.list.invalidate({ groupId }),
  });

  const endInvalid = !!startAt && !!endAt && new Date(endAt) < new Date(startAt);
  const canAdd = !!title.trim() && !!startAt && !endInvalid && !add.isPending;
  const addDisabledReason =
    !title.trim() ? "先填標題"
    : !startAt ? "先選開始時間"
    : endInvalid ? "結束時間要晚於開始時間"
    : null;

  const submit = () => {
    if (!canAdd) return;
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

  /** 點月曆日期 → 預填開始時間、聚焦標題、捲動到表單 */
  function prefillFromDay(day: Date) {
    const now = new Date();
    const isToday = dayKey(day) === dayKey(now);
    let start: Date;
    if (isToday) {
      start = new Date(now.getTime() + 30 * 60 * 1000);
      start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
    } else {
      start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0);
    }
    setStartAt(toDatetimeLocal(start));
    setEndAt("");
    // 保留使用者已輸入的標題/備註，方便連續加多筆
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      const el =
        document.getElementById("sch-title") ||
        document.querySelector('[aria-label="排程標題"]');
      (el as HTMLElement | null)?.focus?.();
    }, 280);
  }

  const projectTitleOf = (pid: string | null) =>
    pid ? (projects.data ?? []).find((p) => p.id === pid)?.title ?? null : null;
  const items = (list.data?.items ?? []) as ScheduleItem[];
  const scheduleTruncated = list.data?.truncated ?? false;

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
        <div className="seg" role="tablist" aria-label="排程檢視" style={{ marginLeft: "auto" }}>
          <button
            role="tab"
            aria-selected={view === "list"}
            className={view === "list" ? "on" : ""}
            onClick={() => setView("list")}
          >
            <Icon name="FileText" size={13} /> 清單
          </button>
          <button
            role="tab"
            aria-selected={view === "calendar"}
            className={view === "calendar" ? "on" : ""}
            onClick={() => setView("calendar")}
          >
            <Icon name="CalendarPlus" size={13} /> 月曆
          </button>
        </div>
      </div>
      <p className="hint">
        拍攝、開會、上片時間都排在這裡。月曆模式：點任一日期即可快速新增該日行程。
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <GoogleCalendarBar groupId={groupId} />
        <span className="spacer" />
        {view === "list" && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0 }}>
            <input
              type="checkbox"
              checked={includePast}
              onChange={(e) => setIncludePast(e.target.checked)}
            />
            顯示過去行程
          </label>
        )}
      </div>

      {/* 新增表單 */}
      <div
        ref={formRef}
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginTop: 12,
          borderTop: "1px solid var(--border-soft)",
          paddingTop: 12,
        }}
      >
        <div style={{ flex: "2 1 200px", minWidth: 160 }}>
          <label htmlFor="sch-title">標題（可 @ 提及夥伴）</label>
          <MentionInput
            value={title}
            onChange={setTitle}
            members={members}
            maxLength={120}
            ariaLabel="排程標題"
            placeholder="例：週會・腳本審稿（@人 可通知）"
            onEnter={submit}
          />
        </div>
        <div style={{ flex: "1 1 185px" }}>
          <label htmlFor="sch-start">開始（必填）</label>
          <input
            id="sch-start"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
          />
        </div>
        <div style={{ flex: "1 1 185px" }}>
          <label htmlFor="sch-end">結束（選填）</label>
          <input
            id="sch-end"
            type="datetime-local"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
          />
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
          <input
            id="sch-note"
            value={note}
            maxLength={500}
            placeholder="例：地點、要先準備什麼"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <button className="primary" style={{ flex: "none" }} disabled={!canAdd} onClick={submit}>
          {add.isPending ? "加入中…" : "加入"}
        </button>
        {addDisabledReason && (
          <span className="hint" style={{ alignSelf: "center" }}>{addDisabledReason}</span>
        )}
      </div>
      {endInvalid && (
        <p className="error" role="alert" style={{ marginTop: 6 }}>
          結束時間要晚於開始時間
        </p>
      )}
      {add.error && <p className="error">{add.error.message}</p>}

      {/* 內容：清單 or 月曆 */}
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
        <CalendarView
          items={items}
          projectTitleOf={projectTitleOf}
          onDelete={(id) => remove.mutate({ id })}
          removing={remove.isPending}
          onDayClick={prefillFromDay}
        />
      ) : groups.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 12 }}>
          <h3>{includePast ? "還沒有任何行程" : "接下來沒有排程"}</h3>
          <p>用上面的欄位加第一筆——開會、拍攝、上片都行。</p>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {groups.map((g) => (
            <div key={g.label} style={{ marginTop: 10 }}>
              <h3 style={{ fontSize: "var(--fs-13)", color: "var(--fg-secondary)", margin: "0 0 2px" }}>
                {g.label}
              </h3>
              {g.items.map((ev) => {
                const projTitle = projectTitleOf(ev.projectId);
                return (
                  <div
                    key={ev.id}
                    id={`schedule-${ev.id}`}
                    className="gen-row"
                    style={{ gridTemplateColumns: "auto 1fr auto", alignItems: "center" }}
                  >
                    <span className="mono" style={{ fontSize: "var(--fs-12)", whiteSpace: "nowrap" }}>
                      <Icon name="Clock" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                      {fmtTime(ev.startsAt)}
                      {ev.endsAt ? `–${fmtTime(ev.endsAt)}` : ""}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "var(--fs-14)", fontWeight: 600 }}>
                        {ev.title}
                        {projTitle && <span className="chip" style={{ margin: "0 0 0 8px" }}>{projTitle}</span>}
                      </div>
                      {(ev.note || ev.ownerName) && (
                        <div className="meta">{[ev.ownerName, ev.note].filter(Boolean).join("・")}</div>
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
      {scheduleTruncated && (
        <p className="hint" role="alert" style={{ color: "var(--gold-ink)", marginTop: 8 }}>
          ⚠ 行程超過單頁上限，較晚的行程未顯示
        </p>
      )}
      {remove.error && <p className="error">{remove.error.message}</p>}
    </section>
  );
}

/** 月曆：點任一日期 → 預填新增表單；有行程的日子同時展開當日列表 */
function CalendarView({
  items,
  projectTitleOf,
  onDelete,
  removing,
  onDayClick,
}: {
  items: ScheduleItem[];
  projectTitleOf: (pid: string | null) => string | null;
  onDelete: (id: string) => void;
  removing: boolean;
  onDayClick: (d: Date) => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleItem[]>();
    for (const ev of items) {
      const k = dayKey(new Date(ev.startsAt));
      (m.get(k) ?? m.set(k, []).get(k)!).push(ev);
    }
    for (const arr of m.values())
      arr.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    return m;
  }, [items]);

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
        <button
          className="btn-sm btn-ghost"
          onClick={() => {
            setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
            setSelectedKey(null);
          }}
        >
          回本月
        </button>
      </div>
      <p className="hint" style={{ marginBottom: 6 }}>
        點任一日期 → 自動帶入開始時間並聚焦標題，即可快速新增
      </p>
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
              onClick={() => {
                setSelectedKey(k);
                onDayClick(dt);
              }}
              aria-label={`${dt.getMonth() + 1}/${dt.getDate()}${evs.length ? `，${evs.length} 筆行程` : "，點此新增"}`}
              title={evs.length ? undefined : "點此新增行程"}
            >
              <span className="cal-daynum">{dt.getDate()}</span>
              <span className="cal-events">
                {evs.slice(0, 3).map((ev) => (
                  <span key={ev.id} className="cal-ev" title={ev.title}>
                    <span className="cal-ev-time">{fmtTime(ev.startsAt)}</span> {ev.title}
                  </span>
                ))}
                {evs.length > 3 && <span className="cal-more">+{evs.length - 3}</span>}
                {evs.length === 0 && inMonth && (
                  <span className="cal-more" style={{ opacity: 0.45 }}>+ 新增</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {selectedKey && selectedItems.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <h3 style={{ fontSize: "var(--fs-13)", color: "var(--fg-secondary)", margin: "0 0 2px" }}>
            {new Date(selectedItems[0].startsAt).toLocaleDateString("zh-TW")}・{selectedItems.length} 筆
          </h3>
          {selectedItems.map((ev) => {
            const projTitle = projectTitleOf(ev.projectId);
            return (
              <div
                key={ev.id}
                id={`schedule-${ev.id}`}
                className="gen-row"
                style={{ gridTemplateColumns: "auto 1fr auto", alignItems: "center" }}
              >
                <span className="mono" style={{ fontSize: "var(--fs-12)", whiteSpace: "nowrap" }}>
                  <Icon name="Clock" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                  {fmtTime(ev.startsAt)}
                  {ev.endsAt ? `–${fmtTime(ev.endsAt)}` : ""}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-14)", fontWeight: 600 }}>
                    {ev.title}
                    {projTitle && <span className="chip" style={{ margin: "0 0 0 8px" }}>{projTitle}</span>}
                  </div>
                  {(ev.note || ev.ownerName) && (
                    <div className="meta">{[ev.ownerName, ev.note].filter(Boolean).join("・")}</div>
                  )}
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
