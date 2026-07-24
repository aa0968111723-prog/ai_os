import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { getModel } from "@shared/models";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";
import { discussInMessages } from "../discuss";

/**
 * #0 桌面通知：首次徵求授權，已授權才發。某些瀏覽器（背景分頁/未授權）建構子會丟例外，包 try 忽略。
 * 純附加通知——不影響任何既有輪詢與顯示邏輯。
 */
function notifyDesktop(items: { title: string; body: string }[]): void {
  if (items.length === 0 || typeof Notification === "undefined") return;
  const fire = () => {
    if (Notification.permission !== "granted") return;
    for (const it of items) {
      try {
        new Notification(it.title, { body: it.body });
      } catch {
        /* 某些瀏覽器 constructor 受限（如需 ServiceWorker），忽略即可 */
      }
    }
  };
  if (Notification.permission === "default") {
    Notification.requestPermission().then(fire).catch(() => {});
  } else {
    fire();
  }
}

function StatusPoller({ id }: { id: string }) {
  const utils = trpc.useUtils();
  const status = trpc.generation.status.useQuery(
    { id },
    {
      // 到終局（done/failed）就停：此元件要等父列表刷新才卸載，這段空窗不能繼續空轉打 API
      refetchInterval: (query) =>
        query.state.data?.status === "done" || query.state.data?.status === "failed" ? false : 4000,
      // 切到別的分頁時也要繼續輪詢——否則使用者一離開，生成就「卡在生成中」直到切回來。
      refetchIntervalInBackground: true,
    },
  );
  const finished = status.data?.status === "done" || status.data?.status === "failed";
  // 完成後刷新列表與點數。副作用不能放 select（select 會在每次 render 重跑，觸發次數不受控）
  useEffect(() => {
    if (!finished) return;
    utils.generation.listByProject.invalidate();
    utils.generation.listByProjectPaged.invalidate();
    utils.quota.my.invalidate();
    utils.scenes.listByProject.invalidate();
    utils.projects.assets.invalidate(); // 生成完成會 insert 素材，素材庫/來源下拉要即時反映
  }, [finished, utils]);
  return null;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "排隊中",
  running: "生成中…",
  done: "完成 ✓",
  failed: "失敗（已退點）",
  // 不用滿彩 emoji（⏳/⛔）：pill 配色已承載語意，emoji 跨平台渲染不一且違反單色圖示語彙
  awaiting_approval: "待組長核准",
  rejected: "已駁回",
};

/** 成本審核的兩個新狀態沒有專屬 .pill 配色——借語意最近的既有 class（待核准＝queued 金、已駁回＝failed 紅） */
const STATUS_PILL_CLASS: Record<string, string> = { awaiting_approval: "queued", rejected: "failed" };

