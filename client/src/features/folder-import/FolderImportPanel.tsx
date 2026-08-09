import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Badge, Button, Hint, Meta } from "../../components/ui";
import {
  FOLDER_DIFF_LABEL,
  FOLDER_UPLOAD_CONCURRENCY_DEFAULT,
  buildFolderManifest,
  type FolderManifest,
} from "@shared/folderImport";
import { indexFilesByRelativePath, runUploadQueue } from "./uploadQueue";

/**
 * 資料夾匯入面板（取代舊的「選了就逐檔 for-loop POST」）。
 *
 * 流程與 server 一致（shared/folderImport）：
 *   選資料夾 → 掃描出 manifest → 與上次比對 → 建立 Import Session
 *   → 有界並行上傳（可重試／可取消／可續傳）→ 既有 Intelligence pipeline → 需要確認
 *
 * ★ 進度**分四段顯示**，不把上傳偽裝成「AI 整理」（§6）。
 * ★ 相對路徑（`webkitRelativePath`）完整保留，匯入後不會只剩檔名（§4）。
 * ★ 離開這個畫面不會中斷 AI 分析——分析是伺服器端的持久佇列，不是這個元件在跑。
 */

const UPLOAD_ACCEPT = [
  ".txt", ".md", ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf", ".epub",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif", ".avif",
  ".mp4", ".webm", ".mov", ".m4v", ".mp3", ".wav", ".m4a", ".aac", ".flac",
].join(",");

type Phase = "idle" | "scanned" | "importing" | "done";

