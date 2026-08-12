import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { useMatchMedia } from "../lib/useMatchMedia";
import { registerAssistantFocus, registerAssistantPage } from "../lib/assistantContext";
import { useImmersive } from "../lib/useImmersive";
import { scrollIntoViewForChrome } from "../lib/scrollIntoViewForChrome";
import { Icon } from "../components/Icon";
import { CharCount, ConfirmButton } from "../components/interactions";
import { PlannerSection, plannerInitialSections } from "../components/PlannerSection";
import {
  buildKnowledgeBranches,
  LEAF_TOGGLES,
  type LeafKind,
  type MapGraphData,
  type MapLens,
  type MapNav,
} from "../components/knowledgeMapModel";
import { useLocalDraft } from "../useLocalDraft";
import { MentionInput, resolveMentions } from "../components/MentionInput";
import { AttachmentPanel } from "../components/AttachmentPanel";
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
/**
 * 行程分組標頭用的日期標籤。原本印 `toLocaleDateString("zh-TW")`＝「2026/8/7」，
 * 使用者得先自己算今天幾號才知道第一組是不是今天——這一頁的承諾是「今天要做什麼一眼就知道」，
 * 絕對日期做不到。今天／明天／昨天直接講人話，其餘給「8/12（週二）」，跨年才補上年份。
 */
export function dayLabel(d: Date, now: Date = new Date()): string {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target.getTime() - base.getTime()) / 86400000);
  const md = `${target.getMonth() + 1}/${target.getDate()}`;
  const wd = `週${"日一二三四五六"[target.getDay()]}`;
  if (diff === 0) return `今天・${md}（${wd}）`;
  if (diff === 1) return `明天・${md}（${wd}）`;
  if (diff === -1) return `昨天・${md}（${wd}）`;
  const year = target.getFullYear() === base.getFullYear() ? "" : `${target.getFullYear()}/`;
  return `${year}${md}（${wd}）`;
}
/** Date → datetime-local 的值（本地時區；toISOString 會偏移成 UTC） */
function toDatetimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth",
      block: "start",
    });
  });
}

export function PlannerPage({ groupId }: { groupId: string }) {
  // 全組協作：presence + 游標（組房 g:${groupId}）
  const collab = useCollab(groupId, !!groupId, "group");
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
  // 助手頁面感知：這一頁同時有行程與筆記，預設報行程；
  // 使用者打開某則筆記時，NotesCard 會把焦點翻成筆記（見下方 registerAssistantFocus）。
  useEffect(() => registerAssistantPage({ pageType: focusTarget?.startsWith("note-") ? "notes" : "schedule" }), [focusTarget]);
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
  const noteItems = Array.isArray(notesPreview.data) ? notesPreview.data : (notesPreview.data?.items ?? []);
  const noteCount = Array.isArray(notesPreview.data) ? noteItems.length : (notesPreview.data?.total ?? noteItems.length);
  const linkedKnowledgeCount = upcomingItems.filter((item) => item.projectId).length
    + noteItems.filter((note) => note.projectId).length;

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
          style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12, alignItems: "center" }}
        >
          <Hint as="span" style={{ margin: 0, fontSize: 12 }}>組內在線</Hint>
          {collab.peers.map((p) => (
            <Chip
              key={p.userId}
              style={{ margin: 0, background: p.color, color: "#fff", borderColor: p.color }}
              title={p.userId === collab.self?.userId ? "你" : p.name}
            >
              {p.userId === collab.self?.userId ? "你" : p.name}
            </Chip>
          ))}
        </div>
      )}

      {/* 跳轉列。原本是三張大卡（各約 150px 高，手機還要橫捲），但它們只做一件事：
          捲到下面那一段——而那三段就在同一個畫面裡。等於用掉整個第一屏換三顆捲動鈕，
          真正的行程與筆記反而被推到看不見的地方；卡片上的文案還被寬度截成
          「下一筆 2026/…」這種讀不出資訊的字。改成一列膠囊：跳轉照舊，只吃一行。 */}
      <nav className="planner-jump" aria-label="筆記排程功能">
        <button type="button" onClick={() => revealPlannerSection("planner-schedule")}>
          <Icon name="CalendarPlus" size={14} />組排程
          {todayScheduleCount > 0 && <em title="今天的行程數">今天 {todayScheduleCount}</em>}
        </button>
        <button type="button" onClick={() => revealPlannerSection("planner-notes")}>
          <Icon name="FileText" size={14} />筆記與決議
          {noteCount > 0 && <em title="共用筆記份數">{noteCount}</em>}
        </button>
        <button type="button" onClick={() => revealPlannerSection("planner-knowledge-map")}>
          <Icon name="Sparkles" size={14} />知識地圖
          {linkedKnowledgeCount > 0 && <em title="已連回專案的筆記與行程數">{linkedKnowledgeCount}</em>}
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
    <a href={`/api/schedule/${groupId}/calendar.ics`} download className="m-touch" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Icon name="Download" size={14} />匯出 .ics
    </a>
  );

  const st = status.data;
  if (!st) return icsFallback; // 載入中（或查詢失敗）：先給後備匯出，不擋操作
  if (!st.configured) {
    return (
      <>
        {icsFallback}
        <Hint as="span" style={{ margin: 0 }}>
          系統尚未設定 Google 日曆連線，目前不會自動同步；請下載 .ics 匯入個人日曆，內容更新後需重新下載
        </Hint>
      </>
    );
  }
  if (!st.connected) {
    return (
      <>
        <a href="/api/google/oauth/start" className="m-touch" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="CalendarPlus" size={14} />連結 Google 日曆（自動同步）
        </a>
        <Meta style={{ margin: 0 }}>{flash ?? "連結後排程增刪改自動出現在你的 Google 日曆，免匯出匯入"}</Meta>
        {icsFallback}
      </>
    );
  }
  if (st.status === "error") {
    return (
      <>
        <Meta style={{ margin: 0, color: "var(--danger, #b3261e)" }} title={st.lastError ?? undefined}>
          Google 日曆授權已失效
        </Meta>
        <a href="/api/google/oauth/start" className="m-touch" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="CalendarPlus" size={14} />重新連結
        </a>
      </>
    );
  }
  const lastSync = st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString("zh-TW") : "排入佇列中";
  return (
    <>
      <Meta style={{ margin: 0 }} title={`最後同步：${lastSync}${st.lastError ? `；上次錯誤：${st.lastError}` : ""}`}>
        <Icon name="CalendarPlus" size={13} /> 已連結 Google 日曆{st.googleEmail ? `（${st.googleEmail}）` : ""}・自動同步中
      </Meta>
      {flash && <Meta style={{ margin: 0 }}>{flash}</Meta>}
      <Button size="sm" onClick={() => syncNow.mutate()} disabled={syncNow.isPending} title="平常不用按：增刪改會自動同步；這顆給想立即確認的人">
        {syncNow.isPending ? "同步中…" : "立即同步"}
      </Button>
      {syncNow.isError && <Meta style={{ margin: 0, color: "var(--danger, #b3261e)" }}>{syncNow.error.message}</Meta>}
      <ConfirmButton
        onConfirm={() => disconnect.mutate()}
        title="中斷 Google 日曆連結？"
        message="會撤銷授權並移除你 Google 帳戶裡的「Aios・組排程」日曆（系統內排程不受影響）。"
        confirmLabel="中斷連結"
        disabled={disconnect.isPending}
        triggerClassName="btn-sm"
      >
        中斷連結
      </ConfirmButton>
    </>
  );
}

