import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { getModel } from "@shared/models";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";
import { GenerationPromptCopy, GenerationResultCopy } from "./GenerationCopy";
import { AssetVideo, AssetAudio, MissingMediaBox } from "./MediaFallback";
import { discussInMessages } from "../discuss";
import { revealWorkbenchAnchor } from "../features/creation-workbench/workbenchNav";

import { Button, Chip, EmptyState, Hint, Meta, Pill, Skeleton, type PillStatus } from "./ui";
/** 生成結果縮圖（圖片）：載入失敗顯示「結果已失效」佔位，並拿掉開新分頁連結（點下去只會是 404） */
function GenResultImgLink({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  if (failed) return <MissingMediaBox className="gen-thumb" label="結果已失效" iconSize={16} />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="gen-thumb" src={url} alt={alt} onError={() => setFailed(true)} />
    </a>
  );
}

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
      // 到終局（done/failed）就停：此元件要等父列表刷新才卸載，這段空窗不能繼續空轉打 API。
      // 推進已交 generationRunner（~6s），輪詢只是讀 DB 刷新 UI——10s 夠用，再密無意義。
      refetchInterval: (query) =>
        query.state.data?.status === "done" || query.state.data?.status === "failed" ? false : 10_000,
      // 背景分頁也繼續讀狀態，回到前景時列表/點數能即時反映 runner 已推進的結果。
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

/** 成本審核的兩個新狀態沒有專屬 pill 配色——借語意最近的既有狀態（待核准＝queued 金、已駁回＝failed 紅） */
const STATUS_PILL_CLASS: Record<string, PillStatus> = { awaiting_approval: "queued", rejected: "failed" };

/** 「再用此設定」帶回生成台的完整設定（與 ProjectPage.applyPrompt 的 settings 同形狀） */
export interface ReuseSettings {
  modelId?: string | null;
  characterIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
  sourceAssetId?: string | null;
}

