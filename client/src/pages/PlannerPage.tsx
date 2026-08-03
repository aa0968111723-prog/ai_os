import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { useMatchMedia } from "../lib/useMatchMedia";
import { Icon } from "../components/Icon";
import { CharCount, ConfirmButton } from "../components/interactions";
import { PlannerSection, plannerInitialSections } from "../components/PlannerSection";
import { useLocalDraft } from "../useLocalDraft";
import { MentionInput, resolveMentions } from "../components/MentionInput";
import { flashAnchor, takePlannerFocus } from "../discuss";

import { Button, Chip, EmptyState, Hint, Meta, Skeleton } from "../components/ui";
import { useCollab, CursorOverlay } from "../realtime";
/**
 * 筆記排程（需求 #10）：組內共用的「排程表＋會議筆記＋知識地圖」一頁。
 * - 組排程：可掛專案、可直連 Google 日曆自動同步（.ics 匯出保留為後備）；清單／月曆兩種檢視（真實日曆）。
 * - 筆記／會議紀錄：內容更新由後端自動留版本快照；可「從知識庫匯入」把專案知識帶進筆記。
 * - 知識地圖（知識族譜）：把專案／筆記／行程／知識庫／AI 助手／資料庫織成一張放射圖，
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
  planRunId?: string | null;
  planStepId?: string | null;
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
  planRunId?: string | null;
  planStepId?: string | null;
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

function nextTabValue<T extends string>(values: readonly T[], current: T, key: string): T | null {
  const index = values.indexOf(current);
  if (key === "Home") return values[0] ?? null;
  if (key === "End") return values[values.length - 1] ?? null;
  if (key === "ArrowRight" || key === "ArrowDown") return values[(index + 1) % values.length] ?? null;
  if (key === "ArrowLeft" || key === "ArrowUp") return values[(index - 1 + values.length) % values.length] ?? null;
  return null;
}

function revealPlannerSection(id: string): void {
  const section = document.getElementById(id) as HTMLDetailsElement | null;
  if (!section) return;
  section.open = true;
  requestAnimationFrame(() => {
    section.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  });
}

export function PlannerPage({ groupId }: { groupId: string }) {
  // 深連結來源：① 留言／私訊卡 setPlannerFocus（sessionStorage）② URL ?focus=note-:id|schedule-:id（私訊標注卡直達）
  const [focusTarget] = useState(() => {
    const fromStorage = takePlannerFocus();
    if (fromStorage) return fromStorage;
    try {
      const q = new URLSearchParams(window.location.search).get("focus");
      if (q && /^(note|schedule)-/.test(q)) return q;
    } catch { /* ignore */ }
    return null;
  });
  const initialSections = plannerInitialSections(focusTarget);
  // 由留言／私訊的排程/筆記引用卡跳來：目標 id 就緒後輪詢直到該列渲染再高亮
  useEffect(() => {
    if (!focusTarget) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (flashAnchor(focusTarget) || tries > 20) window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, [focusTarget]);

  // 頁首只讀摘要與下方卡片共用同一組 query key，不增加額外資料來源。
  const schedulePreview = trpc.schedule.list.useQuery(
    { groupId, includePast: false },
    { enabled: !!groupId },
  );
  const notesPreview = trpc.notes.list.useQuery(
    { groupId },
    { enabled: !!groupId },
  );
  const upcomingItems = (schedulePreview.data?.items ?? []) as ScheduleItem[];
  const today = new Date();
  const todayScheduleCount = upcomingItems.filter((item) => dayKey(new Date(item.startsAt)) === dayKey(today)).length;
  const nextSchedule = upcomingItems[0];
  const noteCount = notesPreview.data?.length ?? 0;
  const linkedKnowledgeCount = upcomingItems.filter((item) => item.projectId).length
    + (notesPreview.data ?? []).filter((note) => note.projectId).length;

  // 全組協作：presence + 游標（組房 g:${groupId}）
  const collab = useCollab(groupId, !!groupId, "group");

  if (!groupId) {
    return (
      <div className="page-shell planner-page">
        <header className="page-intro">
          <p className="eyebrow">日常協作</p>
          <h1>筆記與排程</h1>
        </header>
        <EmptyState icon={<Icon name="User" />} title={<>請先選擇組別</>} description={<>用頂欄的組別選單選一個組，就能看到這個組的排程與會議筆記。</>} style={{ marginTop: "var(--sp-32)" }} />
      </div>
    );
  }
  return (
    <div
      className="page-shell planner-page"
      ref={collab.containerRef}
      onPointerMove={collab.onPointerMove}
      style={{ position: "relative" }}
    >
      <CursorOverlay cursors={collab.cursors} />
      <header className="page-intro planner-intro">
        <div>
          <p className="eyebrow">日常協作</p>
          <h1>筆記與排程</h1>
          <p className="page-lede">把會議、期限、決議與知識放在同一個地方，今天要做什麼一眼就知道。</p>
        </div>
        <span className="page-intro__badge"><Icon name="Clock" size={15} />全組共用</span>
      </header>

      {collab.connected && collab.peers.length > 0 && (
        <div
          aria-label="組內在線"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
            alignItems: "center",
          }}
        >
          <Hint as="span" layer="always" style={{ margin: 0, fontSize: 12 }}>
            組內在線
          </Hint>
          {collab.peers.map((p) => (
            <Chip
              key={p.userId}
              style={{
                margin: 0,
                background: p.color,
                color: "#fff",
                borderColor: p.color,
              }}
              title={p.userId === collab.self?.userId ? "你" : p.name}
            >
              {p.userId === collab.self?.userId ? "你" : p.name}
            </Chip>
          ))}
        </div>
      )}

      <nav className="planner-jump-grid" aria-label="筆記排程功能">
        <button type="button" onClick={() => revealPlannerSection("planner-schedule")}>
          <span className="planner-jump-grid__icon schedule"><Icon name="CalendarPlus" size={18} /></span>
          <span>
            <strong>組排程</strong>
            <small>{nextSchedule ? `下一筆 ${fmtDateTime(nextSchedule.startsAt)}` : "接下來沒有行程"}</small>
          </span>
          <span className="planner-jump-grid__metric"><em>{todayScheduleCount}</em><Icon name="ChevronRight" size={16} /></span>
        </button>
        <button type="button" onClick={() => revealPlannerSection("planner-notes")}>
          <span className="planner-jump-grid__icon notes"><Icon name="FileText" size={18} /></span>
          <span><strong>筆記與決議</strong><small>{noteCount ? `${noteCount} 份可追溯共用筆記` : "還沒有共用筆記"}</small></span>
          <span className="planner-jump-grid__metric"><em>{noteCount}</em><Icon name="ChevronRight" size={16} /></span>
        </button>
        <button type="button" onClick={() => revealPlannerSection("planner-knowledge-map")}>
          <span className="planner-jump-grid__icon map"><Icon name="Sparkles" size={18} /></span>
          <span><strong>知識地圖</strong><small>{linkedKnowledgeCount ? `${linkedKnowledgeCount} 筆已連回專案` : "把筆記排程連回專案"}</small></span>
          <span className="planner-jump-grid__metric"><em>{linkedKnowledgeCount}</em><Icon name="ChevronRight" size={16} /></span>
        </button>
      </nav>
      {/* key 綁組別：切換作用組時整卡重掛，表單草稿不會帶到別的組 */}
      <ScheduleCard
        key={`sch-${groupId}`}
        groupId={groupId}
        initiallyOpen={initialSections.schedule}
      />
      <NotesCard
        key={`note-${groupId}`}
        groupId={groupId}
        initiallyOpen={initialSections.notes}
      />
      <KnowledgeMapCard key={`map-${groupId}`} groupId={groupId} initiallyOpen={initialSections.knowledgeMap} />
      <p style={{ marginTop: 24 }}>
        <Link href="/dashboard">回今日工作台</Link>
      </p>
    </div>
  );
}
