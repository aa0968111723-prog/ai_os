import { useEffect, useMemo, useState } from "react";
import { trpc } from "../api";
import { Icon } from "../components/Icon";
import {
  detectDesktopEditors,
  hasDesktopBridge,
  openAssetInExternalEditor,
  revealAssetInFolder,
  stopDesktopHandoff,
  type DetectedDesktopEditor,
  type ExternalEditorKind,
} from "../platform/desktopBridge";
import type { DesktopHandoffStatusEvent, DesktopRevisionEvent } from "../platform/tauriDesktop";

function editorKindForAsset(kind: string): ExternalEditorKind {
  if (kind === "video") return "video-editor";
  if (kind === "audio") return "audio-editor";
  if (kind === "image") return "image-editor";
  return "system-default";
}

function suggestedFileName(asset: { title: string; mime?: string | null; meta?: unknown }): string {
  const meta = asset.meta && typeof asset.meta === "object" ? asset.meta as Record<string, unknown> : null;
  const originalName = typeof meta?.originalName === "string" ? meta.originalName.trim() : "";
  if (originalName) return originalName;
  if (/\.[A-Za-z0-9]{1,8}$/.test(asset.title)) return asset.title;
  const extension = asset.mime?.split("/")[1]?.replace("quicktime", "mov").replace("mpeg", "mp3") ?? "bin";
  return `${asset.title}.${extension}`;
}

