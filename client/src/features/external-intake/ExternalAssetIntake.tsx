import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "../../api";
import { GoogleDrivePicker } from "../../components/GoogleDrivePicker";
import { Icon } from "../../components/Icon";
import { useFocusTrap } from "../../components/interactions";
import { Button, Card, Hint, Meta } from "../../components/ui";
import { readLocalMediaMetadata } from "./mediaMetadata";
import { ExternalImportInbox } from "./ExternalImportInbox";
import { FolderImportPanel } from "../folder-import/FolderImportPanel";

type ImportMethod = "file-picker" | "drag-drop" | "clipboard";
type ExistingAsset = { id: string; title: string; url: string };
type DuplicateCandidate = {
  key: string;
  label: string;
  existing: ExistingAsset;
  retry: () => Promise<boolean>;
};
type UploadedReference = { assetId: string; resourceId?: string; intelligenceId?: string };

export interface ExternalImportNotice {
  source: "file" | "url" | "google-drive" | "folder";
  projectId: string;
  assetIds: string[];
  resourceIds: string[];
  intelligenceIds: string[];
  count: number;
  folderImportSessionId?: string;
}

export interface ExternalIntakeOpenRequest {
  id: string;
  mode: "files" | "url" | "drive" | "folder";
  url?: string;
}

