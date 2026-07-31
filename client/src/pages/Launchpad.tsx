import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { FirstRunGuide } from "../components/FirstRunGuide";
import { InstallAppBanner } from "../components/InstallAppBanner";
import { Icon } from "../components/Icon";
import { ConfirmButton } from "../components/interactions";
import { Button, Card, Chip, EmptyState, Hint, Meta, Skeleton } from "../components/ui";
import { agentOutputKindLabel } from "../../../shared/agentOutputs";

/** 新手導覽「略過／看過」記憶鍵：一旦略過或建過範例就記住，之後不再自動彈出 */
const FIRST_RUN_KEY = "aios.firstRunDismissed";
/** 最近開啟：點卡片時記下 id，置頂顯示（純前端 localStorage） */
const RECENT_KEY = "aios.recentProjects";
/** 「組執行計畫動態」收合偏好記憶鍵（per 組；純前端 localStorage，收起省版面） */
const RUNS_COLLAPSE_KEY = (gid: string) => `aios.teamRuns.collapsed.${gid}`;

function relTime(d: Date | string): string {
  const t = new Date(d).getTime();
  const mins = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(d).toLocaleDateString("zh-TW");
}

/** 封面色帶：以 id 雜湊選一組低彩度暖色（克制、不喧賓奪主；三色光只在此低聲出現） */
const COVERS = [
  "linear-gradient(135deg, #efe3d4, #e6d4bf)",
  "linear-gradient(135deg, #ece4d0, #ddceb4)",
  "linear-gradient(135deg, #ece0e6, #dccfe0)",
  "linear-gradient(135deg, #efe6cf, #e4d5b6)",
  "linear-gradient(135deg, #e7e7dc, #d5d6c6)",
  "linear-gradient(135deg, #f0e2da, #e6cfc2)",
];
function coverOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COVERS[h % COVERS.length];
}
function recordRecent(id: string) {
  try {
    const cur = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as string[];
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...cur.filter((x) => x !== id)].slice(0, 12)));
  } catch {
    /* localStorage 不可用時略過 */
  }
}
function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

