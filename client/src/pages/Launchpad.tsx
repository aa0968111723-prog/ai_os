import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { FirstRunGuide } from "../components/FirstRunGuide";
import { Icon } from "../components/Icon";
import { ConfirmButton } from "../components/interactions";

/** 新手導覽「略過／看過」記憶鍵：一旦略過或建過範例就記住，之後不再自動彈出 */
const FIRST_RUN_KEY = "aios.firstRunDismissed";
/** 最近開啟：點卡片時記下 id，置頂顯示（純前端 localStorage） */
const RECENT_KEY = "aios.recentProjects";

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
  const projects = trpc.projects.list.useQuery({ groupId: groupId || undefined }, { enabled: !!groupId });
  // 跨專案待辦（UX 高：首頁不顯示待審/待核→組長漏審、組員卡住）：專案卡角標用；60 秒輪詢跟上變化
  const pendingSummary = trpc.approvals.pendingSummary.useQuery({ groupId }, { enabled: !!groupId, refetchInterval: 60_000 });
  const pendingOf = (pid: string) => pendingSummary.data?.projects.find((x) => x.projectId === pid);
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

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("");
  const [platform, setPlatform] = useState<string>("");
  // 工具列：搜尋／類型篩選／排序／漸進顯示
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [limit, setLimit] = useState(24);

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

  useEffect(() => {
    if (kindOptions.length && !kindOptions.some((o) => o.value === kind)) setKind(kindOptions[0].value);
  }, [kindOptions, kind]);
  useEffect(() => {
    if (platformOptions.length && !platformOptions.some((o) => o.value === platform)) setPlatform(platformOptions[0].value);
  }, [platformOptions, platform]);

  const activeGroup = me.data?.groups.find((g) => g.groupId === groupId);
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

  const canCreate = !!title.trim() && !!groupId && !!kind && !!platform && !create.isPending;

  return (
    <div>
      <h1>
        今天想<span className="accent">創作</span>什麼？
      </h1>
      <p className="sub">{activeGroup ? `接續「${activeGroup.groupName}」的專案，或開一個新的。` : "接續這個組的專案，或開一個新的。"}</p>

      {showFirstRun && <FirstRunGuide groupId={groupId} onDismiss={dismissFirstRun} />}

      {/* 精簡建立列（常駐、一行；不再佔右側整欄） */}
      <section className="card" data-fb="新專案卡" style={{ padding: "14px 16px", marginBottom: 16 }}>
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

      {/* 組彙總 AI（需求 12 v1）：問整組狀況的唯讀彙總——沒選組就不渲染 */}
      {groupId && <TeamAssistantCard groupId={groupId} />}

      {/* 工具列：搜尋／類型篩選／排序（有專案才顯示） */}
      {all.length > 0 && (
        <div className="launch-toolbar" style={{ marginBottom: 16 }}>
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
          <span className="hint" style={{ marginLeft: "auto" }}>{shownList.length} 個專案</span>
        </div>
      )}

      {projects.error && (
        <p className="error" role="alert">
          專案清單暫時載入不了——
          <button className="btn-ghost btn-sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => projects.refetch()}>再試一次</button>
        </p>
      )}

      {all.length === 0 && !projects.isLoading && !projects.error && !showFirstRun && (
        <div className="empty-state">
          <h3>還沒有專案</h3>
          <p>從上面開一個新專案，或先開個不花點數的範例看看完整長相。</p>
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
        {shown.map((p) => (
          <Link
            key={p.id}
            href={`/p/${p.id}`}
            className="launch-card"
            style={{ textDecoration: "none", color: "inherit" }}
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
                {/* 待辦角標：分鏡待審（組長裁決）／生成待核（成本門檻攔下）——點卡片進專案就能處理 */}
                {(() => {
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
              <div className="launch-meta">更新於 {relTime(p.updatedAt)}</div>
            </div>
          </Link>
        ))}
      </div>

      {shownList.length > limit && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button onClick={() => setLimit((n) => n + 48)}>顯示更多（還有 {shownList.length - limit} 個）</button>
        </div>
      )}
    </div>
  );
}

/** 派工提議（與 teamAssistant.ask 回傳的 dispatches 對齊）：確認後送 teamAssistant.dispatch */
type Dispatch = { projectId: string; projectTitle: string; goal: string; label: string };
/** 派工結果：在某專案建立了一份待核准的代理計畫 */
type DispatchResult = { runId: string; projectId: string; summary: string; estPoints: number };

const TEAM_QUICK_QS = [
  "哪個案子卡住了？這週花了多少點？",
  "哪些專案有分鏡在等審核？",
  "為什麼有專案特別燒點？",
  "依目前狀況，哪個專案該優先推進？",
];

/**
 * 組彙總 AI 卡（需求 12 v2）：一個輸入框問「整組」狀況——後端彙總轄下各專案的分鏡／生成／花費現況，
 * LLM 可先用唯讀工具鑽進特定專案查證再分析；具派工權者（組長以上或被授權組員）還能收到「發起專案
 * 代理計畫」的提議，按確認後在該專案建立一份待核准計畫（仍需在該專案核准才會花點）。唯讀彙總本身不改資料。
 */
function TeamAssistantCard({ groupId }: { groupId: string }) {
  const utils = trpc.useUtils();
  const [question, setQuestion] = useState("");
  const ask = trpc.teamAssistant.ask.useMutation();
  const dispatch = trpc.teamAssistant.dispatch.useMutation();
  // 已派工的提議 index → 結果（避免重複派工、並顯示「到哪核准」）
  const [dispatched, setDispatched] = useState<Record<number, DispatchResult>>({});
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const canAsk = !!question.trim() && !ask.isPending;
  const submit = () => {
    if (!canAsk) return;
    setDispatched({}); // 新問題：清掉上一輪的派工結果
    ask.mutate({ groupId, message: question.trim() });
  };
  const dispatches = (ask.data?.dispatches ?? []) as Dispatch[];
  const steps = ask.data?.steps ?? [];
  return (
    <section className="card" data-fb="組彙總AI卡" style={{ padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <label htmlFor="ta-question" style={{ marginTop: 0 }}>組彙總 AI</label>
          <input
            id="ta-question"
            value={question}
            maxLength={500}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="問問整組狀況：哪個案子卡住了？這週花了多少點？"
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
            "詢問"
          )}
        </button>
      </div>

      {/* 快速提問：冷啟動不用想怎麼開口——點一顆帶入輸入框，按「詢問」才送出 */}
      {!ask.data && !ask.isPending && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {TEAM_QUICK_QS.map((q) => (
            <button key={q} type="button" className="btn-sm" title="點了帶入輸入框，按「詢問」才送出（免費）" onClick={() => setQuestion(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      <p className="hint" style={{ marginTop: 8 }}>免費・唯讀彙總{ask.data?.canDispatch ? "，可提議在專案發起代理計畫（需該專案核准才花點）" : ""}。</p>
      {ask.error && <p className="error" role="alert">{ask.error.message}</p>}

      {/* 多步工具透明化：助手回答前查了什麼一行列給使用者看 */}
      {steps.length > 0 && (
        <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-secondary)", marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
          <Icon name="Search" size={11} />{steps.join("、")}
        </div>
      )}

      {ask.data && <p style={{ whiteSpace: "pre-wrap", marginTop: 8, marginBottom: 0 }} aria-live="polite">{ask.data.answer}</p>}

      {/* 派工提議：具派工權時才會有；每筆按確認後於該專案建立待核准計畫 */}
      {dispatches.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {dispatches.map((d, i) => {
            const done = dispatched[i];
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {done ? (
                  <div className="hint" style={{ color: "var(--success-ink)" }}>
                    ✓ 已在「{d.projectTitle}」建立代理計畫（估 {done.estPoints} 點）：{done.summary}
                    <Link href={`/p/${d.projectId}`} style={{ marginLeft: 6 }}>到專案核准 →</Link>
                  </div>
                ) : (
                  <ConfirmButton
                    triggerClassName="btn-tonal btn-sm"
                    disabled={pendingIdx === i}
                    title="在該專案建立一份待核准的代理計畫（核准後才花點）"
                    message={`在「${d.projectTitle}」發起代理計畫：${d.goal}？\n會建立一份待核准計畫，仍需到該專案核准才會開始執行、花點。`}
                    confirmLabel="發起計畫"
                    onConfirm={async () => {
                      setPendingIdx(i);
                      try {
                        const r = await dispatch.mutateAsync({ groupId, projectId: d.projectId, goal: d.goal });
                        setDispatched((prev) => ({ ...prev, [i]: r }));
                        utils.projects.invalidate(); // 專案卡上的代理狀態可能變動
                      } catch {
                        /* dispatch.error 已在下方顯示；不標記為已派工，讓使用者可重試 */
                      } finally {
                        setPendingIdx((k) => (k === i ? null : k));
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
          {dispatch.error && <p className="error" role="alert" style={{ marginBottom: 0 }}>{dispatch.error.message}</p>}
        </div>
      )}
    </section>
  );
}
