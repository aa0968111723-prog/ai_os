import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";
import { GoogleDrivePicker } from "./GoogleDrivePicker";
import { NotionPagePicker } from "./NotionPagePicker";
import { Badge, Button, Card, Hint, Meta } from "./ui";
import {
  addDataMethodsFor,
  dataHubConnectionLabel,
  dataHubConnectionState,
  type AddDataMethodId,
  type DataHubConnectionState,
} from "@shared/dataHub";

/**
 * ＋加入資料（全站唯一入口）。
 *
 * 產品原則（docs/data-hub-current-state-2026-08.md §13.3）：
 * 使用者只要回答一個問題——「你想從哪裡加入？」
 * 他不需要先知道這份資料應該屬於知識庫、素材庫、資料表還是整合頁；
 * 也不需要先去別的頁面把 Google／Notion 連好再回來。
 *
 * ★ 沒有重寫任何既有能力：
 *   - Google 走既有 GoogleDrivePicker + knowledge.importDriveFile
 *   - Notion 走既有 NotionPagePicker + knowledge.importUrl（Notion 官方 API）
 *   - 上傳走既有 /api/upload（素材庫同一條路徑）
 *   - 貼上文字走既有 knowledge.add
 *   - 網址走既有 knowledge.importUrl
 *   結構化資料表與外部 API 留在資料中心的完整入口（見 shared/dataHub.addDataMethodsFor）。
 *
 * ★ 不變量：連接 ≠ 匯入。這裡顯示的「已連接／需要重新連接」講的永遠只是
 *   「你能不能去自己的雲端挑東西」，不是「AI 讀得到什麼」。
 */

const METHOD_ICON: Record<AddDataMethodId, IconName> = {
  upload: "Upload",
  paste: "FileText",
  "google-drive": "HardDrive",
  notion: "FileText",
  url: "Share2",
  tabular: "Database",
  api: "Waypoints",
};

/** 專案內加入時可用的檔案類型：與素材庫上傳同一份白名單（伺服器仍是最終把關） */
const UPLOAD_ACCEPT = [
  ".txt", ".md", ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf", ".epub",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif", ".avif",
  ".mp4", ".webm", ".mov", ".m4v", ".mp3", ".wav", ".m4a", ".aac", ".flac",
].join(",");

export type AddDataDestination =
  | { kind: "project"; projectId: string; projectTitle?: string | null }
  | { kind: "hub" };

