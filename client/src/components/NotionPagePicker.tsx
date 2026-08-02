import { useState } from "react";
import { Meta, Button, Hint } from "./ui";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon } from "../components/Icon";

/**
 * Notion 選頁器（PR-E4）：與 Google 選檔同一心智模型——連接 → 搜尋 → 勾選 → 匯入。
 * 只列 token 權限內（分享給整合）的頁面／資料庫中繼資料；內容等按匯入才走既有 notion import
 *（databases.importUrl 以 id 組回 notion.so 網址，SSRF／大小守衛全沿用；
 * 伺服器端自動分辨頁面走 blocks、資料庫走 databases query）。
 */

export function NotionPagePicker({ tableId, onImported, onClose }: {
  tableId: string;
  onImported: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<Array<{ name: string; ok: boolean; message?: string }>>([]);

  const list = trpc.integrations.listNotionPages.useQuery(
    { query: submittedQuery || undefined },
    { staleTime: 30_000, placeholderData: (prev) => prev },
  );
  const importUrl = trpc.databases.importUrl.useMutation();
  const utils = trpc.useUtils();

  const data = list.data;
  const pages = data?.ok ? data.pages : [];

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 逐頁序列匯入（與 Google 選檔一致）：部分失敗不中止、逐頁回報
  const doImport = async () => {
    const picked = pages.filter((p) => selected.has(p.id));
    if (picked.length === 0) return;
    setImporting(true);
    setResults([]);
    const out: Array<{ name: string; ok: boolean; message?: string }> = [];
    let okCount = 0;
    for (const p of picked) {
      try {
        // 頁面／資料庫 id → notion.so 網址；normalizeImportUrl 解析回同一個 id，走官方 API 抽文字
        await importUrl.mutateAsync({
          tableId,
          url: `https://www.notion.so/${p.id.replace(/-/g, "")}`,
          name: p.title.slice(0, 120),
        });
        out.push({ name: p.title, ok: true });
        okCount += 1;
      } catch (err) {
        out.push({ name: p.title, ok: false, message: err instanceof Error ? err.message : "匯入失敗" });
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
        <strong><Icon name="FileText" size={14} /> 從 Notion 選頁／資料庫</strong>
        {data?.ok && (
          <span className="meta">目前以 {data.workspace ? `「${data.workspace}」workspace` : "已連接的 Notion 整合"} 瀏覽</span>
        )}
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={onClose} title="收合"><Icon name="X" size={13} /></Button>
      </div>

      {data && !data.ok && data.reason === "not-connected" && (
        <Hint as="p" layer="always" style={{ marginTop: 8 }}>
          還沒設定 Notion。設定後只有「分享給整合」的頁面／資料庫會出現在這裡，AI 只讀你選中匯入的內容。
          <Link href="/integrations" className="btn-tonal btn-sm" style={{ marginLeft: 8 }}>前往設定 Notion <Icon name="ArrowRight" size={13} /></Link>
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
              aria-label="搜尋 Notion 頁面"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setSubmittedQuery(query.trim()); setSelected(new Set()); } }}
              placeholder="搜尋頁面／資料庫標題（留空＝最近編輯）"
              style={{ flex: "1 1 240px" }}
              maxLength={200}
            />
            <Button
              size="sm"
              onClick={() => { setSubmittedQuery(query.trim()); setSelected(new Set()); }}
              disabled={list.isFetching}
            >
              {list.isFetching ? "搜尋中…" : "搜尋"}
            </Button>
          </div>

          {data?.ok && pages.length === 0 && !list.isFetching && (
            <Hint as="p" layer="always" style={{ marginTop: 8 }}>
              找不到頁面或資料庫——確認它已「分享給整合」（右上 ⋯ → 連接 → 選你的 integration；
              資料庫要在資料庫本身那一頁操作，不是在單一列的頁面），或換個關鍵字。
            </Hint>
          )}

          {pages.length > 0 && (
            <div style={{ maxHeight: 280, overflowY: "auto", marginTop: 8 }}>
              {pages.map((p) => (
                <label
                  key={p.id}
                  style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--border-soft, #eee)", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    disabled={importing}
                    onChange={() => toggle(p.id)}
                    style={{ width: "auto" }}
                  />
                  <Icon name={p.type === "database" ? "Database" : "FileText"} size={13} />
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>{p.title}</span>
                  {p.type === "database" && <span className="meta">資料庫</span>}
                  <span className="meta">{p.lastEdited ? new Date(p.lastEdited).toLocaleDateString() : ""}</span>
                </label>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <Button
              size="sm"
              variant="primary"
              disabled={selected.size === 0 || importing}
              onClick={() => { void doImport(); }}
            >
              {importing ? `匯入中（${results.length}/${selected.size}）…` : `匯入選取（${selected.size}）`}
            </Button>
            <span className="meta">只會匯入你勾選的頁面／資料庫；資料庫會抓成一張純文字表格，內容進站後才會被 AI 讀到。</span>
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
