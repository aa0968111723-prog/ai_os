import { useState } from "react";
import { trpc } from "../api";

const KINDS = [
  { id: "transcript", label: "師父開示稿" },
  { id: "testimony", label: "見證故事" },
  { id: "script", label: "腳本" },
  { id: "note", label: "其他筆記" },
] as const;
const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.id, k.label]));

/**
 * 專案知識庫（願景核心「真的懂我們素材」）：
 * 貼上開示稿／見證稿／腳本 → AI 導演發想時自動讀取，夥伴不用每次重講背景。
 */
export function KnowledgeBase({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.knowledge.list.useQuery({ projectId });
  const add = trpc.knowledge.add.useMutation({
    onSuccess: () => {
      utils.knowledge.list.invalidate({ projectId });
      setTitle(""); setContent(""); setOpen(false);
    },
  });
  const remove = trpc.knowledge.remove.useMutation({ onSuccess: () => utils.knowledge.list.invalidate({ projectId }) });

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("transcript");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const totalChars = (list.data ?? []).reduce((s, r) => s + r.chars, 0);

  return (
    <section className="card">
      <h2>專案知識庫（AI 讀得懂你的素材）</h2>
      <p className="hint">
        貼上師父開示稿、見證故事、腳本——AI 導演發想時會自動讀取，你不必每次重講背景。
        {list.data && list.data.length > 0 && `目前 ${list.data.length} 份・約 ${totalChars.toLocaleString()} 字。`}
      </p>

      {list.isLoading ? (
        <p className="hint">載入中…</p>
      ) : list.data && list.data.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          {list.data.map((k) => (
            <div key={k.id} className="gen-row" style={{ gridTemplateColumns: "auto 1fr auto", alignItems: "center" }}>
              <span className="chip">{KIND_LABEL[k.kind] ?? k.kind}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{k.title}</div>
                <div className="meta" style={{ fontSize: 12 }}>{k.excerpt}{k.chars > 120 ? "…" : ""}（{k.chars.toLocaleString()} 字）</div>
              </div>
              <button
                style={{ padding: "3px 12px", fontSize: 12, color: "var(--danger)" }}
                disabled={remove.isPending}
                onClick={() => window.confirm(`刪除知識「${k.title}」？`) && remove.mutate({ id: k.id })}
              >
                刪除
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint" style={{ marginTop: 8 }}>還沒有素材知識——加一份開示稿或腳本，讓 AI 真的懂這支片。</p>
      )}

      {open ? (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
          <label>類型</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
          <label>標題</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：2024 除夕開示・談放下" />
          <label>內容（貼上全文）</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="把開示逐字稿 / 見證故事 / 腳本貼進來…"
          />
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button
              className="primary"
              disabled={!title.trim() || !content.trim() || add.isPending}
              onClick={() => add.mutate({ projectId, kind, title: title.trim(), content })}
            >
              {add.isPending ? "加入中…" : "加入知識庫"}
            </button>
            <button onClick={() => setOpen(false)}>取消</button>
          </div>
          {add.error && <p className="error">{add.error.message}</p>}
        </div>
      ) : (
        <button style={{ marginTop: 12 }} onClick={() => setOpen(true)}>＋ 加入素材知識</button>
      )}
      {remove.error && <p className="error">{remove.error.message}</p>}
    </section>
  );
}
