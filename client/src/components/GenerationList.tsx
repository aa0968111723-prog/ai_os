import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { getModel } from "@shared/models";
import { Icon } from "./Icon";
import { EmptyIllustration } from "./EmptyIllustration";
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
      refetchInterval: (query) =>
        query.state.data?.status === "done" || query.state.data?.status === "failed" ? false : 10_000,
      refetchIntervalInBackground: true,
    },
  );
  const finished = status.data?.status === "done" || status.data?.status === "failed";
  useEffect(() => {
    if (!finished) return;
    utils.generation.listByProject.invalidate();
    utils.generation.listByProjectPaged.invalidate();
    utils.quota.my.invalidate();
    utils.scenes.listByProject.invalidate();
    utils.projects.assets.invalidate();
  }, [finished, utils]);
  return null;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "排隊中",
  running: "生成中…",
  done: "完成 ✓",
  failed: "失敗（已退點）",
  awaiting_approval: "待組長核准",
  rejected: "已駁回",
};

const STATUS_PILL_CLASS: Record<string, PillStatus> = { awaiting_approval: "queued", rejected: "failed" };

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
  onReuse?: (text: string, settings?: ReuseSettings) => void;
}) {
  const utils = trpc.useUtils();
  const list = trpc.generation.listByProject.useQuery(
    { projectId },
    {
      refetchInterval: (query) =>
        query.state.data?.some((g) => g.status === "queued" || g.status === "running") ? 8000 : 45_000,
      refetchIntervalInBackground: true,
    },
  );

  const [statusFilter, setStatusFilter] = useState<
    "queued" | "running" | "done" | "failed" | "awaiting_approval" | "rejected" | null
  >(null);
  const [kindFilter, setKindFilter] = useState<"image" | "video" | "audio" | "text" | null>(null);
  const [sceneFilter, setSceneFilter] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [expanded, setExpanded] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const filtering =
    statusFilter !== null || kindFilter !== null || sceneFilter !== null || debouncedSearch.trim() !== "" || favoriteOnly;
  const browsing = filtering || expanded;
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
      placeholderData: (prev) => prev,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      refetchInterval: (query) =>
        query.state.data?.pages.some((p) => p.items.some((g) => g.status === "queued" || g.status === "running"))
          ? 8000
          : 45_000,
      refetchIntervalInBackground: true,
    },
  );
  const pagedRows = paged.data?.pages.flatMap((p) => p.items) ?? [];
  const rows = browsing
    ? (pagedRows.length === 0 && paged.isLoading && !filtering ? list.data ?? [] : pagedRows)
    : list.data ?? [];

  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const unreadRef = useRef(0);
  const baseTitleRef = useRef<string>("");
  const [liveMsg, setLiveMsg] = useState("");

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
    const isFirst = prev.size === 0;
    const justFinished: { title: string; body: string }[] = [];
    for (const g of rows) {
      const before = prev.get(g.id);
      if (!isFirst && (before === "queued" || before === "running") && (g.status === "done" || g.status === "failed")) {
        justFinished.push({ title: g.status === "done" ? "生成完成 ✓" : "生成失敗", body: g.prompt.slice(0, 20) });
      }
      prev.set(g.id, g.status);
    }
    for (const id of Array.from(prev.keys())) {
      if (!rows.some((g) => g.id === id)) prev.delete(id);
    }
    if (justFinished.length === 0) return;
    setLiveMsg(justFinished.map((x) => `${x.body}：${x.title}`).join("；"));
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
      if (!baseTitleRef.current) baseTitleRef.current = document.title.replace(/^\(\d+\)\s*/, "");
      unreadRef.current += justFinished.length;
      document.title = `(${unreadRef.current}) ${baseTitleRef.current}`;
    }
  }, [list.data]);

  const scenes = trpc.scenes.listByProject.useQuery({ projectId });
  const characters = trpc.characters.list.useQuery({ projectId });
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId });
  const charName = (cid: string) => characters.data?.find((c) => c.id === cid)?.name ?? "已刪除的角色";
  const presetName = (sid: string) => scenePresets.data?.find((s) => s.id === sid)?.name ?? "已刪除的場景";
  const sceneLabel = (sceneId: string) => {
    const idx = scenes.data?.findIndex((s) => s.id === sceneId) ?? -1;
    return idx >= 0 ? `第 ${idx + 1} 鏡・${scenes.data![idx].title}` : null;
  };
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const addScene = trpc.scenes.addFromGeneration.useMutation({
    onMutate: () => setAddedId(null),
    onSuccess: (_data, vars) => {
      setAddedId(vars.generationId);
      utils.scenes.listByProject.invalidate({ projectId });
    },
  });
  const retry = trpc.generation.retry.useMutation({
    onSettled: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.generation.listByProjectPaged.invalidate({ projectId });
      utils.quota.my.invalidate();
    },
  });
  const rename = trpc.generation.rename.useMutation({
    onSuccess: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.generation.listByProjectPaged.invalidate({ projectId });
    },
  });
  const toggleFavorite = trpc.generation.toggleFavorite.useMutation({
    onSuccess: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.generation.listByProjectPaged.invalidate({ projectId });
    },
  });
  const me = trpc.auth.me.useQuery();
  const canDecide = (groupId: string) => {
    const role = me.data?.groups.find((g) => g.groupId === groupId)?.role;
    return role != null && role !== "member";
  };
  const publish = trpc.community.publishFromSource.useMutation({
    onSuccess: () => utils.community.invalidate(),
  });
  const [publishState, setPublishState] = useState<{ id: string; ok: boolean; msg?: string } | null>(null);
  const flashPublish = (id: string, ok: boolean, msg?: string) => {
    setPublishState({ id, ok, msg });
    setTimeout(() => setPublishState((s) => (s && s.id === id ? null : s)), 2000);
  };
  const decideCost = trpc.generation.decideCost.useMutation({
    onSuccess: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.generation.listByProjectPaged.invalidate({ projectId });
      utils.quota.my.invalidate();
    },
  });
  const cancelAwaiting = trpc.generation.cancelAwaiting.useMutation({
    onSuccess: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.generation.listByProjectPaged.invalidate({ projectId });
    },
  });
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
      <EmptyState icon={<EmptyIllustration name="ribbonMark" />} title={<>還沒有生成紀錄——</>} description={<>上面試一次吧。</>} style={{ marginTop: 12 }} />
    );

  const activeFilterCount =
    Number(!!statusFilter) +
    Number(!!kindFilter) +
    Number(!!sceneFilter) +
    Number(!!debouncedSearch) +
    Number(favoriteOnly);

  return (
    <div style={{ marginTop: 14 }} data-fb="生成紀錄">
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
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
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
                  <button type="button" onClick={() => submitRename(g.id)} disabled={rename.isPending} aria-label="儲存名稱" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 2, background: "none", border: "none", cursor: "pointer", color: "var(--success)" }}>
                    <Icon name="Check" size={15} />
                  </button>
                  <button type="button" onClick={() => setRenamingId(null)} aria-label="取消命名" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 2, background: "none", border: "none", cursor: "pointer", color: "var(--muted-fg)" }}>
                    <Icon name="X" size={15} />
                  </button>
                </>
              ) : (
                <>
                  {g.name && <span style={{ fontSize: 14, fontWeight: 600 }}>{g.name}</span>}
                  {canEdit && (
                    <button type="button" aria-label={g.name ? "重新命名" : "命名此生成"} onClick={() => { setRenamingId(g.id); setRenameDraft(g.name ?? ""); }} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 2, background: "none", border: "none", cursor: "pointer", color: "var(--muted-fg)" }}>
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
              {getModel(g.modelId)?.label ?? g.modelId}・
              {(() => {
                const meta = (g.params as { __aiosSourceMeta?: { usedUserKey?: boolean } } | null)?.__aiosSourceMeta;
                if (meta?.usedUserKey) {
                  return <span title="此筆使用個人 fal 金鑰，未扣平台點數">個人金鑰・0 點</span>;
                }
                const spent = g.status === "done" && g.pointsActual != null ? g.pointsActual : g.pointsEst;
                return (
                  <>
                    平台・{spent} 點
                    {g.pointsRefunded > 0 && `（已退 +${g.pointsRefunded}）`}
                  </>
                );
              })()}
            </div>
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
                  {chars.length > 0 && <Chip title={chars.map(charName).join("、")}>角色 {chars.length}</Chip>}
                  {presets.length > 0 && <Chip title={presets.map(presetName).join("、")}>場景 {presets.length}</Chip>}
                  {props.length > 0 && <Chip>素材 {props.length}</Chip>}
                  {continuity?.locked && (
                    <Chip title={`快照 ${continuity.fingerprint?.slice(0, 8) ?? "—"}・參考圖 ${continuity.referenceAssetIds?.length ?? 0} 張`}>一致性鎖定</Chip>
                  )}
                  {boundScene && (
                    <button type="button" className="chip pick" title="只看綁定這一鏡的生成" onClick={() => setSceneFilter(g.sceneId)}>{boundScene}</button>
                  )}
                  {g.workflowRunId && (
                    <button type="button" className="chip pick" title="這筆是製作範本跑出來的——點了切到工作台「製作範本」模式" onClick={() => revealWorkbenchAnchor("#sec-workflow", { projectId })}>製作範本</button>
                  )}
                  {g.agentRunId && (
                    <button type="button" className="chip pick" title="這筆是 AI 執行計畫跑出來的——點了切到工作台「執行計畫」模式" onClick={() => revealWorkbenchAnchor("#sec-agent", { projectId })}>AI 執行計畫</button>
                  )}
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
              <GenerationResultCopy text={g.resultText} copied={copiedId === g.id} onCopy={() => copyText(g.id, g.resultText ?? "")} />
            )}
            {g.error && <div className="error">{g.status === "rejected" ? "駁回理由：" : "生成失敗："}{g.error}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <Pill status={STATUS_PILL_CLASS[g.status] ?? (g.status as PillStatus)}>{STATUS_LABEL[g.status] ?? g.status}</Pill>
            {(g.status === "queued" || g.status === "running") && (
              <Meta style={{ fontSize: 11, textAlign: "right", maxWidth: 140 }}>背景執行中，可離開</Meta>
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
            {g.status === "awaiting_approval" && me.data?.user?.id === g.userId && !canDecide(g.groupId) && (
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
            {canEdit && g.status === "done" && onReuse && (
              <button
                style={{ padding: "4px 12px", fontSize: 12 }}
                title="把這筆的提示詞、模型與角色/場景/素材勾選帶回生成台"
                onClick={() =>
                  onReuse(g.prompt, {
                    modelId: g.modelId,
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
                {publishState?.id === g.id ? (publishState.ok ? "已發布 ✓" : "發布失敗") : "發布"}
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