export function FolderImportPanel({ projectId, groupId, onDone }: {
  projectId: string;
  groupId: string;
  onDone?: () => void;
}) {
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<Map<string, File>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [manifest, setManifest] = useState<FolderManifest | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(0);
  const [failed, setFailed] = useState(0);
  const [queueTotal, setQueueTotal] = useState(0);
  const [error, setError] = useState("");

  // 資料夾選取要靠 DOM 屬性——React 沒有 webkitdirectory 的型別化 prop
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const preview = trpc.folderImport.preview.useQuery(
    {
      groupId,
      displayName: manifest?.rootDisplayName ?? "",
      entries: manifest?.entries ?? [],
    },
    { enabled: phase === "scanned" && !!manifest?.entries.length, staleTime: 30_000 },
  );

  const status = trpc.folderImport.status.useQuery(
    { sessionId: sessionId ?? "" },
    {
      enabled: !!sessionId,
      // AI 理解是背景工作：匯入還在跑就每 4 秒問一次，停了就不再輪詢
      refetchInterval: (query) => (query.state.data?.session.status === "uploading"
        || (query.state.data?.analyzedFiles ?? 0) < (query.state.data?.session.uploadedFiles ?? 0)) ? 4_000 : false,
    },
  );

  const begin = trpc.folderImport.begin.useMutation();
  const reportFailure = trpc.folderImport.reportFailure.useMutation();
  const cancel = trpc.folderImport.cancel.useMutation();

  const onPick = useCallback((fileList: FileList | null) => {
    setError("");
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    filesRef.current = indexFilesByRelativePath(files);
    setManifest(buildFolderManifest(files.map((file) => ({
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      type: file.type,
      webkitRelativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath,
    }))));
    setPhase("scanned");
  }, []);

  const startImport = useCallback(async () => {
    if (!manifest?.entries.length) return;
    setError("");
    setPhase("importing");
    setUploaded(0);
    setFailed(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const session = await begin.mutateAsync({
        groupId,
        projectId,
        displayName: manifest.rootDisplayName,
        sourceType: "web_directory",
        // 瀏覽器無法持續監看使用者的電腦——只承諾「手動重新掃描」（§9）
        mode: "manual_rescan",
        entries: manifest.entries,
      });
      setSessionId(session.sessionId);
      setQueueTotal(session.uploadQueue.length);
      if (!session.uploadQueue.length) { setPhase("done"); onDone?.(); return; }

      await runUploadQueue({
        tasks: session.uploadQueue.map((entry) => ({ key: entry.relativePath, item: entry })),
        concurrency: FOLDER_UPLOAD_CONCURRENCY_DEFAULT,
        signal: controller.signal,
        upload: async (task) => {
          const file = filesRef.current.get(task.key);
          if (!file) throw new Error("找不到這個檔案（可能已被移動）");
          const form = new FormData();
          form.append("projectId", projectId);
          form.append("importSessionId", session.sessionId);
          // 只送相對路徑：本機完整路徑永遠不離開這台電腦（§11）
          form.append("relativePath", task.key);
          form.append("file", file);
          const response = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
          const data = (await response.json()) as { ok?: boolean; error?: string };
          if (!response.ok || !data.ok) throw new Error(data.error ?? `加入失敗（${response.status}）`);
        },
        onProgress: (result) => {
          if (result.status === "uploaded") setUploaded((value) => value + 1);
          else if (result.status === "failed") setFailed((value) => value + 1);
        },
      }).then(async (results) => {
        // 失敗只有瀏覽器知道；不回報的話 session 會永遠停在「還在上傳」
        for (const result of results) {
          if (result.status === "uploaded") continue;
          await reportFailure.mutateAsync({
            sessionId: session.sessionId,
            relativePath: result.key,
            status: result.status === "cancelled" ? "skipped" : "failed",
            error: result.error ?? undefined,
          }).catch(() => undefined);
        }
      });
      setPhase("done");
      void utils.projects.assets.invalidate({ projectId });
      void utils.dataHub.list.invalidate();
      onDone?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "資料夾匯入失敗");
      setPhase("scanned");
    }
  }, [manifest, groupId, projectId, begin, reportFailure, utils, onDone]);

  const stages = status.data?.stages ?? [];
  const counts = preview.data?.counts;
  const skippedNote = useMemo(() => {
    if (!manifest?.skipped.length) return null;
    const unsafe = manifest.skipped.filter((item) => item.reason === "unsafe_path").length;
    const empty = manifest.skipped.filter((item) => item.reason === "empty").length;
    return [unsafe ? `${unsafe} 個路徑無法處理` : "", empty ? `${empty} 個空檔案` : ""].filter(Boolean).join("・");
  }, [manifest]);

  return (
    <div className="add-data-panel folder-import">
      <label htmlFor="folder-import-input" style={{ fontWeight: 600 }}>選擇資料夾</label>
      <input
        id="folder-import-input"
        ref={inputRef}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        disabled={phase === "importing"}
        onChange={(event) => onPick(event.target.files)}
      />

      {manifest && (
        <div className="folder-import__summary">
          <strong>{manifest.rootDisplayName}</strong>
          <Meta>
            {manifest.entries.length.toLocaleString("en-US")} 個檔案
            {skippedNote ? `・略過 ${skippedNote}` : ""}
          </Meta>
          {counts && (
            <span className="folder-import__diff">
              {(["NEW", "MODIFIED", "UNCHANGED", "MISSING"] as const).map((state) => (
                counts[state] > 0
                  ? <Badge key={state}>{FOLDER_DIFF_LABEL[state]} {counts[state]}</Badge>
                  : null
              ))}
            </span>
          )}
          {counts && counts.MISSING > 0 && (
            <Hint style={{ margin: 0 }}>
              有 {counts.MISSING} 個檔案在你的電腦上已經找不到了。Aios <strong>不會</strong>自動刪除站內的資料——
              要不要刪除由你決定。
            </Hint>
          )}
        </div>
      )}

      {phase === "scanned" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="primary" disabled={!manifest?.entries.length || begin.isPending} onClick={() => { void startImport(); }}>
            {counts && counts.UNCHANGED > 0
              ? `匯入 ${counts.NEW + counts.MODIFIED} 個新增／修改的檔案`
              : "開始匯入"}
          </Button>
          {counts && counts.UNCHANGED > 0 && (
            <Meta>沒有變動的 {counts.UNCHANGED} 個檔案不會重傳，也不會重跑 AI 分析。</Meta>
          )}
        </div>
      )}

      {(phase === "importing" || phase === "done") && (
        <div className="folder-import__progress" role="status">
          <p className="folder-import__line">
            <Icon name="Upload" size={14} /> 上傳 {uploaded.toLocaleString("en-US")} / {queueTotal.toLocaleString("en-US")}
            {failed > 0 ? `・${failed} 個失敗` : ""}
          </p>
          {stages.map((stage) => (
            <p key={stage.key} className="folder-import__line">
              <strong>{stage.label}</strong>
              <span>{stage.detail}</span>
              {stage.percent != null && <Badge>{stage.percent}%</Badge>}
            </p>
          ))}
          {phase === "importing" && (
            <Button size="sm" variant="ghost" onClick={() => {
              abortRef.current?.abort();
              if (sessionId) void cancel.mutateAsync({ sessionId }).catch(() => undefined);
            }}>停止匯入</Button>
          )}
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {!!status.data?.failedEntries.length && (
        <details className="folder-import__failures">
          <summary>{status.data.failedEntries.length} 個檔案沒有成功</summary>
          <ul>
            {status.data.failedEntries.map((entry) => (
              <li key={entry.relativePath}><code>{entry.relativePath}</code>{entry.error ? `：${entry.error}` : ""}</li>
            ))}
          </ul>
        </details>
      )}

      <Hint style={{ margin: 0 }}>
        ✨ 原始資料夾結構會完整保留；AI 另外在背景辨識類型、分類、標籤、去重並建立語意索引。
        離開這個畫面，AI 分析會繼續。
      </Hint>
    </div>
  );
}