function ScheduleCard({ groupId, initiallyOpen }: { groupId: string; initiallyOpen: boolean }) {
  const utils = trpc.useUtils();
  const [sectionOpen, setSectionOpen] = useState(initiallyOpen);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [includePast, setIncludePast] = useState(false);
  // 手機減負：六欄新增表單先收成一顆「＋ 新增行程」，清單優先（桌機維持常駐表單）
  const compact = useMatchMedia("(max-width: 820px)");
  const [createOpen, setCreateOpen] = useState(false);
  // 手機再減一層：展開後仍有六欄堆成六列，但「排一筆會議」只需要標題＋開始時間。
  // 結束／專案／備註收進「其他欄位」，要用的人再展開。
  const [moreFields, setMoreFields] = useState(false);
  // 同步設定的摘要（與 GoogleCalendarBar 同一個 query key，react-query 只會打一次）
  const syncStatus = trpc.googleCalendar.status.useQuery();
  const [syncOpen, setSyncOpen] = useState(false);
  // 授權失效＝同步已經默默停掉，這種要處理的狀態不能藏在摺疊裡
  useEffect(() => {
    if (syncStatus.data?.status === "error") setSyncOpen(true);
  }, [syncStatus.data?.status]);
  const syncSummary = !syncStatus.data
    ? "檢查中…"
    : syncStatus.data.status === "error"
      ? "Google 授權已失效，需重新連結"
      : syncStatus.data.connected
        ? "已連結 Google 日曆・自動同步中"
        : syncStatus.data.configured
          ? "尚未連結 Google 日曆"
          : "可匯出 .ics 匯入個人日曆";
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

  // 點月曆日期 → 預填開始時間、展開表單、捲到表單並聚焦標題（連續加多筆時保留已輸入的標題／備註）
  const formRef = useRef<HTMLDivElement | null>(null);
  const prefillFromDay = (day: Date): void => {
    const now = new Date();
    let start: Date;
    if (dayKey(day) === dayKey(now)) {
      // 今天：從「現在 +30 分」起跳並進位到整點或半點，免得預設時間已經過去
      start = new Date(now.getTime() + 30 * 60 * 1000);
      start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
    } else {
      start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0);
    }
    setStartAt(toDatetimeLocal(start));
    setEndAt("");
    setCreateOpen(true);
    // 尊重 prefers-reduced-motion（同檔 revealPlannerSection 的既有寫法；顯式 smooth 蓋不掉 CSS 開關）
    formRef.current?.scrollIntoView({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth",
      block: "center",
    });
    // 表單在手機是收合的，展開要等一次 render；捲動動畫結束後才聚焦，才不會被捲走
    setTimeout(() => {
      document.querySelector<HTMLElement>('[aria-label="排程標題"]')?.focus?.();
    }, 280);
  };

  // 桌機照舊全欄常駐；手機只在使用者主動展開、或那些欄位已經有值時才攤開
  const showAllFields = !compact || moreFields || !!endAt || !!projectId || !!note;
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

  // 依日期分組（list 已按 startsAt 升冪，同一天必相鄰，掃一遍即可）。
  // 分組身分用 dayKey（跨年同月同日不會撞在一起），顯示才換成「今天／明天」的人話標籤。
  const groups: Array<{ key: string; label: string; items: ScheduleItem[] }> = [];
  for (const ev of items) {
    const at = new Date(ev.startsAt);
    const key = dayKey(at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(ev);
    else groups.push({ key, label: dayLabel(at), items: [ev] });
  }

  return (
    <PlannerSection
      open={sectionOpen}
      onOpenChange={setSectionOpen}
      analyticsLabel="排程卡"
      contentId="planner-schedule-content"
      title="組排程"
      lede="安排全組行程、切換清單／月曆與管理日曆同步"
      primary
    >
        {/* 工具列一行搞定：檢視切換＋清單過濾（＋精簡模式下的「說明」小鈕）。
            過去這裡只有靠右的切換鈕獨佔一行，說明鈕、過去行程開關、日曆設定各自再吃一行。 */}
        <div className="planner-toolbar">
          <div className="seg" role="tablist" aria-label="排程檢視">
          <button
            role="tab"
            aria-selected={view === "list"}
            tabIndex={view === "list" ? 0 : -1}
            data-schedule-view="list"
            className={view === "list" ? "on" : ""}
            onClick={() => setView("list")}
            onKeyDown={(event) => {
              const next = nextTabValue(["list", "calendar"] as const, "list", event.key);
              if (!next) return;
              event.preventDefault();
              setView(next);
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-schedule-view="${next}"]`)?.focus();
            }}
          >
            <Icon name="FileText" size={13} /> 清單
          </button>
          <button
            role="tab"
            aria-selected={view === "calendar"}
            tabIndex={view === "calendar" ? 0 : -1}
            data-schedule-view="calendar"
            className={view === "calendar" ? "on" : ""}
            onClick={() => setView("calendar")}
            onKeyDown={(event) => {
              const next = nextTabValue(["list", "calendar"] as const, "calendar", event.key);
              if (!next) return;
              event.preventDefault();
              setView(next);
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-schedule-view="${next}"]`)?.focus();
            }}
          >
            <Icon name="CalendarPlus" size={13} /> 月曆
          </button>
          </div>
          {view === "list" && (
            <label className="planner-toolbar__filter" title="預設只顯示未來與最近 24 小時內的行程">
              <input type="checkbox" checked={includePast} onChange={(e) => setIncludePast(e.target.checked)} />
              顯示過去行程
            </label>
          )}
          <Hint>拍攝、開會、上片時間都排在這裡，全組看同一份，不再翻對話記錄找時間。</Hint>
        </div>

      {/* 新增列：手機預設收合（清單優先，展開才吃半屏高度）；桌機常駐 */}
      {compact && !createOpen && (
        <Button
          variant="primary"
          style={{ width: "100%", justifyContent: "center", marginTop: 12 }}
          aria-expanded={false}
          aria-controls="schedule-create-form"
          onClick={() => setCreateOpen(true)}
        >
          <Icon name="CalendarPlus" size={14} /> 新增行程
        </Button>
      )}
      {(!compact || createOpen) && (
      <div ref={formRef} id="schedule-create-form" className="schedule-create-form" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 4 }}>
        <div className="schedule-create-form__title" style={{ flex: "2 1 200px", minWidth: 160 }}>
          <label htmlFor="sch-title">標題（可 @ 提及夥伴）</label>
          <MentionInput value={title} onChange={setTitle} members={members} maxLength={120}
            ariaLabel="排程標題" placeholder="例：週會・腳本審稿（@人 可通知）" onEnter={submit} />
        </div>
        <div className="schedule-create-form__start" style={{ flex: "1 1 185px" }}>
          <label htmlFor="sch-start">開始（必填）</label>
          <input id="sch-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </div>
        {showAllFields && (
        <div className="schedule-create-form__end" style={{ flex: "1 1 185px" }}>
          <label htmlFor="sch-end">結束（選填）</label>
          <input id="sch-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </div>
        )}
        {showAllFields && (
        <div className="schedule-create-form__project" style={{ flex: "1 1 150px" }}>
          <label htmlFor="sch-project">掛在專案（選填）</label>
          <select id="sch-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">不掛專案</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </div>
        )}
        {showAllFields && (
        <div className="schedule-create-form__note" style={{ flex: "2 1 180px" }}>
          <label htmlFor="sch-note">備註（選填）</label>
          <input id="sch-note" value={note} maxLength={500} placeholder="例：地點、要先準備什麼" onChange={(e) => setNote(e.target.value)} />
        </div>
        )}
        {/* 排一筆會議真正必要的只有標題＋開始時間。手機上六欄堆成六列＝整個視窗都是表單，
            其餘三欄收在這顆按鈕後面（有填過內容就不收，免得使用者以為自己打的字不見了）。 */}
        {compact && !showAllFields && (
          <button
            type="button"
            className="schedule-create-form__more"
            aria-expanded={false}
            onClick={() => setMoreFields(true)}
          >
            <Icon name="ChevronDown" size={13} />結束時間・專案・備註
          </button>
        )}
        <button className="primary schedule-create-form__submit" style={{ flex: "none" }} disabled={!canAdd} onClick={submit}>
          {add.isPending ? "加入中…" : "加入"}
        </button>
        {compact && (
          <Button variant="ghost" style={{ flex: "none" }} onClick={() => setCreateOpen(false)}>收合</Button>
        )}
        {addDisabledReason && <Hint as="span" style={{ alignSelf: "center" }}>{addDisabledReason}</Hint>}
      </div>
      )}
      {/* 結束早於開始屬輸入錯誤：用 .error 樣式即時顯示，別讓人當成普通提示忽略 */}
      {endInvalid && <p className="error" role="alert" style={{ marginTop: 6 }}>結束時間要晚於開始時間</p>}
      {add.error && <p className="error">{add.error.message}</p>}

      {/* 內容區：清單 or 月曆 */}
      {list.isLoading ? (
        <div style={{ marginTop: 12 }} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="gen-row">
              <Skeleton style={{ height: 14 }} />
            </div>
          ))}
        </div>
      ) : list.error ? (
        <p className="error">{list.error.message}</p>
      ) : view === "calendar" ? (
        <CalendarView items={items} projectTitleOf={projectTitleOf} onDelete={(id) => remove.mutate({ id })} removing={remove.isPending} onDayClick={prefillFromDay} />
      ) : groups.length === 0 ? (
        <EmptyState icon={<Icon name="CalendarPlus" />} title={<>{includePast ? "還沒有任何行程" : "接下來沒有排程"}</>} description={<>用上面的欄位加第一筆——開會、拍攝、上片都行。</>} style={{ marginTop: 12 }} />
      ) : (
        <div style={{ marginTop: 8 }}>
          {groups.map((g) => (
            <div key={g.key} style={{ marginTop: 10 }}>
              <h3 className="planner-day-head">{g.label}</h3>
              {g.items.map((ev) => {
                const projTitle = projectTitleOf(ev.projectId);
                return (
                  <div key={ev.id} id={`schedule-${ev.id}`} className="gen-row gen-row--schedule" style={{ alignItems: "center" }}>
                    <span className="mono" style={{ fontSize: "var(--fs-12)", whiteSpace: "nowrap" }}>
                      <Icon name="Clock" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                      {fmtTime(ev.startsAt)}
                      {ev.endsAt ? `–${fmtTime(ev.endsAt)}` : ""}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "var(--fs-14)", fontWeight: 600 }}>
                        {ev.title}
                        {projTitle && <Chip style={{ margin: "0 0 0 8px" }}>{projTitle}</Chip>}
                        {ev.mentions?.length ? <Chip style={{ margin: "0 0 0 6px" }} title="有 @提及夥伴"><Icon name="Bell" size={11} style={{ verticalAlign: "-1px" }} /> {ev.mentions.length}</Chip> : null}
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
                      {ev.planRunId && ev.projectId && (
                        <Link href={`/p/${ev.projectId}?focus=agent-run-${ev.planRunId}`} className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 4, margin: "2px 0 0 8px" }}>
                          <Icon name="Sparkles" size={11} />由 AI 計畫建立／更新・回到計畫
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
        <Meta as="p" role="alert" style={{ color: "var(--gold-ink)", marginTop: 8 }}>
          ⚠ 行程超過單頁上限（300 筆），較晚的行程未顯示——可用專案篩選或刪除過期行程縮小範圍
        </Meta>
      )}
      {remove.error && <p className="error">{remove.error.message}</p>}

      {/* 行事曆同步與匯出：這是「設定一次」的東西，卻擺在行程清單上方——每次進來都要先
          捲過一整段帳號設定（連結 Google／說明文案／匯出 .ics）才看得到今天要做什麼。
          收成摺疊、移到清單下方，狀態直接寫在摘要行；只有授權失效（同步已默默停掉）才自動展開。 */}
      <details className="planner-sync" open={syncOpen} onToggle={(e) => setSyncOpen(e.currentTarget.open)}>
        <summary>
          <Icon name="CalendarPlus" size={14} />
          <span>行事曆同步與匯出</span>
          <Meta as="span" style={{ margin: 0 }}>{syncSummary}</Meta>
        </summary>
        <div className="planner-sync-bar" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <GoogleCalendarBar groupId={groupId} />
        </div>
      </details>
    </PlannerSection>
  );
}

/** 月曆檢視：真正的月份網格（週日起始），行程落在各自那天；點某天在下方展開當日行程。 */
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
  /** 點格子＝在下方表單預填那天並聚焦，空白日也能直接開排 */
  onDayClick: (day: Date) => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // ≤820：點「有行程的日子」只展開下方當日清單，不再直接 prefill 表單
  //（原行為會展開表單＋smooth 捲走＋聚焦標題，Android 立刻彈鍵盤——
  // 手機上想「看某天行程」被表單搶走視角）。桌機行為不變。
  const compact = useMatchMedia("(max-width: 820px)");

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
              onClick={() => {
                setSelectedKey(evs.length ? k : null);
                if (compact && evs.length) {
                  requestAnimationFrame(() => {
                    scrollIntoViewForChrome(document.getElementById("cal-day-list"));
                  });
                  return;
                }
                onDayClick(dt);
              }}
              aria-label={`${dt.getMonth() + 1}/${dt.getDate()}${evs.length ? `，${evs.length} 筆行程，${compact ? "點此查看" : "點此新增"}` : "，點此新增行程"}`}
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
                {evs.length === 0 && inMonth && <span className="cal-more" style={{ opacity: 0.45 }}>＋ 新增</span>}
              </span>
            </button>
          );
        })}
      </div>

      {/* 選定某天 → 展開當日全部行程（含刪除、回連） */}
      {selectedKey && selectedItems.length > 0 && (
        <div id="cal-day-list" style={{ marginTop: 10 }}>
          <h3 className="planner-day-head">
            {dayLabel(new Date(selectedItems[0].startsAt))}・{selectedItems.length} 筆
          </h3>
          {/* compact 才渲染：手機點有行程的日子不再直達表單，新增入口改在這裡（桌機 DOM 不變） */}
          {compact && (
            <Button
              size="sm"
              variant="ghost"
              type="button"
              style={{ margin: "2px 0 4px" }}
              onClick={() => onDayClick(new Date(selectedItems[0].startsAt))}
            >
              <Icon name="Clock" size={13} style={{ marginRight: 4 }} />＋在這天新增行程
            </Button>
          )}
          {selectedItems.map((ev) => {
            const projTitle = projectTitleOf(ev.projectId);
            return (
              <div key={ev.id} id={`schedule-${ev.id}`} className="gen-row gen-row--schedule" style={{ alignItems: "center" }}>
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
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── (2) 筆記・會議紀錄（可從知識庫匯入） ─────────────────────── */

function NotesCard({ groupId, initiallyOpen }: { groupId: string; initiallyOpen: boolean }) {
  const utils = trpc.useUtils();
  const [sectionOpen, setSectionOpen] = useState(initiallyOpen);
  const list = trpc.notes.list.useQuery({ groupId });
  const projects = trpc.projects.list.useQuery({ groupId });
  const members = trpc.projects.groupMembers.useQuery({ groupId }).data ?? [];

  // 表單（新增／編輯共用）：editingId 有值＝編輯模式，全文以 notes.get 載入後才可改
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // 正在編輯的那則筆記＝使用者當下指涉的對象（「這則幫我轉成任務」）
  useEffect(
    () => (editingId ? registerAssistantFocus({ pageType: "notes", entityType: "note", entityId: editingId }) : undefined),
    [editingId],
  );
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
  // 表單移到清單上方之後，從下面某一列按「編輯」得把視角帶回表單，否則看起來像沒反應
  const formRef = useRef<HTMLDivElement | null>(null);
  const revealForm = () => {
    requestAnimationFrame(() => scrollIntoViewForChrome(formRef.current));
  };
  const openEdit = (n: { id: string; title: string; projectId: string | null }) => {
    seededRef.current = false;
    setEditingId(n.id);
    setProjectId(n.projectId ?? "");
    setFormOpen(true);
    revealForm();
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

  // 筆記清單原本沒有任何搜尋——三個月的會議紀錄堆起來只能一列一列往下看。
  // 標題與摘要都比對（摘要就是內文開頭，找「那次講到分鏡的會」靠的是它）。
  const notes = (Array.isArray(list.data) ? list.data : list.data?.items ?? []) as NoteItem[];
  const notesTruncated = !Array.isArray(list.data) && !!list.data?.truncated;
  const notesTotal = Array.isArray(list.data) ? notes.length : (list.data?.total ?? notes.length);
  // 一次只展開一則的附件區：附件查詢是每則一支，全部常駐會在筆記一多時打爆後端
  const [openAttachments, setOpenAttachments] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? notes.filter((n) => `${n.title} ${n.excerpt}`.toLowerCase().includes(needle))
    : notes;

  return (
    <PlannerSection
      open={sectionOpen}
      onOpenChange={setSectionOpen}
      analyticsLabel="筆記卡"
      contentId="planner-notes-content"
      title="筆記・會議紀錄"
      lede="集中會議決議、待辦與可追溯版本的共用筆記"
    >
      {/* 新增與搜尋擺在清單上方。原本「新增筆記」在整份清單的最底下——筆記一多就得先捲過
          所有紀錄才加得了一則；而清單本身沒有搜尋，要找「上次講到分鏡的那場會」只能一列一列看。 */}
      <div className="planner-toolbar">
        {!formOpen && (
          <Button variant="primary" size="sm" onClick={openNew}>
            <Icon name="Plus" size={14} />新增筆記
          </Button>
        )}
        {notes.length > 4 && (
          <span className="map-search">
            <Icon name="Search" size={14} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋標題或內容…"
              aria-label="搜尋筆記"
            />
            {query && <Button variant="ghost" size="sm" onClick={() => setQuery("")} aria-label="清除搜尋">清除</Button>}
          </span>
        )}
        <Hint>會議決議、待辦、想法都記在這裡，全組共用；內容更新會自動保留版本快照，不怕改壞。可從專案知識庫一鍵匯入既有內容。</Hint>
        {notesTruncated && (
          <Hint>筆記超過單頁上限，只顯示最近 {notes.length} / {notesTotal.toLocaleString()} 則，不能把這頁當成全部。</Hint>
        )}
      </div>

      {formOpen && (
        <div ref={formRef} style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
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
          <Hint style={{ marginTop: 4 }}>（編輯中的內容會自動暫存在本機——切組、重整、手機切換都不會不見）</Hint>

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

          {/* 附件：新增時還沒有筆記 id 可掛，儲存後從清單列的「附件」加 */}
          {editingId ? (
            <>
              <label>附件（照片、PDF、Word…）</label>
              <AttachmentPanel
                kind="note"
                refId={editingId}
                onChanged={() => utils.notes.list.invalidate({ groupId })}
              />
            </>
          ) : (
            <Hint style={{ marginTop: 8 }}>要夾白板照片或講義 PDF？先儲存這則筆記，再從清單上的「附件」加。</Hint>
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
          {editingId && <Hint style={{ marginTop: 4 }}>內容更新會自動保留版本快照</Hint>}
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="primary" disabled={!canSave} onClick={save}>
              {saving ? "儲存中…" : "儲存"}
            </button>
            <button onClick={closeForm}>取消</button>
            {!canSave && !saving && (
              <Meta>
                {!contentReady ? "全文載入中…" : !title.trim() ? "先填標題" : !content.trim() ? "先填內容" : ""}
              </Meta>
            )}
          </div>
          {(add.error || update.error || full.error) && (
            <p className="error">{add.error?.message ?? update.error?.message ?? full.error?.message}</p>
          )}
        </div>
      )}

      {list.isLoading ? (
        <div style={{ marginTop: 8 }} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="gen-row">
              <Skeleton style={{ height: 14 }} />
            </div>
          ))}
        </div>
      ) : list.error ? (
        <p className="error">{list.error.message}</p>
      ) : filtered.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          {filtered.map((n) => {
            const projTitle = projectTitleOf(n.projectId);
            const attachOpen = openAttachments === n.id;
            return (
              <div key={n.id} id={`note-${n.id}`} className="gen-row gen-row--note" style={{ alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-14)", fontWeight: 600 }}>
                    {n.title}
                    {projTitle && <Chip style={{ margin: "0 0 0 8px" }}>{projTitle}</Chip>}
                    {n.mentions?.length ? <Chip style={{ margin: "0 0 0 6px" }} title="有 @提及夥伴"><Icon name="Bell" size={11} style={{ verticalAlign: "-1px" }} /> {n.mentions.length}</Chip> : null}
                    {n.attachmentCount > 0 && (
                      <Chip style={{ margin: "0 0 0 6px" }} title={`夾了 ${n.attachmentCount} 個附件`}>
                        <Icon name="Paperclip" size={11} style={{ verticalAlign: "-1px" }} /> {n.attachmentCount}
                      </Chip>
                    )}
                  </div>
                  <div className="meta">{n.excerpt}{n.chars > n.excerpt.length ? "…" : ""}（{n.chars.toLocaleString()} 字）</div>
                  <div className="meta">{fmtDateTime(n.updatedAt)} 更新・{n.creatorName}</div>
                  {n.sourceMessageId && n.projectId && (
                    <Link href={`/p/${n.projectId}`} className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                      <Icon name="MessageCircle" size={11} />來自留言
                    </Link>
                  )}
                  {n.planRunId && n.projectId && (
                    <Link href={`/p/${n.projectId}?focus=agent-run-${n.planRunId}`} className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 4, margin: "2px 0 0 8px" }}>
                      <Icon name="Sparkles" size={11} />由 AI 計畫建立／更新・回到計畫
                    </Link>
                  )}
                  {/* 附件（照片／PDF）預設收合：一次展開一則，避免 200 則筆記各發一支查詢 */}
                  {attachOpen && (
                    <AttachmentPanel
                      kind="note"
                      refId={n.id}
                      compact
                      onChanged={() => utils.notes.list.invalidate({ groupId })}
                    />
                  )}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <Button
                    size="sm"
                    aria-expanded={attachOpen}
                    title="加照片、PDF 等附件"
                    onClick={() => setOpenAttachments(attachOpen ? null : n.id)}
                  >
                    <Icon name="Paperclip" size={13} />附件{n.attachmentCount > 0 ? ` ${n.attachmentCount}` : ""}
                  </Button>
                  <Button size="sm" onClick={() => openEdit(n)}>編輯</Button>
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
      ) : needle ? (
        <EmptyState
          icon={<Icon name="Search" />}
          title={<>找不到「{query.trim()}」</>}
          description={<>這個組有 {notes.length} 份筆記，換個關鍵字或清除搜尋再看一次。</>}
          style={{ marginTop: 8 }}
        />
      ) : (
        <EmptyState icon={<Icon name="FileText" />} title={<>還沒有筆記</>} description={<>開完會記一份，決議和待辦全組都看得到。</>} style={{ marginTop: 8 }} />
      )}
      {remove.error && <p className="error">{remove.error.message}</p>}

    </PlannerSection>
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
      <Button size="sm"
        type="button"
        style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }}
        disabled={disabled || projects.length === 0}
        title={projects.length === 0 ? "這個組還沒有專案知識庫可匯入" : undefined}
        onClick={() => setOpen(true)}>
        <Icon name="Sparkles" size={13} />從知識庫匯入
      </Button>
    );
  }
  return (
    <div style={{ marginTop: 8, border: "1px solid var(--border-soft)", borderRadius: "var(--r-12)", padding: "var(--sp-12)", background: "var(--card2)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Icon name="Sparkles" size={13} style={{ color: "var(--primary-ink)" }} />
        <strong style={{ fontSize: "var(--fs-13)" }}>從知識庫匯入</strong>
        <Button variant="ghost" size="sm" type="button" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)}>收合</Button>
      </div>
      <Hint style={{ marginTop: 4 }}>選一個專案的知識（開示稿／見證／腳本…），把全文附加到這則筆記的內容尾端。</Hint>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 6 }}>
        <div style={{ flex: "1 1 180px" }}>
          <label htmlFor="kb-attach-project">專案</label>
          <select id="kb-attach-project" value={pid} onChange={(e) => { setPid(e.target.value); setKid(""); }}>
            <option value="">選專案…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: "2 1 220px" }}>
          <label htmlFor="kb-attach-knowledge">知識</label>
          <select id="kb-attach-knowledge" value={kid} disabled={!pid || kb.isLoading} onChange={(e) => setKid(e.target.value)}>
            <option value="">{!pid ? "先選專案" : kb.isLoading ? "載入中…" : (kb.data?.length ?? 0) === 0 ? "此專案沒有知識" : "選一筆知識…"}</option>
            {(kb.data ?? []).map((k) => (
              <option key={k.id} value={k.id}>{k.title}（{k.chars.toLocaleString()} 字）</option>
            ))}
          </select>
        </div>
        <Button size="sm" variant="primary" type="button" disabled={!kid || busy || disabled} onClick={doImport}>
          {busy ? "匯入中…" : "匯入到內容"}
        </Button>
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

/* ─────────────────────── (3) 知識地圖・心智圖（知識族譜） ─────────────────────── */

type MapSelection = { label: string; sub: string; nav: MapNav };

/** 兩種檢視：清單（大綱，手機預設）與心智圖（放射圖，桌機預設） */
type MapView = "list" | "map";

/** 清單每支分支先展開幾列，其餘按「顯示其餘 N 個」續載——一次倒 200 列出來沒人捲得完 */
const LIST_PAGE = 8;
/** 心智圖畫得下的分支數／每支葉數；超過的分別由「另有 N 支」與「+N」節點交棒給清單 */
const MAP_MAX_BRANCHES = 10;
const MAP_MAX_LEAVES = 6;
/** 全螢幕時掛在 <body>：全站浮動殼層（頂欄、分頁列、私訊球、回饋浮標）讓開 */
const MAP_IMMERSIVE_BODY_CLASS = "map-immersive";
/** 縮放範圍。下限壓到 0.25：全螢幕在手機直向只有 ~360px 寬，要裝下 920 寬的圖得縮到 0.4 以下 */
const MAP_MIN_SCALE = 0.25;
const MAP_MAX_SCALE = 2.5;

const isMapView = (v: string | null): v is MapView => v === "list" || v === "map";

/**
 * 知識地圖（知識族譜）：中心＝這個組，往外一圈是「專案／組層級／資料庫」分支，
 * 再往外是掛在其下的筆記（藍）、行程（琥珀）、知識（綠）、AI 助手（紫）與資料庫（青）。
 * 資料吃後端聚合端點 knowledgeMap.graph（一次撈齊六類、全帶組隔離與資料庫 ACL），
 * 過濾與分支組裝在 knowledgeMapModel（純函式、可測），本元件只做檢視、佈局與導航。
 *
 * 兩種檢視吃同一棵樹：
 * - **清單**：分支收合式大綱，一列一個節點、點一下直接到那筆——手機預設。
 *   920×560 的放射圖在 360px 螢幕上等比縮到 0.39x，文字剩 4px、節點剩 2px；
 *   放大成 720px 再橫捲又會開在整片空白的左緣（中心節點在畫布正中央）。
 *   要在手機上「找到某一筆」，清單才是能用的形狀。
 * - **心智圖**：看關聯用的鳥瞰圖，桌機預設；可拖拉排版、縮放、平移。
 * 搜尋、鏡頭、專案聚焦與型別開關對兩種檢視同時生效。
 */
export function KnowledgeMapCard({ groupId, initiallyOpen }: { groupId: string; initiallyOpen: boolean }) {
  const [, setLocation] = useLocation();
  const [sectionOpen, setSectionOpen] = useState(initiallyOpen);
  const compact = useMatchMedia("(max-width: 820px)");
  const me = trpc.auth.me.useQuery();
  const meId = me.data?.user.id ?? "";
  const graphQ = trpc.knowledgeMap.graph.useQuery({ groupId });

  const [lens, setLensRaw] = useState<MapLens>("all");
  const [focusProject, setFocusProjectRaw] = useState(""); // ""＝全部專案
  const [types, setTypes] = useState<Record<LeafKind, boolean>>({ note: true, schedule: true, knowledge: true, agent: true, db: true });
  const [query, setQueryRaw] = useState("");
  const [selected, setSelected] = useState<MapSelection | null>(null);
  // 檢視偏好記在這台裝置：手機預設清單、桌機預設心智圖（改過就以使用者選的為準）
  const viewStoreKey = `map-view-${groupId}`;
  const [viewMode, setViewModeRaw] = useState<MapView>(() => {
    try {
      const saved = localStorage.getItem(viewStoreKey);
      if (isMapView(saved)) return saved;
    } catch {
      /* 無痕模式讀不到就用預設 */
    }
    return compact ? "list" : "map";
  });
  // 清單檢視：哪些分支展開（未指定者用預設規則）、每支已顯示幾列
  const [openBranches, setOpenBranches] = useState<Record<string, boolean>>({});
  const [listLimits, setListLimits] = useState<Record<string, number>>({});

  // 換鏡頭／聚焦／開關型別時把選取清掉——面板殘留上一個視角的節點會誤導
  const setLens = (v: MapLens) => { setLensRaw(v); setSelected(null); };
  const setFocusProject = (v: string) => { setFocusProjectRaw(v); setSelected(null); };
  const toggleType = (k: LeafKind) => { setTypes((t) => ({ ...t, [k]: !t[k] })); setSelected(null); };
  // 換關鍵字時連「哪支展開／展開幾列」一起歸零：留著上一輪的收合狀態會把搜到的結果藏起來
  const setQuery = (v: string) => { setQueryRaw(v); setSelected(null); setOpenBranches({}); setListLimits({}); };
  const setViewMode = (v: MapView) => {
    setViewModeRaw(v);
    setSelected(null);
    try {
      localStorage.setItem(viewStoreKey, v);
    } catch {
      /* 存不了就只在本次會話生效 */
    }
  };

  const data = graphQ.data as MapGraphData | undefined;

  const graph = useMemo(
    () => (data ? buildKnowledgeBranches(data, { meId, lens, focusProject, types, query, fmtDateTime }) : null),
    [data, lens, focusProject, types, query, meId],
  );

  /** 心智圖畫得下的部分：分支取前 10 支（資料庫分支固定保留一席），其餘交給清單 */
  const mapBranches = useMemo(() => {
    if (!graph) return null;
    const dbBranch = graph.branches.find((b) => b.kind === "dbhub");
    const content = graph.branches.filter((b) => b.kind !== "dbhub");
    const cap = dbBranch ? MAP_MAX_BRANCHES - 1 : MAP_MAX_BRANCHES;
    return {
      shownBranches: [...content.slice(0, cap), ...(dbBranch ? [dbBranch] : [])],
      hiddenBranchCount: Math.max(0, content.length - cap),
    };
  }, [graph]);

  // 佈局幾何（固定 viewBox，SVG 依容器寬縮放）
  const W = 920;
  const H = 560;
  const cx = W / 2;
  const cy = H / 2;
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

  const layout = useMemo(() => {
    if (!mapBranches) return null;
    const { shownBranches } = mapBranches;
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
    // 邊記「兩端節點 id」而非座標：節點被拖走時，邊在渲染期跟著節點的有效位置走
    const edges: Array<{ from: string; to: string; kind: "branch" | "leaf" }> = [];
    nodes.push({ id: "group", type: "group", label: "本組", x: cx, y: cy });
    if (B === 0) return { nodes, edges };
    shownBranches.forEach((b, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / B;
      const bx = cx + RB * Math.cos(a);
      const by = cy + RB * Math.sin(a);
      edges.push({ from: "group", to: `b-${b.key}`, kind: "branch" });
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
      const shownLeaves = b.leaves.slice(0, MAP_MAX_LEAVES);
      const extra = b.leaves.length - shownLeaves.length;
      const total = shownLeaves.length + (extra > 0 ? 1 : 0);
      const fan = Math.min(Math.PI * 0.7, 0.36 * Math.max(1, total)); // 扇形總開角
      // 相鄰葉一近一遠交錯（差 RING）：同半徑排排站時，標籤（最長 11 字 ≈ 80px）
      // 會蓋掉隔壁那顆的字——扇形只隔開了節點，沒隔開節點上方的文字。
      const RING = 34;
      const leafPos = (j: number) => {
        const off = total > 1 ? -fan / 2 + (fan * j) / (total - 1) : 0;
        const la = a + off;
        const r = RL + (j % 2 === 1 ? RING : 0);
        return { lx: cx + r * Math.cos(la), ly: cy + r * Math.sin(la) };
      };
      shownLeaves.forEach((leaf, j) => {
        const { lx, ly } = leafPos(j);
        edges.push({ from: `b-${b.key}`, to: leaf.id, kind: "leaf" });
        nodes.push({ id: leaf.id, type: leaf.kind, label: clip(leaf.label, 11), x: lx, y: ly, selection: { label: leaf.label, sub: leaf.sub, nav: leaf.nav } });
      });
      if (extra > 0) {
        const { lx, ly } = leafPos(shownLeaves.length);
        edges.push({ from: `b-${b.key}`, to: `more-${b.key}`, kind: "leaf" });
        nodes.push({
          id: `more-${b.key}`,
          type: "more",
          label: `+${extra}`,
          x: lx,
          y: ly,
          // 以前這裡只是一句「請進來源頁看全部」的死路；現在按下去會切到清單並展開這一支
          selection: {
            label: `${b.label}：還有 ${extra} 個節點`,
            sub: `心智圖每支最多畫 ${MAP_MAX_LEAVES} 片葉子，切到清單可看完整 ${b.leaves.length} 筆`,
            nav: { type: "branch", key: b.key },
          },
        });
      }
    });
    return { nodes, edges };
  }, [mapBranches]);

  /* ── 自由拖拉（創作者可自行排版）──
   * - 節點拖拉：存「相對自動佈局的偏移量」（不是絕對座標）——資料增減、換鏡頭後
   *   自動佈局變了，已拖過的節點仍保持使用者給它的相對位移；per 組存 localStorage。
   * - 畫布：空白處拖曳平移（滑鼠）、滾輪／按鈕縮放；觸控裝置保留頁面捲動，用按鈕縮放＋拖節點。
   * - 拖完的 click 不當「選取」：以移動距離 >4px 區分拖與點。 */
  const layoutStoreKey = `map-layout-${groupId}`;
  const [overrides, setOverrides] = useState<Record<string, { dx: number; dy: number }>>(() => {
    try {
      const raw = localStorage.getItem(layoutStoreKey);
      return raw ? (JSON.parse(raw) as Record<string, { dx: number; dy: number }>) : {};
    } catch {
      return {};
    }
  });
  const [view, setView] = useState({ tx: 0, ty: 0, s: 1 });
  // 使用者自己縮放／平移過就別再自動套「剛好裝滿」的檢視——那會把他調好的視角搶回去
  const [viewTouched, setViewTouched] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);

  /* ── 全螢幕（沉浸）──
   * 卡片裡的族譜在手機上只有一小塊：等比縮到 0.39x 後字剩 4px、節點剩 2px，
   * 35 個節點糊成一團——這張圖真正能看的前提是「攤開整個視窗」。
   * 原生 Fullscreen API ＋ CSS 沉浸兩層（iOS Safari 沒有前者，見 lib/useImmersive）。
   * 搜尋、篩選與檢視切換一起帶進全螢幕，進去以後才不用退出來才能換條件。 */
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { immersive, exit: exitImmersive, toggle: toggleImmersive } = useImmersive(hostRef, MAP_IMMERSIVE_BODY_CLASS);

  /* 畫布的可視座標系：卡片內沿用固定的 920×560（維持既有的等比縮放與手機橫捲）；
     全螢幕時改吃容器的實際像素（1 單位＝1px）——沿用 920×560 會被 preserveAspectRatio
     信箱化，手機直向下整張圖只佔螢幕中間一條，等於白開了全螢幕。 */
  const [stageBox, setStageBox] = useState<{ w: number; h: number } | null>(null);
  const VW = stageBox ? stageBox.w : W;
  const VH = stageBox ? stageBox.h : H;

  const dragRef = useRef<
    | { mode: "node"; id: string; startX: number; startY: number; baseDx: number; baseDy: number; moved: boolean }
    | { mode: "pan"; startX: number; startY: number; baseTx: number; baseTy: number }
    | null
  >(null);
  const suppressClickRef = useRef(false);

  /** client px → viewBox 座標係數（viewBox 寬＝VW、SVG 依容器寬縮放，等比） */
  const pxToSvg = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? VW / rect.width : 1;
  };
  /** 存佈局到本機：只留「目前圖上存在」的節點（已刪內容的偏移不無限累積） */
  const persistOverrides = (o: Record<string, { dx: number; dy: number }>) => {
    const ids = new Set((layout?.nodes ?? []).map((n) => n.id));
    const pruned: Record<string, { dx: number; dy: number }> = {};
    for (const [k, v] of Object.entries(o)) if (ids.has(k)) pruned[k] = v;
    try {
      localStorage.setItem(layoutStoreKey, JSON.stringify(pruned));
    } catch {
      /* 無痕模式等存不了就算了：本次會話仍可拖，只是下次不記得 */
    }
    return pruned;
  };

  const onNodePointerDown = (id: string) => (e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation(); // 別讓畫布把這次按下當成平移
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const cur = overrides[id] ?? { dx: 0, dy: 0 };
    dragRef.current = { mode: "node", id, startX: e.clientX, startY: e.clientY, baseDx: cur.dx, baseDy: cur.dy, moved: false };
  };
  const onNodePointerMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    if (!d || d.mode !== "node") return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= 4) return;
    d.moved = true;
    const k = pxToSvg() / view.s; // 畫布縮放中拖動：px 位移換成世界座標要再除縮放
    setOverrides((o) => ({ ...o, [d.id]: { dx: d.baseDx + (e.clientX - d.startX) * k, dy: d.baseDy + (e.clientY - d.startY) * k } }));
  };
  const onNodePointerUp = () => {
    const d = dragRef.current;
    if (d?.mode === "node" && d.moved) {
      suppressClickRef.current = true;
      setOverrides((o) => persistOverrides(o));
    }
    if (d?.mode === "node") dragRef.current = null;
  };
  /** 拖完鬆手觸發的 click 吞掉，不開詳情面板 */
  const onNodeClick = (sel?: MapSelection | null) => () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setSelected(sel ?? null);
  };

  /* 全螢幕的觸控手勢：單指平移、雙指縮放。卡片內刻意不接觸控平移（畫布只佔一小塊，
     攔掉手指就捲不動整頁）；全螢幕時整個視窗都是畫布，沒有頁面要捲，手勢才給得下去。 */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<number | null>(null); // 上一幀的兩指距離
  const pinchPoints = () => [...pointersRef.current.values()];

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest?.(".map-node")) return; // 節點自己處理
    if (e.pointerType !== "mouse" && !immersive) return; // 卡片內：觸控時空白處保留頁面捲動
    svgRef.current?.setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size >= 2) {
      // 第二根手指落下＝改成縮放；平移中途轉縮放要先把平移停掉，否則兩者互相打架
      const [a, b] = pinchPoints();
      pinchRef.current = Math.hypot(a.x - b.x, a.y - b.y);
      dragRef.current = null;
      return;
    }
    dragRef.current = { mode: "pan", startX: e.clientX, startY: e.clientY, baseTx: view.tx, baseTy: view.ty };
  };
  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size >= 2 && pinchRef.current !== null) {
      const [a, b] = pinchPoints();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = svgRef.current?.getBoundingClientRect();
      if (dist > 0 && pinchRef.current > 0 && rect && rect.width > 0) {
        const k = VW / rect.width;
        // 以兩指中點為錨：捏合時使用者盯著的是中間那塊，錨在畫布中央會把它推走
        zoomAt(((a.x + b.x) / 2 - rect.left) * k, ((a.y + b.y) / 2 - rect.top) * k, dist / pinchRef.current);
      }
      pinchRef.current = dist;
      return;
    }
    const d = dragRef.current;
    if (!d || d.mode !== "pan") return;
    const k = pxToSvg();
    setViewTouched(true);
    setView((v) => ({ ...v, tx: d.baseTx + (e.clientX - d.startX) * k, ty: d.baseTy + (e.clientY - d.startY) * k }));
  };
  const onSvgPointerUp = (e?: React.PointerEvent<SVGSVGElement>) => {
    if (e) pointersRef.current.delete(e.pointerId);
    else pointersRef.current.clear();
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (dragRef.current?.mode === "pan") dragRef.current = null;
  };

  /** 縮放（限 0.25–2.5 倍）：以指定的 viewBox 錨點為中心，錨點在畫面上不動 */
  const zoomAt = (px: number, py: number, factor: number) => {
    setViewTouched(true);
    setView((v) => {
      const s2 = Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, v.s * factor));
      if (s2 === v.s) return v;
      const wx = (px - v.tx) / v.s;
      const wy = (py - v.ty) / v.s;
      return { s: s2, tx: px - wx * s2, ty: py - wy * s2 };
    });
  };

  /* 「剛好裝滿」的初始檢視：固定 viewBox 是 920×560，但少少幾個節點只佔中間一小圈，
     四周全是空白——手機縮到 0.39x 後那圈更小得看不清。算出節點的外接框（留標籤的邊距）
     再等比放到畫布上，圖就填滿可視區。使用者一動手（縮放／平移）就不再覆蓋他的視角。 */
  const fitView = useMemo(() => {
    const nodes = layout?.nodes ?? [];
    if (nodes.length === 0) return { tx: 0, ty: 0, s: 1 };
    const PAD = 64; // 標籤畫在節點上方／兩側，外接框要留出來
    const pts = nodes.map((n) => {
      const o = overrides[n.id];
      return o ? { x: n.x + o.dx, y: n.y + o.dy } : { x: n.x, y: n.y };
    });
    const minX = Math.min(...pts.map((p) => p.x)) - PAD;
    const maxX = Math.max(...pts.map((p) => p.x)) + PAD;
    const minY = Math.min(...pts.map((p) => p.y)) - PAD;
    const maxY = Math.max(...pts.map((p) => p.y)) + PAD;
    const s = Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, Math.min(VW / (maxX - minX), VH / (maxY - minY))));
    return { s, tx: VW / 2 - ((minX + maxX) / 2) * s, ty: VH / 2 - ((minY + maxY) / 2) * s };
  }, [layout, overrides, VW, VH]);
  useEffect(() => {
    if (!viewTouched) setView(fitView);
  }, [fitView, viewTouched]);

  const hasContent = !!graph && graph.branches.length > 0;
  const mapVisible = hasContent && viewMode === "map";
  // 滾輪縮放要 preventDefault 擋頁面捲動；React 的 onWheel 在根節點是 passive，改掛原生非 passive 監聽
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !mapVisible) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      const k = VW / rect.width;
      zoomAt((e.clientX - rect.left) * k, (e.clientY - rect.top) * k, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // zoomAt 是穩定閉包（只用 setView 函式式更新），不入依賴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapVisible, VW]);

  /* 全螢幕時量畫布的實際像素當 viewBox（見 stageBox）。轉向、鍵盤彈出、退出全螢幕
     都會改尺寸，用 ResizeObserver 跟著走；不在全螢幕就清掉，回到固定的 920×560。 */
  useEffect(() => {
    const el = mapWrapRef.current;
    if (!immersive || !mapVisible || !el) {
      setStageBox(null);
      return;
    }
    const sync = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setStageBox({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    sync();
    if (typeof ResizeObserver === "undefined") return; // jsdom／舊瀏覽器：量一次就好
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [immersive, mapVisible]);

  /* 進出全螢幕＝可視區整個換掉，使用者原本調好的縮放平移已經對不上新畫布，
     重新套一次「剛好裝滿」；他在全螢幕裡再動手，一樣以他的視角為準。 */
  useEffect(() => {
    setViewTouched(false);
  }, [immersive]);

  /* Esc 退出全螢幕。原生全螢幕時瀏覽器自己會處理（useImmersive 接 fullscreenchange 收斂），
     iOS Safari 只有 CSS 沉浸那一層，沒有這個監聽就只剩按鈕能出去。 */
  useEffect(() => {
    if (!immersive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitImmersive();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [immersive, exitImmersive]);

  /* 手機把畫布放大成 720px 橫捲（等比縮到螢幕寬會讓字剩 4px），但捲軸起點在最左邊——
     中心節點在畫布正中央，使用者一打開只看到整片空白，以為地圖壞了。開圖時先捲到中央。
     全螢幕沒有橫捲（畫布就是整個視窗），overflow 是 0，這裡自然不做事。 */
  useEffect(() => {
    if (!mapVisible) return;
    const el = mapWrapRef.current;
    if (!el) return;
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow > 0) el.scrollLeft = overflow / 2;
  }, [mapVisible, immersive]);

  /** 節點的有效位置＝自動佈局＋使用者拖出的偏移 */
  const posOf = (n: { id: string; x: number; y: number }) => {
    const o = overrides[n.id];
    return o ? { x: n.x + o.dx, y: n.y + o.dy } : { x: n.x, y: n.y };
  };
  const nodeById = useMemo(() => new Map((layout?.nodes ?? []).map((n) => [n.id, n])), [layout]);
  const hasCustomLayout = Object.keys(overrides).length > 0;
  const resetLayout = () => {
    setOverrides({});
    try {
      localStorage.removeItem(layoutStoreKey);
    } catch {
      /* 同 persistOverrides：存取失敗不影響本次會話 */
    }
  };
  /** 重設檢視＝回到「剛好裝滿」，不是回到原點——原點下的圖只佔畫布中間一小塊 */
  const resetView = () => {
    setViewTouched(false);
    setView(fitView);
  };

  /** 節點的「前往」：按 nav 型別跳頁、跳到上方那筆，或切到清單展開整支 */
  const go = (nav: MapNav) => {
    if (!nav) return;
    if (nav.type === "anchor") {
      const target = document.getElementById(nav.anchorId);
      const parentSection = target?.closest<HTMLDetailsElement>(".planner-section");
      if (parentSection && !parentSection.open) parentSection.open = true;
      window.requestAnimationFrame(() => flashAnchor(nav.anchorId));
    }
    else if (nav.type === "project") setLocation(`/p/${nav.projectId}`);
    else if (nav.type === "branch") {
      setViewMode("list");
      setOpenBranches({ [nav.key]: true });
      setListLimits((l) => ({ ...l, [nav.key]: Math.max(l[nav.key] ?? 0, LIST_PAGE * 4) }));
    }
    else setLocation(nav.tableId ? `/databases?open=${nav.tableId}` : "/databases");
  };
  const navLabel = (nav: MapNav) =>
    !nav
      ? null
      : nav.type === "anchor"
        ? "跳到上方那筆"
        : nav.type === "project"
          ? "開啟專案"
          : nav.type === "branch"
            ? "在清單看全部"
            : nav.tableId
              ? "開啟資料庫"
              : "開啟資料庫頁";

  const counts = graph?.counts;
  const lensLabel = lens === "all" ? "全組" : lens === "mine" ? "我的" : "提及我";
  const focusLabel = focusProject ? data?.projects.find((p) => p.id === focusProject)?.title ?? "某專案" : "全部專案";
  const onTypeCount = LEAF_TOGGLES.filter((t) => types[t.kind]).length;

  /* 鏡頭／專案聚焦／型別開關：桌機直接攤開，手機收進「篩選」摺疊——
     四排控制項在 360px 螢幕上會佔掉整個第一屏，地圖本體被推到看不見的地方。 */
  const filterControls = (
    <>
      <div className="map-filter-row">
        <div className="seg" role="tablist" aria-label="鏡頭">
          {(["all", "mine", "mentioned"] as const).map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={lens === item}
              tabIndex={lens === item ? 0 : -1}
              data-map-lens={item}
              className={lens === item ? "on" : ""}
              onClick={() => setLens(item)}
              onKeyDown={(event) => {
                const next = nextTabValue(["all", "mine", "mentioned"] as const, item, event.key);
                if (!next) return;
                event.preventDefault();
                setLens(next);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-map-lens="${next}"]`)?.focus();
              }}
            >
              {item === "all" ? "全組" : item === "mine" ? "我的" : "提及我"}
            </button>
          ))}
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
      </div>

      {/* 圖例＝型別開關：點一下顯示／隱藏該型別的節點 */}
      <div className="map-filter-row">
        {LEAF_TOGGLES.map((t) => (
          <button key={t.kind} type="button" className={`map-toggle${types[t.kind] ? " on" : ""}`} aria-pressed={types[t.kind]} onClick={() => toggleType(t.kind)}>
            <span className={`map-dot ${t.kind}`} /> {t.label}
          </button>
        ))}
        <span className="map-legend"><span className="map-dot proj" /> 專案</span>
        <span className="map-legend"><span className="map-dot bucket" /> 組層級</span>
      </div>
      {lens === "mentioned" && (
        <Hint style={{ marginTop: 6 }}>「提及我」只適用有 @提及 的筆記與行程；知識、代理與資料庫在此鏡頭下不顯示。</Hint>
      )}
    </>
  );

  return (
    <PlannerSection
      open={sectionOpen}
      onOpenChange={setSectionOpen}
      analyticsLabel="知識地圖卡"
      contentId="planner-knowledge-map-content"
      title="知識地圖・心智圖"
      lede="依專案與資料型別探索組內知識關聯"
    >
      <Hint>
        本組知識族譜：先用搜尋或篩選收斂，再挑檢視——「清單」一列一個節點、點一下直接開那一筆（手機建議）；
        「心智圖」把專案／組層級／資料庫織成放射圖看關聯，節點可拖拉排版（位置記在這台裝置）、可縮放平移。
        顏色：筆記（藍）、行程（琥珀）、知識庫（綠）、AI 執行計畫（紫）、資料庫（青）。
        圖太擠就按「全螢幕」，整張族譜攤到整個視窗（Esc 或再按一次退出）。
      </Hint>

      {/* 全螢幕包住「搜尋＋篩選＋族譜本體」而不是只包畫布：
          進了全螢幕還要能換關鍵字與檢視，不然得退出來改條件再進去一次 */}
      <div className={`map-host${immersive ? " is-immersive" : ""}`} ref={hostRef}>
      {/* 搜尋＋檢視切換：兩者對清單與心智圖同時生效 */}
      <div className="map-bar">
        <span className="map-search">
          <Icon name="Search" size={14} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋節點名稱…"
            aria-label="搜尋知識族譜節點"
          />
          {query && (
            <Button variant="ghost" size="sm" onClick={() => setQuery("")} aria-label="清除搜尋">清除</Button>
          )}
        </span>
        <div className="seg" role="tablist" aria-label="檢視">
          {(["list", "map"] as const).map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={viewMode === item}
              tabIndex={viewMode === item ? 0 : -1}
              data-map-view={item}
              className={viewMode === item ? "on" : ""}
              onClick={() => setViewMode(item)}
              onKeyDown={(event) => {
                const next = nextTabValue(["list", "map"] as const, item, event.key);
                if (!next) return;
                event.preventDefault();
                setViewMode(next);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-map-view="${next}"]`)?.focus();
              }}
            >
              <Icon name={item === "list" ? "List" : "Waypoints"} size={13} /> {item === "list" ? "清單" : "心智圖"}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          onClick={toggleImmersive}
          aria-pressed={immersive}
          title={immersive ? "退出全螢幕（Esc）" : "把知識族譜攤到整個視窗"}
        >
          <Icon name={immersive ? "Shrink" : "Expand"} size={13} /> {immersive ? "退出全螢幕" : "全螢幕"}
        </Button>
      </div>

      {compact ? (
        <details className="map-filters">
          <summary>篩選：{lensLabel}・{focusLabel}・{onTypeCount}/{LEAF_TOGGLES.length} 型別</summary>
          {filterControls}
        </details>
      ) : (
        filterControls
      )}

      {counts && graph && (
        <Meta style={{ marginTop: 8 }}>
          共 {graph.total} 個節點・筆記 {counts.note}・行程 {counts.schedule}・知識 {counts.knowledge}・AI 計畫 {counts.agent}・資料庫 {counts.db}
          {viewMode === "map" && mapBranches && mapBranches.hiddenBranchCount > 0
            ? `・另有 ${mapBranches.hiddenBranchCount} 支太密沒畫（切「清單」看全部）`
            : ""}
        </Meta>
      )}

      {graphQ.isLoading ? (
        <Skeleton style={{ height: 320, marginTop: 12, borderRadius: "var(--r-12)" }} aria-hidden="true" />
      ) : graphQ.error ? (
        <p className="error">{graphQ.error.message}</p>
      ) : !graph || graph.branches.length === 0 ? (
        query.trim() ? (
          <EmptyState
            icon={<Icon name="Search" />}
            title={<>找不到「{query.trim()}」</>}
            description={<>換個關鍵字，或把鏡頭切回「全組」、型別開關全開再找一次。</>}
            style={{ marginTop: 12 }}
          />
        ) : (
          <EmptyState icon={<Icon name="Waypoints" />} title={<>這張族譜還是空的</>} description={<>先在上面加幾筆行程或筆記（可掛專案），或在專案裡累積知識庫、跑 AI 執行計畫、建資料庫，這裡就會長出對應的族譜節點。
              {lens !== "all" && "或把鏡頭切回「全組」。"}</>} style={{ marginTop: 12 }} />
        )
      ) : viewMode === "list" ? (
        /* 清單檢視：分支收合式大綱。一列一個節點、48px 高的整列命中區，點一下直接到那一筆——
           手機上找東西靠的是這個，不是在 0.39x 的放射圖上戳 2px 的圓點。 */
        <div className="map-list" data-testid="map-list">
          {graph.branches.map((b, i) => {
            const isOpen = openBranches[b.key] ?? (!!query.trim() || i === 0);
            const limit = listLimits[b.key] ?? LIST_PAGE;
            const shown = b.leaves.slice(0, limit);
            const rest = b.leaves.length - shown.length;
            const branchNav: MapNav =
              b.kind === "project" && b.projectId ? { type: "project", projectId: b.projectId } : b.kind === "dbhub" ? { type: "db" } : null;
            return (
              <div className={`map-branch${isOpen ? " open" : ""}`} key={b.key}>
                <div className="map-branch__head">
                  <button
                    type="button"
                    className="map-branch__toggle"
                    aria-expanded={isOpen}
                    aria-controls={`map-branch-${b.key}`}
                    onClick={() => setOpenBranches((o) => ({ ...o, [b.key]: !isOpen }))}
                  >
                    <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} size={14} />
                    <span className={`map-dot ${b.kind === "dbhub" ? "db" : b.kind === "project" ? "proj" : "bucket"}`} />
                    <span className="map-branch__label">{b.label}</span>
                    <Meta style={{ margin: 0 }}>{b.leaves.length}</Meta>
                  </button>
                  {branchNav && (
                    <Button variant="ghost" size="sm" onClick={() => go(branchNav)}>{navLabel(branchNav)}</Button>
                  )}
                </div>
                {isOpen && (
                  <ul className="map-rows" id={`map-branch-${b.key}`}>
                    {shown.map((leaf) => (
                      <li key={leaf.id}>
                        <button type="button" className="map-row" onClick={() => go(leaf.nav)}>
                          <span className={`map-dot ${leaf.kind}`} />
                          <span className="map-row__text">
                            <strong>{leaf.label}</strong>
                            <small>{leaf.sub}</small>
                          </span>
                          <span className="map-row__go">{navLabel(leaf.nav)}<Icon name="ChevronRight" size={14} /></span>
                        </button>
                      </li>
                    ))}
                    {rest > 0 && (
                      <li>
                        <button
                          type="button"
                          className="map-row map-row--more"
                          onClick={() => setListLimits((l) => ({ ...l, [b.key]: (l[b.key] ?? LIST_PAGE) + LIST_PAGE * 2 }))}
                        >
                          顯示其餘 {rest} 個節點
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="map-stage">
          {/* 畫布工具：縮放與重設（浮在右上角）；佈局被拖過才出現「重設佈局」 */}
          <div className="map-tools">
            <Button size="sm" onClick={() => zoomAt(VW / 2, VH / 2, 1.2)} aria-label="放大" title="放大">＋</Button>
            <Button size="sm" onClick={() => zoomAt(VW / 2, VH / 2, 1 / 1.2)} aria-label="縮小" title="縮小">－</Button>
            {viewTouched && (
              <Button size="sm" onClick={resetView} title="回到「剛好裝滿畫布」的檢視">重設檢視</Button>
            )}
            {hasCustomLayout && (
              <Button size="sm" onClick={resetLayout} title="清除拖拉過的節點位置，回到自動佈局">重設佈局</Button>
            )}
          </div>
          <div className="map-wrap" ref={mapWrapRef}>
          {/* role=group（非 img）：img 會讓報讀器把整張圖當單一圖片，內部所有可點節點對 AT 隱形 */}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VW} ${VH}`}
            className="map-svg"
            role="group"
            aria-label="知識地圖（可 Tab 到各節點，Enter 開啟詳情）"
            onPointerDown={onSvgPointerDown}
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onPointerCancel={onSvgPointerUp}
          >
            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
              {layout?.edges.map((e, i) => {
                const from = nodeById.get(e.from);
                const to = nodeById.get(e.to);
                if (!from || !to) return null;
                const p1 = posOf(from);
                const p2 = posOf(to);
                return <line key={`e-${i}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className={`map-edge ${e.kind}`} />;
              })}
              {layout?.nodes.map((n) => {
                const { x, y } = posOf(n);
                const dragProps = {
                  onPointerDown: onNodePointerDown(n.id),
                  onPointerMove: onNodePointerMove,
                  onPointerUp: onNodePointerUp,
                  onPointerCancel: onNodePointerUp,
                };
                if (n.type === "group") {
                  return (
                    <g key={n.id} className="map-node group" {...dragProps}>
                      <circle cx={x} cy={y} r={34} />
                      <text x={x} y={y} textAnchor="middle" dominantBaseline="central">{n.label}</text>
                    </g>
                  );
                }
                // 可點節點的鍵盤/報讀器可及性：role=button＋tabIndex＋Enter/Space 觸發，
                // 否則純鍵盤使用者無法聚焦或啟動任何節點（WCAG 2.1.1 / 4.1.2）
                const a11yProps = (selection: Parameters<typeof onNodeClick>[0]) => ({
                  role: "button" as const,
                  tabIndex: 0,
                  "aria-label": n.label,
                  onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onNodeClick(selection)();
                    }
                  },
                });
                if (n.type === "project" || n.type === "bucket" || n.type === "dbhub" || n.type === "more") {
                  const w = Math.max(56, n.label.length * 13 + 22);
                  return (
                    <g key={n.id} className={`map-node ${n.type} clickable`} onClick={onNodeClick(n.selection)} {...a11yProps(n.selection)} {...dragProps}>
                      <rect x={x - w / 2} y={y - 15} width={w} height={30} rx={15} />
                      <text x={x} y={y} textAnchor="middle" dominantBaseline="central">{n.label}</text>
                    </g>
                  );
                }
                // note / schedule / knowledge / agent / db 葉節點
                return (
                  <g key={n.id} className={`map-node ${n.type} clickable`} onClick={onNodeClick(n.selection)} {...a11yProps(n.selection)} {...dragProps}>
                    {/* 透明命中圈：r=6 的葉節點在手機等比縮小後只剩 ~4px 可點
                       （text 是 pointer-events:none），永遠隱形、只擴大命中面積 */}
                    <circle className="map-hit" cx={x} cy={y} r={20} />
                    <circle cx={x} cy={y} r={6} />
                    <text x={x} y={y - 12} textAnchor="middle">{n.label}</text>
                  </g>
                );
              })}
            </g>
          </svg>
          </div>
          {/* 節點詳情面板：貼在畫布下緣（不是卡片最底下）——手機上畫布有 438px 高，
              面板放在圖後面會落在螢幕外，點了節點像沒反應 */}
          {selected && (
            <div className="map-detail" role="status">
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ fontSize: "var(--fs-14)", display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{selected.label}</strong>
                <Meta style={{ margin: 0 }}>{selected.sub}</Meta>
              </div>
              {selected.nav && (
                <Button size="sm" variant="primary" onClick={() => go(selected.nav)}>
                  {navLabel(selected.nav)}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)} aria-label="關閉詳情">關閉</Button>
            </div>
          )}
        </div>
      )}
      </div>
    </PlannerSection>
  );
}