export function ExternalAssetIntake({
  projectId,
  groupId,
  sceneId,
  sceneLabel,
  editingSessionId,
  triggerLabel = "＋ 帶入成果",
  triggerVariant = "primary",
  openRequest,
  dialogTitle,
  closeOnImported = false,
  onImported,
}: {
  projectId: string;
  groupId?: string;
  sceneId?: string;
  sceneLabel?: string;
  /** Exact ExternalEditingBridge return target; bypasses heuristic matching. */
  editingSessionId?: string;
  triggerLabel?: string;
  triggerVariant?: "primary" | "ghost" | "tonal";
  /** Lets the command center open the existing mini workspace from natural language. */
  openRequest?: ExternalIntakeOpenRequest;
  /** Product-language heading; the generic external-result copy is wrong for normal intake. */
  dialogTitle?: string;
  /** Command Center returns to the conversation as soon as persistence is verified. */
  closeOnImported?: boolean;
  onImported?: (notice?: ExternalImportNotice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"files" | "url" | "drive" | "folder">("files");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open, () => setOpen(false));
  const utils = trpc.useUtils();
  const sessions = trpc.externalIntake.activeSessions.useQuery(
    { projectId, sceneId },
    { enabled: open && !editingSessionId, staleTime: 10_000 },
  );
  const activeSession = sessions.data?.[0];
  const context = { currentProjectId: projectId, ...(sceneId ? { currentSceneId: sceneId } : {}) };
  const urlImport = trpc.externalIntake.importUrl.useMutation();
  const driveImport = trpc.externalIntake.importDriveFile.useMutation();

  useEffect(() => {
    if (!openRequest) return;
    setMode(openRequest.mode);
    if (openRequest.mode === "url" && openRequest.url) setUrl(openRequest.url);
    setOpen(true);
  }, [openRequest]);

  const addDuplicate = (candidate: DuplicateCandidate) => {
    setDuplicates((current) => current.some((item) => item.key === candidate.key)
      ? current
      : [...current, candidate]);
  };

  const refresh = (notice?: ExternalImportNotice) => {
    void utils.externalIntake.inbox.invalidate({ projectId });
    void utils.externalIntake.activeSessions.invalidate();
    void utils.projects.assets.invalidate({ projectId });
    void utils.externalEditing.list.invalidate({ projectId });
    onImported?.(notice);
    if (notice && closeOnImported) setOpen(false);
  };

  const uploadOne = async (file: File, method: ImportMethod, forceDuplicate = false): Promise<UploadedReference | null> => {
    const mediaMetadata = await readLocalMediaMetadata(file);
    const form = new FormData();
    form.append("projectId", projectId);
    form.append("intake", "1");
    form.append("source", editingSessionId ? "external-editor" : "external-ai");
    form.append("importMethod", method);
    form.append("context", JSON.stringify(context));
    form.append("mediaMetadata", JSON.stringify(mediaMetadata));
    if (activeSession) {
      form.append("externalSessionId", activeSession.id);
      form.append("sourceTool", activeSession.externalTool);
    }
    if (editingSessionId) {
      form.append("editingSessionId", editingSessionId);
      form.append("sourceTool", "lumafusion");
    }
    if (forceDuplicate) form.append("forceDuplicate", "1");
    form.append("file", file);
    const response = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
    const data = await response.json() as {
      ok?: boolean;
      error?: string;
      duplicate?: { id: string; title: string; url: string };
      asset?: { id: string };
      intelligenceId?: string | null;
      libraryResourceId?: string | null;
    };
    if (response.status === 409 && data.duplicate) {
      addDuplicate({
        key: `file:${file.name}:${file.size}:${file.lastModified}`,
        label: file.name,
        existing: data.duplicate,
        retry: async () => !!(await uploadOne(file, method, true)),
      });
      return null;
    }
    if (!response.ok || !data.ok) throw new Error(data.error ?? `帶入失敗（${response.status}）`);
    return data.asset?.id ? {
      assetId: data.asset.id,
      resourceId: data.libraryResourceId ?? undefined,
      intelligenceId: data.intelligenceId ?? undefined,
    } : null;
  };

  const uploadFiles = async (files: FileList | File[], method: ImportMethod) => {
    const list = Array.from(files);
    if (!list.length || busy) return;
    setBusy(true);
    setError("");
    setDuplicates([]);
    let done = 0;
    const assetIds: string[] = [];
    const resourceIds: string[] = [];
    const intelligenceIds: string[] = [];
    const failures: string[] = [];
    for (const [index, file] of list.entries()) {
      setProgress(`正在安全保存 ${index + 1}/${list.length}：${file.name}`);
      try {
        const uploaded = await uploadOne(file, method);
        if (uploaded) {
          done += 1;
          assetIds.push(uploaded.assetId);
          if (uploaded.resourceId) resourceIds.push(uploaded.resourceId);
          if (uploaded.intelligenceId) intelligenceIds.push(uploaded.intelligenceId);
        }
      }
      catch (caught) { failures.push(`${file.name}：${caught instanceof Error ? caught.message : "帶入失敗"}`); }
    }
    if (done) refresh({ source: "file", projectId, assetIds, resourceIds, intelligenceIds, count: done });
    if (failures.length) setError(`${done} 個成功、${failures.length} 個失敗——${failures.join("；")}`);
    setProgress(done ? `✓ ${done} 個成果已安全保存，AI 正在背景整理` : "");
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const importFromUrl = async () => {
    if (!url.trim() || busy) return;
    setBusy(true); setError(""); setProgress("正在檢查連結並安全保存…");
    try {
      const result = await urlImport.mutateAsync({
        projectId,
        url: url.trim(),
        source: "url",
        context,
        externalSessionId: activeSession?.id,
        editingSessionId,
        sourceTool: activeSession?.externalTool,
      });
      if (!result.ok) {
        setError(`這個素材似乎已存在：${result.asset.title}`);
        const sourceUrl = url.trim();
        addDuplicate({
          key: `url:${sourceUrl}`,
          label: sourceUrl,
          existing: { id: result.asset.id, title: result.asset.title, url: result.asset.url },
          retry: async () => {
            const forced = await urlImport.mutateAsync({
              projectId,
              url: sourceUrl,
              source: "url",
              context,
              externalSessionId: activeSession?.id,
              editingSessionId,
              sourceTool: activeSession?.externalTool,
              forceDuplicate: true,
            });
            if (forced.ok) setUrl("");
            return forced.ok;
          },
        });
      } else {
        setUrl("");
        setProgress("✓ 成果已安全保存，AI 正在背景整理");
        refresh({
          source: "url", projectId, assetIds: [result.asset.id],
          resourceIds: result.libraryResourceId ? [result.libraryResourceId] : [],
          intelligenceIds: result.intelligenceId ? [result.intelligenceId] : [], count: 1,
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "網址匯入失敗");
      setProgress("");
    } finally { setBusy(false); }
  };

  const importDriveFiles = async (files: Array<{ id: string; name: string }>) => {
    setBusy(true); setError("");
    const failures: string[] = [];
    let done = 0;
    const assetIds: string[] = [];
    const resourceIds: string[] = [];
    const intelligenceIds: string[] = [];
    for (const [index, file] of files.entries()) {
      setProgress(`從 Google Drive 帶入 ${index + 1}/${files.length}：${file.name}`);
      try {
        const result = await driveImport.mutateAsync({
          projectId,
          fileId: file.id,
          context,
          externalSessionId: activeSession?.id,
          editingSessionId,
        });
        if (result.ok) {
          done += 1;
          assetIds.push(result.asset.id);
          if (result.libraryResourceId) resourceIds.push(result.libraryResourceId);
          if (result.intelligenceId) intelligenceIds.push(result.intelligenceId);
        }
        else {
          failures.push(`${file.name}：似乎已存在，可在下方選擇仍然匯入`);
          addDuplicate({
            key: `drive:${file.id}`,
            label: file.name,
            existing: { id: result.asset.id, title: result.asset.title, url: result.asset.url },
            retry: async () => (await driveImport.mutateAsync({
              projectId,
              fileId: file.id,
              context,
              externalSessionId: activeSession?.id,
              editingSessionId,
              forceDuplicate: true,
            })).ok,
          });
        }
      } catch (caught) { failures.push(`${file.name}：${caught instanceof Error ? caught.message : "帶入失敗"}`); }
    }
    if (done) refresh({ source: "google-drive", projectId, assetIds, resourceIds, intelligenceIds, count: done });
    setProgress(done ? `✓ ${done} 個 Drive 檔案已安全保存` : "");
    if (failures.length) setError(failures.join("；"));
    setBusy(false);
  };

  return (
    <>
      <Button
        size="sm"
        variant={triggerVariant}
        aria-label={triggerLabel === "＋" ? "加入資料" : undefined}
        onClick={() => setOpen(true)}
      >
        {triggerLabel === "＋" ? null : <Icon name="Package" size={13} />} {triggerLabel}
      </Button>
      {open && typeof document !== "undefined" ? createPortal(
        <div className="modal-scrim external-intake-scrim" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <Card ref={dialogRef} className="modal-card external-intake" role="dialog" aria-modal="true" aria-label={dialogTitle ?? "帶入外部生成成果"}>
            <div className="external-intake__head">
              <div>
                <h2>{dialogTitle ?? "把剛剛生成的內容帶進來"}</h2>
                <Meta as="p" style={{ margin: 0 }}>先安全保存，再在背景整理；不用等 AI 分析完。</Meta>
              </div>
              <Button size="sm" variant="ghost" aria-label="關閉" onClick={() => setOpen(false)}><Icon name="X" /></Button>
            </div>
            {activeSession && (
              <Hint role="status" style={{ margin: "8px 0" }}>
                正在等待 {activeSession.externalToolName} 成果：{sceneLabel ?? (sceneId ? "目前分鏡" : "目前專案")}。
                帶入後會優先詢問是否套用到這裡。
              </Hint>
            )}
            {editingSessionId && (
              <Hint role="status" style={{ margin: "8px 0" }}>
                回傳到同一個 LumaFusion 剪輯工作階段；Aios 會保留來源版本與原本的專案位置。
              </Hint>
            )}
            <div className="external-intake__tabs" role="tablist" aria-label="帶入方式">
              <Button id="external-intake-files-tab" role="tab" aria-selected={mode === "files"} aria-controls="external-intake-files-panel" size="sm" variant={mode === "files" ? "primary" : "ghost"} onClick={() => setMode("files")}>從電腦</Button>
              <Button id="external-intake-drive-tab" role="tab" aria-selected={mode === "drive"} aria-controls="external-intake-drive-panel" size="sm" variant={mode === "drive" ? "primary" : "ghost"} onClick={() => setMode("drive")}>Google Drive</Button>
              {groupId ? (
                <Button id="external-intake-folder-tab" role="tab" aria-selected={mode === "folder"} aria-controls="external-intake-folder-panel" size="sm" variant={mode === "folder" ? "primary" : "ghost"} onClick={() => setMode("folder")}>資料夾</Button>
              ) : null}
              <Button id="external-intake-url-tab" role="tab" aria-selected={mode === "url"} aria-controls="external-intake-url-panel" size="sm" variant={mode === "url" ? "primary" : "ghost"} onClick={() => setMode("url")}>貼上連結</Button>
            </div>
            {mode === "files" && (
              <div id="external-intake-files-panel" role="tabpanel" aria-labelledby="external-intake-files-tab">
                <div
                  className={`external-intake__drop${dragOver ? " is-dragging" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInput.current?.click()}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInput.current?.click(); }}
                  onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(event) => { event.preventDefault(); setDragOver(false); void uploadFiles(event.dataTransfer.files, "drag-drop"); }}
                >
                  <Icon name="Upload" size={24} />
                  <strong>{busy ? "正在帶入…" : "拖放圖片、影片、音訊或文件"}</strong>
                  <Meta as="span">可一次選很多檔案</Meta>
                </div>
                <input ref={fileInput} hidden type="file" multiple accept="image/*,video/*,audio/*,.pdf,.txt,.md,.doc,.docx,.ppt,.pptx" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files, "file-picker"); }} />
              </div>
            )}
            {mode === "url" && (
              <div id="external-intake-url-panel" role="tabpanel" aria-labelledby="external-intake-url-tab" className="external-intake__url">
                <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="貼上公開圖片、影片、音訊或可下載檔案網址" aria-label="公開成果網址" />
                <Button variant="primary" disabled={!url.trim() || busy} onClick={() => { void importFromUrl(); }}>帶入</Button>
                <Meta as="p">需要登入的外部 AI 頁面不會被繞過；請先下載成果再帶入。</Meta>
              </div>
            )}
            {mode === "drive" && (
              <div id="external-intake-drive-panel" role="tabpanel" aria-labelledby="external-intake-drive-tab">
                <GoogleDrivePicker onClose={() => setMode("files")} onPick={(files) => { void importDriveFiles(files); }} pickLabel="帶入選取成果" />
              </div>
            )}
            {mode === "folder" && groupId ? (
              <div id="external-intake-folder-panel" role="tabpanel" aria-labelledby="external-intake-folder-tab">
                <FolderImportPanel
                  projectId={projectId}
                  groupId={groupId}
                  onDone={(result) => {
                    if (!result) return;
                    refresh({
                      source: "folder",
                      projectId,
                      assetIds: [],
                      resourceIds: [],
                      intelligenceIds: [],
                      count: result.count,
                      folderImportSessionId: result.sessionId,
                    });
                  }}
                />
              </div>
            ) : null}
            {progress && <p className="success" role="status">{progress}</p>}
            {error && <p className="error" role="alert">{error}</p>}
            {duplicates.map((duplicate) => (
              <Hint key={duplicate.key} as="div" role="alert" className="external-intake__duplicate">
                <span>
                  <strong>這個素材似乎已存在：{duplicate.existing.title}</strong>
                  <Meta as="small">來源：{duplicate.label}</Meta>
                </span>
                <div>
                  <a className="btn-ghost btn-sm" href={duplicate.existing.url} target="_blank" rel="noreferrer">查看原素材</a>
                  <Button size="sm" disabled={busy} onClick={async () => {
                    setBusy(true); setError("");
                    try {
                      if (!await duplicate.retry()) throw new Error("素材仍被判定為重複，請重新整理後再試");
                      setDuplicates((current) => current.filter((item) => item.key !== duplicate.key));
                      refresh();
                      setProgress("✓ 已依你的選擇另外保留一份");
                    } catch (caught) { setError(caught instanceof Error ? caught.message : "帶入失敗"); }
                    finally { setBusy(false); }
                  }}>仍然匯入</Button>
                </div>
              </Hint>
            ))}
            <ExternalImportInbox projectId={projectId} compact onChanged={onImported} />
          </Card>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
