import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { FirstRunGuide } from "../components/FirstRunGuide";
import { InstallAppBanner } from "../components/InstallAppBanner";
import { Icon } from "../components/Icon";
import { ConfirmButton } from "../components/interactions";

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
      <section id="new-project-panel" className="card new-project-panel" data-fb="新專案卡" hidden={!createOpen} aria-label="建立新專案">
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
          <button className="primary" disabled={!canCreate} onClick={() => create.mutate({ groupId, title: title.trim(), kind, platform })}>
            {create.isPending ? "建立中…" : "建立專案"}
          </button>
        </div>
        {activeGroup && (
          <p className="hint" style={{ marginTop: 8 }}>將建立在：{activeGroup.teamName}・{activeGroup.groupName}（頂欄可切換組別）</p>
        )}
        {options.isLoading && <p className="hint">選項載入中…</p>}
        {!options.isLoading && groupId && !kindOptions.length && <p className="hint">這個組還沒有內容類型選項——請組長到「選項」頁新增。</p>}
        {!options.isLoading && groupId && !platformOptions.length && <p className="hint">這個組還沒有發布平台選項——請組長到「選項」頁新增。</p>}
        {pickedPlatform?.format && <p className="hint">畫面格式：{pickedPlatform.format}（依平台自動帶入）</p>}
        {!groupId && <p className="hint">（要先屬於一個組才能建專案）</p>}
        {groupId && kindOptions.length > 0 && platformOptions.length > 0 && !title.trim() && <p className="hint">先為專案命名，就能建立專案。</p>}
        {create.error && <p className="error" role="alert">{create.error.message}</p>}
      </section>

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
            <a href="#projects" className="daily-status-card attention">
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
                      <span className="chip">{pending.pendingApprovals + pending.awaitingGenerations} 待處理</span>
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
        {groupId && <TeamAssistantCard key={groupId} groupId={groupId} />}
      </section>

      <section id="projects" className="dashboard-section" aria-labelledby="projects-title">
        <div className="section-heading">
          <div><p className="eyebrow">完整清單</p><h2 id="projects-title">所有專案</h2></div>
          <button type="button" className="btn-sm" onClick={() => setCreateOpen(true)}>建立新專案</button>
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
            <span className="hint" style={{ marginLeft: "auto" }}>{shownList.length} 個專案</span>
          )}
        </div>
      )}

      {projects.error && (
        <p className="error" role="alert">
          專案清單暫時載入不了——
          <button className="btn-ghost btn-sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => projects.refetch()}>再試一次</button>
        </p>
      )}

      {restoreProject.error && (
        <p className="error" role="alert">還原失敗：{restoreProject.error.message}</p>
      )}

      {all.length === 0 && !projects.isLoading && !projects.error && !showFirstRun && (
        <div className="empty-state">
          <h3>{includeArchived ? "還沒有專案（含已封存）" : "還沒有專案"}</h3>
          <p>
            {includeArchived
              ? "從上面開一個新專案，或先開個不花點數的範例看看完整長相。"
              : "從上面開一個新專案，或勾「顯示已封存」找回已封存的專案。也可先開個不花點數的範例看看完整長相。"}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 12 }}>
            <button
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              disabled={!groupId || createSample.isPending}
              onClick={() => createSample.mutate({ groupId })}
            >
              <Icon name="Sparkles" size={15} />
              {createSample.isPending ? "建立範例中…" : "建立範例專案看看（免費）"}
            </button>
            <Link href="/help" style={{ display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "center" }}>
              <Icon name="HelpCircle" size={14} />看怎麼用
            </Link>
          </div>
          {createSample.error && <p className="error">{createSample.error.message}</p>}
        </div>
      )}
      {all.length > 0 && shownList.length === 0 && <p className="hint">沒有符合「{q}」的專案。</p>}

      <div className="launch-grid" aria-busy={projects.isLoading}>
        {projects.isLoading &&
          Array.from({ length: 8 }).map((_, i) => <div key={`sk-${i}`} className="launch-card skeleton" style={{ height: 176 }} aria-hidden />)}
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
                  <span className="chip" style={{ margin: 0 }}>{kindLabelOf(p.kind)}</span>
                  <span>{p.format}</span>
                  {isArchived && (
                    <span className="chip" style={{ margin: 0, color: "var(--fg-secondary)" }} title="已封存，可還原">
                      已封存
                    </span>
                  )}
                  {/* 待辦角標：分鏡待審（組長裁決）／生成待核（成本門檻攔下）——點卡片進專案就能處理 */}
                  {!isArchived && (() => {
                    const pd = pendingOf(p.id);
                    if (!pd) return null;
                    return (
                      <>
                        {pd.pendingApprovals > 0 && (
                          <span className="chip" style={{ margin: 0, color: "var(--gold-ink)", borderColor: "var(--gold-ink)" }} title="有分鏡送審等組長裁決">
                            待審 {pd.pendingApprovals}
                          </span>
                        )}
                        {pd.awaitingGenerations > 0 && (
                          <span className="chip" style={{ margin: 0, color: "var(--gold-ink)", borderColor: "var(--gold-ink)" }} title="有生成被成本門檻攔下，等組長核准">
                            待核 {pd.awaitingGenerations}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div className="launch-meta" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>更新於 {relTime(p.updatedAt)}</span>
                  {canRestore && (
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={restoreProject.isPending}
                      title="還原後會重新出現在作業台"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        restoreProject.mutate({ id: p.id, archived: false });
                      }}
                    >
                      {restoreProject.isPending ? "還原中…" : "還原"}
                    </button>
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
type ChatMsg = { role: "user" | "assistant"; text: string; steps?: string[]; dispatches?: Dispatch[] };

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
  healthy: { label: "狀態穩定", hint: "目前沒有需要立刻處理的代理阻塞" },
  attention: { label: "需要關注", hint: "有進行中的計畫、待核或近期失敗——先掃一眼下方清單" },
  blocked: { label: "有阻塞", hint: "近期失敗且仍有等待／待核——優先到對應專案處理" },
};

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
function TeamAssistantCard({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const [question, setQuestion] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const ask = trpc.teamAssistant.ask.useMutation();
  const dispatch = trpc.teamAssistant.dispatch.useMutation();
  const overview = trpc.teamAssistant.agentOverview.useQuery(
    { groupId },
    {
      refetchInterval: (q) => ((q.state.data?.summary?.active ?? 0) > 0 ? 8000 : false),
    },
  );
  const [dispatched, setDispatched] = useState<Record<string, DispatchResult>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
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
          setMsgs((prev) => [...prev, { role: "assistant", text: d.answer, steps: d.steps, dispatches: d.dispatches as Dispatch[] }]);
          if ((d.dispatches?.length ?? 0) > 0) overview.refetch();
        },
      },
    );
  };
  const canDispatchHint = ask.data?.canDispatch ?? false;
  const summary = overview.data?.summary;
  const runs = overview.data?.runs ?? [];
  const activeRuns = summary?.active ?? 0;
  const filteredRuns = useMemo(
    () => runs.filter((r) => matchesRunFilter(r.status, runFilter)),
    [runs, runFilter],
  );
  // 預設「進行中」若為空且列表有其他狀態，自動提示可切全部
  const healthMeta = HEALTH_LABEL[summary?.health ?? "healthy"] ?? HEALTH_LABEL.healthy;

  return (
    <section className="card team-ai-card" data-fb="組彙總AI卡">
      {/* ── 團隊分析：全組代理匯總（非聊天） ── */}
      <div className="team-analysis" aria-labelledby="team-analysis-title">
        <div className="team-analysis__head">
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>全組代理</p>
            <h3 id="team-analysis-title" style={{ margin: "2px 0 0", fontSize: "1.05rem" }}>團隊分析</h3>
          </div>
          {summary && (
            <span
              className={`team-analysis__health is-${summary.health}`}
              title={healthMeta.hint}
            >
              {healthMeta.label}
              {summary.activeProjects > 0 ? `・${summary.activeProjects} 專案活動` : ""}
            </span>
          )}
        </div>
        {overview.isLoading && <div className="skeleton" style={{ height: 48, marginTop: 10 }} aria-hidden />}
        {overview.error && (
          <p className="error" role="alert" style={{ marginTop: 8 }}>
            代理動態載入失敗——
            <button type="button" className="btn-ghost btn-sm" onClick={() => overview.refetch()}>再試一次</button>
          </p>
        )}
        {summary && !overview.isLoading && (
          <div className="team-analysis__stats" role="group" aria-label="代理狀態計數">
            <button type="button" className={`team-stat${runFilter === "running" ? " is-on" : ""}`} onClick={() => { setRunFilter("running"); setRunsCollapsed(false); }}>
              <strong>{summary.running}</strong><small>執行中</small>
            </button>
            <button type="button" className={`team-stat${runFilter === "waiting" ? " is-on" : ""}`} onClick={() => { setRunFilter("waiting"); setRunsCollapsed(false); }}>
              <strong>{summary.waiting}</strong><small>等待人員</small>
            </button>
            <button type="button" className={`team-stat${runFilter === "awaiting_approval" ? " is-on" : ""}`} onClick={() => { setRunFilter("awaiting_approval"); setRunsCollapsed(false); }}>
              <strong>{summary.awaitingApproval}</strong><small>待核准</small>
            </button>
            <button type="button" className={`team-stat${runFilter === "failed" ? " is-on" : ""}`} onClick={() => { setRunFilter("failed"); setRunsCollapsed(false); }}>
              <strong>{summary.failedRecent}</strong><small>近七日失敗</small>
            </button>
            <button type="button" className={`team-stat${runFilter === "done" ? " is-on" : ""}`} onClick={() => { setRunFilter("done"); setRunsCollapsed(false); }}>
              <strong>{summary.doneRecent}</strong><small>近七日完成</small>
            </button>
          </div>
        )}
        <p className="hint" style={{ margin: "8px 0 0" }}>{healthMeta.hint}</p>
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
          <span className="hint">
            （{runs.length} 筆{activeRuns > 0 ? `・${activeRuns} 進行中` : ""}）
          </span>
          <Icon name={runsCollapsed ? "ChevronDown" : "ChevronUp"} size={13} style={{ marginLeft: "auto" }} />
        </button>
        <div id="team-agent-runs" hidden={runsCollapsed}>
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
            <p className="hint" style={{ marginTop: 8 }}>
              這個組還沒有 AI 執行計畫。可在下方問組彙總 AI，或到專案頁用「執行計畫」發起。
            </p>
          )}
          {runs.length > 0 && filteredRuns.length === 0 && (
            <p className="hint" style={{ marginTop: 8 }}>
              目前篩選下沒有計畫——
              <button type="button" className="btn-ghost btn-sm" onClick={() => setRunFilter("all")}>改看全部</button>
            </p>
          )}
          {filteredRuns.length > 0 && (
            <div className="team-run-list" style={{ marginTop: 8 }}>
              {filteredRuns.map((r) => {
                const st = RUN_STATUS[r.status] ?? { label: r.status };
                const progress = r.totalSteps > 0 ? Math.min(100, Math.round((r.doneSteps / r.totalSteps) * 100)) : 0;
                const href = `/p/${r.projectId}?focus=agent-run-${r.id}`;
                return (
                  <div key={r.id} className={`team-run-row is-${r.status}`}>
                    <span className="chip" style={{ margin: 0, color: st.color, borderColor: st.color }}>{st.label}</span>
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
              <button key={q} type="button" className="btn-sm" title="點了帶入輸入框，按「詢問」才送出（免費）" onClick={() => setQuestion(q)}>
                {q}
              </button>
            ))}
          </div>
        )}

        <p className="hint" style={{ marginTop: 8 }}>
          免費・唯讀分析整組專案與代理進度{canDispatchHint ? "，並可提議發起 AI 執行計畫（需該專案核准才花點）" : ""}。
          {msgs.length > 0 && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              style={{ marginLeft: 8 }}
              onClick={() => { setMsgs([]); setDispatched({}); ask.reset(); }}
            >
              清除對話
            </button>
          )}
        </p>
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
                  {(m.dispatches?.length ?? 0) > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                      {m.dispatches!.map((d, i) => {
                        const key = `${mi}-${i}`;
                        const done = dispatched[key];
                        return (
                          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {done ? (
                              <div className="hint" style={{ color: "var(--success-ink)" }}>
                                ✓ 已在「{d.projectTitle}」建立 AI 執行計畫（估 {done.estPoints} 點）：{done.summary}
                                <Link href={`/p/${d.projectId}?focus=agent-run-${done.runId}`} style={{ marginLeft: 6 }}>到專案核准 →</Link>
                              </div>
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
    </section>
  );
}