export function GenerationList({ projectId, canEdit = true }: { projectId: string; canEdit?: boolean }) {
  const utils = trpc.useUtils();
  const list = trpc.generation.listByProject.useQuery(
    { projectId },
    {
      // 有進行中的生成 8 秒、閒置降到 45 秒。閒置不能完全停：後端無背景排程，生成狀態
      // 推進全靠「任何一個開著專案頁的瀏覽器」輪詢 status——完全停輪會讓組員/MCP 送出的
      // 生成在本分頁永不出現、也沒人推進它，30 分鐘後被陳屍清掃誤判失敗退點
      refetchInterval: (query) =>
        query.state.data?.some((g) => g.status === "queued" || g.status === "running") ? 8000 : 45_000,
      refetchIntervalInBackground: true,
    },
  );

  // ── 篩選 / 搜尋 / 分頁 ──────────────────────────────────────────────
  // 設計：預設（無篩選、未展開）維持既有 list（首頁 30 筆＋輪詢＋通知＋外部失效即時刷新，全不動）。
  // 一旦使用者設篩選/搜尋或按「載入更多」，切到 listByProjectPaged 這支 keyset 分頁查詢當顯示來源。
  const [statusFilter, setStatusFilter] = useState<
    "queued" | "running" | "done" | "failed" | "awaiting_approval" | "rejected" | null
  >(null);
  const [kindFilter, setKindFilter] = useState<"image" | "video" | "audio" | "text" | null>(null);
  /** 分鏡篩選：選了某格分鏡就只看綁定該格的生成（帶進 listByProjectPaged 的 sceneId） */
  const [sceneFilter, setSceneFilter] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [expanded, setExpanded] = useState(false); // 按過「載入更多」
  const [favoriteOnly, setFavoriteOnly] = useState(false); // #20 只看收藏
  const filtering =
    statusFilter !== null || kindFilter !== null || sceneFilter !== null || debouncedSearch.trim() !== "" || favoriteOnly;
  const browsing = filtering || expanded; // 顯示來源改用分頁查詢的條件
  const paged = trpc.generation.listByProjectPaged.useInfiniteQuery(
    {
      projectId,
      status: statusFilter ?? undefined,
      kind: kindFilter ?? undefined,
      sceneId: sceneFilter ?? undefined,
      search: debouncedSearch.trim() || undefined,
      favoriteOnly: favoriteOnly || undefined,
    },
    {
      enabled: browsing,
      // 換篩選條件（query key 變）時沿用上一批結果當佔位，列表不整批清空跳版
      placeholderData: (prev) => prev,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      // 分頁視圖也要輪詢進行中的生成（與首頁同節奏：有進行中 8 秒、否則 45 秒）
      refetchInterval: (query) =>
        query.state.data?.pages.some((p) => p.items.some((g) => g.status === "queued" || g.status === "running"))
          ? 8000
          : 45_000,
      refetchIntervalInBackground: true,
    },
  );
  const pagedRows = paged.data?.pages.flatMap((p) => p.items) ?? [];
  // 顯示來源：瀏覽/篩選模式用分頁結果，否則沿用既有首頁 list（保留所有既有行為）。
  // 「載入更多」剛切到分頁來源、首批還沒回來時（無篩選＝結果必是同一批的超集）先沿用首頁 30 筆，
  // 原本畫面上的列不會整批消失再重新冒出——那看起來像資料被弄丟了
  const rows = browsing
    ? (pagedRows.length === 0 && paged.isLoading && !filtering ? list.data ?? [] : pagedRows)
    : list.data ?? [];

  // #0 完成通知：在列表層偵測某筆生成由 queued/running 轉 done/failed 的「邊緣」，
  // 發桌面通知＋（背景分頁時）標題未讀徽章。推進已改由伺服器背景做，這裡純附加通知、不改輪詢。
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const unreadRef = useRef(0);
  const baseTitleRef = useRef<string>("");
  // 報讀器宣告（無障礙）：狀態 pill 只是靜默換字，留在頁面上的報讀器使用者無從得知生成完成/失敗
  const [liveMsg, setLiveMsg] = useState("");

  // 分頁切回前景即清除未讀徽章，還原原始標題
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && unreadRef.current > 0) {
        unreadRef.current = 0;
        if (baseTitleRef.current) document.title = baseTitleRef.current;
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    const rows = list.data;
    if (!rows) return;
    const prev = prevStatusRef.current;
    const isFirst = prev.size === 0; // 首輪只建基準，不通知（避免載入既有已完成列時洗一排通知）
    const justFinished: { title: string; body: string }[] = [];
    for (const g of rows) {
      const before = prev.get(g.id);
      if (!isFirst && (before === "queued" || before === "running") && (g.status === "done" || g.status === "failed")) {
        justFinished.push({ title: g.status === "done" ? "生成完成 ✓" : "生成失敗", body: g.prompt.slice(0, 20) });
      }
      prev.set(g.id, g.status);
    }
    // 清掉已不在列表的舊 id（列表上限 30，避免 map 無限長）
    for (const id of Array.from(prev.keys())) {
      if (!rows.some((g) => g.id === id)) prev.delete(id);
    }
    if (justFinished.length === 0) return;
    // (0) 頁內 aria-live 宣告：桌面通知需另外授權且離頁才有感，報讀器使用者靠這行才知道結果
    setLiveMsg(justFinished.map((x) => `${x.body}：${x.title}`).join("；"));
    // (1) 桌面通知——聚合：一次偵測到多筆完成（如工作流一次跑完多鏡）就發「一則彙總」而非逐筆洗版
    if (justFinished.length === 1) {
      notifyDesktop(justFinished);
    } else {
      const doneN = justFinished.filter((x) => x.title.includes("完成")).length;
      const failN = justFinished.length - doneN;
      const head = [doneN ? `${doneN} 個生成完成 ✓` : "", failN ? `${failN} 個失敗` : ""].filter(Boolean).join("・");
      const body = justFinished.map((x) => x.body).slice(0, 3).join("；") + (justFinished.length > 3 ? "…" : "");
      notifyDesktop([{ title: head, body }]);
    }
    if (document.hidden) {
      // (2) 背景分頁標題徽章：(N) 前綴；base 只抓一次並剝掉既有前綴，切回前景由上面的 effect 清除
      if (!baseTitleRef.current) baseTitleRef.current = document.title.replace(/^\(\d+\)\s*/, "");
      unreadRef.current += justFinished.length;
      document.title = `(${unreadRef.current}) ${baseTitleRef.current}`;
    }
  }, [list.data]);

  // 與 SceneList 同 key 共用快取，不會多打 API——用來判斷成品是否已加入分鏡
  const scenes = trpc.scenes.listByProject.useQuery({ projectId });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  // #20 行內重新命名：正在編輯的列 id ＋ 草稿字串
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const addScene = trpc.scenes.addFromGeneration.useMutation({
    onMutate: () => setAddedId(null),
    onSuccess: (_data, vars) => {
      setAddedId(vars.generationId);
      utils.scenes.listByProject.invalidate({ projectId });
    },
  });
  const retry = trpc.generation.submit.useMutation({
    // fal submit 失敗時伺服器也已寫入一筆 failed 列——成功失敗都要刷新列表與點數
    onSettled: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.generation.listByProjectPaged.invalidate({ projectId });
      utils.quota.my.invalidate();
    },
  });
  // #20 命名：純 metadata，成功後同時失效首頁 list 與分頁 paged（兩種顯示來源都要更新）
  const rename = trpc.generation.rename.useMutation({
    onSuccess: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.generation.listByProjectPaged.invalidate({ projectId });
    },
  });
  // #20 收藏切換：同樣失效兩支查詢（「只看收藏」篩選結果也要即時反映）
  const toggleFavorite = trpc.generation.toggleFavorite.useMutation({
    onSuccess: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.generation.listByProjectPaged.invalidate({ projectId });
    },
  });
  // 成本審核：與 App 同 key 共用 auth.me 快取——用該列 groupId 對出自己的組內角色，組長以上才畫核准/駁回鈕
  const me = trpc.auth.me.useQuery();
  const canDecide = (groupId: string) => {
    const role = me.data?.groups.find((g) => g.groupId === groupId)?.role;
    return role != null && role !== "member";
  };
  // 裁決成本審核（核准→開始生成並扣點；駁回→終局）：成功後刷新生成列表與點數
  const decideCost = trpc.generation.decideCost.useMutation({
    onSuccess: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.generation.listByProjectPaged.invalidate({ projectId });
      utils.quota.my.invalidate();
    },
  });
  // 把某筆成品設為其綁定分鏡的現用畫面（音訊生成則設為旁白）：成功後刷新分鏡列表
  const setVisual = trpc.scenes.setVisualFromGeneration.useMutation({
    onSuccess: () => utils.scenes.listByProject.invalidate({ projectId }),
  });
  const submitRename = (id: string) => {
    rename.mutate({ generationId: id, name: renameDraft.trim() }, { onSuccess: () => setRenamingId(null) });
  };
  const addSceneError = addScene.error?.message;
  const inScenes = (genId: string) => !!scenes.data?.some((s) => s.generationId === genId);
  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
  };

  if (list.isLoading)
    return (
      <div style={{ marginTop: 14 }} aria-hidden="true">
        {[0, 1, 2].map((k) => (
          <div key={k} className="gen-row">
            <div className="gen-thumb skeleton" />
            <div>
              <div className="skeleton" style={{ height: 14, width: k === 1 ? "55%" : "72%", marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 11, width: "40%" }} />
            </div>
            <div className="skeleton" style={{ height: 28, width: 64, borderRadius: 999 }} />
          </div>
        ))}
      </div>
    );
  if (!list.data?.length)
    return (
      <div className="empty-state" style={{ marginTop: 12 }}>
        <h3>還沒有生成紀錄——</h3>
        <p>上面試一次吧。</p>
      </div>
    );

  return (
    <div style={{ marginTop: 14 }} data-fb="生成紀錄">
      {/* 視覺隱藏的狀態宣告區：生成由進行中轉完成/失敗時朗讀一次 */}
      <div className="sr-only" role="status" aria-live="polite">{liveMsg}</div>
      {addSceneError && <p className="error">加入分鏡失敗：{addSceneError}</p>}
      {addedId && !addSceneError && (
        <p className="hint" style={{ color: "var(--success-ink)" }}>已加入分鏡 ✓（在下方分鏡・交付區）</p>
      )}
      {retry.error && <p className="error">重試失敗：{retry.error.message}</p>}
      {decideCost.error && <p className="error">核准／駁回失敗：{decideCost.error.message}</p>}
      {setVisual.error && <p className="error">設為分鏡現用失敗：{setVisual.error.message}</p>}
      <div
        className="gen-filters"
        style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }}
      >
        {([["queued", "排隊中"], ["running", "生成中"], ["done", "完成"], ["failed", "失敗"], ["awaiting_approval", "待核准"], ["rejected", "已駁回"]] as const).map(([val, label]) => (
          <button
            key={val}
            type="button"
            className={`chip pick ${statusFilter === val ? "on" : ""}`}
            aria-pressed={statusFilter === val}
            onClick={() => setStatusFilter((cur) => (cur === val ? null : val))}
          >
            {label}
          </button>
        ))}
        <span style={{ width: 1, height: 16, background: "var(--border)" }} aria-hidden="true" />
        {([["image", "圖片"], ["video", "影片"], ["audio", "音訊"], ["text", "文字"]] as const).map(([val, label]) => (
          <button
            key={val}
            type="button"
            className={`chip pick ${kindFilter === val ? "on" : ""}`}
            aria-pressed={kindFilter === val}
            onClick={() => setKindFilter((cur) => (cur === val ? null : val))}
          >
            {label}
          </button>
        ))}
        <span style={{ width: 1, height: 16, background: "var(--border)" }} aria-hidden="true" />
        <button
          type="button"
          className={`chip pick ${favoriteOnly ? "on" : ""}`}
          aria-pressed={favoriteOnly}
          onClick={() => setFavoriteOnly((v) => !v)}
        >
          <Icon name="Star" size={12} style={{ verticalAlign: "-2px", marginRight: 4, ...(favoriteOnly ? { fill: "currentColor" } : {}) }} />
          只看收藏
        </button>
        <span style={{ width: 1, height: 16, background: "var(--border)" }} aria-hidden="true" />
        {/* 分鏡篩選：只看綁定某格分鏡的生成（就地生成/旁白配音都會綁 sceneId） */}
        <select
          aria-label="篩選分鏡"
          value={sceneFilter ?? ""}
          onChange={(e) => setSceneFilter(e.target.value || null)}
          style={{ width: "auto", maxWidth: 200, padding: "4px 10px", fontSize: 12 }}
        >
          <option value="">全部分鏡</option>
          {(scenes.data ?? []).map((s, i) => (
            <option key={s.id} value={s.id}>第 {i + 1} 鏡・{s.title}</option>
          ))}
        </select>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="搜尋提示詞…"
          aria-label="搜尋提示詞"
          style={{ flex: "1 1 140px", minWidth: 120, padding: "4px 10px", fontSize: 12 }}
        />
        {browsing && (
          <button
            type="button"
            onClick={() => {
              setStatusFilter(null);
              setKindFilter(null);
              setSceneFilter(null);
              setSearchInput("");
              setDebouncedSearch("");
              setFavoriteOnly(false);
              setExpanded(false);
            }}
            style={{ padding: "3px 10px", fontSize: 12 }}
          >
            清除
          </button>
        )}
      </div>
      {/* 查詢失敗不能偽裝成「查無資料」——講清楚是伺服器/網路問題並給重試出口 */}
      {browsing && paged.isError && (
        <p className="error" role="alert" style={{ marginTop: 12 }}>
          生成紀錄暫時載入不了（不是資料不見了）——
          <button className="btn-ghost btn-sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => paged.refetch()}>再試一次</button>
        </p>
      )}
      {browsing && paged.isLoading && rows.length === 0 && <p className="hint" style={{ marginTop: 12 }}>載入中…</p>}
      {browsing && !paged.isLoading && !paged.isError && rows.length === 0 && (
        <p className="hint" style={{ marginTop: 12 }}>沒有符合條件的生成紀錄。</p>
      )}
      {rows.map((g) => (
        <div key={g.id} className="gen-row" id={`generation-${g.id}`}>
          {(g.status === "queued" || g.status === "running") && <StatusPoller id={g.id} />}
          {g.resultUrl ? (
            g.kind === "video" ? (
              <video className="gen-thumb" src={g.resultUrl} controls muted />
            ) : g.kind === "audio" ? (
              <div className="gen-thumb" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-fg)" }}><Icon name="Volume2" size={24} /></div>
            ) : (
              <a href={g.resultUrl} target="_blank" rel="noreferrer">
                <img className="gen-thumb" src={g.resultUrl} alt={g.prompt.slice(0, 40)} />
              </a>
            )
          ) : (
            <div className="gen-thumb" style={g.kind === "text" ? { display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-fg)" } : undefined}>
              {g.kind === "text" ? <Icon name="FileText" size={24} /> : ""}
            </div>
          )}
          <div>
            {/* #20 名稱＋收藏列：附加在既有 prompt 顯示「之上」，下方 prompt div 原樣保留（e2e 以 prompt 文字比對）。
                收藏/命名是全組共見 metadata——檢視者唯讀（2.3），只顯示現值不給改 */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
              {/* 在留言中討論：所有人可用（含檢視者）——把這筆生成帶進組內留言變成有錨點的對話 */}
              <button
                type="button"
                aria-label="在留言中討論這筆生成"
                title="把這筆生成帶進組內留言討論"
                onClick={() => discussInMessages({ refType: "generation", refId: g.id, title: g.name || g.prompt.slice(0, 40) })}
                style={{ display: "inline-flex", padding: 2, background: "none", border: "none", cursor: "pointer", color: "var(--muted-fg)" }}
              >
                <Icon name="MessageCircle" size={15} />
              </button>
              {canEdit ? (
                <button
                  type="button"
                  aria-label={g.favorite ? "取消收藏" : "收藏"}
                  aria-pressed={!!g.favorite}
                  disabled={toggleFavorite.isPending}
                  onClick={() => toggleFavorite.mutate({ generationId: g.id, favorite: !g.favorite })}
                  style={{ display: "inline-flex", padding: 2, background: "none", border: "none", cursor: "pointer", color: g.favorite ? "var(--gold)" : "var(--muted-fg)" }}
                >
                  <Icon name="Star" size={16} style={g.favorite ? { fill: "currentColor" } : undefined} />
                </button>
              ) : (
                g.favorite && <Icon name="Star" size={16} style={{ color: "var(--gold)", fill: "currentColor" }} />
              )}
              {canEdit && renamingId === g.id ? (
                <>
                  <input
                    autoFocus
                    value={renameDraft}
                    maxLength={80}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename(g.id);
                      else if (e.key === "Escape") setRenamingId(null);
                    }}
                    placeholder="為這次生成命名…"
                    aria-label="命名此生成"
                    style={{ fontSize: 13, padding: "2px 8px", flex: "1 1 140px", minWidth: 100 }}
                  />
                  <button
                    type="button"
                    onClick={() => submitRename(g.id)}
                    disabled={rename.isPending}
                    aria-label="儲存名稱"
                    style={{ display: "inline-flex", padding: 2, background: "none", border: "none", cursor: "pointer", color: "var(--success)" }}
                  >
                    <Icon name="Check" size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenamingId(null)}
                    aria-label="取消命名"
                    style={{ display: "inline-flex", padding: 2, background: "none", border: "none", cursor: "pointer", color: "var(--muted-fg)" }}
                  >
                    <Icon name="X" size={15} />
                  </button>
                </>
              ) : (
                <>
                  {g.name && <span style={{ fontSize: 14, fontWeight: 600 }}>{g.name}</span>}
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={g.name ? "重新命名" : "命名此生成"}
                      onClick={() => {
                        setRenamingId(g.id);
                        setRenameDraft(g.name ?? "");
                      }}
                      style={{ display: "inline-flex", padding: 2, background: "none", border: "none", cursor: "pointer", color: "var(--muted-fg)" }}
                    >
                      <Icon name="Pencil" size={14} />
                    </button>
                  )}
                </>
              )}
            </div>
            <div style={{ fontSize: 14 }}>{g.prompt}</div>
            <div className="meta mono" style={{ fontSize: 11 }}>
              {getModel(g.modelId)?.label ?? g.modelId}・−{g.pointsEst} 點{g.pointsRefunded > 0 && `（已退 +${g.pointsRefunded}）`}
            </div>
            {g.kind === "audio" && g.resultUrl && (
              <audio controls src={g.resultUrl} style={{ width: "100%", maxWidth: 320, height: 32, marginTop: 6 }} />
            )}
            {g.resultText && (
              <div
                className="result-text"
                style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 6 }}
              >
                {g.resultText}
                <div style={{ marginTop: 6 }}>
                  <button style={{ padding: "2px 10px", fontSize: 11 }} onClick={() => copyText(g.id, g.resultText ?? "")}>
                    {copiedId === g.id ? "已複製 ✓" : "複製文字"}
                  </button>
                </div>
              </div>
            )}
            {/* 已駁回列的 error 欄存的是駁回理由，前綴要講對，別誤導成「生成失敗」 */}
            {g.error && <div className="error">{g.status === "rejected" ? "駁回理由：" : "生成失敗："}{g.error}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <span className={`pill ${STATUS_PILL_CLASS[g.status] ?? g.status}`}>{STATUS_LABEL[g.status] ?? g.status}</span>
            {canEdit && g.status === "done" && g.kind !== "text" && (
              inScenes(g.id) ? (
                <button style={{ padding: "4px 12px", fontSize: 12 }} disabled>已加入</button>
              ) : (
                <button style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", fontSize: 12 }} disabled={addScene.isPending}
                  onClick={() => addScene.mutate({ generationId: g.id })}>
                  <Icon name="Plus" size={13} />加入分鏡
                </button>
              )
            )}
            {/* 綁定分鏡的成品可一鍵回填為該格現用畫面（音訊＝旁白）——重生多次後挑最好的一版用 */}
            {canEdit && g.status === "done" && g.sceneId && (
              <ConfirmButton
                triggerStyle={{ padding: "4px 12px", fontSize: 12 }}
                disabled={setVisual.isPending}
                message={g.kind === "audio" ? "把這筆音訊設為該分鏡的旁白？" : "把這筆成品設為該分鏡的現用畫面？"}
                confirmLabel="設定"
                onConfirm={() => setVisual.mutate({ sceneId: g.sceneId!, generationId: g.id })}
              >
                設為此鏡現用
              </ConfirmButton>
            )}
            {/* 成本審核：組長以上就地裁決；駁回可附理由（會存進該列 error 欄顯示給組員） */}
            {g.status === "awaiting_approval" && canDecide(g.groupId) && (
              <>
                <ConfirmButton
                  triggerStyle={{ padding: "4px 12px", fontSize: 12, color: "var(--success-ink)", borderColor: "var(--success)" }}
                  disabled={decideCost.isPending}
                  message={`核准後這筆會開始生成（預估 ${g.pointsEst} 點）。`}
                  confirmLabel="核准"
                  onConfirm={() => decideCost.mutate({ id: g.id, decision: "approved" })}
                >
                  核准
                </ConfirmButton>
                <ConfirmButton
                  triggerStyle={{ padding: "4px 12px", fontSize: 12, color: "var(--danger-ink)", borderColor: "var(--danger)" }}
                  disabled={decideCost.isPending}
                  title="駁回這筆生成"
                  reason={{ label: "駁回理由（會顯示給組員，建議填寫）", placeholder: "說明為什麼不核准…" }}
                  confirmLabel="駁回"
                  onConfirm={(reason) => decideCost.mutate({ id: g.id, decision: "rejected", ...(reason ? { reason } : {}) })}
                >
                  駁回
                </ConfirmButton>
              </>
            )}
            {g.status === "failed" && (
              <ConfirmButton
                triggerStyle={{ padding: "4px 12px", fontSize: 12 }}
                disabled={retry.isPending}
                message={`以相同設定重試${g.pointsEst > 0 ? `會再扣 ${g.pointsEst} 點` : "會再扣點"}，確定要重試嗎？`}
                confirmLabel="重試"
                onConfirm={() => {
                  // 素材庫來源存的是 48 小時簽名網址——過期後原樣重送必敗。
                  // 從網址取回 assetId 改走 sourceAssetId，讓伺服器重新簽名（順帶重過相容性守門）
                  const assetId = g.sourceUrl?.match(/\/api\/assets\/([0-9a-f-]{36})\/file/)?.[1];
                  retry.mutate({
                    projectId, modelId: g.modelId, prompt: g.prompt,
                    ...(assetId ? { sourceAssetId: assetId } : { sourceUrl: g.sourceUrl ?? undefined }),
                  });
                }}
              >
                以相同設定重試
              </ConfirmButton>
            )}
          </div>
        </div>
      ))}
      {browsing
        ? paged.hasNextPage && (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button type="button" disabled={paged.isFetchingNextPage} onClick={() => paged.fetchNextPage()} style={{ padding: "6px 16px", fontSize: 13 }}>
                {paged.isFetchingNextPage ? "載入中…" : "載入更多"}
              </button>
            </div>
          )
        : (list.data?.length ?? 0) >= 30 && (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button type="button" onClick={() => setExpanded(true)} style={{ padding: "6px 16px", fontSize: 13 }}>
                載入更多
              </button>
            </div>
          )}
    </div>
  );
}
