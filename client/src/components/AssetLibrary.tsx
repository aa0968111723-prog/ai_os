import { useRef, useState } from "react";
import { trpc } from "../api";

function fmtSize(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const KIND_ICON: Record<string, string> = { image: "🖼", video: "🎬", audio: "🔊", doc: "📄" };

/**
 * 專案素材庫：上傳（拖放/點選/多檔）、預覽、改名、刪除、選為生成來源。
 * 上傳走 /api/upload（multipart）；檔案存 Railway Volume，網址永久有效。
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

  return (
    <section className="card">
      <h2>素材庫（上傳參考素材・生成成品自動入庫）</h2>

      <div
        className={`upload-zone ${dragOver ? "drag" : ""}`}
        role="button"
        tabIndex={0}
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
        <p className="hint">載入中…</p>
      ) : !assets.data?.length ? (
        <p className="hint" style={{ marginTop: 10 }}>還沒有素材——上傳參考圖、原音檔，或先生成一張。</p>
      ) : (
        <div className="asset-grid">
          {assets.data.map((a) => {
            const myRole = me.data?.groups.find((g) => g.groupId === a.groupId)?.role;
            const canDelete = (a.uploadedBy != null && a.uploadedBy === me.data?.user.id) || myRole === "leader" || myRole === "admin";
            const isSource = a.id === selectedSourceId;
            const askRename = () => {
              const next = window.prompt("素材名稱", a.title);
              if (next && next.trim() && next.trim() !== a.title) rename.mutate({ assetId: a.id, title: next.trim() });
            };
            return (
              <div
                key={a.id}
                className="asset-cell"
                style={isSource ? { outline: "2px solid var(--primary)", outlineOffset: 2, borderRadius: 8 } : undefined}
              >
                {a.kind === "image" && a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer">
                    <img src={a.url} alt={a.title} loading="lazy" />
                  </a>
                ) : (
                  <div className="asset-icon">{KIND_ICON[a.kind] ?? "📦"}</div>
                )}
                <div className="asset-meta">
                  <div className="asset-title" title="點兩下改名" onDoubleClick={askRename}>
                    {a.title}
                  </div>
                  <div className="hint" style={{ fontSize: 11 }}>
                    {a.locked ? "🔒 鎖定 · " : ""}
                    {a.isAiGenerated ? "AI 生成" : "上傳"}
                    {a.storagePath ? "・已永久保存" : a.isAiGenerated ? "・保存中…" : ""}
                    {a.sizeBytes ? `・${fmtSize(a.sizeBytes)}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    {onPickSource && (
                      <button
                        style={{ padding: "2px 10px", fontSize: 11 }}
                        onClick={() => onPickSource({ id: a.id, title: a.title, kind: a.kind })}
                      >
                        {isSource ? "✓ 已選為來源" : "用作來源"}
                      </button>
                    )}
                    {a.kind === "audio" && a.url && <audio controls src={a.url} style={{ height: 26, maxWidth: 150 }} />}
                    {a.kind === "doc" && (
                      <button
                        style={{ padding: "2px 10px", fontSize: 11 }}
                        disabled={toKnowledge.isPending}
                        title="讓 AI 導演讀得懂這份文字素材"
                        onClick={() => toKnowledge.mutate({ assetId: a.id })}
                      >
                        加入知識庫
                      </button>
                    )}
                    <button style={{ padding: "2px 10px", fontSize: 11 }} disabled={rename.isPending} onClick={askRename}>
                      ✎ 改名
                    </button>
                    <button
                      style={{ padding: "2px 10px", fontSize: 11, color: a.locked ? "var(--gold, #B58A3E)" : undefined }}
                      disabled={setLock.isPending}
                      title="固定素材（師父原音/開示/配樂）：鎖定後交付包會原封保留在 00_鎖定原素材"
                      onClick={() => setLock.mutate({ assetId: a.id, locked: !a.locked })}
                    >
                      {a.locked ? "解鎖" : "🔒 鎖定"}
                    </button>
                    {canDelete && (
                      <button
                        style={{ padding: "2px 10px", fontSize: 11 }}
                        disabled={del.isPending}
                        onClick={() => window.confirm(`確定刪除「${a.title}」？分鏡若引用此素材會一併清空。`) && del.mutate({ assetId: a.id })}
                      >
                        刪除
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {del.error && <p className="error">{del.error.message}</p>}
      {rename.error && <p className="error">改名失敗：{rename.error.message}</p>}
    </section>
  );
}
