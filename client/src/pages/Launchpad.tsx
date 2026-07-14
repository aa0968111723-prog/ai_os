import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { FirstRunGuide } from "../components/FirstRunGuide";

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
  const hasNoProjects = projects.data !== undefined && projects.data.length === 0;
  const showFirstRun = !!groupId && hasNoProjects && !firstRunDismissed;

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
        {create.error && <p className="error">{create.error.message}</p>}
      </section>

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
        <p className="error">
          專案清單暫時載入不了——
          <button style={{ padding: "2px 12px", marginLeft: 4 }} onClick={() => projects.refetch()}>再試一次</button>
        </p>
      )}

      {all.length === 0 && !projects.isLoading && !projects.error && (
        <div className="empty-state">
          <h3>還沒有專案</h3>
          <p>從上面開一個新專案，把素材整理成分鏡與成品。</p>
        </div>
      )}
      {all.length > 0 && shownList.length === 0 && <p className="hint">沒有符合「{q}」的專案。</p>}

      <div className="launch-grid">
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
