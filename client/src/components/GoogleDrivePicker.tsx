import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";

/**
 * Google 雲端選檔器（PR-E1 使用者主路徑）：已連結者不必貼網址——搜尋自己的雲端、
 * 多選檔案、逐檔匯入目前資料庫的文件區。
 * 產品原則：連接 ≠ 授權 AI 讀全雲端——這裡只列中繼資料，內容要按「匯入」才抓；
 * 標題列固定顯示目前連結的 Google 帳戶（帳號透明）。
 */

type PickedFile = { id: string; name: string; mimeType: string; size: number | null; modifiedTime: string | null };

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

export function GoogleDrivePicker({ tableId, onImported, onClose }: {
  tableId: string;
  /** 至少一檔匯入成功後呼叫（呼叫端刷新文件清單） */
  onImported: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  const [extraFiles, setExtraFiles] = useState<PickedFile[]>([]); // 「載入更多」累積的後續頁
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<Array<{ name: string; ok: boolean; message?: string }>>([]);

  const list = trpc.integrations.listDriveFiles.useQuery(
    { query: submittedQuery || undefined, pageToken },
    // placeholderData：換頁／搜尋時保留上一批結果，畫面不閃空清單（比照 ModelsPage）
    { staleTime: 30_000, placeholderData: (prev) => prev },
  );
  const importFile = trpc.databases.importDriveFile.useMutation();
  const utils = trpc.useUtils();

  const data = list.data;
  const firstPage: PickedFile[] = data?.ok ? data.files : [];
  const files = [...extraFiles, ...firstPage.filter((f) => !extraFiles.some((e) => e.id === f.id))];

  const runSearch = () => {
    setSubmittedQuery(query.trim());
    setPageToken(undefined);
    setExtraFiles([]);
    setSelected(new Set());
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

  // 序列化逐檔匯入（不並發打爆後端；與批次上傳同哲學），部分失敗不中止、逐檔回報
  const doImport = async () => {
    const picked = files.filter((f) => selected.has(f.id));
    if (picked.length === 0) return;
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
      onImported();
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
        <button className="btn-sm" onClick={onClose} title="收合"><Icon name="X" size={13} /></button>
      </div>

      {data && !data.ok && data.reason === "not-connected" && (
        <p className="hint" style={{ marginTop: 8 }}>
          還沒連結 Google 雲端。連結後 AI 與匯入只會讀「你選中的檔案」，不是整顆雲端。
          <Link href="/integrations" className="btn-tonal btn-sm" style={{ marginLeft: 8 }}>前往連結 Google <Icon name="ArrowRight" size={13} /></Link>
        </p>
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
            <button className="btn-sm" onClick={runSearch} disabled={list.isFetching}>
              {list.isFetching ? "搜尋中…" : "搜尋"}
            </button>
          </div>

          {data?.ok && files.length === 0 && !list.isFetching && (
            <p className="hint" style={{ marginTop: 8 }}>找不到符合的檔案——換個關鍵字，或確認檔案在這個 Google 帳戶的雲端裡。</p>
          )}

          {files.length > 0 && (
            <div style={{ maxHeight: 280, overflowY: "auto", marginTop: 8 }}>
              {files.map((f) => {
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
                    <span className="badge">{mimeLabel(f.mimeType)}</span>
                    <span className="meta">{formatSize(f.size)}{f.modifiedTime ? `・${new Date(f.modifiedTime).toLocaleDateString()}` : ""}</span>
                  </label>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <button
              className="btn-sm primary"
              disabled={selected.size === 0 || importing}
              onClick={() => { void doImport(); }}
            >
              {importing ? `匯入中（${results.length}/${selected.size}）…` : `匯入選取（${selected.size}）`}
            </button>
            {data?.ok && data.nextPageToken && (
              <button className="btn-sm" onClick={loadMore} disabled={list.isFetching}>載入更多</button>
            )}
            <span className="meta">只會匯入你勾選的檔案；內容進站後才會被 AI 讀到。</span>
          </div>

          {results.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {results.map((r, i) => (
                <p key={i} className={r.ok ? "hint" : "error"} style={{ margin: "2px 0" }} role={r.ok ? undefined : "alert"}>
                  {r.ok ? <><Icon name="Check" size={12} /> {r.name}：匯入成功</> : <>{r.name}：{r.message}</>}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