export function AddDataSheet({ open, destination, onClose, onAdded, onOpenTableFlow }: {
  open: boolean;
  /** 從專案進來就已經知道要加到哪；從資料中心進來則先讓使用者挑一個專案 */
  destination: AddDataDestination;
  onClose: () => void;
  /** 至少加入一份資料後呼叫（呼叫端刷新自己的清單） */
  onAdded?: () => void;
  /**
   * 資料中心才有的「結構化資料表」與「外部 API」路徑：交回呼叫端開啟既有的建表／匯入流程。
   * 沒提供時該選項不出現——不做一顆按下去沒反應的按鈕。
   */
  onOpenTableFlow?: () => void;
}) {
  const [method, setMethod] = useState<AddDataMethodId | null>(null);
  const [pickedProjectId, setPickedProjectId] = useState<string>("");
  const cardRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  const sources = trpc.dataHub.sources.useQuery(undefined, { enabled: open, staleTime: 30_000 });
  // 資料中心入口才需要選目的地；專案內已經知道要加到哪
  const projects = trpc.projects.list.useQuery(undefined, {
    enabled: open && destination.kind === "hub",
    staleTime: 30_000,
  });

  // 唯讀成員在該專案本來就寫不進去——不要列出來讓人按了才被後端擋
  const writableProjects = useMemo(
    () => (projects.data ?? []).filter((p) => p.myProjectRole !== "viewer"),
    [projects.data],
  );

  const projectId = destination.kind === "project" ? destination.projectId : pickedProjectId;
  const projectTitle = destination.kind === "project"
    ? destination.projectTitle ?? null
    : writableProjects.find((p) => p.id === pickedProjectId)?.title ?? null;

  const methods = addDataMethodsFor(destination.kind === "project" ? "project" : "hub");

  /** 每個來源的連線狀態（只講「能不能去挑」，不是 AI 讀得到什麼） */
  const connectionOf = (need: "google-drive" | "notion" | "api" | null): DataHubConnectionState | null => {
    if (!need) return null;
    const s = sources.data?.find((x) => x.id === need);
    if (!s) return null;
    return dataHubConnectionState({ configured: s.configured, connected: s.connected, status: s.status });
  };

  /* ── 對話框行為：Esc 關閉、焦點圈住、關閉後歸還焦點、鎖背景捲動 ── */
  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !cardRef.current) return;
      const focusable = cardRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      restoreFocusTo.current?.focus?.();
    };
  }, [open, onClose]);

  // 每次重新開啟都回到「你想從哪裡加入？」——不要接著上次的半路狀態
  useEffect(() => {
    if (!open) setMethod(null);
  }, [open]);

  if (!open) return null;

  const needsDestination = destination.kind === "hub" && !projectId;

  return (
    <div
      className="add-data-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card
        as="section"
        ref={cardRef}
        className="add-data-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-data-title"
        data-fb="加入資料"
      >
        <div className="add-data-card__head">
          <div>
            <h2 id="add-data-title">
              <Icon name="Plus" size={18} /> 加入資料
            </h2>
            <Meta as="p" style={{ margin: "2px 0 0" }}>
              {projectTitle ? `加入到「${projectTitle}」，之後這個專案的 AI 就讀得到` : "選一個地方放，之後 AI 就讀得到"}
            </Meta>
          </div>
          <Button variant="ghost" aria-label="關閉" onClick={onClose}>
            <Icon name="X" size={18} />
          </Button>
        </div>

        {needsDestination && (
          <div className="add-data-destination">
            <label htmlFor="add-data-project" style={{ fontWeight: 600 }}>加入到哪個專案？</label>
            {projects.isLoading ? (
              <Meta as="p">正在讀取你的專案…</Meta>
            ) : writableProjects.length === 0 ? (
              <Hint style={{ margin: 0 }}>你目前沒有可以編輯的專案——先建立一個專案，再回來加入資料。</Hint>
            ) : (
              <select
                id="add-data-project"
                value={pickedProjectId}
                onChange={(e) => setPickedProjectId(e.target.value)}
              >
                <option value="">請選擇…</option>
                {writableProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {method === null ? (
          <>
            <p className="add-data-question">你想從哪裡加入？</p>
            <div className="add-data-methods">
              {methods.map((m) => {
                const conn = connectionOf(m.requiresConnection);
                const unavailable = conn === "unavailable";
                const isTableFlow = m.id === "tabular" || m.id === "api";
                if (isTableFlow && !onOpenTableFlow) return null;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`add-data-method${m.advanced ? " is-advanced" : ""}`}
                    disabled={unavailable || (needsDestination && !isTableFlow)}
                    onClick={() => {
                      if (isTableFlow) {
                        onOpenTableFlow?.();
                        onClose();
                        return;
                      }
                      setMethod(m.id);
                    }}
                    title={unavailable ? "站方尚未設定這個服務" : m.hint}
                  >
                    <span className="add-data-method__icon"><Icon name={METHOD_ICON[m.id]} size={18} /></span>
                    <span className="add-data-method__copy">
                      <strong>{m.label}</strong>
                      <small>{m.hint}</small>
                    </span>
                    {conn && <Badge>{dataHubConnectionLabel(conn)}</Badge>}
                  </button>
                );
              })}
            </div>
            {needsDestination && writableProjects.length > 0 && (
              <Hint style={{ margin: 0 }}>先選一個專案，就可以開始加入資料。</Hint>
            )}
            {/* ★ 不變量 I1：這句話不可以被寫成「連接後 AI 就能讀你的雲端」 */}
            <Hint style={{ margin: 0 }}>
              連接 Google 或 Notion 只是讓你可以去挑檔案；AI 只讀得到你真正選中並加入的內容。
            </Hint>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="add-data-back"
              onClick={() => setMethod(null)}
            >
              <Icon name="Undo2" size={14} /> 換一種方式
            </Button>
            {projectId && (
              <MethodPanel
                method={method}
                projectId={projectId}
                onDone={() => {
                  onAdded?.();
                }}
                onBack={() => setMethod(null)}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/* ────────────────────────── 各加入方式的面板 ────────────────────────── */

function MethodPanel({ method, projectId, onDone, onBack }: {
  method: AddDataMethodId;
  projectId: string;
  onDone: () => void;
  onBack: () => void;
}) {
  if (method === "google-drive") {
    return <GoogleDrivePicker projectId={projectId} onImported={onDone} onClose={onBack} />;
  }
  if (method === "notion") {
    return <NotionPagePicker projectId={projectId} onImported={onDone} onClose={onBack} />;
  }
  if (method === "paste") return <PastePanel projectId={projectId} onDone={onDone} />;
  if (method === "url") return <UrlPanel projectId={projectId} onDone={onDone} />;
  if (method === "upload") return <UploadPanel projectId={projectId} onDone={onDone} />;
  return null;
}

function PastePanel({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const add = trpc.knowledge.add.useMutation({
    onSuccess: (row) => {
      setOk(`已加入「${row.title}」——這個專案的 AI 現在讀得到`);
      setTitle("");
      setContent("");
      void utils.knowledge.list.invalidate({ projectId });
      onDone();
    },
  });

  const canSubmit = !!title.trim() && !!content.trim() && !add.isPending;
  return (
    <div className="add-data-panel">
      <label htmlFor="add-data-paste-title" style={{ fontWeight: 600 }}>這份資料叫什麼？</label>
      <input
        id="add-data-paste-title"
        value={title}
        maxLength={120}
        placeholder="例：第 3 集腳本、10/5 會議紀錄"
        onChange={(e) => setTitle(e.target.value)}
      />
      <label htmlFor="add-data-paste-body" style={{ fontWeight: 600 }}>內容</label>
      <textarea
        id="add-data-paste-body"
        value={content}
        rows={8}
        placeholder="把腳本、筆記或會議紀錄貼進來…"
        onChange={(e) => setContent(e.target.value)}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button
          variant="primary"
          disabled={!canSubmit}
          onClick={() => add.mutate({ projectId, title: title.trim(), content, kind: "note" })}
        >
          {add.isPending ? "加入中…" : "加入"}
        </Button>
        {ok && <Meta style={{ color: "var(--success-ink)" }}>{ok}</Meta>}
      </div>
      {add.error && <p className="error" role="alert">{add.error.message}</p>}
    </div>
  );
}

function UrlPanel({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [url, setUrl] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const importUrl = trpc.knowledge.importUrl.useMutation({
    onSuccess: (res) => {
      setOk(
        res.truncated
          ? `已加入「${res.title}」——內容較長，只取了前 ${res.chars.toLocaleString("en-US")} 字給 AI`
          : `已加入「${res.title}」——這個專案的 AI 現在讀得到`,
      );
      setUrl("");
      void utils.knowledge.list.invalidate({ projectId });
      onDone();
    },
  });

  return (
    <div className="add-data-panel">
      <label htmlFor="add-data-url" style={{ fontWeight: 600 }}>貼上網址</label>
      <input
        id="add-data-url"
        value={url}
        maxLength={2000}
        placeholder="網頁、Google 文件或 Notion 頁面的連結"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && url.trim() && !importUrl.isPending) {
            importUrl.mutate({ projectId, url: url.trim() });
          }
        }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button
          variant="primary"
          disabled={!url.trim() || importUrl.isPending}
          onClick={() => importUrl.mutate({ projectId, url: url.trim() })}
        >
          {importUrl.isPending ? "讀取中…" : "加入"}
        </Button>
        {ok && <Meta style={{ color: "var(--success-ink)" }}>{ok}</Meta>}
      </div>
      <Hint style={{ margin: 0 }}>
        只會抓得到文字的網頁；私人的 Google 文件請先連接 Google 雲端，或改用上面的「Google 雲端」選檔。
      </Hint>
      {importUrl.error && <p className="error" role="alert">{importUrl.error.message}</p>}
    </div>
  );
}

function UploadPanel({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  /**
   * 走既有的 /api/upload（與素材庫同一條路徑，含 MIME 白名單、配額與落地）——
   * 這裡只是換一個入口，不是第二套上傳。逐檔送出：一檔失敗不擋後面的檔。
   */
  const doUpload = async (files: FileList | null) => {
    if (busy || !files?.length) return;
    const list = Array.from(files);
    setBusy(true);
    setError("");
    setOk("");
    const failed: string[] = [];
    let okCount = 0;
    for (const [i, file] of list.entries()) {
      setStep(list.length > 1 ? `加入中…（${i + 1}/${list.length}）` : "加入中…");
      try {
        const form = new FormData();
        form.append("projectId", projectId);
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) failed.push(`${file.name}：${data.error ?? `加入失敗（${res.status}）`}`);
        else okCount += 1;
      } catch {
        failed.push(`${file.name}：加入失敗——請檢查網路後重試`);
      }
    }
    setBusy(false);
    setStep("");
    if (inputRef.current) inputRef.current.value = "";
    if (okCount > 0) {
      setOk(`已加入 ${okCount} 個檔案`);
      void utils.projects.assets.invalidate({ projectId });
      onDone();
    }
    if (failed.length) setError(failed.join("；"));
  };

  return (
    <div className="add-data-panel">
      <label htmlFor="add-data-upload" style={{ fontWeight: 600 }}>選擇檔案</label>
      <input
        id="add-data-upload"
        ref={inputRef}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        disabled={busy}
        onChange={(e) => { void doUpload(e.target.files); }}
      />
      {busy && <Meta as="p" role="status">{step}</Meta>}
      {ok && <Meta as="p" style={{ color: "var(--success-ink)" }}>{ok}</Meta>}
      {error && <p className="error" role="alert">{error}</p>}
      <Hint style={{ margin: 0 }}>
        文件、圖片與影音都可以。圖影會進專案素材庫；要讓 AI 讀懂圖片內容，可以在素材庫請 AI 產生描述。
      </Hint>
    </div>
  );
}
