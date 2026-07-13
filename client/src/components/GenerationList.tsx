import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { getModel } from "@shared/models";
import { Icon } from "./Icon";

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
};

export function GenerationList({ projectId }: { projectId: string }) {
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
  const [statusFilter, setStatusFilter] = useState<"queued" | "running" | "done" | "failed" | null>(null);
  const [kindFilter, setKindFilter] = useState<"image" | "video" | "audio" | "text" | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [expanded, setExpanded] = useState(false); // 按過「載入更多」
  const [favoriteOnly, setFavoriteOnly] = useState(false); // #20 只看收藏
  const filtering = statusFilter !== null || kindFilter !== null || debouncedSearch.trim() !== "" || favoriteOnly;
  const browsing = filtering || expanded; // 顯示來源改用分頁查詢的條件
  const paged = trpc.generation.listByProjectPaged.useInfiniteQuery(
    {
      projectId,
      status: statusFilter ?? undefined,
      kind: kindFilter ?? undefined,
      search: debouncedSearch.trim() || undefined,
      favoriteOnly: favoriteOnly || undefined,
    },
    {
      enabled: browsing,
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
  // 顯示來源：瀏覽/篩選模式用分頁結果，否則沿用既有首頁 list（保留所有既有行為）
  const rows = browsing ? pagedRows : list.data ?? [];

  // #0 完成通知：在列表層偵測某筆生成由 queued/running 轉 done/failed 的「邊緣」，
  // 發桌面通知＋（背景分頁時）標題未讀徽章。推進已改由伺服器背景做，這裡純附加通知、不改輪詢。
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const unreadRef = useRef(0);
  const baseTitleRef = useRef<string>("");

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
  if (!list.data?.length) return <p className="hint" style={{ marginTop: 12 }}>還沒有生成紀錄——上面試一次吧。</p>;

  return (
    <div style={{ marginTop: 14 }} data-fb="生成紀錄">
      {addSceneError && <p className="error">加入分鏡失敗：{addSceneError}</p>}
      {addedId && !addSceneError && (
        <p className="hint" style={{ color: "var(--success)" }}>已加入分鏡 ✓（在下方分鏡・交付區）</p>
      )}
      {retry.error && <p className="error">重試失敗：{retry.error.message}</p>}
      <div
        className="gen-filters"
        style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }}
      >
        {([["queued", "排隊中"], ["running", "生成中"], ["done", "完成"], ["failed", "失敗"]] as const).map(([val, label]) => (
          <button
            key={val}
            type="button"
            className="gen-filter-chip"
            aria-pressed={statusFilter === val}
            onClick={() => setStatusFilter((cur) => (cur === val ? null : val))}
            style={{ padding: "3px 10px", fontSize: 12, borderRadius: 999, opacity: statusFilter === val ? 1 : 0.55, fontWeight: statusFilter === val ? 600 : 400 }}
          >
            {label}
          </button>
        ))}
        <span style={{ width: 1, height: 16, background: "rgba(0,0,0,.15)" }} aria-hidden="true" />
        {([["image", "圖片"], ["video", "影片"], ["audio", "音訊"], ["text", "文字"]] as const).map(([val, label]) => (
          <button
            key={val}
            type="button"
            className="gen-filter-chip"
            aria-pressed={kindFilter === val}
            onClick={() => setKindFilter((cur) => (cur === val ? null : val))}
            style={{ padding: "3px 10px", fontSize: 12, borderRadius: 999, opacity: kindFilter === val ? 1 : 0.55, fontWeight: kindFilter === val ? 600 : 400 }}
          >
            {label}
          </button>
        ))}
        <span style={{ width: 1, height: 16, background: "rgba(0,0,0,.15)" }} aria-hidden="true" />
        <button
          type="button"
          className="gen-filter-chip"
          aria-pressed={favoriteOnly}
          onClick={() => setFavoriteOnly((v) => !v)}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", fontSize: 12, borderRadius: 999, opacity: favoriteOnly ? 1 : 0.55, fontWeight: favoriteOnly ? 600 : 400 }}
        >
          <Icon name="Star" size={12} style={favoriteOnly ? { fill: "currentColor" } : undefined} />
          只看收藏
        </button>
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
      {browsing && paged.isLoading && <p className="hint" style={{ marginTop: 12 }}>載入中…</p>}
      {browsing && !paged.isLoading && rows.length === 0 && (
        <p className="hint" style={{ marginTop: 12 }}>沒有符合條件的生成紀錄。</p>
      )}
      {rows.map((g) => (
        <div key={g.id} className="gen-row">
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
            {/* #20 名稱＋收藏列：附加在既有 prompt 顯示「之上」，下方 prompt div 原樣保留（e2e 以 prompt 文字比對） */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
              <button
                type="button"
                aria-label={g.favorite ? "取消收藏" : "收藏"}
                aria-pressed={!!g.favorite}
                disabled={toggleFavorite.isPending}
                onClick={() => toggleFavorite.mutate({ generationId: g.id, favorite: !g.favorite })}
                style={{ display: "inline-flex", padding: 2, background: "none", border: "none", cursor: "pointer", color: g.favorite ? "#E0A800" : "var(--muted-fg)" }}
              >
                <Icon name="Star" size={16} style={g.favorite ? { fill: "currentColor" } : undefined} />
              </button>
              {renamingId === g.id ? (
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
                style={{
                  whiteSpace: "pre-wrap", fontSize: 13, background: "var(--bg, #F4EEE4)",
                  border: "1px solid rgba(0,0,0,.08)", borderRadius: 10, padding: "8px 12px", marginTop: 6,
                }}
              >
                {g.resultText}
                <div style={{ marginTop: 6 }}>
                  <button style={{ padding: "2px 10px", fontSize: 11 }} onClick={() => copyText(g.id, g.resultText ?? "")}>
                    {copiedId === g.id ? "已複製 ✓" : "複製文字"}
                  </button>
                </div>
              </div>
            )}
            {g.error && <div className="error">生成失敗：{g.error}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <span className={`pill ${g.status}`}>{STATUS_LABEL[g.status] ?? g.status}</span>
            {g.status === "done" && g.kind !== "text" && (
              inScenes(g.id) ? (
                <button style={{ padding: "4px 12px", fontSize: 12 }} disabled>已加入</button>
              ) : (
                <button style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", fontSize: 12 }} disabled={addScene.isPending}
                  onClick={() => addScene.mutate({ generationId: g.id })}>
                  ＋加入分鏡
                </button>
              )
            )}
            {g.status === "failed" && (
              <button style={{ padding: "4px 12px", fontSize: 12 }} disabled={retry.isPending}
                onClick={() => {
                  const cost = g.pointsEst > 0 ? `會再扣 ${g.pointsEst} 點` : "會再扣點";
                  if (!window.confirm(`以相同設定重試${cost}，確定要重試嗎？`)) return;
                  // 素材庫來源存的是 48 小時簽名網址——過期後原樣重送必敗。
                  // 從網址取回 assetId 改走 sourceAssetId，讓伺服器重新簽名（順帶重過相容性守門）
                  const assetId = g.sourceUrl?.match(/\/api\/assets\/([0-9a-f-]{36})\/file/)?.[1];
                  retry.mutate({
                    projectId, modelId: g.modelId, prompt: g.prompt,
                    ...(assetId ? { sourceAssetId: assetId } : { sourceUrl: g.sourceUrl ?? undefined }),
                  });
                }}>
                以相同設定重試
              </button>
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
