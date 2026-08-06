import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { FirstRunGuide } from "../components/FirstRunGuide";
import { InstallAppBanner } from "../components/InstallAppBanner";
import { ProgressStepper, inferProjectCurrentStep } from "../components/ProgressStepper";
import { Icon } from "../components/Icon";
import { AssetImg } from "../components/MediaFallback";
import { ProjectCoverPicker } from "../components/ProjectCoverPicker";
import { AddOptionInline } from "../components/AddOptionInline";
import { FormatPicker } from "../components/FormatPicker";
import { Button, Card, Chip, EmptyState, Hint, Skeleton } from "../components/ui";
import { useMatchMedia } from "../lib/useMatchMedia";
import { useCollab, CursorOverlay } from "../realtime";
import { DEFAULT_PROJECT_FORMAT, normalizeProjectFormat, type ProjectFormat } from "../../../shared/models";

/** 新手導覽「略過／看過」記憶鍵：一旦略過或建過範例就記住，之後不再自動彈出 */
const FIRST_RUN_KEY = "aios.firstRunDismissed";
/** 最近開啟：點卡片時記下 id，置頂顯示（純前端 localStorage） */
const RECENT_KEY = "aios.recentProjects";
/** 作業台專案列表版面：grid 卡片／list 列表（僅桌面 ≥821 顯示切換） */
export const LAUNCH_LAYOUT_KEY = "aios.launchpad.layout";
export type LaunchLayout = "grid" | "list";