export function GenerationList({
  projectId,
  canEdit = true,
  onReuse,
}: {
  projectId: string;
  canEdit?: boolean;
  /** 把某筆生成的完整設定（提示詞＋模型＋角色/場景/素材卡＋來源素材）帶回生成台再生一次 */
  onReuse?: (text: string, settings?: ReuseSettings) => void;
}) {
  const utils = trpc.useUtils();
  const list = trpc.generation.listByProject.useQuery(
    { projectId },
    {
      // 有進行中的生成 8 秒、閒置降到 45 秒。推進已由 generationRunner 負責；
      // 列表輪詢只是刷新 UI（組員/MCP 送出的新列也會出現）＋ list 路徑節流陳屍備援。
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
    // (1) 桌面通知——聚合：一次偵測到多筆完成（如製作範本一次跑完多鏡）就發「一則彙總」而非逐筆洗版
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
  // 與 ProjectPage 同 key 共用快取——把生成列存的角色/場景卡 id 翻成名字（注入透明化的回看線）
  const characters = trpc.characters.list.useQuery({ projectId });
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId });
  const charName = (cid: string) => characters.data?.find((c) => c.id === cid)?.name ?? "已刪除的角色";
  const presetName = (sid: string) => scenePresets.data?.find((s) => s.id === sid)?.name ?? "已刪除的場景";
  /** 綁定分鏡的「第 N 鏡」標籤（分鏡已刪就回 null，不畫死鏈） */
  const sceneLabel = (sceneId: string) => {
    const idx = scenes.data?.findIndex((s) => s.id === sceneId) ?? -1;
    return idx >= 0 ? `第 ${idx + 1} 鏡・${scenes.data![idx].title}` : null;
  };
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
  // 伺服器端完整重試：角色/場景錨點、分鏡綁定、來源重簽全由伺服器從失敗列還原——
  // 舊做法前端只重組 prompt/model/來源，錨點默默掉光（跨鏡一致性斷裂）
  const retry = trpc.generation.retry.useMutation({
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
  // Phase B：完成列一鍵發布到全站靈感頻道（對齊 PromptLibrary）
  const publish = trpc.community.publishFromSource.useMutation({
    onSuccess: () => utils.community.invalidate(),
  });
  const [publishState, setPublishState] = useState<{ id: string; ok: boolean; msg?: string } | null>(null);
  const flashPublish = (id: string, ok: boolean, msg?: string) => {
    setPublishState({ id, ok, msg });
    setTimeout(() => setPublishState((s) => (s && s.id === id ? null : s)), 2000);
  };
  // 裁決成本審核（核准→開始生成並扣點；駁回→終局）：成功後刷新生成列表與點數
  const decideCost = trpc.generation.decideCost.useMutation({
    onSuccess: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.generation.listByProjectPaged.invalidate({ projectId });
      utils.quota.my.invalidate();
    },
  });
  // 提交者取消自己的待核（未扣點）
  const cancelAwaiting = trpc.generation.cancelAwaiting.useMutation({
    onSuccess: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.generation.listByProjectPaged.invalidate({ projectId });
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
            <Skeleton className="gen-thumb" />
            <div>
              <Skeleton style={{ height: 14, width: k === 1 ? "55%" : "72%", marginBottom: 8 }} />
              <Skeleton style={{ height: 11, width: "40%" }} />
            </div>
            <Skeleton style={{ height: 28, width: 64, borderRadius: 999 }} />
          </div>
        ))}
      </div>
    );
  if (!list.data?.length)
    return (
      <EmptyState icon={<Icon name="Sparkles" />} title={<>還沒有生成紀錄——</>} description={<>上面試一次吧。</>} style={{ marginTop: 12 }} />
    );

  const activeFilterCount =
    Number(!!statusFilter) +
    Number(!!kindFilter) +
    Number(!!sceneFilter) +
    Number(!!debouncedSearch) +
    Number(favoriteOnly);

  return (
    <div style={{ marginTop: 14 }} data-fb="生成紀錄">
      {/* 視覺隱藏的狀態宣告區：生成由進行中轉完成/失敗時朗讀一次 */}
      <div className="sr-only" role="status" aria-live="polite">{liveMsg}</div>
      {addSceneError && <p className="error">加入分鏡失敗：{addSceneError}</p>}
      {addedId && !addSceneError && (
        <Meta as="p" style={{ color: "var(--success-ink)" }}>已加入分鏡 ✓（在下方分鏡・交付區）</Meta>
      )}
      {retry.error && <p className="error">重試失敗：{retry.error.message}</p>}
      {decideCost.error && <p className="error">核准／駁回失敗：{decideCost.error.message}</p>}
      {setVisual.error && <p className="error">設為分鏡現用失敗：{setVisual.error.message}</p>}
      <details className="generation-filter-panel">
        <summary>
          <span><Icon name="SlidersHorizontal" size={13} /> 篩選與搜尋</span>
          <Meta>{activeFilterCount > 0 ? `已套用 ${activeFilterCount} 項` : "依狀態、類型、分鏡或提示詞尋找"}</Meta>
        </summary>
        <div
          className="gen-filters"
          style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}
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
      </details>
      {/* 查詢失敗不能偽裝成「查無資料」——講清楚是伺服器/網路問題並給重試出口 */}
      {browsing && paged.isError && (
        <p className="error" role="alert" style={{ marginTop: 12 }}>
          生成紀錄暫時載入不了（不是資料不見了）——
          <Button variant="ghost" size="sm" style={{ marginLeft: "var(--sp-4)" }} onClick={() => paged.refetch()}>再試一次</Button>
        </p>
      )}
      {browsing && paged.isLoading && rows.length === 0 && <Meta as="p" style={{ marginTop: 12 }}>載入中…</Meta>}
      {browsing && !paged.isLoading && !paged.isError && rows.length === 0 && (
        <Meta as="p" style={{ marginTop: 12 }}>沒有符合條件的生成紀錄。</Meta>
      )}
      {rows.map((g) => (
        <div key={g.id} className="gen-row" id={`generation-${g.id}`}>
          {(g.status === "queued" || g.status === "running") && <StatusPoller id={g.id} />}
          {g.resultUrl ? (
            g.kind === "video" ? (
              <AssetVideo className="gen-thumb" src={g.resultUrl} controls muted fallbackClassName="gen-thumb" fallbackLabel="結果已失效" fallbackIconSize={16} />
            ) : g.kind === "audio" ? (
              <div className="gen-thumb" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-fg)" }}><Icon name="Volume2" size={24} /></div>
            ) : (
              <GenResultImgLink url={g.resultUrl} alt={g.prompt.slice(0, 40)} />
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
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 2, background: "none", border: "none", cursor: "pointer", color: "var(--muted-fg)" }}
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
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 2, background: "none", border: "none", cursor: "pointer", color: g.favorite ? "var(--gold)" : "var(--muted-fg)" }}
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
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 2, background: "none", border: "none", cursor: "pointer", color: "var(--success)" }}
                  >
                    <Icon name="Check" size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenamingId(null)}
                    aria-label="取消命名"
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 2, background: "none", border: "none", cursor: "pointer", color: "var(--muted-fg)" }}
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
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 2, background: "none", border: "none", cursor: "pointer", color: "var(--muted-fg)" }}
                    >
                      <Icon name="Pencil" size={14} />
                    </button>
                  )}
                </>
              )}
            </div>
            <div style={{ fontSize: 14 }}>
              <GenerationPromptCopy text={g.prompt} />
            </div>
            <div className="meta mono" style={{ fontSize: 11 }}>
              {getModel(g.modelId)?.label ?? g.modelId}・−{g.pointsEst} 點{g.pointsRefunded > 0 && `（已退 +${g.pointsRefunded}）`}
            </div>
            {/* 細膩連結列：這筆生成「帶了什麼、綁在哪、從哪來」一眼可回看、可點回去 */}
            {(() => {
              const chars = (g.characterIds as string[] | null) ?? [];
              const presets = (g.scenePresetIds as string[] | null) ?? [];
              const props = (g.propIds as string[] | null) ?? [];
              const continuity = g.continuitySnapshot as { locked?: boolean; fingerprint?: string; referenceAssetIds?: string[] } | null;
              const boundScene = g.sceneId ? sceneLabel(g.sceneId) : null;
              const injected = (g.params as { prompt?: unknown } | null)?.prompt;
              const injectedPrompt = typeof injected === "string" && injected.trim() !== g.prompt.trim() ? injected : null;
              if (!chars.length && !presets.length && !props.length && !continuity?.locked && !boundScene && !g.workflowRunId && !g.agentRunId && !injectedPrompt) return null;
              return (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginTop: 4 }}>
                  {chars.length > 0 && (
                    <Chip title={chars.map(charName).join("、")}>角色 {chars.length}</Chip>
                  )}
                  {presets.length > 0 && (
                    <Chip title={presets.map(presetName).join("、")}>場景 {presets.length}</Chip>
                  )}
                  {props.length > 0 && <Chip>素材 {props.length}</Chip>}
                  {continuity?.locked && (
                    <Chip title={`快照 ${continuity.fingerprint?.slice(0, 8) ?? "—"}・參考圖 ${continuity.referenceAssetIds?.length ?? 0} 張`}>
                      一致性鎖定
                    </Chip>
                  )}
                  {boundScene && (
                    <button
                      type="button"
                      className="chip pick"
                      title="只看綁定這一鏡的生成"
                      onClick={() => setSceneFilter(g.sceneId)}
                    >
                      {boundScene}
                    </button>
                  )}
                  {g.workflowRunId && (
                    <button
                      type="button"
                      className="chip pick"
                      title="這筆是製作範本跑出來的——點了切到工作台「製作範本」模式"
                      onClick={() => revealWorkbenchAnchor("#sec-workflow", { projectId })}
                    >
                      製作範本
                    </button>
                  )}
                  {g.agentRunId && (
                    <button
                      type="button"
                      className="chip pick"
                      title="這筆是 AI 執行計畫跑出來的——點了切到工作台「執行計畫」模式"
                      onClick={() => revealWorkbenchAnchor("#sec-agent", { projectId })}
                    >
                      AI 執行計畫
                    </button>
                  )}
                  {/* 注入透明化：世界觀/角色/場景錨點注入後「實際送給模型」的完整提示詞 */}
                  {injectedPrompt && (
                    <details style={{ flexBasis: "100%" }}>
                      <Meta as="summary" style={{ cursor: "pointer", fontSize: 12 }}>完整注入提示詞</Meta>
                      <div className="mono" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, marginTop: 4, padding: "6px 8px", background: "var(--surface-2, rgba(0,0,0,0.04))", borderRadius: 6 }}>
                        {injectedPrompt}
                        <div style={{ marginTop: 4 }}>
                          <button style={{ padding: "2px 10px", fontSize: 11 }} onClick={() => copyText(`inj-${g.id}`, injectedPrompt)}>
                            {copiedId === `inj-${g.id}` ? "已複製 ✓" : "複製"}
                          </button>
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              );
            })()}
            {g.kind === "audio" && g.resultUrl && (
              <AssetAudio controls src={g.resultUrl} style={{ width: "100%", maxWidth: 320, height: 32, marginTop: 6 }} fallbackLabel="音檔已失效（可能是伺服器重啟前的舊檔）" />
            )}
            {g.resultText && (
              <GenerationResultCopy
                text={g.resultText}
                copied={copiedId === g.id}
                onCopy={() => copyText(g.id, g.resultText ?? "")}
              />
            )}
            {/* 已駁回列的 error 欄存的是駁回理由，前綴要講對，別誤導成「生成失敗」 */}
            {g.error && <div className="error">{g.status === "rejected" ? "駁回理由：" : "生成失敗："}{g.error}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <Pill status={STATUS_PILL_CLASS[g.status] ?? (g.status as PillStatus)}>{STATUS_LABEL[g.status] ?? g.status}</Pill>
            {/* MOB-03：進行中列提示可離開（背景 runner 推進） */}
            {(g.status === "queued" || g.status === "running") && (
              <Meta style={{ fontSize: 11, textAlign: "right", maxWidth: 140 }}>
                背景執行中，可離開
              </Meta>
            )}
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
            {/* 提交者可取消自己的待核（未扣點）；組長已有駁回鈕時不必再畫 */}
            {g.status === "awaiting_approval" &&
              me.data?.user?.id === g.userId &&
              !canDecide(g.groupId) && (
                <ConfirmButton
                  triggerStyle={{ padding: "4px 12px", fontSize: 12, color: "var(--danger-ink)" }}
                  disabled={cancelAwaiting.isPending}
                  message="取消這筆待核生成？尚未扣點，取消後不會送出。"
                  confirmLabel="取消待核"
                  onConfirm={() => cancelAwaiting.mutate({ id: g.id })}
                >
                  取消待核
                </ConfirmButton>
              )}
            {g.status === "failed" && canEdit && (
              <ConfirmButton
                triggerStyle={{ padding: "4px 12px", fontSize: 12 }}
                disabled={retry.isPending}
                message={`以相同設定重試${g.pointsEst > 0 ? `會再扣 ${g.pointsEst} 點` : "會再扣點"}（角色/場景錨點與分鏡綁定都會保留），確定要重試嗎？`}
                confirmLabel="重試"
                onConfirm={() => retry.mutate({ id: g.id })}
              >
                以相同設定重試
              </ConfirmButton>
            )}
            {/* 再用此設定：把這筆的完整用法（提示詞＋模型＋角色/場景/素材卡＋來源素材）帶回生成台再生一次 */}
            {canEdit && g.status === "done" && onReuse && (
              <button
                style={{ padding: "4px 12px", fontSize: 12 }}
                title="把這筆的提示詞、模型與角色/場景/素材勾選帶回生成台"
                onClick={() =>
                  onReuse(g.prompt, {
                    modelId: g.modelId,
                    // ?? []＝「這筆當時沒帶卡」也要如實還原（清掉現勾）——否則混入當前勾選就不是「此設定」了
                    characterIds: (g.characterIds as string[] | null) ?? [],
                    scenePresetIds: (g.scenePresetIds as string[] | null) ?? [],
                    propIds: (g.propIds as string[] | null) ?? [],
                    sourceAssetId: g.sourceUrl?.match(/\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/file/i)?.[1] ?? null,
                  })
                }
              >
                再用此設定
              </button>
            )}
            {/* 靈感頻道：完成列發布（sourceType=generation） */}
            {canEdit && g.status === "done" && (
              <button
                style={{ padding: "4px 12px", fontSize: 12 }}
                title="發布到全站靈感頻道（Show Prompt + 一鍵再用）"
                disabled={publish.isPending}
                onClick={() => {
                  publish.mutate(
                    { sourceType: "generation", sourceId: g.id },
                    {
                      onSuccess: () => flashPublish(g.id, true),
                      onError: (e) => flashPublish(g.id, false, e.message),
                    },
                  );
                }}
              >
                {publishState?.id === g.id
                  ? publishState.ok
                    ? "已發布 ✓"
                    : "發布失敗"
                  : "發布"}
              </button>
            )}
          </div>
        </div>
      ))}
      {publishState && !publishState.ok && publishState.msg && (
        <p className="error" style={{ fontSize: 12 }}>{publishState.msg}</p>
      )}
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
