import { useState } from "react";
import { Meta, Badge, Button, Hint } from "./ui";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";

/**
 * Google 雲端選檔器（PR-E1 使用者主路徑）：已連結者不必貼網址——搜尋自己的雲端、
 * 多選檔案、逐檔匯入目前資料庫的文件區。
 * 產品原則：連接 ≠ 授權 AI 讀全雲端——這裡只列中繼資料，內容要按「匯入」才抓；
 * 標題列固定顯示目前連結的 Google 帳戶（帳號透明）。
 */

type PickedFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  isFolder: boolean;
  owner: string | null;
  ownedByMe: boolean;
};

const MIME_LABEL: Array<[RegExp, string]> = [
  [/vnd\.google-apps\.document/, "Google 文件"],
  [/vnd\.google-apps\.spreadsheet/, "Google 試算表"],
  [/vnd\.google-apps\.presentation/, "Google 簡報"],
  [/vnd\.google-apps\./, "Google 其他"],
  [/pdf/, "PDF"],
  [/^image\//, "圖片"],
  [/^video\//, "影片"],
  [/^audio\//, "音訊"],
  [/wordprocessingml|msword/, "Word"],
  [/spreadsheetml|ms-excel/, "Excel"],
  [/presentationml|ms-powerpoint/, "PowerPoint"],
  [/^text\//, "文字"],
];

function mimeLabel(mime: string): string {
  return MIME_LABEL.find(([re]) => re.test(mime))?.[1] ?? "檔案";
}

/** 這些 Google 原生類型後端不支援匯入（資料夾已在清單排除；表單／繪圖等在此擋掉勾選） */
function importable(mime: string): boolean {
  if (!mime.startsWith("application/vnd.google-apps.")) return true;
  return /vnd\.google-apps\.(document|spreadsheet|presentation)$/.test(mime);
}

function formatSize(size: number | null): string {
  if (size == null || Number.isNaN(size)) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function GoogleDrivePicker({ tableId, onImported, onClose, onPick, pickLabel, onSaveToKnowledge }: {
  /** 匯入模式：目的資料庫（有 onPick 時可省略） */
  tableId?: string;
  /** 至少一檔匯入成功後呼叫（呼叫端刷新文件清單） */
  onImported?: () => void;
  onClose: () => void;
  /**
   * 選取模式（PR-E3）：提供時不匯入，改把勾選檔案回傳給呼叫端
   *（如「僅本次規劃」——內容由後端在規劃當下拉取，不落庫）。
   */
  onPick?: (files: Array<{ id: string; name: string }>) => void;
  /** 選取模式主按鈕文案（預設「納入本次規劃」） */
  pickLabel?: string;
  /**
   * 選取模式的「轉存進知識庫」（PR-E2 預設建議）：提供時多一顆建議按鈕，
   * 把勾選檔案交給呼叫端轉存（可重複使用、之後規劃自動注入）。
   */
  onSaveToKnowledge?: (files: Array<{ id: string; name: string }>) => void;
}) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  // PR-E3「可選資料夾」：點資料夾列縮小範圍；folderName 供麵包屑顯示
  const [folder, setFolder] = useState<{ id: string; name: string } | null>(null);
  const [extraFiles, setExtraFiles] = useState<PickedFile[]>([]); // 「載入更多」累積的後續頁
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<Array<{ name: string; ok: boolean; message?: string }>>([]);

  const list = trpc.integrations.listDriveFiles.useQuery(
    { query: submittedQuery || undefined, pageToken, folderId: folder?.id },
    // placeholderData：換頁／搜尋時保留上一批結果，畫面不閃空清單（比照 ModelsPage）
    { staleTime: 30_000, placeholderData: (prev) => prev },
  );
  const importFile = trpc.databases.importDriveFile.useMutation();
  const utils = trpc.useUtils();

  const data = list.data;
  const firstPage: PickedFile[] = data?.ok ? data.files : [];
  const files = [...extraFiles, ...firstPage.filter((f) => !extraFiles.some((e) => e.id === f.id))];

  const resetPage = () => {
    setPageToken(undefined);
    setExtraFiles([]);
    setSelected(new Set());
  };
  const runSearch = () => {
    setSubmittedQuery(query.trim());
    resetPage();
  };
  const enterFolder = (f: { id: string; name: string }) => {
    setFolder(f);
    resetPage();
  };

  const loadMore = () => {
    if (!data?.ok || !data.nextPageToken) return;
    setExtraFiles(files);
    setPageToken(data.nextPageToken);
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pickedFiles = () => files.filter((f) => selected.has(f.id)).map((f) => ({ id: f.id, name: f.name }));

  // 序列化逐檔匯入（不並發打爆後端；與批次上傳同哲學），部分失敗不中止、逐檔回報
  const doImport = async () => {
    const picked = files.filter((f) => selected.has(f.id));
    if (picked.length === 0) return;
    // 選取模式：不匯入，把勾選結果交回呼叫端（內容等規劃當下才抓）
    if (onPick) {
      onPick(picked.map((f) => ({ id: f.id, name: f.name })));
      setSelected(new Set());
      onClose();
      return;
    }
    if (!tableId) return;
    setImporting(true);
    setResults([]);
    const out: Array<{ name: string; ok: boolean; message?: string }> = [];
    let okCount = 0;
    for (const f of picked) {
      try {
        await importFile.mutateAsync({ tableId, fileId: f.id });
        out.push({ name: f.name, ok: true });
        okCount += 1;
      } catch (err) {
        out.push({ name: f.name, ok: false, message: err instanceof Error ? err.message : "匯入失敗" });
      }
      setResults([...out]);
    }
    setImporting(false);
    if (okCount > 0) {
      setSelected(new Set());
      onImported?.();
      utils.databases.listFiles.invalidate({ tableId });
    }
  };

  return (
    <div style={{ border: "1px solid var(--border-soft, #eee)", borderRadius: 8, padding: 12, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong><Icon name="HardDrive" size={14} /> 從 Google 雲端選檔</strong>
        {data?.ok && (
          <span className="meta">目前以 {data.email ?? "已連結帳戶"} 瀏覽</span>
        )}
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={onClose} title="收合"><Icon name="X" size={13} /></Button>
      </div>

      {data && !data.ok && data.reason === "not-connected" && (
        <Hint as="p" style={{ marginTop: 8 }}>
          還沒連結 Google 雲端。連結後 AI 與匯入只會讀「你選中的檔案」，不是整顆雲端。
          <Link href="/integrations" className="btn-tonal btn-sm" style={{ marginLeft: 8 }}>前往連結 Google <Icon name="ArrowRight" size={13} /></Link>
        </Hint>
      )}
      {data && !data.ok && data.reason === "error" && (
        <p className="error" role="alert" style={{ marginTop: 8 }}>{data.message}</p>
      )}
      {list.error && <p className="error" role="alert" style={{ marginTop: 8 }}>{list.error.message}</p>}

      {(!data || data.ok) && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <input
              aria-label="搜尋雲端檔名"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
              placeholder="搜尋檔名（留空＝最近修改）"
              style={{ flex: "1 1 240px" }}
              maxLength={200}
            />
            <Button size="sm" onClick={runSearch} disabled={list.isFetching}>
              {list.isFetching ? "搜尋中…" : "搜尋"}
            </Button>
          </div>

          {data?.ok && files.length === 0 && !list.isFetching && (
            <Hint as="p" style={{ marginTop: 8 }}>找不到符合的檔案——換個關鍵字，或確認檔案在這個 Google 帳戶的雲端裡。</Hint>
          )}

          {folder && (
            <p className="meta" style={{ margin: "6px 0 0" }}>
              📁 目前資料夾：{folder.name}
              <Button size="sm" style={{ marginLeft: 8 }} onClick={() => { setFolder(null); resetPage(); }}>
                回全部雲端
              </Button>
            </p>
          )}
          {files.length > 0 && (
            <div style={{ maxHeight: 280, overflowY: "auto", marginTop: 8 }}>
              {files.map((f) => {
                // 資料夾列：點入縮小範圍（PR-E3 可選資料夾），不可勾選匯入
                if (f.isFolder) {
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => enterFolder({ id: f.id, name: f.name })}
                      style={{
                        display: "flex", gap: 8, alignItems: "center", padding: "4px 0", width: "100%",
                        background: "none", border: 0, borderBottom: "1px solid var(--border-soft, #eee)",
                        cursor: "pointer", textAlign: "left",
                      }}
                      title={`進入資料夾「${f.name}」縮小搜尋範圍`}
                    >
                      <span aria-hidden>📁</span>
                      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{f.name}</span>
                      <span className="meta">資料夾——點入</span>
                    </button>
                  );
                }
                const supported = importable(f.mimeType);
                return (
                  <label
                    key={f.id}
                    style={{
                      display: "flex", gap: 8, alignItems: "center", padding: "4px 0",
                      borderBottom: "1px solid var(--border-soft, #eee)",
                      opacity: supported ? 1 : 0.5, cursor: supported ? "pointer" : "not-allowed",
                    }}
                    title={supported ? f.name : "這種 Google 類型（表單／繪圖等）無法匯入為文件"}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(f.id)}
                      disabled={!supported || importing}
                      onChange={() => toggle(f.id)}
                      style={{ width: "auto" }}
                    />
                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{f.name}</span>
                    <Badge>{mimeLabel(f.mimeType)}</Badge>
                    {!f.ownedByMe && (
                      <Badge title="這不是你自己的檔案——由他人共用給此帳戶">
                        共用{f.owner ? `：${f.owner.slice(0, 12)}` : ""}
                      </Badge>
                    )}
                    <span className="meta">{formatSize(f.size)}{f.modifiedTime ? `・${new Date(f.modifiedTime).toLocaleDateString()}` : ""}</span>
                  </label>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            {onPick && onSaveToKnowledge && (
              <Button
                size="sm"
                variant="primary"
                disabled={selected.size === 0 || importing}
                title="轉存後可重複使用——之後的規劃會自動注入（建議）"
                onClick={() => {
                  onSaveToKnowledge(pickedFiles());
                  setSelected(new Set());
                  onClose();
                }}
              >
                轉存進知識庫（{selected.size}）
              </Button>
            )}
            <Button
              size="sm"
              variant={onPick && onSaveToKnowledge ? undefined : "primary"}
              disabled={selected.size === 0 || importing}
              onClick={() => { void doImport(); }}
            >
              {onPick
                ? `${pickLabel ?? "僅本次規劃"}（${selected.size}）`
                : importing ? `匯入中（${results.length}/${selected.size}）…` : `匯入選取（${selected.size}）`}
            </Button>
            {data?.ok && data.nextPageToken && (
              <Button size="sm" onClick={loadMore} disabled={list.isFetching}>載入更多</Button>
            )}
            <span className="meta">
              {onPick
                ? onSaveToKnowledge
                  ? "轉存＝進知識庫可重複使用（建議）；僅本次＝這次規劃看完就丟（每檔最多 8,000 字、不落庫）。未勾選的搜尋結果 AI 看不到。"
                  : "只有勾選的檔案會進本次規劃（每檔最多 8,000 字、不會存進站內）；未勾選的搜尋結果 AI 看不到。"
                : "只會匯入你勾選的檔案；內容進站後才會被 AI 讀到。"}
            </span>
          </div>

          {results.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {results.map((r, i) =>
                r.ok ? (
                  <Meta key={i} as="p" style={{ margin: "2px 0" }}>
                    <Icon name="Check" size={12} /> {r.name}：匯入成功
                  </Meta>
                ) : (
                  <p key={i} className="error" style={{ margin: "2px 0" }} role="alert">
                    {r.name}：{r.message}
                  </p>
                ),
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
