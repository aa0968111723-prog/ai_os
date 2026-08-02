import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Icon } from "../../components/Icon";
import { ConfirmButton } from "../../components/interactions";
import { Button, Chip, EmptyState } from "../../components/ui";

/** 排程列形狀（與 PlannerPage ScheduleItem 對齊） */
export type ScheduleItem = {
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
  planRunId?: string | null;
  planStepId?: string | null;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** HH:mm */
function fmtTime(d: string | Date): string {
  const t = new Date(d);
  return `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
}

/** 本地日期鍵 YYYY-M-D（月為 0-based，與 PlannerPage.dayKey 一致） */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** datetime-local 字串（本地牆鐘、零填充）— 供父層 prefill 用 */
export function toLocalDatetimeValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 月曆檢視：真正的月份網格（週日起始），行程落在各自那天。
 * 點任何一天（含空天）在下方展開當日行程；空天可一鍵新增並預填開始時間。
 */
export function CalendarView({
  items,
  projectTitleOf,
  onDelete,
  removing,
  onRequestAdd,
}: {
  items: ScheduleItem[];
  projectTitleOf: (pid: string | null) => string | null;
  onDelete: (id: string) => void;
  removing: boolean;
  /** 點「為這天新增行程」時呼叫；dayKey 格式為 YYYY-M-D（月 0-based） */
  onRequestAdd: (dayKey: string) => void;
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
  const selectedLabel = (() => {
    if (!selectedKey) return "";
    const [y, m, d] = selectedKey.split("-").map(Number);
    if ([y, m, d].some((n) => Number.isNaN(n))) return selectedKey;
    return new Date(y, m, d).toLocaleDateString("zh-TW");
  })();
  const goMonth = (delta: number) => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
    setSelectedKey(null);
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <Button size="sm" onClick={() => goMonth(-1)} aria-label="上個月">
          <Icon name="ChevronRight" size={14} style={{ transform: "rotate(180deg)" }} />
        </Button>
        <strong style={{ fontSize: "var(--fs-15)" }}>{monthLabel}</strong>
        <Button size="sm" onClick={() => goMonth(1)} aria-label="下個月">
          <Icon name="ChevronRight" size={14} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { setCursor(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedKey(null); }}>
          回本月
        </Button>
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
              onClick={() => setSelectedKey(k)}
              aria-label={`${dt.getMonth() + 1}/${dt.getDate()}${evs.length ? `，${evs.length} 筆行程` : "，可選取新增"}`}
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

      {/* 選定某天 → 展開當日全部行程（含空天可新增） */}
      {selectedKey && (
        <div style={{ marginTop: 10 }}>
          <h3 style={{ fontSize: "var(--fs-13)", color: "var(--fg-secondary)", margin: "0 0 6px" }}>
            {selectedLabel}・{selectedItems.length > 0 ? `${selectedItems.length} 筆` : "尚無行程"}
          </h3>
          {selectedItems.length === 0 ? (
            <EmptyState
              icon={<Icon name="CalendarPlus" />}
              title={<>這天還沒有行程</>}
              description={<>點下面按鈕，開始時間會自動帶入這天 09:00。</>}
              style={{ marginTop: 4 }}
            />
          ) : (
            selectedItems.map((ev) => {
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
                      {projTitle && <Chip style={{ margin: "0 0 0 8px" }}>{projTitle}</Chip>}
                    </div>
                    {(ev.note || ev.ownerName) && <div className="meta">{[ev.ownerName, ev.note].filter(Boolean).join("・")}</div>}
                    {ev.planRunId && ev.projectId && (
                      <Link href={`/p/${ev.projectId}?focus=agent-run-${ev.planRunId}`} className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <Icon name="Sparkles" size={11} />由 AI 計畫建立／更新・回到計畫
                      </Link>
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
            })
          )}
          <Button
            variant="primary"
            size="sm"
            style={{ marginTop: 8 }}
            onClick={() => onRequestAdd(selectedKey)}
          >
            <Icon name="CalendarPlus" size={14} /> 為這天新增行程
          </Button>
        </div>
      )}
    </div>
  );
}
