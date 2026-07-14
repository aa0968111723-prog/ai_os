import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";
import { ConfirmButton } from "./interactions";

function fmtSize(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const KIND_ICON: Record<string, IconName> = { image: "Image", video: "Clapperboard", audio: "Volume2", doc: "FileText" };

/** 種類篩選 chips 的顯示順序與標籤 */
const KIND_FILTERS: { key: string; label: string; icon?: IconName }[] = [
  { key: "all", label: "全部" },
  { key: "image", label: "圖片", icon: "Image" },
  { key: "video", label: "影片", icon: "Clapperboard" },
  { key: "audio", label: "音訊", icon: "Volume2" },
  { key: "doc", label: "文件", icon: "FileText" },
];

/** 哪些種類可以當生成來源（視覺素材）——來源相容濾鏡用 */
function isSourceable(kind: string): boolean {
  return kind === "image" || kind === "video";
}

/**
 * 專案素材庫：上傳（拖放/點選/多檔）、預覽、改名、刪除、選為生成來源。
 * 上傳走 /api/upload（multipart）；檔案存 Railway Volume，網址永久有效。
 * 工具列提供種類篩選、標題搜尋、排序（最新／名稱），三者可組合過濾。
 */
export function AssetLibrary({
  projectId,
  onPickSource,
  selectedSourceId,
}: {
  projectId: string;
  onPickSource?: (asset: { id: string; title: string; kind: string }) => void;
  /** 生成台目前選中的來源素材：對應格子加醒目框，一眼看出選了哪個 */
  selectedSourceId?: string | null;
}) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const assets = trpc.projects.assets.useQuery({ projectId });
  const del = trpc.projects.deleteAsset.useMutation({ onSuccess: () => utils.projects.assets.invalidate({ projectId }) });
  const rename = trpc.projects.renameAsset.useMutation({ onSuccess: () => utils.projects.assets.invalidate({ projectId }) });
  const toKnowledge = trpc.knowledge.addFromAsset.useMutation({ onSuccess: () => utils.knowledge.list.invalidate({ projectId }) });
  const setLock = trpc.projects.setAssetLock.useMutation({ onSuccess: () => utils.projects.assets.invalidate({ projectId }) });
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // 工具列狀態：種類篩選 / 搜尋 / 排序 / 只看可當來源 / 展開的格子選單 / 行內改名 / 大圖遮罩
  const [kindFilter, setKindFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
  const [onlySourceable, setOnlySourceable] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);

  /** 多檔逐一上傳：一檔失敗不擋後面的檔，全部跑完再彙整成敗 */
  const doUpload = async (files: FileList | null) => {
    if (uploading) {
      // 上一批還在跑時新拖入的檔案不能靜默吞掉——講清楚，免得使用者以為排進去了
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

  // 各種類數量統計（給 chips 顯示數字，也用來決定哪些 chip 要出現）
  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of allAssets ?? []) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    return counts;
  }, [allAssets]);

  // 篩選＋搜尋＋排序組合。資料本身已是 createdAt desc（最新在前），故「最新」= 原陣列順序。
  const shown = useMemo(() => {
    let list = allAssets ?? [];
    if (kindFilter !== "all") list = list.filter((a) => a.kind === kindFilter);
    if (onlySourceable) list = list.filter((a) => isSourceable(a.kind));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((a) => a.title.toLowerCase().includes(q));
    if (sortBy === "name") list = [...list].sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));
    return list;
  }, [allAssets, kindFilter, onlySourceable, search, sortBy]);

  // 大圖遮罩：Esc 關閉
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // 點格子外面關掉展開的「⋯」選單
  useEffect(() => {
    if (!menuOpenId) return;
    const onDocClick = () => setMenuOpenId(null);
    // 延一拍掛上，免得同一個開啟點擊立刻被關掉
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
  const filterActive = kindFilter !== "all" || onlySourceable || search.trim() !== "";
  const smallBtn = { padding: "2px 10px", fontSize: 11 } as const;

  return (
    <section className="card">
      <h2>素材庫（上傳參考素材・生成成品自動入庫）</h2>

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
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept="image/*,video/*,audio/*,.zip,.pdf,.txt,.md"
        onChange={(e) => doUpload(e.target.files)}
      />
      {uploadError && <p className="error">{uploadError}</p>}

      {assets.isLoading ? (
        <div className="asset-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="asset-cell skeleton" style={{ height: 132 }} />
          ))}
        </div>
      ) : !total ? (
        <div className="empty-state" style={{ marginTop: 10 }}>
          <h3>還沒有素材——</h3>
          <p>上傳參考圖、原音檔，或先生成一張。</p>
        </div>
      ) : (
        <>
          {/* 工具列：數量統計 · 種類篩選 chips · 搜尋 · 排序 */}
          <div data-fb="素材工具列" style={{ margin: "12px 0 4px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div role="radiogroup" aria-label="依種類篩選素材" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
              {KIND_FILTERS.map((f) => {
                // 全部一定顯示；其餘只在該類有素材時才出現，避免點了空空的
                const count = f.key === "all" ? total : kindCounts[f.key] ?? 0;
                if (f.key !== "all" && count === 0) return null;
                const on = kindFilter === f.key;
                return (
                  <span
                    key={f.key}
                    role="radio"
                    aria-checked={on}
                    tabIndex={0}
                    className={`chip pick ${on ? "on" : ""}`}
                    onClick={() => setKindFilter(f.key)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setKindFilter(f.key); } }}
                  >
                    {f.icon && <Icon name={f.icon} size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />}
                    {f.label} {count}
                  </span>
                );
              })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <input
                type="search"
                value={search}
                data-fb="素材搜尋"
                placeholder="搜尋標題…"
                aria-label="依標題搜尋素材"
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: "1 1 160px", minWidth: 120, fontSize: 13, padding: "6px 12px" }}
              />
              <label style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12, whiteSpace: "nowrap" }}>
                排序
                <select
                  value={sortBy}
                  aria-label="素材排序方式"
                  onChange={(e) => setSortBy(e.target.value as "recent" | "name")}
                  style={{ width: "auto", fontSize: 13, padding: "6px 10px" }}
                >
                  <option value="recent">最新</option>
                  <option value="name">名稱</option>
                </select>
              </label>
              {onPickSource && (
                <span
                  role="switch"
                  aria-checked={onlySourceable}
                  tabIndex={0}
                  className={`chip pick ${onlySourceable ? "on" : ""}`}
                  title="只顯示能當生成來源的圖片與影片"
                  onClick={() => setOnlySourceable((v) => !v)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOnlySourceable((v) => !v); } }}
                >
                  {onlySourceable && <Icon name="Check" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />}
                  只看可當來源的
                </span>
              )}
            </div>
            <p className="hint" style={{ margin: 0 }}>
              {filterActive ? `顯示 ${shown.length} / 共 ${total} 個素材` : `共 ${total} 個素材`}
            </p>
          </div>

          {shown.length === 0 ? (
            <p className="hint" style={{ marginTop: 10 }}>
              沒有符合條件的素材——換個種類或清掉搜尋字。
              <span
                role="button"
                tabIndex={0}
                onClick={() => { setKindFilter("all"); setOnlySourceable(false); setSearch(""); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setKindFilter("all"); setOnlySourceable(false); setSearch(""); } }}
                style={{ color: "var(--primary-ink)", cursor: "pointer", marginLeft: 6, textDecoration: "underline" }}
              >
                清除篩選
              </span>
            </p>
          ) : (
            <div className="asset-grid">
              {shown.map((a) => {
                const myRole = me.data?.groups.find((g) => g.groupId === a.groupId)?.role;
                const canDelete = (a.uploadedBy != null && a.uploadedBy === me.data?.user.id) || myRole === "leader" || myRole === "admin";
                const isSource = a.id === selectedSourceId;
                const isEditing = editingId === a.id;
                const menuOpen = menuOpenId === a.id;
                return (
                  <div
                    key={a.id}
                    className="asset-cell"
                    data-fb="素材格"
                    style={isSource ? { outline: "2px solid var(--primary)", outlineOffset: 2, borderRadius: 8 } : undefined}
                  >
                    {a.kind === "image" && a.url ? (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`放大檢視 ${a.title}`}
                        title="點一下放大檢視"
                        style={{ cursor: "zoom-in", display: "block" }}
                        onClick={() => setLightbox({ url: a.url!, title: a.title })}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLightbox({ url: a.url!, title: a.title }); } }}
                      >
                        <img src={a.url} alt={a.title} loading="lazy" />
                      </div>
                    ) : a.kind === "video" && a.url ? (
                      <video
                        src={a.url}
                        controls
                        preload="metadata"
                        style={{ width: "100%", height: 96, objectFit: "cover", display: "block", background: "var(--muted)" }}
                      />
                    ) : (
                      <div className="asset-icon"><Icon name={KIND_ICON[a.kind] ?? "Package"} size={32} /></div>
                    )}
                    <div className="asset-meta">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editValue}
                          aria-label="素材名稱"
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => submitRename(a.id, a.title)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); submitRename(a.id, a.title); }
                            else if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
                          }}
                          style={{ fontSize: 13, fontWeight: 600, padding: "3px 8px", borderRadius: 8 }}
                        />
                      ) : (
                        <div className="asset-title" title="點兩下改名" onDoubleClick={() => startRename(a.id, a.title)}>
                          {a.title}
                        </div>
                      )}
                      <div className="hint" style={{ fontSize: 11 }}>
                        {a.locked ? <><Icon name="Lock" size={11} style={{ verticalAlign: "-1px", marginRight: 4, color: "var(--gold-ink)" }} />鎖定 · </> : ""}
                        {a.isAiGenerated ? "AI 生成" : "上傳"}
                        {a.storagePath ? "・已永久保存" : a.isAiGenerated ? "・保存中…" : ""}
                        {a.sizeBytes ? `・${fmtSize(a.sizeBytes)}` : ""}
                      </div>

                      {/* 音訊直接在格子裡試聽 */}
                      {a.kind === "audio" && a.url && (
                        <audio controls src={a.url} style={{ height: 28, width: "100%", marginTop: 6 }} />
                      )}

                      {/* 主動作（用作來源）顯眼，其餘收進「⋯」選單 */}
                      <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {onPickSource && (
                          <button
                            className={isSource ? "" : "primary"}
                            style={{ ...smallBtn, flex: "1 1 auto" }}
                            onClick={() => onPickSource({ id: a.id, title: a.title, kind: a.kind })}
                          >
                            {isSource ? <><Icon name="Check" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />已選為來源</> : "用作來源"}
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="更多動作"
                          aria-haspopup="menu"
                          aria-expanded={menuOpen}
                          title="更多：改名／鎖定／刪除"
                          style={{ ...smallBtn, lineHeight: 1, minWidth: 40, minHeight: 40, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                          onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpen ? null : a.id); }}
                        >
                          <Icon name="Ellipsis" size={18} />
                        </button>
                      </div>

                      {menuOpen && (
                        <div
                          role="menu"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: "flex", flexDirection: "column", gap: 6, marginTop: 6, paddingTop: 6,
                            borderTop: "1px solid var(--border-soft)",
                          }}
                        >
                          {a.kind === "doc" && (
                            <button
                              className="menu-item"
                              disabled={toKnowledge.isPending}
                              title="讓 AI 導演讀得懂這份文字素材"
                              onClick={() => { toKnowledge.mutate({ assetId: a.id }); setMenuOpenId(null); }}
                            >
                              加入知識庫
                            </button>
                          )}
                          <button className="menu-item" disabled={rename.isPending} onClick={() => startRename(a.id, a.title)}>
                            <Icon name="Pencil" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />改名
                          </button>
                          <button
                            className="menu-item"
                            style={a.locked ? { color: "var(--gold-ink)" } : undefined}
                            disabled={setLock.isPending}
                            title="固定素材（師父原音/開示/配樂）：鎖定後交付包會原封保留在 00_鎖定原素材"
                            onClick={() => { setLock.mutate({ assetId: a.id, locked: !a.locked }); setMenuOpenId(null); }}
                          >
                            {a.locked
                              ? <><Icon name="Unlock" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />解鎖</>
                              : <><Icon name="Lock" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />鎖定</>}
                          </button>
                          {canDelete && (
                            <>
                              <div className="menu-sep" />
                              <ConfirmButton
                                triggerClassName="menu-item danger"
                                disabled={del.isPending}
                                triggerTitle="刪除後會移到回收桶，可從下方「回收桶」還原（不扣點、不刪原檔）"
                                message={`把「${a.title}」移到回收桶？分鏡引用會保留，可從回收桶還原。`}
                                confirmLabel="刪除"
                                onConfirm={() => { del.mutate({ assetId: a.id }); setMenuOpenId(null); }}
                              >
                                刪除
                              </ConfirmButton>
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
        </>
      )}
      {del.error && <p className="error">{del.error.message}</p>}
      {rename.error && <p className="error">改名失敗：{rename.error.message}</p>}

      {/* 頁內大圖遮罩：點外部或 Esc 關閉 */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`檢視 ${lightbox.title}`}
          data-fb="素材大圖"
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000, background: "rgba(43, 38, 32, 0.72)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
          }}
        >
          <div style={{ position: "relative", maxWidth: "92vw", maxHeight: "88vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <img
              src={lightbox.url}
              alt={lightbox.title}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "92vw", maxHeight: "80vh", objectFit: "contain", borderRadius: 12, boxShadow: "var(--e4)" }}
            />
            <div style={{ color: "#fff", fontSize: 13, textAlign: "center", maxWidth: "80vw" }}>{lightbox.title}</div>
            <button
              type="button"
              aria-label="關閉大圖"
              onClick={() => setLightbox(null)}
              style={{ position: "absolute", top: 8, right: 8, borderRadius: 999, width: 40, height: 40, padding: 0, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            >
              <Icon name="X" size={18} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