/** 首頁作業台：搜尋/篩選/排序的專案卡格 ＋ 頂部精簡建立列 */
export function Launchpad({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  // 工具列：搜尋／類型篩選／排序／已封存／漸進顯示（includeArchived 影響 list query，須先於它宣告）
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [limit, setLimit] = useState(24);
  const projects = trpc.projects.list.useQuery(
    { groupId: groupId || undefined, includeArchived: includeArchived || undefined },
    { enabled: !!groupId },
  );
  // 跨專案待辦（UX 高：首頁不顯示待審/待核→組長漏審、組員卡住）：專案卡角標用；60 秒輪詢跟上變化
  const pendingSummary = trpc.approvals.pendingSummary.useQuery({ groupId }, { enabled: !!groupId, refetchInterval: 60_000 });
  const pendingOf = (pid: string) => pendingSummary.data?.projects.find((x) => x.projectId === pid);
  const agentOverview = trpc.teamAssistant.agentOverview.useQuery(
    { groupId },
    {
      enabled: !!groupId,
      refetchInterval: (query) => {
        const active = query.state.data?.summary?.active ?? 0;
        return active > 0 ? 8_000 : false;
      },
    },
  );
  const options = trpc.options.byGroup.useQuery({ groupId, includeInactive: true }, { enabled: !!groupId });
  const kindOptions = (options.data ?? []).filter((o) => o.type === "kind" && o.active);
  const platformOptions = (options.data ?? []).filter((o) => o.type === "platform" && o.active);
  const kindLabelOf = (value: string) => (options.data ?? []).find((o) => o.type === "kind" && o.value === value)?.label ?? value;
  const create = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      utils.projects.list.invalidate();
      navigate(`/p/${project.id}`);
    },
  });
  // 空狀態的「建立範例專案」：與 FirstRunGuide 同一支後端（免費、可重入）——
  // 「略過」導覽不該讓唯一的安全沙盒永久消失，一次誤點要可回復
  const createSample = trpc.projects.createSample.useMutation({
    onSuccess: (project) => {
      utils.projects.list.invalidate();
      navigate(`/p/${project.id}`);
    },
  });
  // 還原已封存：組長／負責人可從卡片直接還原（與 ProjectPage 封存鈕同一 mutation）
  const restoreProject = trpc.projects.setArchived.useMutation({
    onSuccess: () => utils.projects.list.invalidate(),
  });

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("");
  const [platform, setPlatform] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const createAutoOpenedGroup = useRef<string | null>(null);

  const [firstRunDismissed, setFirstRunDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FIRST_RUN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const dismissFirstRun = () => {
    try {
      localStorage.setItem(FIRST_RUN_KEY, "1");
    } catch {
      /* 隱私模式：只在本 session 記住 */
    }
    setFirstRunDismissed(true);
  };
  // 導覽門檻是「這位使用者」而非「整個組」：被邀進活躍組的新人（最常見的新人路徑）
  // 面對的是一堆陌生人專案卡，比空組的人更需要五階段說明與免費範例沙盒。
  // 判準＝在此組尚無自己建立的專案；已看過/略過（per 裝置記憶）就不再彈。
  const myUserId = me.data?.user.id;
  const hasOwnProject =
    projects.data !== undefined && myUserId != null &&
    projects.data.some((p) => p.ownerId === myUserId);
  const showFirstRun =
    !!groupId && projects.data !== undefined && myUserId != null && !hasOwnProject && !firstRunDismissed;

  // 換組重置工具列：kindFilter 是各組自訂的 value，殘留到別組會把該組專案全部濾掉
  // （畫面顯示「沒有符合『』的專案」，其實是舊組的篩選在作怪）；搜尋字串同理
  useEffect(() => {
    setKindFilter("");
    setQ("");
    setIncludeArchived(false);
    setLimit(24);
  }, [groupId]);

  useEffect(() => {
    if (kindOptions.length && !kindOptions.some((o) => o.value === kind)) setKind(kindOptions[0].value);
  }, [kindOptions, kind]);
  useEffect(() => {
    if (platformOptions.length && !platformOptions.some((o) => o.value === platform)) setPlatform(platformOptions[0].value);
  }, [platformOptions, platform]);

  const activeGroup = me.data?.groups.find((g) => g.groupId === groupId);
  const myRole = activeGroup?.role;
  const isLeader = myRole === "leader" || myRole === "admin";
  const pickedPlatform = platformOptions.find((p) => p.value === platform);

  const all = projects.data ?? [];
  // 過濾（搜尋＋類型）→ 排序（最近開啟置頂／最近更新／名稱）→ 限量
  const shownList = useMemo(() => {
    const recent = readRecent();
    const filtered = all
      .filter((p) => !q.trim() || p.title.toLowerCase().includes(q.trim().toLowerCase()))
      .filter((p) => !kindFilter || p.kind === kindFilter);
    if (sort === "title") {
      return [...filtered].sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));
    }
    // recent：先「最近開啟」名單順序，其餘依 updatedAt
    return [...filtered].sort((a, b) => {
      const ra = recent.indexOf(a.id);
      const rb = recent.indexOf(b.id);
      if (ra !== -1 || rb !== -1) {
        if (ra === -1) return 1;
        if (rb === -1) return -1;
        return ra - rb;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [all, q, kindFilter, sort]);
  const shown = shownList.slice(0, limit);
  const recentProjects = shownList.filter((project) => project.status !== "archived").slice(0, 3);
  const agentSummary = agentOverview.data?.summary;
  const runningRuns = agentSummary?.running ?? 0;
  const waitingRuns = (agentSummary?.waiting ?? 0) + (agentSummary?.awaitingApproval ?? 0);
  const completedRuns = agentSummary?.doneRecent ?? 0;
  const pendingApprovals = pendingSummary.data?.totalPendingApprovals ?? 0;
  const pendingGenerations = pendingSummary.data?.totalAwaitingGenerations ?? 0;
  const pendingTotal = pendingApprovals + pendingGenerations;
  const todayLabel = new Intl.DateTimeFormat("zh-TW", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  // 「待我裁決」用的組級待辦：把 pendingSummary 的 per-project 計數配上專案標題。
  // 兩份資料都是這一頁本來就查過的（專案卡角標與頂欄計數共用），不多發任何查詢。
  const pendingDecisions = useMemo<PendingDecisionSource[]>(() => {
    const titleOf = new Map((projects.data ?? []).map((p) => [p.id, p.title] as const));
    return (pendingSummary.data?.projects ?? []).map((p) => ({
      ...p,
      // 查不到標題不能整列丟掉（會靜靜吃掉一件待辦）；用專案 id 前綴當可辨識的替代
      projectTitle: titleOf.get(p.projectId) ?? `專案 ${p.projectId.slice(0, 8)}`,
    }));
  }, [pendingSummary.data, projects.data]);
  const focusProject = recentProjects[0] ?? null;
  const focusState = pendingTotal > 0
    ? {
        kind: "attention",
        eyebrow: "優先處理",
        title: `有 ${pendingTotal} 件需要你決定`,
        detail: "先處理待審與成本核准，AI 與團隊才能繼續往下走。",
        href: "#projects",
        action: "開始處理",
        icon: "Bell" as const,
      }
    : runningRuns > 0
      ? {
          kind: "working",
          eyebrow: "正在推進",
          title: `AI 正在處理 ${runningRuns} 份計畫`,
          detail: "你可以先做別的事；需要人員決定時，這裡會提醒你。",
          href: "#ai-work",
          action: "查看進度",
          icon: "Sparkles" as const,
        }
      : focusProject
        ? {
            kind: "continue",
            eyebrow: "接著上次",
            title: focusProject.title,
            detail: `${kindLabelOf(focusProject.kind)}・更新於 ${relTime(focusProject.updatedAt)}`,
            href: `/p/${focusProject.id}`,
            action: "繼續工作",
            icon: "ArrowRight" as const,
          }
        : {
            kind: "start",
            eyebrow: "今天第一步",
            title: "建立一個專案，把想法變成可執行工作",
            detail: "選內容類型與發布平台後，AI 會沿用同一份專案脈絡協作。",
            href: "#new-project-panel",
            action: "建立專案",
            icon: "Plus" as const,
          };

  const canCreate = !!title.trim() && !!groupId && !!kind && !!platform && !create.isPending;

  useEffect(() => {
    if (projects.data?.length === 0 && createAutoOpenedGroup.current !== groupId) {
      createAutoOpenedGroup.current = groupId;
      setCreateOpen(true);
    }
  }, [groupId, projects.data]);

  return (
    <div className="daily-dashboard">
      <section className="daily-hero" aria-labelledby="daily-title">
        <div className="daily-hero__copy">
          <p className="daily-date"><Icon name="CalendarPlus" size={14} />{todayLabel}</p>
          <p className="eyebrow">今日工作台</p>
          <h1 id="daily-title">
            {me.data?.user.name ? `${me.data.user.name}，` : ""}今天從哪裡<span className="accent">開始</span>？
          </h1>
          <p className="sub">
            {activeGroup ? `這裡整理「${activeGroup.groupName}」需要你處理的事、AI 進度與最近專案。` : "需要你處理的事與 AI 進度都在這裡。"}
          </p>
        </div>
        <button
          type="button"
          className="primary daily-new-project"
          aria-expanded={createOpen}
          aria-controls="new-project-panel"
          onClick={() => setCreateOpen((open) => !open)}
        >
          <Icon name={createOpen ? "X" : "Plus"} size={16} />
          {createOpen ? "收起建立表單" : "建立新專案"}
        </button>
      </section>

      <nav className="daily-quick-links" aria-label="常用工具">
        <Link href="/planner"><Icon name="Clock" size={15} /><span>安排今天</span><small>排程與筆記</small></Link>
        <Link href="/databases"><Icon name="Database" size={15} /><span>整理資料</span><small>清單與批次匯入</small></Link>
        <Link href="/chat"><Icon name="MessageCircle" size={15} /><span>聯絡夥伴</span><small>私訊與標注</small></Link>
      </nav>

      {showFirstRun && <FirstRunGuide groupId={groupId} onDismiss={dismissFirstRun} />}

      <div style={{ marginBottom: 14 }}><InstallAppBanner /></div>

      {/* 精簡建立列（常駐、一行；不再佔右側整欄） */}
      <Card as="section" id="new-project-panel" className="new-project-panel" data-fb="新專案卡" hidden={!createOpen} aria-label="建立新專案">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "3 1 220px" }}>
            <label htmlFor="np-title" style={{ marginTop: 0 }}>新專案名稱</label>
            <input id="np-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：見證故事 · 走出低谷"
              onKeyDown={(e) => { if (e.key === "Enter" && canCreate) create.mutate({ groupId, title: title.trim(), kind, platform }); }} />
          </div>
          <div style={{ flex: "1 1 130px" }}>
            <label htmlFor="np-kind" style={{ marginTop: 0 }}>內容類型</label>
            <select id="np-kind" value={kind} onChange={(e) => setKind(e.target.value)} disabled={!kindOptions.length}>
              {kindOptions.map((k) => (
                <option key={k.id} value={k.value}>{k.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: "1 1 130px" }}>
            <label htmlFor="np-platform" style={{ marginTop: 0 }}>發布平台</label>
            <select id="np-platform" value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={!platformOptions.length}>
              {platformOptions.map((p) => (
                <option key={p.id} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <Button variant="primary" disabled={!canCreate} onClick={() => create.mutate({ groupId, title: title.trim(), kind, platform })}>
            {create.isPending ? "建立中…" : "建立專案"}
          </Button>
        </div>
        {/* 這一區的說明幾乎都是「為什麼還不能建」＋「怎麼解」，藏起來會讓人卡在原地，
         * 故多為 layer="always"；只有解釋自動帶入行為的那句屬於引導層。 */}
        {activeGroup && (
          <Hint layer="always" style={{ marginTop: 8 }}>將建立在：{activeGroup.teamName}・{activeGroup.groupName}（頂欄可切換組別）</Hint>
        )}
        {options.isLoading && <Hint layer="always">選項載入中…</Hint>}
        {!options.isLoading && groupId && !kindOptions.length && <Hint layer="always">這個組還沒有內容類型選項——請組長到「選項」頁新增。</Hint>}
        {!options.isLoading && groupId && !platformOptions.length && <Hint layer="always">這個組還沒有發布平台選項——請組長到「選項」頁新增。</Hint>}
        {pickedPlatform?.format && <Hint>畫面格式：{pickedPlatform.format}（依平台自動帶入）</Hint>}
        {!groupId && <Hint layer="always">（要先屬於一個組才能建專案）</Hint>}
        {groupId && kindOptions.length > 0 && platformOptions.length > 0 && !title.trim() && <Hint layer="always">先為專案命名，就能建立專案。</Hint>}
        {create.error && <p className="error" role="alert">{create.error.message}</p>}
      </Card>

      <div className={`daily-overview${recentProjects.length ? "" : " daily-overview--solo"}`}>
        <div className="daily-overview__main">
          {focusState.kind === "start" ? (
            <button
              type="button"
              className={`daily-focus-card ${focusState.kind}`}
              onClick={() => {
                setCreateOpen(true);
                requestAnimationFrame(() => document.getElementById("new-project-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }));
              }}
            >
              <span className="daily-focus-card__icon"><Icon name={focusState.icon} size={21} /></span>
              <span className="daily-focus-card__copy">
                <small>{focusState.eyebrow}</small>
                <strong>{focusState.title}</strong>
                <span>{focusState.detail}</span>
              </span>
              <span className="daily-focus-card__action">{focusState.action}<Icon name="ChevronRight" size={16} /></span>
            </button>
          ) : (
            <a href={focusState.href} className={`daily-focus-card ${focusState.kind}`}>
              <span className="daily-focus-card__icon"><Icon name={focusState.icon} size={21} /></span>
              <span className="daily-focus-card__copy">
                <small>{focusState.eyebrow}</small>
                <strong>{focusState.title}</strong>
                <span>{focusState.detail}</span>
              </span>
              <span className="daily-focus-card__action">{focusState.action}<Icon name="ChevronRight" size={16} /></span>
            </a>
          )}

          <section className="daily-status-grid" aria-label="今日摘要">
            {/* 直落「待我裁決」收件匣（#ai-work 區）——先前連 #projects 還要自己找案子 */}
            <a href="#ai-work" className="daily-status-card attention">
              <span className="daily-status-card__icon"><Icon name="Bell" size={18} /></span>
              <span><strong>{pendingTotal}</strong><small>待我處理</small></span>
              <span className="daily-status-card__detail">{pendingApprovals} 待審・{pendingGenerations} 待核</span>
            </a>
            <a href="#ai-work" className="daily-status-card working">
              <span className="daily-status-card__icon"><Icon name="Sparkles" size={18} /></span>
              <span><strong>{runningRuns}</strong><small>AI 正在工作</small></span>
              <span className="daily-status-card__detail">
                {agentSummary?.activeProjects
                  ? `${agentSummary.activeProjects} 個專案有活動`
                  : "目前沒有執行中的計畫"}
              </span>
            </a>
            <a href="#ai-work" className="daily-status-card waiting">
              <span className="daily-status-card__icon"><Icon name="Clock" size={18} /></span>
              <span><strong>{waitingRuns}</strong><small>等待／待核</small></span>
              <span className="daily-status-card__detail">
                {(agentSummary?.awaitingApproval ?? 0) > 0
                  ? `含 ${agentSummary!.awaitingApproval} 份待核准計畫`
                  : "需要決定後才會繼續"}
              </span>
            </a>
            <a href="#ai-work" className="daily-status-card completed">
              <span className="daily-status-card__icon"><Icon name="Check" size={18} /></span>
              <span><strong>{completedRuns}</strong><small>近七日成果</small></span>
              <span className="daily-status-card__detail">
                {(agentSummary?.failedRecent ?? 0) > 0
                  ? `另有 ${agentSummary!.failedRecent} 筆近期失敗`
                  : "已完成的 AI 計畫"}
              </span>
            </a>
          </section>
        </div>

        {recentProjects.length > 0 && (
          <section className="continue-work" aria-labelledby="continue-title">
            <div className="section-heading">
              <div><p className="eyebrow">接續進度</p><h2 id="continue-title">最近專案</h2></div>
              <a href="#projects">全部</a>
            </div>
            <div className="continue-work__grid">
              {recentProjects.map((project) => {
                const pending = pendingOf(project.id);
                return (
                  <Link key={project.id} href={`/p/${project.id}`} className="continue-card" onClick={() => recordRecent(project.id)}>
                    <span className="continue-card__mark" style={{ background: coverOf(project.id) }}>{project.title.trim().charAt(0) || "○"}</span>
                    <span className="continue-card__body">
                      <strong>{project.title}</strong>
                      <small>{kindLabelOf(project.kind)}・更新於 {relTime(project.updatedAt)}</small>
                    </span>
                    {!!pending && pending.pendingApprovals + pending.awaitingGenerations > 0 && (
                      <Chip>{pending.pendingApprovals + pending.awaitingGenerations} 待處理</Chip>
                    )}
                    <Icon name="ChevronRight" size={17} />
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* 組彙總 AI（需求 12 v1）：問整組狀況的唯讀彙總——沒選組就不渲染。
          key 綁組：換組即整卡重掛，否則 A 組的問答殘留在畫面上、
          「追問」還會把 A 組對話歷史連同新 groupId 送去 B 組（跨組脈絡外溢） */}
      <section id="ai-work" className="dashboard-section" aria-labelledby="ai-work-title">
        <div className="section-heading">
          <div><p className="eyebrow">協作代理</p><h2 id="ai-work-title">AI 工作與團隊分析</h2></div>
          <p>看清查證步驟、執行狀態與需要人員決定的節點。</p>
        </div>
        {groupId && (
          <TeamAssistantCard
            key={groupId}
            groupId={groupId}
            pendingDecisions={pendingDecisions}
            pendingLoading={pendingSummary.isLoading}
            pendingFailed={!!pendingSummary.error}
            starterProjects={all}
            isLeader={isLeader}
            myUserId={myUserId}
          />
        )}
      </section>

      <section id="projects" className="dashboard-section" aria-labelledby="projects-title">
        <div className="section-heading">
          <div><p className="eyebrow">完整清單</p><h2 id="projects-title">所有專案</h2></div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>建立新專案</Button>
        </div>

      {/* 工具列：搜尋／類型篩選／排序／顯示已封存（有專案或開了已封存才顯示完整工具列；
          「顯示已封存」在空狀態也要可見，否則封存後再也找不到還原入口） */}
      {(all.length > 0 || includeArchived || !!groupId) && !projects.isLoading && (
        <div className="launch-toolbar" style={{ marginBottom: 16 }}>
          {all.length > 0 && (
            <>
              <input
                style={{ flex: "1 1 200px", width: "auto" }}
                placeholder="搜尋專案名稱…"
                value={q}
                onChange={(e) => { setQ(e.target.value); setLimit(24); }}
                aria-label="搜尋專案"
              />
              <select style={{ width: "auto", flex: "0 0 auto" }} value={kindFilter} onChange={(e) => { setKindFilter(e.target.value); setLimit(24); }} aria-label="依類型篩選">
                <option value="">全部類型</option>
                {kindOptions.map((k) => (
                  <option key={k.id} value={k.value}>{k.label}</option>
                ))}
              </select>
              <select style={{ width: "auto", flex: "0 0 auto" }} value={sort} onChange={(e) => setSort(e.target.value as "recent" | "title")} aria-label="排序方式">
                <option value="recent">最近</option>
                <option value="title">名稱</option>
              </select>
            </>
          )}
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0, cursor: "pointer", flex: "0 0 auto" }}
            title="預設隱藏已封存專案；勾選後可列出並還原"
          >
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => { setIncludeArchived(e.target.checked); setLimit(24); }}
            />
            顯示已封存
          </label>
          {all.length > 0 && (
            /* 篩選後的結果數是狀態不是說明——收成「？」只會讓人不知道篩掉了多少 */
            <Hint as="span" layer="always" style={{ marginLeft: "auto" }}>{shownList.length} 個專案</Hint>
          )}
        </div>
      )}

      {projects.error && (
        <p className="error" role="alert">
          專案清單暫時載入不了——
          <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => projects.refetch()}>再試一次</Button>
        </p>
      )}

      {restoreProject.error && (
        <p className="error" role="alert">還原失敗：{restoreProject.error.message}</p>
      )}

      {all.length === 0 && !projects.isLoading && !projects.error && !showFirstRun && (
        <EmptyState icon={<Icon name="Package" />}
          title={includeArchived ? "還沒有專案（含已封存）" : "還沒有專案"}
          description={
            includeArchived
              ? "從上面開一個新專案，或先開個不花點數的範例看看完整長相。"
              : "從上面開一個新專案，或勾「顯示已封存」找回已封存的專案。也可先開個不花點數的範例看看完整長相。"
          }
          action={
            <>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 12 }}>
                <Button
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  disabled={!groupId || createSample.isPending}
                  onClick={() => createSample.mutate({ groupId })}
                >
                  <Icon name="Sparkles" size={15} />
                  {createSample.isPending ? "建立範例中…" : "建立範例專案看看（免費）"}
                </Button>
                <Link href="/help" style={{ display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "center" }}>
                  <Icon name="HelpCircle" size={14} />看怎麼用
                </Link>
              </div>
              {createSample.error && <p className="error">{createSample.error.message}</p>}
            </>
          }
        />
      )}
      {all.length > 0 && shownList.length === 0 && <Hint layer="always">沒有符合「{q}」的專案。</Hint>}

      <div className="launch-grid" aria-busy={projects.isLoading}>
        {projects.isLoading &&
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={`sk-${i}`} className="launch-card" height={176} />)}
        {shown.map((p) => {
          const isArchived = p.status === "archived";
          const canRestore = isArchived && (isLeader || p.ownerId === myUserId);
          return (
            <Link
              key={p.id}
              href={`/p/${p.id}`}
              className="launch-card"
              style={{ textDecoration: "none", color: "inherit", opacity: isArchived ? 0.85 : undefined }}
              onClick={() => recordRecent(p.id)}
            >
              <div className="launch-cover" style={{ background: coverOf(p.id) }}>
                <span className="launch-mono">{p.title.trim().charAt(0) || "○"}</span>
              </div>
              <div className="launch-body">
                <h3 className="launch-title">{p.title}</h3>
                <div className="launch-meta">
                  <Chip style={{ margin: 0 }}>{kindLabelOf(p.kind)}</Chip>
                  <span>{p.format}</span>
                  {isArchived && (
                    <Chip style={{ margin: 0, color: "var(--fg-secondary)" }} title="已封存，可還原">
                      已封存
                    </Chip>
                  )}
                  {/* 待辦角標：分鏡待審（組長裁決）／生成待核（成本門檻攔下）——點卡片進專案就能處理 */}
                  {!isArchived && (() => {
                    const pd = pendingOf(p.id);
                    if (!pd) return null;
                    return (
                      <>
                        {pd.pendingApprovals > 0 && (
                          <Chip style={{ margin: 0, color: "var(--gold-ink)", borderColor: "var(--gold-ink)" }} title="有分鏡送審等組長裁決">
                            待審 {pd.pendingApprovals}
                          </Chip>
                        )}
                        {pd.awaitingGenerations > 0 && (
                          <Chip style={{ margin: 0, color: "var(--gold-ink)", borderColor: "var(--gold-ink)" }} title="有生成被成本門檻攔下，等組長核准">
                            待核 {pd.awaitingGenerations}
                          </Chip>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div className="launch-meta" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>更新於 {relTime(p.updatedAt)}</span>
                  {canRestore && (
                    <Button
                      size="sm"
                      disabled={restoreProject.isPending}
                      title="還原後會重新出現在作業台"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        restoreProject.mutate({ id: p.id, archived: false });
                      }}
                    >
                      {restoreProject.isPending ? "還原中…" : "還原"}
                    </Button>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {shownList.length > limit && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button onClick={() => setLimit((n) => n + 48)}>顯示更多（還有 {shownList.length - limit} 個）</button>
        </div>
      )}
      </section>
    </div>
  );
}

/** 派工提議（與 teamAssistant.ask 回傳的 dispatches 對齊）：確認後送 teamAssistant.dispatch */
type Dispatch = { projectId: string; projectTitle: string; goal: string; label: string };
/** 派工結果：在某專案建立了一份待核准的 AI 執行計畫 */
type DispatchResult = { runId: string; projectId: string; summary: string; estPoints: number };

const TEAM_QUICK_QS = [
  "哪個案子卡住了？這週花了多少點？",
  "哪些專案有分鏡在等審核？",
  "為什麼有專案特別燒點？",
  "依目前狀況，哪個專案該優先推進？",
];

/** 對話訊息（前端狀態；assistant 訊息帶當輪的查證步驟與派工提議） */
type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
  dispatches?: Dispatch[];
  /** 決策軌跡：1–3 句結構化結論（不是 chain-of-thought） */
  rationale?: string;
  /** 這輪實際依據了哪些上下文區塊（後端已過白名單） */
  contextUsed?: string[];
  /** 阻塞資料讀取失敗 → 回答是在資訊不全的情況下給的，要講出來 */
  degraded?: boolean;
};

/** 代理狀態 → 中文標籤與強調色（與後端 AGENT_RUN_STATUS_LABEL 對齊） */
const RUN_STATUS: Record<string, { label: string; color?: string }> = {
  awaiting_approval: { label: "待核准", color: "var(--gold-ink)" },
  running: { label: "執行中", color: "var(--primary-ink)" },
  waiting: { label: "等待人員", color: "var(--gold-ink)" },
  done: { label: "完成", color: "var(--success-ink)" },
  failed: { label: "失敗", color: "var(--danger-ink)" },
  stopped: { label: "已停止" },
};

const HEALTH_LABEL: Record<string, { label: string; hint: string }> = {
  // idle 與 healthy 必須分開講：舊版把「從沒發起過計畫」也講成「狀態穩定・沒有阻塞」，
  // 於是新組看到的是五個 0 加一句安慰話——把「沒東西可分析」講成「分析結果良好」。
  idle: { label: "尚未啟用", hint: "這個組還沒有 AI 執行計畫——可到專案頁用「執行計畫」發起，或在下方問組彙總 AI" },
  healthy: { label: "狀態穩定", hint: "目前沒有需要立刻處理的代理阻塞" },
  attention: { label: "需要關注", hint: "有進行中的計畫、待核或近期失敗——先掃一眼下方清單" },
  blocked: { label: "有阻塞", hint: "近期失敗且仍有等待／待核——優先到對應專案處理" },
};

/** 人員阻塞把健康度往上推時要換一句話——否則畫面會說「狀態穩定」旁邊卻列著兩項逾期 */
const PEOPLE_HEALTH_HINT: Record<string, string> = {
  attention: "有人員任務在等或即將到期——見下方「誰卡住了」",
  blocked: "有人員任務逾期或關卡卡住，AI 停在那裡等人——先處理下方「誰卡住了」",
};

type TeamHealth = "idle" | "healthy" | "attention" | "blocked";
const HEALTH_SEVERITY: Record<TeamHealth, number> = { idle: 0, healthy: 1, attention: 2, blocked: 3 };

/**
 * 代理健康度 ＋ 人員阻塞健康度 → 這張卡真正該顯示的健康度。
 *
 * 為什麼要合：run 狀態與人類任務是兩個資料源，只看前者就會出現「狀態穩定」旁邊
 * 列著兩項逾期任務的自相矛盾畫面——而那兩項逾期正是 AI 停下來等的東西。
 * 取兩者中較嚴重的；`idle`（從沒發起過計畫）只有在人員面也沒事時才保留，
 * 因為「沒用過 AI」不代表「沒有事情卡住」。
 */
export function mergeTeamHealth(
  runHealth: TeamHealth | undefined,
  peopleStatus: "healthy" | "attention" | "blocked" | undefined,
): { health: TeamHealth; fromPeople: boolean } {
  const run = runHealth ?? "healthy";
  // 只有 attention／blocked 算「人員面有事」。people=healthy 不能當成升級訊號，
  // 否則它的嚴重度（1）會蓋掉 idle（0），讓空組又變回「狀態穩定」。
  if (
    (peopleStatus === "attention" || peopleStatus === "blocked")
    && HEALTH_SEVERITY[peopleStatus] > HEALTH_SEVERITY[run]
  ) {
    return { health: peopleStatus, fromPeople: true };
  }
  return { health: run, fromPeople: false };
}

/** 一件「等人裁決」的事：四種來源合流成同一份收件匣 */
type DecisionKind = "agent" | "task" | "scene" | "generation";
type PendingDecisionSource = {
  projectId: string;
  projectTitle: string;
  pendingApprovals: number;
  awaitingGenerations: number;
  oldestPendingApprovalAt?: Date | string | null;
  oldestAwaitingGenerationAt?: Date | string | null;
};
/** 組級洞察裡的一項人類核准節點（來自 teamAssistant.groupInsights 的 workItems） */
type PendingTaskSource = {
  taskId: string;
  projectId: string;
  projectTitle: string;
  title: string;
  dueAt?: Date | string | null;
};
type DecisionItem = {
  key: string;
  kind: DecisionKind;
  projectId: string;
  projectTitle: string;
  /** 這件事是什麼（代理＝目標原文，其餘＝件數描述） */
  what: string;
  /** 最久的那一件是什麼時候進待辦的（用來排「卡最久的排前面」）；查不到就排最後 */
  since: Date | null;
  /** 只有代理計畫有：可在這張卡就地核准／放棄（走既有 agents.approve／discard，不另開扣點路徑） */
  runId?: string;
  estPoints?: number;
  /** 只有人類核准節點有：走既有 tasks.decideApproval */
  taskId?: string;
  /** 代理計畫的發起人（用來比照專案頁判斷能不能就地核准） */
  ownerId?: string | null;
};

const DECISION_META: Record<DecisionKind, { label: string; hint: string }> = {
  agent: { label: "計畫待核", hint: "核准後才開始執行、才開始花點" },
  task: { label: "人員核准", hint: "代理計畫卡在這個人類關卡，核准或退回都會喚醒後續步驟" },
  scene: { label: "分鏡送審", hint: "要看過內容才能裁決，到專案頁決定" },
  generation: { label: "生成待核", hint: "達組內成本門檻的生成，核准才會送出" },
};

/**
 * 空組起手式用的三個 playbook。
 *
 * 刻意只挑三個而不是全部列出：起手式的作用是「降低第一步的門檻」，
 * 給七個選項等於把選擇成本原封不動還給使用者。這三個涵蓋最常見的起點——
 * 從腳本拆分鏡、直接出媒體、先把計畫講清楚。
 */
const STARTER_PLAYBOOK_IDS = ["playbook.storyboard.v1", "playbook.creation.short.v1", "playbook.director.v1"] as const;

/** 收件匣一次最多列幾件：再多就是清單而不是「先做這幾件」 */
const DECISION_INBOX_MAX = 6;

/**
 * 能不能就地裁決這份代理計畫。
 *
 * 與 approveAgentCore 的守門同一條規則（組員只能裁自己發起的），也與專案頁
 * AgentCard 的 canControl 一致。不比照的話，一般組員會看到別人計畫上的「核准」鈕，
 * 按下去必定吃 FORBIDDEN——畫面對能力說謊。看得到但不能裁的，一律導去專案頁。
 */
export function canDecideRun(
  item: { ownerId?: string | null },
  isLeader: boolean,
  myUserId?: string,
): boolean {
  if (isLeader) return true;
  return Boolean(myUserId) && item.ownerId === myUserId;
}

/** 卡了幾天（未滿一天回 0；沒有時間戳回 null，呼叫端不顯示） */
function daysStuck(since: Date | null, nowMs: number): number | null {
  if (!since) return null;
  return Math.max(0, Math.floor((nowMs - since.getTime()) / 86_400_000));
}

/**
 * 到期日的人話（未來／過去都要對）。
 *
 * 不能直接套 relTime：它只算「過去多久」，未來的日期會被算成負數再夾到 1 分鐘，
 * 於是「三天後到期」顯示成「1 分鐘前」——最該提醒的那種欄位反而在說謊。
 */
export function dueLabel(due: Date | string | null | undefined, nowMs: number = Date.now()): string | null {
  if (!due) return null;
  const t = due instanceof Date ? due.getTime() : new Date(due).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.round((t - nowMs) / 86_400_000);
  if (days < 0) return `逾期 ${-days} 天`;
  if (days === 0) return "今天到期";
  return `${days} 天後到期`;
}

/**
 * 三種待裁決來源 → 一份排序好的收件匣（純函式，便於測）。
 *
 * 排序＝卡最久的排前面（沒有時間戳的排最後），因為這張卡的問題從來不是「有沒有資料」，
 * 而是「我現在該先處理哪一件」。同時間才用類別穩定排序，避免每次輪詢跳動。
 */
export function buildDecisionInbox(
  runs: Array<{ id: string; projectId: string; projectTitle: string; goal: string; status: string; estPoints: number; updatedAt: Date | string; userId?: string | null }>,
  pending: PendingDecisionSource[],
  tasks: PendingTaskSource[] = [],
): DecisionItem[] {
  const toDate = (v: Date | string | null | undefined): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const items: DecisionItem[] = [];
  for (const r of runs) {
    if (r.status !== "awaiting_approval") continue;
    items.push({
      key: `agent-${r.id}`, kind: "agent", projectId: r.projectId, projectTitle: r.projectTitle,
      what: r.goal, since: toDate(r.updatedAt), runId: r.id, estPoints: r.estPoints,
      ownerId: r.userId ?? null,
    });
  }
  for (const t of tasks) {
    items.push({
      key: `task-${t.taskId}`, kind: "task", projectId: t.projectId, projectTitle: t.projectTitle,
      // 到期日就是「該在什麼時候之前決定」，拿它當卡住基準比建立時間更貼近使用者感受
      what: t.title, since: toDate(t.dueAt), taskId: t.taskId,
    });
  }
  for (const p of pending) {
    if (p.pendingApprovals > 0) {
      items.push({
        key: `scene-${p.projectId}`, kind: "scene", projectId: p.projectId, projectTitle: p.projectTitle,
        what: `${p.pendingApprovals} 個分鏡等你裁決`, since: toDate(p.oldestPendingApprovalAt),
      });
    }
    if (p.awaitingGenerations > 0) {
      items.push({
        key: `generation-${p.projectId}`, kind: "generation", projectId: p.projectId, projectTitle: p.projectTitle,
        what: `${p.awaitingGenerations} 筆生成等你核准`, since: toDate(p.oldestAwaitingGenerationAt),
      });
    }
  }
  const ORDER: DecisionKind[] = ["agent", "task", "scene", "generation"];
  return items.sort((a, b) => {
    const ta = a.since?.getTime() ?? Number.POSITIVE_INFINITY;
    const tb = b.since?.getTime() ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind);
  });
}

type RunFilter = "all" | "active" | "awaiting_approval" | "waiting" | "running" | "failed" | "done";

const RUN_FILTERS: Array<{ id: RunFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "active", label: "進行中" },
  { id: "awaiting_approval", label: "待核准" },
  { id: "waiting", label: "等人" },
  { id: "running", label: "執行中" },
  { id: "failed", label: "失敗" },
  { id: "done", label: "完成" },
];

function matchesRunFilter(status: string, filter: RunFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status === "running" || status === "waiting" || status === "awaiting_approval";
  return status === filter;
}

/**
 * 組彙總 AI 卡：① 團隊分析（全組代理健康／篩選清單）② 可追問的組彙總對話 ③ 派工。
 * 對話只存前端狀態（重整即清空）；唯讀彙總本身不改資料。
 */
function TeamAssistantCard({
  groupId,
  pendingDecisions,
  pendingLoading,
  pendingFailed,
  starterProjects,
  isLeader,
  myUserId,
}: {
  groupId: string;
  /** 組內「分鏡送審／生成待核」的 per-project 計數（由 Launchpad 已查到的 pendingSummary 傳入） */
  pendingDecisions: PendingDecisionSource[];
  pendingLoading: boolean;
  pendingFailed: boolean;
  /** 起手式的「在哪個專案發起」下拉；沿用這一頁已查到的專案清單，不另發查詢 */
  starterProjects: Array<{ id: string; title: string; status: string }>;
  /** 與專案頁同一條規則：組長以上、或自己發起的計畫，才可就地核准 */
  isLeader: boolean;
  myUserId?: string;
}) {
  const utils = trpc.useUtils();
  const [question, setQuestion] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const ask = trpc.teamAssistant.ask.useMutation();
  const dispatch = trpc.teamAssistant.dispatch.useMutation();
  // 就地裁決代理計畫：沿用專案頁同一組 mutation（守門／額度／併發鎖全在 approveAgentCore 裡，
  // 這裡只是換一個入口，沒有第二條扣點路徑）
  const approveRun = trpc.agents.approve.useMutation();
  const discardRun = trpc.agents.discard.useMutation();
  const decideTask = trpc.tasks.decideApproval.useMutation();
  // 組級洞察：人類任務阻塞與「誰卡住了」。與 agentOverview 分開查——一條是狀態計數、
  // 一條是判斷結果，合成一支會讓計數也被 100/300 的洞察上限綁住。
  const insights = trpc.teamAssistant.groupInsights.useQuery(
    { groupId },
    { refetchInterval: (q) => ((q.state.data?.activeRuns ?? 0) > 0 ? 30_000 : false) },
  );
  const overview = trpc.teamAssistant.agentOverview.useQuery(
    { groupId },
    {
      refetchInterval: (q) => ((q.state.data?.summary?.active ?? 0) > 0 ? 8000 : false),
    },
  );
  const roles = trpc.agents.listRoles.useQuery(undefined, { staleTime: 10 * 60_000 });
  const [dispatched, setDispatched] = useState<Record<string, DispatchResult>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [starterProjectId, setStarterProjectId] = useState("");
  const [runsCollapsed, setRunsCollapsed] = useState(false);
  const [runFilter, setRunFilter] = useState<RunFilter>("active");
  useEffect(() => {
    try { setRunsCollapsed(localStorage.getItem(RUNS_COLLAPSE_KEY(groupId)) === "1"); }
    catch { /* 無痕模式：讀不到就當展開 */ }
    setRunFilter("active");
  }, [groupId]);
  const toggleRuns = () => {
    const next = !runsCollapsed;
    setRunsCollapsed(next);
    try { localStorage.setItem(RUNS_COLLAPSE_KEY(groupId), next ? "1" : "0"); } catch { /* 無痕模式 */ }
  };
  const canAsk = !!question.trim() && !ask.isPending;
  const submit = () => {
    if (!canAsk) return;
    const q = question.trim();
    const history = msgs.slice(-6).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((prev) => [...prev, { role: "user", text: q }]);
    setQuestion("");
    ask.mutate(
      { groupId, message: q, history },
      {
        onSuccess: (d) => {
          setMsgs((prev) => [...prev, {
            role: "assistant", text: d.answer, steps: d.steps, dispatches: d.dispatches as Dispatch[],
            rationale: d.rationale ?? undefined, contextUsed: d.contextUsed ?? [], degraded: d.degraded ?? false,
          }]);
          if ((d.dispatches?.length ?? 0) > 0) overview.refetch();
        },
      },
    );
  };
  const canDispatchHint = ask.data?.canDispatch ?? false;
  const summary = overview.data?.summary;
  const runs = overview.data?.runs ?? [];
  const totalRuns = overview.data?.totalRuns ?? runs.length;
  const listLimit = overview.data?.listLimit ?? runs.length;
  const activeRuns = summary?.active ?? 0;
  const filteredRuns = useMemo(
    () => runs.filter((r) => matchesRunFilter(r.status, runFilter)),
    [runs, runFilter],
  );
  // 預設「進行中」若為空且列表有其他狀態，自動提示可切全部
  const merged = mergeTeamHealth(summary?.health, insights.data?.status);
  const healthMeta = {
    ...(HEALTH_LABEL[merged.health] ?? HEALTH_LABEL.healthy),
    // 被人員阻塞推上去時要換一句話，否則會出現「狀態穩定」旁邊列著兩項逾期
    hint: merged.fromPeople
      ? (PEOPLE_HEALTH_HINT[merged.health] ?? HEALTH_LABEL[merged.health].hint)
      : (HEALTH_LABEL[merged.health] ?? HEALTH_LABEL.healthy).hint,
  };
  // 人類核准節點由伺服器明列（pendingApprovalTasks），不從 blockers 的文案反推——
  // 靠標籤前綴猜「這是不是核准節點」會在文案一改就默默漏件。
  const pendingTasks = insights.data?.pendingApprovalTasks ?? [];
  const inbox = useMemo(
    () => buildDecisionInbox(runs, pendingDecisions, pendingTasks),
    [runs, pendingDecisions, pendingTasks],
  );
  // 起手式：只在「這個組還沒用過代理」時出現，用完就消失（不長期佔第一屏）。
  // 目標文字直接取自 playbook 模板——與專案頁的「執行計畫」同一組敘事，不另編一套。
  const starters = useMemo(() => {
    const projects = (starterProjects ?? []).filter((p) => p.status !== "archived");
    const playbooks = roles.data?.playbooks ?? [];
    const items = STARTER_PLAYBOOK_IDS
      .map((id) => playbooks.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ id: p.id, playbookId: p.id, title: p.title, goal: p.goalTemplate }));
    return {
      // 沒有專案可派、或這組已經用過代理，就不佔版面
      show: !overview.isLoading && summary?.hasRuns === false && projects.length > 0 && items.length > 0,
      projects,
      items,
    };
  }, [starterProjects, roles.data, overview.isLoading, summary?.hasRuns]);
  useEffect(() => {
    if (starters.projects.length && !starters.projects.some((p) => p.id === starterProjectId)) {
      setStarterProjectId(starters.projects[0].id);
    }
  }, [starters.projects, starterProjectId]);

  // 代理產出與計畫疑慮：兩段都空就不渲染
  const agentOutput = useMemo(() => {
    const results = insights.data?.groupResults ?? [];
    const concerns = insights.data?.planConcerns ?? [];
    return { show: results.length > 0 || concerns.length > 0, results, concerns };
  }, [insights.data]);
  // 「誰卡住了」：沒有任何人員任務也沒有阻塞時整段不渲染——空區塊只會佔版面、不傳達資訊
  const stuck = useMemo(() => {
    const d = insights.data;
    const people = d?.people ?? [];
    const projects = (d?.byProject ?? []).filter((p) => p.blockers > 0 || p.overdueTasks > 0);
    return {
      show: !!d && (people.length > 0 || projects.length > 0),
      people, projects,
      openTasks: d?.openTasks ?? 0,
      overdueTasks: d?.overdueTasks ?? 0,
    };
  }, [insights.data]);
  // 每次 render 取一次「現在」：同一畫面上的「卡了 N 天」不該用到兩個不同的基準時間
  const nowMs = Date.now();
  const [decidingKey, setDecidingKey] = useState<string | null>(null);
  const decideError = approveRun.error ?? discardRun.error ?? decideTask.error;
  /** 就地裁決後：代理清單、組級洞察、跨專案待辦、專案卡角標都要跟上（四處看的是同一件事） */
  const afterDecide = () => {
    overview.refetch();
    insights.refetch();
    utils.approvals.pendingSummary.invalidate();
    utils.projects.invalidate();
  };

  return (
    <Card as="section" className="team-ai-card" data-fb="組彙總AI卡">
      {/* ── 團隊分析：全組代理匯總（非聊天） ── */}
      <div className="team-analysis" aria-labelledby="team-analysis-title">
        <div className="team-analysis__head">
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>全組代理</p>
            <h3 id="team-analysis-title" style={{ margin: "2px 0 0", fontSize: "1.05rem" }}>團隊分析</h3>
          </div>
          {summary && (
            <span
              className={`team-analysis__health is-${merged.health}`}
              title={healthMeta.hint}
            >
              {healthMeta.label}
              {summary.activeProjects > 0 ? `・${summary.activeProjects} 專案活動` : ""}
            </span>
          )}
        </div>
        {overview.isLoading && <Skeleton height={48} style={{ marginTop: 10 }} />}
        {overview.error && (
          <p className="error" role="alert" style={{ marginTop: 8 }}>
            代理動態載入失敗——
            <Button variant="ghost" size="sm" onClick={() => overview.refetch()}>再試一次</Button>
          </p>
        )}

        {/* ── 待我裁決：這張卡的第一屏。
            原本第一屏是五個計數＋一句「目前不需要立即處理」，但同一頁其實已經查到
            分鏡送審／生成待核的筆數——組內有東西卡著，這張叫「團隊分析」的卡照樣顯示全 0。
            現在三種「等人決定」的來源合流成一份收件匣，卡最久的排前面；計數降到第二屏。 ── */}
        {!overview.isLoading && (
          <div className="team-inbox" aria-label="待我裁決">
            <div className="team-inbox__head">
              <strong>待我裁決</strong>
              <Meta>
                {pendingLoading && inbox.length === 0 ? "統計中…" : `${inbox.length} 件`}
                {pendingFailed ? "・跨專案待辦載入失敗，可能少列" : ""}
              </Meta>
            </div>
            {inbox.length === 0 ? (
              <Hint layer="always" style={{ margin: 0 }}>
                {pendingFailed
                  ? "跨專案待辦載入失敗，暫時無法確認有沒有待裁決事項。"
                  : summary?.hasRuns
                    ? "沒有等你決定的事項——代理計畫、分鏡送審、生成核准都清空了。"
                    : "這個組還沒開始用 AI 代理。下面挑一個起手式就能發起第一份計畫（建立計畫免費，核准後才花點）。"}
              </Hint>
            ) : (
              <div className="team-inbox__list">
                {inbox.slice(0, DECISION_INBOX_MAX).map((d) => {
                  const meta = DECISION_META[d.kind];
                  const stuck = daysStuck(d.since, nowMs);
                  const busy = decidingKey === d.key;
                  return (
                    <div key={d.key} className={`team-inbox__row is-${d.kind}`}>
                      <Chip style={{ margin: 0 }} title={meta.hint}>{meta.label}</Chip>
                      <span className="team-inbox__copy">
                        <Link href={`/p/${d.projectId}`} title="開啟這個專案">{d.projectTitle}</Link>
                        <span title={d.what}>{d.what}</span>
                      </span>
                      <Meta className="team-inbox__age">
                        {stuck === null ? "—" : stuck === 0 ? "今天" : `卡了 ${stuck} 天`}
                        {d.kind === "agent" && d.estPoints != null ? `・估 ${d.estPoints} 點` : ""}
                      </Meta>
                      <span className="team-inbox__act">
                        {d.kind === "agent" && d.runId && canDecideRun(d, isLeader, myUserId) ? (
                          <>
                            {/* 就地核准／放棄：走專案頁同一支 mutation。核准這一刻起才開始花點，
                                所以一定要二次確認並把估點寫在確認訊息裡。 */}
                            <ConfirmButton
                              triggerClassName="btn-tonal btn-sm"
                              disabled={busy}
                              title="核准後代理才開始執行、才開始花點"
                              message={`核准「${d.projectTitle}」的執行計畫？\n${d.what}\n核准後背景執行器會接手，估 ${d.estPoints ?? 0} 點。`}
                              confirmLabel="核准並開始"
                              onConfirm={async () => {
                                setDecidingKey(d.key);
                                try {
                                  await approveRun.mutateAsync({ runId: d.runId! });
                                  afterDecide();
                                } catch {
                                  /* approveRun.error 已顯示 */
                                } finally {
                                  setDecidingKey((k) => (k === d.key ? null : k));
                                }
                              }}
                            >
                              核准
                            </ConfirmButton>
                            <ConfirmButton
                              triggerClassName="btn-ghost btn-sm"
                              disabled={busy}
                              title="放棄這份還沒核准的計畫（不花點）"
                              message={`放棄「${d.projectTitle}」的執行計畫？\n${d.what}\n計畫會被丟棄，不會花點；要再做得重新規劃。`}
                              confirmLabel="放棄計畫"
                              onConfirm={async () => {
                                setDecidingKey(d.key);
                                try {
                                  await discardRun.mutateAsync({ runId: d.runId! });
                                  afterDecide();
                                } catch {
                                  /* discardRun.error 已顯示 */
                                } finally {
                                  setDecidingKey((k) => (k === d.key ? null : k));
                                }
                              }}
                            >
                              放棄
                            </ConfirmButton>
                          </>
                        ) : d.kind === "task" && d.taskId ? (
                          <>
                            {/* 人類核准節點：要決定的內容就是任務標題本身（不像分鏡要看圖），
                                所以可以就地裁決；走 tasks.decideApproval，喚醒邏輯留在 core 裡 */}
                            <ConfirmButton
                              triggerClassName="btn-tonal btn-sm"
                              disabled={busy}
                              title="核准這個人類關卡，讓計畫的後續步驟繼續"
                              message={`核准「${d.projectTitle}」的人員關卡？\n${d.what}\n核准後計畫的後續步驟會被喚醒繼續執行。`}
                              confirmLabel="核准並繼續"
                              onConfirm={async () => {
                                setDecidingKey(d.key);
                                try {
                                  await decideTask.mutateAsync({ id: d.taskId!, decision: "approve" });
                                  afterDecide();
                                } catch {
                                  /* decideTask.error 已顯示 */
                                } finally {
                                  setDecidingKey((k) => (k === d.key ? null : k));
                                }
                              }}
                            >
                              核准
                            </ConfirmButton>
                            <ConfirmButton
                              triggerClassName="btn-ghost btn-sm"
                              disabled={busy}
                              title="退回這個關卡（計畫不會繼續往下走）"
                              message={`退回「${d.projectTitle}」的人員關卡？\n${d.what}\n計畫不會繼續往下走，需要重新處理後再送一次。`}
                              confirmLabel="退回"
                              onConfirm={async () => {
                                setDecidingKey(d.key);
                                try {
                                  await decideTask.mutateAsync({ id: d.taskId!, decision: "reject" });
                                  afterDecide();
                                } catch {
                                  /* decideTask.error 已顯示 */
                                } finally {
                                  setDecidingKey((k) => (k === d.key ? null : k));
                                }
                              }}
                            >
                              退回
                            </ConfirmButton>
                          </>
                        ) : (
                          /* 分鏡／生成刻意不就地裁決：不看內容就按核准等於盲簽 */
                          <Link href={`/p/${d.projectId}?focus=pending`} title={meta.hint}>前往處理 →</Link>
                        )}
                      </span>
                    </div>
                  );
                })}
                {inbox.length > DECISION_INBOX_MAX && (
                  <Meta as="p" style={{ margin: 0 }}>
                    還有 {inbox.length - DECISION_INBOX_MAX} 件——先處理上面卡最久的幾件。
                  </Meta>
                )}
              </div>
            )}
            {decideError && <p className="error" role="alert" style={{ margin: 0 }}>{decideError.message}</p>}
          </div>
        )}

        {/* ── 起手式：空組的第一屏不能只有一句「沒有東西」。
            用既有的 playbook 目標模板當三個起點，選一個專案就能發起——
            所有守門仍在 planAgentCore 裡，這裡只是把入口搬到看得到的地方。 ── */}
        {starters.show && (
          <div className="team-starters" aria-label="起手式">
            <div className="team-starters__head">
              <strong>從這裡開始</strong>
              <Meta>建立計畫免費，核准後才開始花點</Meta>
            </div>
            <label htmlFor="ta-starter-project" style={{ marginTop: 0 }}>要在哪個專案發起</label>
            <select
              id="ta-starter-project"
              value={starterProjectId}
              onChange={(e) => setStarterProjectId(e.target.value)}
              style={{ width: "auto", maxWidth: "100%" }}
            >
              {starters.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
            <div className="team-starters__list">
              {starters.items.map((s) => {
                const key = `starter-${s.id}`;
                const done = dispatched[key];
                const target = starters.projects.find((p) => p.id === starterProjectId);
                return done ? (
                  <Hint key={key} as="div" layer="always" style={{ color: "var(--success-ink)" }}>
                    ✓ 已建立「{s.title}」的執行計畫（估 {done.estPoints} 點）：{done.summary}
                    <Link href={`/p/${done.projectId}?focus=agent-run-${done.runId}`} style={{ marginLeft: 6 }}>到專案核准 →</Link>
                  </Hint>
                ) : (
                  <ConfirmButton
                    key={key}
                    triggerClassName="btn-tonal btn-sm"
                    disabled={!target || pendingKey === key}
                    title={s.goal}
                    message={`在「${target?.title ?? ""}」發起 AI 執行計畫：${s.goal}？\n會建立一份待核准計畫，仍需到該專案核准才會開始執行、花點。`}
                    confirmLabel="發起計畫"
                    onConfirm={async () => {
                      if (!target) return;
                      setPendingKey(key);
                      try {
                        const r = await dispatch.mutateAsync({
                          groupId,
                          projectId: target.id,
                          goal: s.goal,
                          // playbook 一併帶上：同一句目標帶不帶 playbook 排出來的步驟骨架不同
                          playbookId: s.playbookId,
                        });
                        setDispatched((prev) => ({ ...prev, [key]: r }));
                        utils.projects.invalidate();
                        overview.refetch();
                        insights.refetch();
                        setRunFilter("awaiting_approval");
                        setRunsCollapsed(false);
                      } catch {
                        /* dispatch.error 已顯示 */
                      } finally {
                        setPendingKey((k) => (k === key ? null : k));
                      }
                    }}
                  >
                    <Icon name="Play" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                    {s.title}
                  </ConfirmButton>
                );
              })}
            </div>
            {dispatch.error && <p className="error" role="alert" style={{ margin: 0 }}>{dispatch.error.message}</p>}
          </div>
        )}

        {/* ── 誰卡住了：把未結人類任務歸到人與專案。
            這張卡原本只看得到 agent_runs，於是「7 項人員任務逾期」這種最該被看見的
            阻塞完全不在畫面上——AI 停著等人，畫面卻說一切正常。 ── */}
        {stuck.show && (
          <div className="team-stuck" aria-label="誰卡住了">
            <div className="team-stuck__head">
              <strong>誰卡住了</strong>
              <Meta>
                {stuck.openTasks} 項人員任務進行中
                {stuck.overdueTasks > 0 ? `・${stuck.overdueTasks} 項逾期` : ""}
              </Meta>
            </div>
            <div className="team-stuck__cols">
              <div>
                <Meta as="p" style={{ margin: "0 0 4px" }}>依人員</Meta>
                {stuck.people.length === 0 ? (
                  <Hint layer="always" style={{ margin: 0 }}>沒有進行中的人員任務。</Hint>
                ) : (
                  <ul className="team-stuck__list">
                    {stuck.people.map((p) => (
                      <li key={p.userId ?? "unassigned"}>
                        <span className="team-stuck__who">{p.userId ? (p.name ?? "（未命名成員）") : "尚未指派"}</span>
                        <Meta>
                          {p.openTasks} 項
                          {p.overdueTasks > 0 ? `・${p.overdueTasks} 逾期` : ""}
                          {dueLabel(p.earliestDueAt, nowMs) ? `・最近一件：${dueLabel(p.earliestDueAt, nowMs)}` : ""}
                        </Meta>
                      </li>
                    ))}
                  </ul>
                )}
                {insights.data?.peopleTruncated && (
                  <Meta as="p" style={{ margin: "4px 0 0" }}>人數較多，只列最卡的前幾位。</Meta>
                )}
              </div>
              <div>
                <Meta as="p" style={{ margin: "0 0 4px" }}>依專案</Meta>
                {stuck.projects.length === 0 ? (
                  <Hint layer="always" style={{ margin: 0 }}>沒有專案有阻塞。</Hint>
                ) : (
                  <ul className="team-stuck__list">
                    {stuck.projects.map((p) => (
                      <li key={p.projectId}>
                        <Link href={`/p/${p.projectId}`} className="team-stuck__who">{p.projectTitle}</Link>
                        <Meta>
                          {p.criticalBlockers > 0 ? `${p.criticalBlockers} 項嚴重・` : ""}
                          {p.blockers} 項阻塞
                          {p.overdueTasks > 0 ? `・${p.overdueTasks} 逾期` : ""}
                        </Meta>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {insights.data && (insights.data.truncated.runs || insights.data.truncated.tasks) && (
              <Meta as="p" style={{ margin: 0 }}>
                資料量已達分析上限，這裡是抽樣結果——完整清單請到各專案頁看。
              </Meta>
            )}
            {insights.data && insights.data.blockersTotal > insights.data.blockers.length && (
              /* 阻塞清單有顯示上限，依專案的統計卻是全量；不講清楚兩個數字看起來會像對不上 */
              <Meta as="p" style={{ margin: 0 }}>
                共 {insights.data.blockersTotal} 項阻塞（明細只列前 {insights.data.blockers.length} 項；上方依專案的統計是全部）。
              </Meta>
            )}
          </div>
        )}
        {/* ── 代理做出了什麼：計畫不是只有狀態，還有產出。
            沒有這一段，這張卡只回答得了「跑到哪」，回答不了「做出了什麼」。 ── */}
        {agentOutput.show && (
          <div className="team-output" aria-label="代理產出與計畫疑慮">
            {agentOutput.results.length > 0 && (
              <div>
                <div className="team-output__head">
                  <strong>代理已產出</strong>
                  <Meta>
                    {agentOutput.results.length} 項
                    {insights.data?.truncated.results ? "（已達顯示上限）" : ""}
                  </Meta>
                </div>
                <div className="team-output__chips">
                  {agentOutput.results.map((r) => (
                    <Link
                      key={`${r.type}:${r.id}`}
                      href={`/p/${r.projectId}?focus=agent-run-${r.runId}`}
                      className="team-output__chip"
                      title={`在「${r.projectTitle}」由計畫的某一步產出——點開會定位到那一步`}
                    >
                      <span className="team-output__kind">{agentOutputKindLabel(r.type)}</span>
                      {r.label}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {agentOutput.concerns.length > 0 && (
              <div>
                <div className="team-output__head">
                  <strong>計畫還缺什麼</strong>
                  <Meta>
                    待補資訊 {insights.data?.unresolvedInformation ?? 0}
                    ・風險 {insights.data?.risks ?? 0}
                  </Meta>
                </div>
                <ul className="team-stuck__list">
                  {agentOutput.concerns.map((c) => (
                    <li key={c.runId}>
                      <Link
                        href={`/p/${c.projectId}?focus=agent-run-${c.runId}`}
                        className="team-stuck__who"
                        title={c.goal}
                      >
                        {c.projectTitle}｜{c.goal}
                      </Link>
                      <Meta>
                        {c.missingInformation > 0 ? `待補 ${c.missingInformation}` : ""}
                        {c.missingInformation > 0 && c.risks > 0 ? "・" : ""}
                        {c.risks > 0 ? `風險 ${c.risks}` : ""}
                      </Meta>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {insights.error && (
          <p className="error" role="alert" style={{ margin: "8px 0 0" }}>
            人員阻塞分析載入失敗——
            <Button variant="ghost" size="sm" onClick={() => insights.refetch()}>再試一次</Button>
          </p>
        )}

        {/* 健康度徽章旁的解釋：徽章本身已有文字標籤，這句是補充 → 引導層 */}
        <Hint style={{ margin: "8px 0 0" }}>{healthMeta.hint}</Hint>
      </div>

      {/* ── 組執行計畫動態 ── */}
      <div className="team-runs-block">
        <button
          type="button"
          className="team-runs-toggle"
          onClick={toggleRuns}
          aria-expanded={!runsCollapsed}
          aria-controls="team-agent-runs"
          title={runsCollapsed ? "展開組執行計畫動態" : "收合組執行計畫動態"}
        >
          <Icon name="Sparkles" size={13} />
          <span>組執行計畫動態</span>
          {/* 在 <button> 內，必須用 span（<p> 會是無效 HTML）；筆數是狀態不是說明。
              載入中／失敗要講出來——空手顯示「（0 筆）」會被讀成「這組沒有計畫」。 */}
          <Meta>
            （{overview.isLoading
              ? "載入中…"
              : overview.error
                ? "載入失敗"
                : `${totalRuns} 筆${activeRuns > 0 ? `・${activeRuns} 進行中` : ""}`}）
          </Meta>
          <Icon name={runsCollapsed ? "ChevronDown" : "ChevronUp"} size={13} style={{ marginLeft: "auto" }} />
        </button>
        <div id="team-agent-runs" hidden={runsCollapsed}>
          {/* 計數降到第二屏：它們回答「整體狀況如何」，而第一屏要回答的是「我現在該做什麼」 */}
          {summary && !overview.isLoading && (
            <div className="team-analysis__stats" role="group" aria-label="代理狀態計數">
              <button type="button" className={`team-stat${runFilter === "running" ? " is-on" : ""}`} onClick={() => setRunFilter("running")}>
                <strong>{summary.running}</strong><small>執行中</small>
              </button>
              <button type="button" className={`team-stat${runFilter === "waiting" ? " is-on" : ""}`} onClick={() => setRunFilter("waiting")}>
                <strong>{summary.waiting}</strong><small>等待人員</small>
              </button>
              <button type="button" className={`team-stat${runFilter === "awaiting_approval" ? " is-on" : ""}`} onClick={() => setRunFilter("awaiting_approval")}>
                <strong>{summary.awaitingApproval}</strong><small>待核准</small>
              </button>
              <button type="button" className={`team-stat${runFilter === "failed" ? " is-on" : ""}`} onClick={() => setRunFilter("failed")}>
                <strong>{summary.failedRecent}</strong><small>近七日失敗</small>
              </button>
              <button type="button" className={`team-stat${runFilter === "done" ? " is-on" : ""}`} onClick={() => setRunFilter("done")}>
                <strong>{summary.doneRecent}</strong><small>近七日完成</small>
              </button>
            </div>
          )}
          {runs.length > 0 && (
            <div className="team-run-filters" role="toolbar" aria-label="依狀態篩選代理">
              {RUN_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`chip pick${runFilter === f.id ? " is-on" : ""}`}
                  aria-pressed={runFilter === f.id}
                  onClick={() => setRunFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {runs.length === 0 && !overview.isLoading && !overview.error && (
            /* 空清單時這句是唯一的下一步指引，收起來就變成一片空白 */
            <Hint layer="always" style={{ marginTop: 8 }}>
              還沒有計畫可顯示。到專案頁用「執行計畫」發起後，這裡會列出全組進度。
            </Hint>
          )}
          {runs.length > 0 && filteredRuns.length === 0 && (
            /* 「篩選後沒東西」＋還原辦法，藏起來會讓人以為資料不見了 */
            <Hint layer="always" style={{ marginTop: 8 }}>
              目前篩選下沒有計畫——
              <Button variant="ghost" size="sm" onClick={() => setRunFilter("all")}>改看全部</Button>
            </Hint>
          )}
          {filteredRuns.length > 0 && (
            <div className="team-run-list" style={{ marginTop: 8 }}>
              {filteredRuns.map((r) => {
                const st = RUN_STATUS[r.status] ?? { label: r.status };
                const progress = r.totalSteps > 0 ? Math.min(100, Math.round((r.doneSteps / r.totalSteps) * 100)) : 0;
                const href = `/p/${r.projectId}?focus=agent-run-${r.id}`;
                return (
                  <div key={r.id} className={`team-run-row is-${r.status}`}>
                    <Chip style={{ margin: 0, color: st.color, borderColor: st.color }}>{st.label}</Chip>
                    <span className="team-run-row__copy">
                      <Link href={href} title="開啟專案並定位此計畫">{r.projectTitle}</Link>
                      <span title={r.goal}>{r.goal}</span>
                      {r.currentStepNote && (
                        <span className="team-run-row__step" title={r.currentStepNote}>
                          現在：{r.currentStepNote}
                        </span>
                      )}
                      {r.error && r.status === "failed" && (
                        <span className="team-run-row__err" title={r.error}>{r.error}</span>
                      )}
                      <span className="team-run-row__track" aria-label={`完成 ${progress}%`}>
                        <span style={{ width: `${progress}%` }} />
                      </span>
                    </span>
                    <span className="team-run-row__meta">
                      {r.totalSteps > 0 ? `${r.doneSteps}/${r.totalSteps} 步` : "—"}
                      ・估 {r.estPoints} 點
                      {r.userName ? `・${r.userName}` : ""}
                      ・{relTime(r.updatedAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {/* 清單有上限而計數沒有：不講清楚，使用者會把「30 筆」當成全組總量 */}
          {totalRuns > listLimit && (
            <Meta as="p" style={{ margin: "8px 0 0" }}>
              清單只顯示最近 {listLimit} 筆（全組共 {totalRuns} 筆）；上方計數統計的是全部。
              {summary && summary.stoppedRecent > 0 ? `近七日另有 ${summary.stoppedRecent} 筆被停止。` : ""}
            </Meta>
          )}
          {totalRuns <= listLimit && summary && summary.stoppedRecent > 0 && (
            <Meta as="p" style={{ margin: "8px 0 0" }}>近七日另有 {summary.stoppedRecent} 筆被停止。</Meta>
          )}
        </div>
      </div>

      {/* ── 組彙總對話 ── */}
      <div className="team-chat-block">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <label htmlFor="ta-question" style={{ marginTop: 0 }}>組彙總 AI</label>
            <input
              id="ta-question"
              value={question}
              maxLength={500}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={msgs.length ? "接著追問…（記得上下文）" : "問問整組狀況：哪個案子卡住了？這週花了多少點？"}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
          </div>
          <button className="primary" disabled={!canAsk} onClick={submit}>
            {ask.isPending ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-8)" }}>
                <Icon name="Loader" className="spin" />
                詢問中…
              </span>
            ) : (
              msgs.length ? "追問" : "詢問"
            )}
          </button>
        </div>

        {msgs.length === 0 && !ask.isPending && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {TEAM_QUICK_QS.map((q) => (
              <Button key={q} size="sm" title="點了帶入輸入框，按「詢問」才送出（免費）" onClick={() => setQuestion(q)}>
                {q}
              </Button>
            ))}
          </div>
        )}

        {/* 「免費・唯讀」是花不花錢的前提，屬於代價資訊 → 兩種模式都要看得到 */}
        <Hint layer="always" style={{ marginTop: 8 }}>
          免費・唯讀分析整組專案與代理進度{canDispatchHint ? "，並可提議發起 AI 執行計畫（需該專案核准才花點）" : ""}。
          {msgs.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              style={{ marginLeft: 8 }}
              onClick={() => { setMsgs([]); setDispatched({}); ask.reset(); }}
            >
              清除對話
            </Button>
          )}
        </Hint>
        {ask.error && <p className="error" role="alert">{ask.error.message}</p>}

        {msgs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8, maxHeight: 380, overflowY: "auto" }} aria-live="polite">
            {msgs.map((m, mi) =>
              m.role === "user" ? (
                <p key={mi} style={{ margin: 0, fontWeight: 600 }}>{m.text}</p>
              ) : (
                <div key={mi}>
                  {(m.steps?.length ?? 0) > 0 && (
                    <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-secondary)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon name="Search" size={11} />{m.steps!.join("、")}
                    </div>
                  )}
                  <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{m.text}</p>
                  {m.degraded && (
                    /* 資訊不全時一定要講：不講的話這個回答看起來與完整資料下的回答沒有兩樣 */
                    <Meta as="p" style={{ margin: "4px 0 0", color: "var(--danger-ink)" }}>
                      ⚠ 這次沒能讀到阻塞與人員任務資料，以上回答可能漏掉卡住的事項。
                    </Meta>
                  )}
                  {m.rationale && (
                    <Meta as="p" style={{ margin: "4px 0 0" }}>依據：{m.rationale}</Meta>
                  )}
                  {(m.contextUsed?.length ?? 0) > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                      {m.contextUsed!.map((c) => (
                        <Chip key={c} style={{ margin: 0 }} title="這輪回答實際用到的資料區塊">{c}</Chip>
                      ))}
                    </div>
                  )}
                  {(m.dispatches?.length ?? 0) > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                      {m.dispatches!.map((d, i) => {
                        const key = `${mi}-${i}`;
                        const done = dispatched[key];
                        return (
                          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {done ? (
                              /* 已建立計畫的估點與「去核准」入口——藏起來就找不到要核准什麼 */
                              <Hint as="div" layer="always" style={{ color: "var(--success-ink)" }}>
                                ✓ 已在「{d.projectTitle}」建立 AI 執行計畫（估 {done.estPoints} 點）：{done.summary}
                                <Link href={`/p/${d.projectId}?focus=agent-run-${done.runId}`} style={{ marginLeft: 6 }}>到專案核准 →</Link>
                              </Hint>
                            ) : (
                              <ConfirmButton
                                triggerClassName="btn-tonal btn-sm"
                                disabled={pendingKey === key}
                                title="在該專案建立一份待核准的 AI 執行計畫（核准後才花點）"
                                message={`在「${d.projectTitle}」發起 AI 執行計畫：${d.goal}？\n會建立一份待核准計畫，仍需到該專案核准才會開始執行、花點。`}
                                confirmLabel="發起計畫"
                                onConfirm={async () => {
                                  setPendingKey(key);
                                  try {
                                    const r = await dispatch.mutateAsync({ groupId, projectId: d.projectId, goal: d.goal });
                                    setDispatched((prev) => ({ ...prev, [key]: r }));
                                    utils.projects.invalidate();
                                    overview.refetch();
                                    setRunFilter("awaiting_approval");
                                    setRunsCollapsed(false);
                                  } catch {
                                    /* dispatch.error 已顯示 */
                                  } finally {
                                    setPendingKey((k) => (k === key ? null : k));
                                  }
                                }}
                              >
                                <Icon name="Play" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                                {d.label}
                              </ConfirmButton>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ),
            )}
            {dispatch.error && <p className="error" role="alert" style={{ marginBottom: 0 }}>{dispatch.error.message}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}