export function DesktopCompanionPage() {
  const desktopAvailable = hasDesktopBridge();
  const projects = trpc.projects.list.useQuery({});
  const [projectId, setProjectId] = useState("");
  const assets = trpc.projects.assets.useQuery(
    { projectId, limit: 500 },
    { enabled: desktopAvailable && !!projectId },
  );
  const [editors, setEditors] = useState<DetectedDesktopEditor[]>([]);
  const [assetId, setAssetId] = useState("");
  const [editorId, setEditorId] = useState("");
  const [activeHandoffId, setActiveHandoffId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectId && projects.data?.[0]?.id) setProjectId(projects.data[0].id);
  }, [projectId, projects.data]);

  useEffect(() => {
    if (!assetId && assets.data?.[0]?.id) setAssetId(assets.data[0].id);
  }, [assetId, assets.data]);

  useEffect(() => {
    if (!desktopAvailable) return;
    void detectDesktopEditors().then(setEditors);
  }, [desktopAvailable]);

  const selectedAsset = assets.data?.find((asset) => asset.id === assetId) ?? null;
  const neededKind = selectedAsset ? editorKindForAsset(selectedAsset.kind) : "system-default";
  const matchingEditors = useMemo(
    () => editors.filter((editor) => editor.kind === neededKind || editor.kind === "system-default"),
    [editors, neededKind],
  );

  useEffect(() => {
    if (!matchingEditors.some((editor) => editor.id === editorId)) {
      setEditorId(matchingEditors[0]?.id ?? "");
    }
  }, [editorId, matchingEditors]);

  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<DesktopHandoffStatusEvent>).detail;
      if (detail.projectId && detail.projectId !== projectId) return;
      if (detail.handoffId) setActiveHandoffId(detail.handoffId);
      setError(detail.phase === "error" ? detail.message : "");
      setMessage(detail.phase === "error" ? "" : detail.message);
    };
    const onRevision = (event: Event) => {
      const detail = (event as CustomEvent<DesktopRevisionEvent>).detail;
      if (detail.projectId !== projectId) return;
      setMessage(`已回傳新素材${detail.title ? `「${detail.title}」` : ""}，原始素材仍保留。`);
      void assets.refetch();
    };
    window.addEventListener("aios:desktop-handoff-status", onStatus);
    window.addEventListener("aios:asset-revision-uploaded", onRevision);
    return () => {
      window.removeEventListener("aios:desktop-handoff-status", onStatus);
      window.removeEventListener("aios:asset-revision-uploaded", onRevision);
    };
  }, [assets, projectId]);

  const openSelected = async () => {
    if (!selectedAsset || !editorId) return;
    setBusy(true);
    setError("");
    setMessage("正在準備本機交接…");
    try {
      const result = await openAssetInExternalEditor({
        assetId: selectedAsset.id,
        projectId,
        editorKind: neededKind,
        editorId,
        suggestedName: suggestedFileName(selectedAsset),
        returnPath: `/p/${projectId}?tab=assets`,
      });
      if (!result.ok) {
        setError(result.message);
        setMessage("");
        return;
      }
      if (result.handoffId) setActiveHandoffId(result.handoffId);
      setMessage("已啟動外部軟體。儲存檔案後，Aios 會在內容穩定時自動回傳新素材版本。");
    } finally {
      setBusy(false);
    }
  };

  const revealSelected = async () => {
    if (!selectedAsset) return;
    const result = await revealAssetInFolder({ assetId: selectedAsset.id, projectId });
    if (!result.ok) setError(result.message);
  };

  const stopWatching = async () => {
    if (!activeHandoffId) return;
    const result = await stopDesktopHandoff(activeHandoffId);
    if (result.ok) {
      setMessage("已停止這次編輯檔監看；本機檔案仍保留。");
      setActiveHandoffId("");
    } else {
      setError(result.message);
    }
  };

  if (!desktopAvailable) {
    return (
      <section className="card" style={{ maxWidth: 760, margin: "0 auto" }}>
        <h2>桌面剪輯連接</h2>
        <div className="empty-state">
          <h3>這項功能需要 Aios 桌面版</h3>
          <p>一般瀏覽器與 PWA 不會取得啟動本機剪輯軟體或監看檔案的權限。你仍可從素材庫下載後手動開啟。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="stack" style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="card">
        <h2>桌面剪輯連接</h2>
        <p className="hint">
          選擇專案素材與電腦中已安裝的軟體。Aios 只會把素材下載到自己的本機快取；儲存修改後會上傳成新素材，不覆寫原檔。
        </p>
      </div>

      <div className="card stack">
        <label>
          專案
          <select value={projectId} onChange={(event) => { setProjectId(event.target.value); setAssetId(""); setActiveHandoffId(""); }}>
            <option value="">選擇專案</option>
            {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
        </label>

        <label>
          素材
          <select value={assetId} onChange={(event) => { setAssetId(event.target.value); setActiveHandoffId(""); }} disabled={!projectId || assets.isLoading}>
            <option value="">{assets.isLoading ? "載入中…" : "選擇素材"}</option>
            {(assets.data ?? []).map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.title}・{asset.kind}</option>
            ))}
          </select>
        </label>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 8 }}>開啟軟體</legend>
          {matchingEditors.length === 0 ? (
            <p className="hint">沒有偵測到符合這類素材的軟體。</p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {matchingEditors.map((editor) => (
                <label key={editor.id} className={`chip pick ${editorId === editor.id ? "on" : ""}`}>
                  <input
                    type="radio"
                    name="desktop-editor"
                    value={editor.id}
                    checked={editorId === editor.id}
                    onChange={() => setEditorId(editor.id)}
                    style={{ marginRight: 6 }}
                  />
                  {editor.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button className="primary" type="button" disabled={!selectedAsset || !editorId || busy} onClick={() => void openSelected()}>
            {busy ? <><Icon name="Loader" className="spin" size={14} /> 準備中…</> : "用外部軟體開啟並監看"}
          </button>
          <button type="button" disabled={!selectedAsset} onClick={() => void revealSelected()}>在 Finder／檔案總管顯示</button>
          {activeHandoffId && <button type="button" className="btn-ghost" onClick={() => void stopWatching()}>停止自動回傳</button>}
        </div>

        {message && <p className="hint" role="status" aria-live="polite">{message}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      <div className="card">
        <h3>目前偵測到的桌面程式</h3>
        <ul>
          {editors.map((editor) => <li key={editor.id}>{editor.name}（{editor.kind}）</li>)}
        </ul>
      </div>
    </section>
  );
}
