import { useRef, useState } from "react";
import { trpc } from "../api";

function fmtSize(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const KIND_ICON: Record<string, string> = { image: "🖼", video: "🎬", audio: "🔊", doc: "📄" };

/**
 * 專案素材庫：上傳（拖放/點選）、預覽、改名、刪除、選為生成來源。
 * 上傳走 /api/upload（multipart）；檔案存 Railway Volume，網址永久有效。
 */
export function AssetLibrary({
  projectId,
  onPickSource,
}: {
  projectId: string;
  onPickSource?: (asset: { id: string; title: string; kind: string }) => void;
}) {
  const utils = trpc.useUtils();
  const assets = trpc.projects.assets.useQuery({ projectId });
  const del = trpc.projects.deleteAsset.useMutation({ onSuccess: () => utils.projects.assets.invalidate({ projectId }) });
  const rename = trpc.projects.renameAsset.useMutation({ onSuccess: () => utils.projects.assets.invalidate({ projectId }) });
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const doUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setUploadError(data.error ?? `上傳失敗（${res.status}）`);
        return;
      }
      utils.projects.assets.invalidate({ projectId });
    } catch {
      setUploadError("上傳失敗——請檢查網路後重試");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <section className="card">
      <h2>素材庫（上傳參考素材・生成成品自動入庫）</h2>

      <div
        className={`upload-zone ${dragOver ? "drag" : ""}`}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); doUpload(e.dataTransfer.files); }}
      >
        {uploading ? "上傳中…" : "點這裡或把檔案拖進來上傳（圖片/影片/音訊/zip/PDF，單檔 200MB 內）"}
      </div>
      <input
        ref={fileInput}
        type="file"
        hidden
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
          {assets.data.map((a) => (
            <div key={a.id} className="asset-cell">
              {a.kind === "image" && a.url ? (
                <a href={a.url} target="_blank" rel="noreferrer">
                  <img src={a.url} alt={a.title} loading="lazy" />
                </a>
              ) : (
                <div className="asset-icon">{KIND_ICON[a.kind] ?? "📦"}</div>
              )}
              <div className="asset-meta">
                <div
                  className="asset-title"
                  title="點兩下改名"
                  onDoubleClick={() => {
                    const next = window.prompt("素材名稱", a.title);
                    if (next && next.trim() && next !== a.title) rename.mutate({ assetId: a.id, title: next.trim() });
                  }}
                >
                  {a.title}
                </div>
                <div className="hint" style={{ fontSize: 11 }}>
                  {a.isAiGenerated ? "AI 生成" : "上傳"}
                  {a.storagePath ? "・已永久保存" : a.isAiGenerated ? "・保存中…" : ""}
                  {a.sizeBytes ? `・${fmtSize(a.sizeBytes)}` : ""}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  {onPickSource && (
                    <button style={{ padding: "2px 10px", fontSize: 11 }} onClick={() => onPickSource({ id: a.id, title: a.title, kind: a.kind })}>
                      用作來源
                    </button>
                  )}
                  {a.kind === "audio" && a.url && <audio controls src={a.url} style={{ height: 26, maxWidth: 150 }} />}
                  <button
                    style={{ padding: "2px 10px", fontSize: 11 }}
                    disabled={del.isPending}
                    onClick={() => window.confirm(`確定刪除「${a.title}」？分鏡若引用此素材會一併清空。`) && del.mutate({ assetId: a.id })}
                  >
                    刪除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {del.error && <p className="error">{del.error.message}</p>}
    </section>
  );
}
