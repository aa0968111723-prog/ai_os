import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";
import { EmptyIllustration } from "./EmptyIllustration";
import { ExportJobButton } from "./ExportJobButton";
import { ConfirmButton, useRovingRadio, useFocusTrap } from "./interactions";
import { AssetImg, AssetVideo, AssetAudio } from "./MediaFallback";
import { discussInMessages } from "../discuss";
import {
  detectDesktopEditors,
  editorKindForAsset,
  hasDesktopBridge,
  openAssetInExternalEditor,
  revealAssetInFolder,
  suggestedFileName,
  type DetectedDesktopEditor,
} from "../platform/desktopBridge";
import type { DesktopHandoffStatusEvent } from "../platform/tauriDesktop";
import {
  formatLineageSummary,
  listDirectRevisions,
  parseAssetLineageMeta,
} from "@shared/assetLineage";
import { Button, Card, Chip, EmptyState, Hint, Meta, Skeleton } from "./ui";

function fmtSize(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return "<1KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const KIND_ICON: Record<string, IconName> = { image: "Image", video: "Clapperboard", audio: "Volume2", doc: "FileText" };

const KIND_FILTERS: { key: string; label: string; icon?: IconName }[] = [
  { key: "all", label: "全部" },
  { key: "image", label: "圖片", icon: "Image" },
  { key: "video", label: "影片", icon: "Clapperboard" },
  { key: "audio", label: "音訊", icon: "Volume2" },
  { key: "doc", label: "文件", icon: "FileText" },
];

function isSourceable(kind: string): boolean {
  return kind === "image" || kind === "video";
}

/**
 * 專案素材庫：上傳（拖放/點選/多檔）、預覽、改名、刪除、選為生成來源。
 * 上傳走 /api/upload（multipart）；檔案存伺服器持久 Volume，網址永久有效。
 */
export function AssetLibrary({
  projectId,
  onPickSource,
  selectedSourceId,
}: {
  projectId: string;
  onPickSource?: (asset: { id: string; title: string; kind: string }) => void;
  selectedSourceId?: string | null;
}) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const [assetLimit, setAssetLimit] = useState(100);
  const assets = trpc.projects.assets.useQuery({ projectId, limit: assetLimit });
  const publish = trpc.community.publishFromSource.useMutation({
    onSuccess: () => utils.community.invalidate(),
  });
  const [publishState, setPublishState] = useState<{ id: string; ok: boolean; msg?: string } | null>(null);
  const flashPublish = (id: string, ok: boolean, msg?: string) => {
    setPublishState({ id, ok, msg });
    setTimeout(() => setPublishState((s) => (s && s.id === id ? null : s)), 2000);
  };
  const del = trpc.projects.deleteAsset.useMutation({
    onSuccess: () => {
      utils.projects.assets.invalidate({ projectId });
      utils.projects.listDeleted.invalidate({ projectId });
    },
  });
  const rename = trpc.projects.renameAsset.useMutation({ onSuccess: () => utils.projects.assets.invalidate({ projectId }) });
  const [knowledgeAddedId, setKnowledgeAddedId] = useState<string | null>(null);
  const toKnowledge = trpc.knowledge.addFromAsset.useMutation({
    onSuccess: (_data, vars) => {
      utils.knowledge.list.invalidate({ projectId });
      setKnowledgeAddedId(vars.assetId);
      window.setTimeout(() => setKnowledgeAddedId((cur) => (cur === vars.assetId ? null : cur)), 2500);
    },
  });
  const [describedId, setDescribedId] = useState<string | null>(null);
  const describeImage = trpc.knowledge.describeImageAsset.useMutation({
    onSuccess: (_data, vars) => {
      utils.knowledge.list.invalidate({ projectId });
      setDescribedId(vars.assetId);
      window.setTimeout(() => setDescribedId((cur) => (cur === vars.assetId ? null : cur)), 2500);
    },
  });
  const setLock = trpc.projects.setAssetLock.useMutation({ onSuccess: () => utils.projects.assets.invalidate({ projectId }) });
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [kindFilter, setKindFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
  const [onlySourceable, setOnlySourceable] = useState(false);
  const [revisionOfId, setRevisionOfId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const desktopAvailable = hasDesktopBridge();
  const [desktopBusyId, setDesktopBusyId] = useState<string | null>(null);
  const [desktopEditors, setDesktopEditors] = useState<DetectedDesktopEditor[]>([]);
  const [desktopEditorByKind, setDesktopEditorByKind] = useState<Record<string, string>>({});
  const [desktopStatus, setDesktopStatus] = useState<{ assetId: string; kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!desktopAvailable) return;
    void detectDesktopEditors().then(setDesktopEditors).catch(() => setDesktopEditors([]));
  }, [desktopAvailable]);

  useEffect(() => {
    if (!desktopAvailable) return;
    const onRevision = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; title?: string }>).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      void utils.projects.assets.invalidate({ projectId });
      setDesktopStatus({
        assetId: "",
        kind: "ok",
        text: `已回傳新素材${detail?.title ? `「${detail.title}」` : ""}，原始素材仍保留。`,
      });
    };
    const onHandoff = (event: Event) => {
      const detail = (event as CustomEvent<DesktopHandoffStatusEvent>).detail;
      if (!detail) return;
      if (detail.projectId && detail.projectId !== projectId) return;
      const assetId = detail.sourceAssetId ?? "";
      if (detail.phase === "error") {
        setDesktopStatus({ assetId, kind: "err", text: detail.message });
        return;
      }
      const pct = typeof detail.percent === "number" ? `（${detail.percent}%）` : "";
      setDesktopStatus({ assetId, kind: "ok", text: `${detail.message}${pct}` });
    };
    window.addEventListener("aios:asset-revision-uploaded", onRevision);
    window.addEventListener("aios:desktop-handoff-status", onHandoff);
    return () => {
      window.removeEventListener("aios:asset-revision-uploaded", onRevision);
      window.removeEventListener("aios:desktop-handoff-status", onHandoff);
    };
  }, [desktopAvailable, projectId, utils.projects.assets]);

  const editorsForKind = (kind: string) => {
    const needed = editorKindForAsset(kind);
    return desktopEditors.filter((e) => e.kind === needed || e.kind === "system-default");
  };

  const openInExternalEditor = async (asset: {
    id: string;
    title: string;
    kind: string;
    mime?: string | null;
    meta?: unknown;
  }) => {
    setDesktopBusyId(asset.id);
    setDesktopStatus({ assetId: asset.id, kind: "ok", text: "正在準備本機交接…" });
    try {
      const needed = editorKindForAsset(asset.kind);
      const pick =
        desktopEditorByKind[needed]?.trim() ||
        editorsForKind(asset.kind)[0]?.id ||
        undefined;
      const result = await openAssetInExternalEditor({
        assetId: asset.id,
        projectId,
        editorKind: needed,
        editorId: pick,
        suggestedName: suggestedFileName(asset),
        returnPath: `/p/${projectId}?tab=assets`,
      });
      if (!result.ok) {
        setDesktopStatus({ assetId: asset.id, kind: "err", text: result.message });
        return;
      }
      setDesktopStatus({
        assetId: asset.id,
        kind: "ok",
        text: "已啟動外部軟體。儲存後 Aios 會自動回傳新素材版本。",
      });
      setMenuOpenId(null);
    } finally {
      setDesktopBusyId(null);
    }
  };

  const revealInFolder = async (assetId: string) => {
    setDesktopBusyId(assetId);
    setDesktopStatus(null);
    try {
      const result = await revealAssetInFolder({ assetId, projectId });
      if (!result.ok) {
        setDesktopStatus({ assetId, kind: "err", text: result.message });
        return;
      }
      setDesktopStatus({ assetId, kind: "ok", text: "已在本機資料夾顯示。" });
      setMenuOpenId(null);
    } finally {
      setDesktopBusyId(null);
    }
  };

  const doUpload = async (files: FileList | null) => {
    if (uploading) {
      if (files?.length) setUploadError("上一批還在上傳——請等它跑完再加新檔");
      return;
    }
    if (!files?.length) return;
    const list = Array.from(files);
    setUploading(true);
    setUploadError("");
    const failed: string[] = [];
    let okCount = 0;
    for (const [i, file] of list.entries()) {
      setUploadStep(list.length > 1 ? `上傳中…（${i + 1}/${list.length}）` : "上傳中…");
      try {
        const form = new FormData();
        form.append("projectId", projectId);
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) failed.push(`${file.name}：${data.error ?? `上傳失敗（${res.status}）`}`);
        else okCount += 1;
      } catch {
        failed.push(`${file.name}：上傳失敗——請檢查網路後重試`);
      }
    }
    if (okCount > 0) utils.projects.assets.invalidate({ projectId });
    if (failed.length) {
      setUploadError(list.length > 1 ? `${okCount} 個上傳成功、${failed.length} 個失敗——${failed.join("；")}` : failed[0]);
    }
    setUploading(false);
    setUploadStep("");
    if (fileInput.current) fileInput.current.value = "";
  };

  const allAssets = assets.data;
  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of allAssets ?? []) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    return counts;
  }, [allAssets]);

  const shown = useMemo(() => {
    let list = allAssets ?? [];
    if (revisionOfId) list = listDirectRevisions(list, revisionOfId);
    if (kindFilter !== "all") list = list.filter((a) => a.kind === kindFilter);
    if (onlySourceable) list = list.filter((a) => isSourceable(a.kind));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((a) => a.title.toLowerCase().includes(q));
    if (sortBy === "name") list = [...list].sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));
    return list;
  }, [allAssets, kindFilter, onlySourceable, search, sortBy, revisionOfId]);

  const lightboxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(lightboxRef, !!lightbox, () => setLightbox(null));

  useEffect(() => {
    if (!menuOpenId) return;
    const onDocClick = () => setMenuOpenId(null);
    const id = window.setTimeout(() => document.addEventListener("click", onDocClick), 0);
    return () => { window.clearTimeout(id); document.removeEventListener("click", onDocClick); };
  }, [menuOpenId]);

  const startRename = (id: string, title: string) => {
    setMenuOpenId(null);
    setEditingId(id);
    setEditValue(title);
  };
  const submitRename = (id: string, original: string) => {
    const next = editValue.trim();
    if (next && next !== original) rename.mutate({ assetId: id, title: next });
    setEditingId(null);
  };

  const total = allAssets?.length ?? 0;
  const filterActive =
    kindFilter !== "all" || onlySourceable || search.trim() !== "" || !!revisionOfId;
  const revisionParentTitle = revisionOfId
    ? (allAssets ?? []).find((a) => a.id === revisionOfId)?.title
    : undefined;
  const smallBtn = { padding: "2px 10px", fontSize: 11 } as const;
  const visibleKindFilters = KIND_FILTERS.filter((f) => f.key === "all" || (kindCounts[f.key] ?? 0) > 0);
  const kindRoving = useRovingRadio(visibleKindFilters.map((f) => f.key), kindFilter, setKindFilter);

  return (
    <Card as="section">
      <h2>素材庫（上傳參考素材・生成成品自動入庫）</h2>
      {desktopStatus?.assetId === "" && desktopStatus.kind === "ok" && (
        <Meta as="p" role="status" aria-live="polite" style={{ color: "var(--success-ink)" }}>
          {desktopStatus.text}
        </Meta>
      )}

      <div
        className={`upload-zone ${dragOver ? "drag" : ""}`}
        role="button"
        tabIndex={0}
        data-fb="上傳素材區"
        onClick={() => { if (!uploading) fileInput.current?.click(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!uploading) fileInput.current?.click(); }
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); doUpload(e.dataTransfer.files); }}
      >
        {uploading ? uploadStep || "上傳中…" : "點這裡或把檔案拖進來上傳（可多選；圖片/影片/音訊/zip/PDF，單檔 200MB 內）"}
      </div>
      <input ref={fileInput} type="file" hidden multiple accept="image/*,video/*,audio/*,.zip,.pdf,.txt,.md" onChange={(e) => doUpload(e.target.files)} />
      <input ref={cameraInput} type="file" hidden accept="image/*" capture="environment" onChange={(e) => doUpload(e.target.files)} />
      <Button size="sm" disabled={uploading} style={{ marginTop: 6 }} onClick={() => cameraInput.current?.click()}>
        <Icon name="Camera" size={13} /> 拍照上傳
      </Button>
      {uploadError && <p className="error">{uploadError}</p>}

      {assets.isLoading ? (
        <div className="asset-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="asset-cell" height={132} />
          ))}
        </div>
      ) : !total ? (
        <EmptyState icon={<EmptyIllustration name="emptyMedia" />} title={<>還沒有素材——</>} description={<>上傳參考圖、原音檔，或先生成一張。</>} style={{ marginTop: 10 }} />
      ) : (
        <>
          <div data-fb="素材工具列" style={{ margin: "12px 0 4px", display: "flex", flexDirection: "column", gap: 8 }}>
            {revisionOfId && (
              <Hint layer="always" role="status" style={{ margin: 0, fontSize: 13 }}>
                只顯示「{revisionParentTitle ?? "此素材"}」的直接編輯版本
                <button type="button" className="linkish" style={{ border: 0, background: "none", cursor: "pointer", color: "var(--primary-ink)", textDecoration: "underline", fontSize: 13, marginLeft: 8, padding: 0 }} onClick={() => setRevisionOfId(null)}>
                  清除篩選
                </button>
              </Hint>
            )}
            <div role="radiogroup" aria-label="依種類篩選素材" {...kindRoving.groupProps} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
              {visibleKindFilters.map((f, idx) => {
                const count = f.key === "all" ? total : kindCounts[f.key] ?? 0;
                const on = kindFilter === f.key;
                return (
                  <Chip key={f.key} selected={on} onClick={() => setKindFilter(f.key)} role="radio" aria-checked={on} {...kindRoving.itemProps(idx)}>
                    {f.icon && <Icon name={f.icon} size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />}
                    {f.label} {count}
                  </Chip>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <input type="search" value={search} data-fb="素材搜尋" placeholder="搜尋標題…" aria-label="依標題搜尋素材" onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 160px", minWidth: 120, fontSize: 13, padding: "6px 12px" }} />
              <label style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12, whiteSpace: "nowrap" }}>
                排序
                <select value={sortBy} aria-label="素材排序方式" onChange={(e) => setSortBy(e.target.value as "recent" | "name")} style={{ width: "auto", fontSize: 13, padding: "6px 10px" }}>
                  <option value="recent">最新</option>
                  <option value="name">名稱</option>
                </select>
              </label>
              {onPickSource && (
                <Chip selected={onlySourceable} onClick={() => setOnlySourceable((v) => !v)} role="switch" aria-checked={onlySourceable} title="只顯示能當生成來源的圖片與影片">
                  {onlySourceable && <Icon name="Check" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />}
                  只看可當來源的
                </Chip>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <button type="button" style={smallBtn} title="全選目前顯示的素材" onClick={() => setSelected(new Set(shown.map((a) => a.id)))}>全選</button>
              {selected.size > 0 && (
                <>
                  <button type="button" style={smallBtn} onClick={() => setSelected(new Set())}>清除</button>
                  <ExportJobButton projectId={projectId} assetIds={[...selected]} idleLabel={`打包所選（${selected.size}）`} triggerClassName="primary btn-sm" />
                  <Meta style={{ margin: 0, fontSize: 11 }}>已勾 {selected.size} 個</Meta>
                </>
              )}
            </div>
            <Meta as="p" style={{ margin: 0 }}>
              {filterActive ? `顯示 ${shown.length} / 共 ${total} 個素材` : `共 ${total} 個素材`}
            </Meta>
          </div>

          {shown.length === 0 ? (
            <Hint layer="always" style={{ marginTop: 10 }}>
              沒有符合條件的素材——換個種類或清掉搜尋字。
              <span role="button" tabIndex={0} onClick={() => { setKindFilter("all"); setOnlySourceable(false); setSearch(""); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setKindFilter("all"); setOnlySourceable(false); setSearch(""); } }} style={{ color: "var(--primary-ink)", cursor: "pointer", marginLeft: 6, textDecoration: "underline" }}>
                清除篩選
              </span>
            </Hint>
          ) : (
            <div className="asset-grid">
              {shown.map((a) => {
                const myRole = me.data?.groups.find((g) => g.groupId === a.groupId)?.role;
                const canDelete = (a.uploadedBy != null && a.uploadedBy === me.data?.user.id) || myRole === "leader" || myRole === "admin";
                const isSource = a.id === selectedSourceId;
                const isEditing = editingId === a.id;
                const menuOpen = menuOpenId === a.id;
                return (
                  <div key={a.id} id={`asset-${a.id}`} className="asset-cell" data-fb="素材格" style={{ position: "relative", ...(isSource ? { outline: "2px solid var(--primary)", outlineOffset: 2, borderRadius: 8 } : undefined) }}>
                    <input type="checkbox" checked={selected.has(a.id)} aria-label={`選取素材 ${a.title}`} title="勾選後可用工具列「打包所選」只打包這些素材" onClick={(e) => e.stopPropagation()} onChange={() => toggleSelect(a.id)} style={{ position: "absolute", top: 6, left: 6, zIndex: 2, width: 16, height: 16, margin: 0, accentColor: "var(--primary)", cursor: "pointer" }} />
                    {a.kind === "image" && a.url ? (
                      <div role="button" tabIndex={0} aria-label={`放大檢視 ${a.title}`} title="點一下放大檢視" style={{ cursor: "zoom-in", display: "block" }} onClick={() => setLightbox({ url: a.url!, title: a.title })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLightbox({ url: a.url!, title: a.title }); } }}>
                        <AssetImg src={a.url} alt={a.title} loading="lazy" fallbackHeight={96} />
                      </div>
                    ) : a.kind === "video" && a.url ? (
                      <AssetVideo src={a.url} controls preload="metadata" style={{ width: "100%", height: 96, objectFit: "cover", display: "block", background: "var(--muted)" }} fallbackHeight={96} />
                    ) : (
                      <div className="asset-icon"><Icon name={KIND_ICON[a.kind] ?? "Package"} size={32} /></div>
                    )}
                    <div className="asset-meta">
                      {isEditing ? (
                        <input autoFocus value={editValue} aria-label="素材名稱" onChange={(e) => setEditValue(e.target.value)} onBlur={() => submitRename(a.id, a.title)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitRename(a.id, a.title); } else if (e.key === "Escape") { e.preventDefault(); setEditingId(null); } }} style={{ fontSize: 13, fontWeight: 600, padding: "3px 8px", borderRadius: 8 }} />
                      ) : (
                        <div className="asset-title" title="點兩下改名" onDoubleClick={() => startRename(a.id, a.title)}>{a.title}</div>
                      )}
                      <Meta as="div" style={{ fontSize: 11 }}>
                        {a.locked ? <><Icon name="Lock" size={11} style={{ verticalAlign: "-1px", marginRight: 4, color: "var(--gold-ink)" }} />鎖定 · </> : ""}
                        {a.isAiGenerated ? "AI 生成" : "上傳"}
                        {a.storagePath ? "・已永久保存" : a.isAiGenerated ? "・保存中…" : ""}
                        {a.sizeBytes ? `・${fmtSize(a.sizeBytes)}` : ""}
                      </Meta>
                      {(() => {
                        const lineage = formatLineageSummary(a.meta, (id) => (allAssets ?? []).find((x) => x.id === id)?.title);
                        const m = parseAssetLineageMeta(a.meta);
                        const childCount = listDirectRevisions(allAssets ?? [], a.id).length;
                        if (!lineage && childCount === 0) return null;
                        return (
                          <div className="asset-lineage" style={{ marginTop: 4 }}>
                            {lineage && (
                              <Meta as="div" style={{ fontSize: 11 }} title={m.sourceAssetId}>
                                {lineage}
                                {m.sourceAssetId && (
                                  <button type="button" className="linkish" style={{ border: 0, background: "none", cursor: "pointer", color: "var(--primary-ink)", textDecoration: "underline", fontSize: 11, marginLeft: 6, padding: 0 }} onClick={(e) => { e.stopPropagation(); setRevisionOfId(m.sourceAssetId!); }}>只看此來源的版本</button>
                                )}
                              </Meta>
                            )}
                            {childCount > 0 && (
                              <Meta as="div" style={{ fontSize: 11, marginTop: 2 }}>
                                <button type="button" className="linkish" style={{ border: 0, background: "none", cursor: "pointer", color: "var(--primary-ink)", textDecoration: "underline", fontSize: 11, padding: 0 }} onClick={(e) => { e.stopPropagation(); setRevisionOfId(a.id); }}>{childCount} 個編輯版本</button>
                              </Meta>
                            )}
                          </div>
                        );
                      })()}
                      {toKnowledge.isPending && toKnowledge.variables?.assetId === a.id && (
                        <Meta as="div" style={{ fontSize: 11 }}><Icon name="Loader" className="spin" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />加入知識庫中…</Meta>
                      )}
                      {knowledgeAddedId === a.id && (
                        <Meta as="div" style={{ fontSize: 11, color: "var(--success-ink)" }}><Icon name="Check" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />已加入知識庫</Meta>
                      )}
                      {describeImage.isPending && describeImage.variables?.assetId === a.id && (
                        <Meta as="div" style={{ fontSize: 11 }}><Icon name="Loader" className="spin" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />AI 描述中…</Meta>
                      )}
                      {describedId === a.id && (
                        <Meta as="div" style={{ fontSize: 11, color: "var(--success-ink)" }}><Icon name="Check" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />已描述入知識庫</Meta>
                      )}
                      {desktopBusyId === a.id && (
                        <Meta as="div" style={{ fontSize: 11 }} role="status" aria-live="polite"><Icon name="Loader" className="spin" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />準備本機交接…</Meta>
                      )}
                      {desktopStatus?.assetId === a.id && desktopBusyId !== a.id && (
                        desktopStatus.kind === "err" ? (
                          <div className="error" style={{ fontSize: 11 }} role="alert" aria-live="polite">{desktopStatus.text}</div>
                        ) : (
                          <Meta as="div" style={{ fontSize: 11, ...(desktopStatus.kind === "ok" ? { color: "var(--success-ink)" } : undefined) }} role="status" aria-live="polite">{desktopStatus.text}</Meta>
                        )
                      )}
                      {a.kind === "audio" && a.url && (
                        <AssetAudio controls src={a.url} style={{ height: 28, width: "100%", marginTop: 6 }} />
                      )}
                      <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {onPickSource && (
                          <button className={isSource ? "" : "primary"} style={{ ...smallBtn, flex: "1 1 auto" }} onClick={() => onPickSource({ id: a.id, title: a.title, kind: a.kind })}>
                            {isSource ? <><Icon name="Check" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />已選為來源</> : "用作來源"}
                          </button>
                        )}
                        <button type="button" aria-label="更多動作" aria-haspopup="menu" aria-expanded={menuOpen} title="更多：改名／鎖定／刪除" style={{ ...smallBtn, lineHeight: 1, minWidth: 40, minHeight: 40, display: "inline-flex", alignItems: "center", justifyContent: "center" }} onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpen ? null : a.id); }}>
                          <Icon name="Ellipsis" size={18} />
                        </button>
                      </div>
                      {menuOpen && (
                        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border-soft)" }}>
                          {desktopAvailable ? (
                            <>
                              {(() => {
                                const needed = editorKindForAsset(a.kind);
                                const opts = editorsForKind(a.kind);
                                if (opts.length === 0) return null;
                                return (
                                  <label className="menu-item" style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
                                    <span style={{ fontSize: 11, color: "var(--fg-secondary)" }}>開啟用軟體</span>
                                    <select aria-label={`「${a.title}」開啟用軟體`} value={desktopEditorByKind[needed] ?? opts[0]?.id ?? ""} onChange={(e) => setDesktopEditorByKind((prev) => ({ ...prev, [needed]: e.target.value }))} style={{ fontSize: 12, minHeight: 36 }}>
                                      {opts.map((ed) => (<option key={ed.id} value={ed.id}>{ed.name}</option>))}
                                    </select>
                                  </label>
                                );
                              })()}
                              <button type="button" className="menu-item" disabled={desktopBusyId === a.id} title="用本機剪輯／影像軟體開啟，儲存後可自動回傳新版本" onClick={() => void openInExternalEditor(a)}>
                                <Icon name="Monitor" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{desktopBusyId === a.id ? "準備中…" : "用外部軟體開啟"}
                              </button>
                              <button type="button" className="menu-item" disabled={desktopBusyId === a.id} title="在本機檔案總管／Finder 顯示" onClick={() => void revealInFolder(a.id)}>
                                <Icon name="Package" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />在資料夾顯示
                              </button>
                              <div className="menu-sep" />
                            </>
                          ) : (
                            <>
                              {(a.url || a.storagePath) && (
                                <a href={`/api/assets/${a.id}/file`} download={suggestedFileName(a)} className="menu-item" role="menuitem" title="下載到本機後用系統軟體開啟" onClick={() => setMenuOpenId(null)} style={{ textDecoration: "none" }}>
                                  <Icon name="Download" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />下載
                                </a>
                              )}
                              <Hint as="div" layer="always" style={{ fontSize: 11, padding: "2px 4px", margin: 0 }}>下載後本機開啟；Aios 桌面版可自動回傳編輯結果</Hint>
                              <div className="menu-sep" />
                            </>
                          )}
                          {a.kind === "doc" && (
                            <button className="menu-item" disabled={toKnowledge.isPending} title="讓 AI 導演讀得懂這份文字素材" onClick={() => { toKnowledge.mutate({ assetId: a.id }); setMenuOpenId(null); }}>加入知識庫</button>
                          )}
                          {a.kind === "image" && (
                            <ConfirmButton triggerClassName="menu-item" disabled={describeImage.isPending} triggerTitle="讓 AI 看圖寫描述並存進知識庫——會呼叫視覺模型，依模型扣點" message={`用 AI 描述「${a.title}」並寫入知識庫？會呼叫視覺模型，依模型扣點。`} confirmLabel="描述並寫入" onConfirm={() => { describeImage.mutate({ assetId: a.id }); setMenuOpenId(null); }}>AI 描述入知識庫</ConfirmButton>
                          )}
                          <button className="menu-item" title="把這張素材帶進組內留言討論" onClick={() => { discussInMessages({ refType: "asset", refId: a.id, title: a.title }); setMenuOpenId(null); }}>
                            <Icon name="MessageCircle" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />在留言中討論
                          </button>
                          <button className="menu-item" title="發布到全站靈感頻道" disabled={publish.isPending} onClick={() => { publish.mutate({ sourceType: "asset", sourceId: a.id }, { onSuccess: () => { flashPublish(a.id, true); setMenuOpenId(null); }, onError: (e) => flashPublish(a.id, false, e.message) }); }}>
                            <Icon name="Share2" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                            {publishState?.id === a.id ? (publishState.ok ? "已發布 ✓" : "發布失敗") : "發布到靈感頻道"}
                          </button>
                          <button className="menu-item" disabled={rename.isPending} onClick={() => startRename(a.id, a.title)}>
                            <Icon name="Pencil" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />改名
                          </button>
                          <button className="menu-item" style={a.locked ? { color: "var(--gold-ink)" } : undefined} disabled={setLock.isPending} title="固定素材（師父原音/開示/配樂）：鎖定後交付包會原封保留在 00_鎖定原素材" onClick={() => { setLock.mutate({ assetId: a.id, locked: !a.locked }); setMenuOpenId(null); }}>
                            {a.locked ? <><Icon name="Unlock" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />解鎖</> : <><Icon name="Lock" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />鎖定</>}
                          </button>
                          {canDelete && (
                            <>
                              <div className="menu-sep" />
                              <ConfirmButton triggerClassName="menu-item danger" disabled={del.isPending} triggerTitle="刪除後會移到回收桶，可從下方「回收桶」還原（不扣點、不刪原檔）" message={`把「${a.title}」移到回收桶？分鏡引用會保留，可從回收桶還原。`} confirmLabel="刪除" onConfirm={() => { del.mutate({ assetId: a.id }); setMenuOpenId(null); }}>刪除</ConfirmButton>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {(allAssets?.length ?? 0) >= assetLimit && (
            <div style={{ marginTop: 10, textAlign: "center" }}>
              <button type="button" onClick={() => setAssetLimit((l) => l + 100)} disabled={assets.isFetching}>
                {assets.isFetching ? "載入中…" : `載入更多素材（已顯示 ${allAssets?.length ?? 0} 個）`}
              </button>
            </div>
          )}
        </>
      )}
      {del.error && <p className="error">{del.error.message}</p>}
      {rename.error && <p className="error">改名失敗：{rename.error.message}</p>}
      {describeImage.error && <p className="error">AI 描述失敗：{describeImage.error.message}</p>}
      {toKnowledge.error && <p className="error" role="alert">加入知識庫失敗：{toKnowledge.error.message}</p>}
      {publishState && !publishState.ok && publishState.msg && (
        <p className="error" role="alert">發布失敗：{publishState.msg}</p>
      )}
      {lightbox && (
        <div ref={lightboxRef} role="dialog" aria-modal="true" aria-label={`檢視 ${lightbox.title}`} data-fb="素材大圖" onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(28, 25, 23, 0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ position: "relative", maxWidth: "92vw", maxHeight: "88vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <AssetImg src={lightbox.url} alt={lightbox.title} onClick={(e) => e.stopPropagation()} style={{ maxWidth: "92vw", maxHeight: "80vh", objectFit: "contain", borderRadius: 12, boxShadow: "var(--e4)" }} fallbackLabel="此素材檔已遺失（可能是伺服器重啟前的舊素材）" fallbackHeight={220} fallbackIconSize={32} fallbackStyle={{ minWidth: 280 }} />
            <div style={{ color: "#fff", fontSize: 13, textAlign: "center", maxWidth: "80vw" }}>{lightbox.title}</div>
            <button type="button" aria-label="關閉大圖" onClick={() => setLightbox(null)} style={{ position: "absolute", top: 8, right: 8, borderRadius: 999, width: 40, height: 40, padding: 0, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="X" size={18} />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