export function loadLaunchLayout(): LaunchLayout {
  try {
    const v = localStorage.getItem(LAUNCH_LAYOUT_KEY);
    return v === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export function saveLaunchLayout(layout: LaunchLayout): void {
  try {
    localStorage.setItem(LAUNCH_LAYOUT_KEY, layout);
  } catch {
    /* 偏好加分項 */
  }
}
/** 「全組現況」收合偏好記憶鍵（per 組；純前端 localStorage，收起省版面）
 *  舊鍵 aios.teamRuns.collapsed.* 一併讀寫，避免升級後收合偏好被重置。 */
const STATUS_COLLAPSE_KEY = (gid: string) => `aios.teamStatus.collapsed.${gid}`;
const LEGACY_RUNS_COLLAPSE_KEY = (gid: string) => `aios.teamRuns.collapsed.${gid}`;

function relTime(d: Date | string): string {
  const t = new Date(d).getTime();
  const mins = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(d).toLocaleDateString("zh-TW");
}

/** 封面色帶：以 id 雜湊選一段 logo 緞帶的粉彩化身（紅／橘／琥珀／黃綠／綠／藍綠，低彩度不喧賓奪主） */
const COVERS = [
  "linear-gradient(135deg, #fbe7e6, #f6cfcc)", // 緞帶紅
  "linear-gradient(135deg, #fdeadb, #f9d4b6)", // 緞帶橘
  "linear-gradient(135deg, #fbf0d6, #f4e0ac)", // 緞帶琥珀
  "linear-gradient(135deg, #eff4dc, #dfe9bb)", // 緞帶黃綠
  "linear-gradient(135deg, #e2f3ea, #c3e6d2)", // 緞帶綠
  "linear-gradient(135deg, #e0f3f2, #bfe5e3)", // 緞帶藍綠
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
  /** 桌面列表／卡片；手機強制卡片（CSS + 不顯示切換） */
  const isDesktop = useMatchMedia("(min-width: 821px)");
  const [layout, setLayout] = useState<LaunchLayout>(() => loadLaunchLayout());
  const setLaunchLayout = (next: LaunchLayout) => {
    setLayout(next);
    saveLaunchLayout(next);
  };
  const projects = trpc.projects.list.useQuery(
    { groupId: groupId || undefined, includeArchived: includeArchived || undefined },
    { enabled: !!groupId },
  );
  // 跨專案待辦（UX 高：首頁不顯示待核→組長漏核、組員卡住）：專案卡角標用；60 秒輪詢跟上變化
  const pendingSummary = trpc.generation.pendingSummary.useQuery({ groupId }, { enabled: !!groupId, refetchInterval: 60_000 });
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
  // 全組協作：presence + 游標（組房 g:${groupId}），讓彼此找得到誰在線、誰在動
  const collab = useCollab(groupId, !!groupId, "group");
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
  /** 正在換封面的專案 id（開對話框用；null＝沒開） */
  const [coverEditId, setCoverEditId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("");
  const [platform, setPlatform] = useState<string>("");
  /** 畫面尺寸：預設跟著平台走，使用者可在建立表單直接改（改了就以他挑的為準，直到換平台） */
  const [format, setFormat] = useState<ProjectFormat>(DEFAULT_PROJECT_FORMAT);
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
  // 換平台就把尺寸帶回該平台預設；使用者之後在尺寸圖上另選的值會保留（本效果只在平台預設變動時觸發）
  const pickedPlatformFormat = pickedPlatform?.format ?? null;
  useEffect(() => {
    if (pickedPlatformFormat) setFormat(normalizeProjectFormat(pickedPlatformFormat));
  }, [pickedPlatformFormat]);

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
  // 換封面對話框讀 list 的最新那一列（而不是開啟當下的快照）：換完 invalidate 後對話框裡的
  // 預覽也跟著換，不必關掉重開；專案在期間消失（被別人封存/篩掉）則自動收起對話框
  const coverEditProject = coverEditId ? all.find((p) => p.id === coverEditId) ?? null : null;
  const agentSummary = agentOverview.data?.summary;
  const runningRuns = agentSummary?.running ?? 0;
  const waitingRuns = (agentSummary?.waiting ?? 0) + (agentSummary?.awaitingApproval ?? 0);
  const completedRuns = agentSummary?.doneRecent ?? 0;
  const pendingTotal = pendingSummary.data?.totalAwaitingGenerations ?? 0;
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
        detail: "先處理成本核准，AI 與團隊才能繼續往下走。",
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
          href: "#projects",
          action: "查看專案",
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
    <div
      className="daily-dashboard"
      ref={collab.containerRef}
      onPointerMove={collab.onPointerMove}
      style={{ position: "relative" }}
    >
      <CursorOverlay cursors={collab.cursors} />
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
          {collab.connected && collab.peers.length > 0 && (
            <div
              aria-label="組內在線"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 10,
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
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="primary daily-new-project"
            aria-expanded={createOpen}
            aria-controls="new-project-panel"
            onClick={() => {
              setCreateOpen((open) => {
                const next = !open;
                if (next) {
                  requestAnimationFrame(() => {
                    document.getElementById("np-title")?.focus({ preventScroll: true });
                  });
                }
                return next;
              });
            }}
          >
            <Icon name={createOpen ? "X" : "Plus"} size={16} />
            {createOpen ? "收起建立表單" : "建立新專案"}
          </button>
        </div>
      </section>

      <nav className="daily-quick-links" aria-label="常用工具">
        <Link href="/planner"><Icon name="Clock" size={15} /><span>安排今天</span><small>排程與筆記</small></Link>
        <Link href="/databases"><Icon name="Database" size={15} /><span>整理資料</span><small>清單與批次匯入</small></Link>
        <Link href="/chat"><Icon name="MessageCircle" size={15} /><span>聯絡夥伴</span><small>私訊與標注</small></Link>
      </nav>

      {showFirstRun && <FirstRunGuide groupId={groupId} onDismiss={dismissFirstRun} />}

      <div style={{ marginBottom: 14 }}><InstallAppBanner /></div>

      {/* 建立新專案：現代磨砂玻璃 Modal 彈窗 */}
      {createOpen ? (
        <div
          className="new-project-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateOpen(false);
          }}
        >
          <Card
            as="section"
            id="new-project-panel"
            className="new-project-modal-card"
            data-fb="新專案卡"
            aria-label="建立新專案"
          >
            <button
              type="button"
              className="new-project-modal__close"
              aria-label="關閉"
              onClick={() => setCreateOpen(false)}
            >
              <Icon name="X" size={18} />
            </button>
            <div className="new-project-modal__header">
              <p className="eyebrow" style={{ margin: 0 }}>NEW PROJECT</p>
              <h2><Icon name="Sparkles" size={20} style={{ color: "var(--primary-ink)" }} />建立新創作專案</h2>
              <p>為你的想法建立專案脈絡，AI 將在此協同創作</p>
            </div>
            <div className="new-project-modal__fields">
              <div>
                <label htmlFor="np-title" style={{ marginTop: 0, fontWeight: 600 }}>新專案名稱</label>
                <input
                  id="np-title"
                  value={title}
                  autoFocus
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例：見證故事 · 走出低谷"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canCreate) {
                      create.mutate({ groupId, title: title.trim(), kind, platform, format });
                    }
                  }}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <div>
                  <label htmlFor="np-kind" style={{ marginTop: 0, fontWeight: 600 }}>內容類型</label>
                  <select
                    id="np-kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                    disabled={!kindOptions.length}
                  >
                    {kindOptions.map((k) => (
                      <option key={k.id} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                  {/* 少了想要的類型就在這裡加，不必離開表單（原本得繞去選單的「選項」頁，回來還要重填） */}
                  {isLeader && groupId && (
                    <AddOptionInline
                      groupId={groupId}
                      type="kind"
                      buttonLabel="自己加一個類型"
                      onAdded={(opt) => setKind(opt.value)}
                    />
                  )}
                </div>
                <div>
                  <label htmlFor="np-platform" style={{ marginTop: 0, fontWeight: 600 }}>發布平台</label>
                  <select
                    id="np-platform"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    disabled={!platformOptions.length}
                  >
                    {platformOptions.map((p) => (
                      <option key={p.id} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  {isLeader && groupId && (
                    <AddOptionInline
                      groupId={groupId}
                      type="platform"
                      buttonLabel="自己加一個平台"
                      onAdded={(opt) => {
                        setPlatform(opt.value);
                        if (opt.format) setFormat(normalizeProjectFormat(opt.format));
                      }}
                    />
                  )}
                </div>
              </div>
              {/* 畫面尺寸：模型支援的全部比例都給選，並畫成等比例小方框（挑錯尺寸＝整支重生成＝真金白銀） */}
              <div>
                <label id="np-format-label" style={{ marginTop: 0, fontWeight: 600 }}>畫面尺寸</label>
                <FormatPicker value={format} onChange={setFormat} labelledBy="np-format-label" />
                {pickedPlatform?.format && normalizeProjectFormat(pickedPlatform.format) !== format && (
                  <Hint layer="always">
                    已改成 {format}（此平台預設 {pickedPlatform.format}）——以你挑的尺寸為準。
                  </Hint>
                )}
              </div>
            </div>
            {/* 提示與錯誤訊息 */}
            {activeGroup && (
              <Hint layer="always" style={{ marginTop: 4 }}>
                將建立在：{activeGroup.teamName}・{activeGroup.groupName}（頂欄可切換組別）
              </Hint>
            )}
            {options.isLoading && <Hint layer="always">選項載入中…</Hint>}
            {!options.isLoading && groupId && !kindOptions.length && (
              <Hint layer="always">
                這個組還沒有內容類型選項——{isLeader ? "用上面的「自己加一個類型」加一個。" : "請組長加一個（組長在這張表單就能加）。"}
              </Hint>
            )}
            {!options.isLoading && groupId && !platformOptions.length && (
              <Hint layer="always">
                這個組還沒有發布平台選項——{isLeader ? "用上面的「自己加一個平台」加一個。" : "請組長加一個（組長在這張表單就能加）。"}
              </Hint>
            )}
            {!groupId && <Hint layer="always">（要先屬於一個組才能建專案）</Hint>}
            {groupId && kindOptions.length > 0 && platformOptions.length > 0 && !title.trim() && (
              <Hint layer="always">先為專案命名，就能建立專案。</Hint>
            )}
            {create.error && <p className="error" role="alert">{create.error.message}</p>}

            <div className="new-project-modal__actions">
              <Button type="button" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                disabled={!canCreate}
                onClick={() => create.mutate({ groupId, title: title.trim(), kind, platform, format })}
              >
                {create.isPending ? "建立中…" : "立即建立專案"}
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        <Card
          as="section"
          id="new-project-panel"
          className="new-project-panel"
          data-fb="新專案卡"
          hidden
          aria-label="建立新專案"
        >
          <input id="np-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select id="np-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {kindOptions.map((k) => (
              <option key={k.id} value={k.value}>{k.label}</option>
            ))}
          </select>
          <select id="np-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {platformOptions.map((p) => (
              <option key={p.id} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Card>
      )}

      {/* 工作台：繼續創作（最近專案） */}
      <div className="daily-bento-grid">
        {/* 繼續創作（最近專案） */}
        <div className="bento-card bento-continue">
          <div className="bento-card__head">
            <h3><Icon name="Compass" size={17} style={{ color: "var(--primary-ink)" }} />繼續創作（最近專案）</h3>
            <a href="#projects">全部專案 ({all.length}) →</a>
          </div>
          {recentProjects.length > 0 ? (
            <section className="continue-work" aria-labelledby="continue-title" style={{ margin: 0, padding: 0 }}>
              <h2 id="continue-title" style={{ display: "none" }}>最近專案</h2>
              <div style={{ display: "grid", gap: 10 }}>
                {recentProjects.map((project) => {
                  const pending = pendingOf(project.id);
                  return (
                    <Link
                      key={project.id}
                      href={`/p/${project.id}`}
                      className="continue-card"
                      onClick={() => recordRecent(project.id)}
                    >
                      <span className="continue-card__mark" style={{ background: coverOf(project.id) }}>
                        {project.coverUrl ? (
                          <AssetImg
                            className="launch-mark__img"
                            src={project.coverUrl}
                            alt=""
                            loading="lazy"
                            fallbackLabel="封面圖遺失"
                            fallbackClassName="launch-mark__fallback"
                            fallbackHeight="100%"
                            fallbackIconSize={16}
                          />
                        ) : (
                          project.title.trim().charAt(0) || "○"
                        )}
                      </span>
                      <span className="continue-card__body">
                        <strong>{project.title}</strong>
                        <small>{kindLabelOf(project.kind)}・更新於 {relTime(project.updatedAt)}</small>
                      </span>
                      {!!pending && pending.awaitingGenerations > 0 && (
                        <Link href={`/p/${project.id}?focus=pending`} style={{ textDecoration: "none" }}>
                          <Chip>{pending.awaitingGenerations} 待處理</Chip>
                        </Link>
                      )}
                      <Icon name="ChevronRight" size={17} />
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : (
            <div style={{ padding: "8px 0" }}>
              {focusState.kind === "start" ? (
                <button
                  type="button"
                  className={`daily-focus-card ${focusState.kind}`}
                  style={{ width: "100%", textAlign: "left" }}
                  onClick={() => {
                    setCreateOpen(true);
                    requestAnimationFrame(() => document.getElementById("np-title")?.focus());
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
                <a href={focusState.href} className={`daily-focus-card ${focusState.kind}`} style={{ width: "100%", textAlign: "left" }}>
                  <span className="daily-focus-card__icon"><Icon name={focusState.icon} size={21} /></span>
                  <span className="daily-focus-card__copy">
                    <small>{focusState.eyebrow}</small>
                    <strong>{focusState.title}</strong>
                    <span>{focusState.detail}</span>
                  </span>
                  <span className="daily-focus-card__action">{focusState.action}<Icon name="ChevronRight" size={16} /></span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      <section id="projects" className="dashboard-section" aria-labelledby="projects-title">
        <div className="section-heading">
          <div><p className="eyebrow">完整清單</p><h2 id="projects-title">所有專案</h2></div>
          <Button size="sm" onClick={() => {
            setCreateOpen(true);
            requestAnimationFrame(() => {
              document.getElementById("new-project-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
              document.getElementById("np-title")?.focus({ preventScroll: true });
            });
          }}>建立新專案</Button>
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
              {isDesktop && (
                <div className="launch-layout-toggle" role="group" aria-label="專案檢視方式">
                  <button
                    type="button"
                    className={layout === "grid" ? "is-selected" : undefined}
                    aria-pressed={layout === "grid"}
                    title="卡片檢視"
                    onClick={() => setLaunchLayout("grid")}
                  >
                    <Icon name="Clapperboard" size={14} /> 卡片
                  </button>
                  <button
                    type="button"
                    className={layout === "list" ? "is-selected" : undefined}
                    aria-pressed={layout === "list"}
                    title="列表檢視（較密，適合掃狀態）"
                    onClick={() => setLaunchLayout("list")}
                  >
                    <Icon name="FileText" size={14} /> 列表
                  </button>
                </div>
              )}
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

      <div
        className={isDesktop && layout === "list" ? "launch-list" : "launch-grid"}
        aria-busy={projects.isLoading}
        data-layout={isDesktop ? layout : "grid"}
      >
        {projects.isLoading &&
          Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={`sk-${i}`}
              className={isDesktop && layout === "list" ? "launch-list-row" : "launch-card"}
              height={isDesktop && layout === "list" ? 52 : 176}
            />
          ))}
        {shown.map((p) => {
          const isArchived = p.status === "archived";
          const canRestore = isArchived && (isLeader || p.ownerId === myUserId);
          const pd = !isArchived ? pendingOf(p.id) : null;
          const listMode = isDesktop && layout === "list";
          // 換封面＝寫入：檢視者不給（後端 assertProjectEditable 同樣會擋）；已封存的先還原再改
          const canEditCover = !isArchived && p.myProjectRole !== "viewer";

          if (listMode) {
            return (
              <div key={p.id} className="launch-list-row" style={{ opacity: isArchived ? 0.85 : undefined }}>
                <Link
                  href={`/p/${p.id}`}
                  className="launch-list-row__main"
                  onClick={() => recordRecent(p.id)}
                >
                  <span className="launch-list-row__mark" style={{ background: coverOf(p.id) }} aria-hidden>
                    {/* 列表列同樣認封面圖：卡片／列表兩種版面認得出是同一個專案 */}
                    {p.coverUrl ? (
                      <AssetImg
                        className="launch-mark__img"
                        src={p.coverUrl}
                        alt=""
                        loading="lazy"
                        fallbackLabel="封面圖遺失"
                        fallbackClassName="launch-mark__fallback"
                        fallbackHeight="100%"
                        fallbackIconSize={14}
                      />
                    ) : (
                      p.title.trim().charAt(0) || "○"
                    )}
                  </span>
                  <span className="launch-list-row__title">{p.title}</span>
                  <span className="launch-list-row__kind">{kindLabelOf(p.kind)}</span>
                  <span className="launch-list-row__format">{p.format}</span>
                  <span className="launch-list-row__time">更新 {relTime(p.updatedAt)}</span>
                  <span className="launch-list-row__badges">
                    {isArchived && <Chip style={{ margin: 0 }}>已封存</Chip>}
                  </span>
                </Link>
                {canRestore && (
                  <Button
                    size="sm"
                    className="launch-list-row__restore"
                    disabled={restoreProject.isPending}
                    title="還原後會重新出現在作業台"
                    onClick={() => restoreProject.mutate({ id: p.id, archived: false })}
                  >
                    {restoreProject.isPending ? "還原中…" : "還原"}
                  </Button>
                )}
              </div>
            );
          }

          return (
            <Link
              key={p.id}
              href={`/p/${p.id}`}
              className="launch-card"
              style={{ textDecoration: "none", color: "inherit", opacity: isArchived ? 0.85 : undefined }}
              onClick={() => recordRecent(p.id)}
            >
              <div className="launch-cover" style={{ background: coverOf(p.id) }}>
                {/* 有綁封面圖就顯示圖，沒綁（或素材進了回收桶→coverUrl 為 null）退回首字色塊 */}
                {p.coverUrl ? (
                  <AssetImg
                    className="launch-cover__img"
                    src={p.coverUrl}
                    alt={`${p.title} 的封面圖`}
                    loading="lazy"
                    fallbackLabel="封面圖遺失"
                    fallbackClassName="launch-cover__fallback"
                    fallbackHeight="100%"
                    fallbackIconSize={18}
                  />
                ) : (
                  <span className="launch-mono">{p.title.trim().charAt(0) || "○"}</span>
                )}
                {canEditCover && (
                  <Button
                    size="sm"
                    className="launch-cover__swap"
                    title="換一張封面圖"
                    onClick={(e) => {
                      // 卡片本身是連結：不攔的話按「換圖」會直接跳進專案
                      e.preventDefault();
                      e.stopPropagation();
                      setCoverEditId(p.id);
                    }}
                  >
                    <Icon name="Image" size={13} />
                    {p.coverUrl ? "換圖" : "加圖"}
                  </Button>
                )}
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
                {!isArchived && (
                  <div className="launch-card__stepper">
                    <ProgressStepper currentStep={inferProjectCurrentStep(p, pd)} size="sm" />
                  </div>
                )}
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

      {/* 換封面對話框：從 list 的最新資料取值，換完 invalidate 後這裡也跟著更新（不必關掉再開） */}
      {coverEditProject && (
        <ProjectCoverPicker
          projectId={coverEditProject.id}
          projectTitle={coverEditProject.title}
          coverAssetId={coverEditProject.coverAssetId}
          coverUrl={coverEditProject.coverUrl}
          onClose={() => setCoverEditId(null)}
        />
      )}
      </section>
    </div>
  );
}
