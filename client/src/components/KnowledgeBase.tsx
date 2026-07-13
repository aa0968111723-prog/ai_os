import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { useLocalDraft } from "../useLocalDraft";
import { VersionHistory } from "./VersionHistory";

const KINDS = [
  { id: "transcript", label: "師父開示稿" },
  { id: "testimony", label: "見證故事" },
  { id: "script", label: "腳本" },
  { id: "note", label: "其他筆記" },
] as const;
const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.id, k.label]));

type KnowledgeListItem = {
  id: string;
  kind: string;
  title: string;
  chars: number;
  excerpt: string;
};

/**
 * 專案知識庫（願景核心「真的懂我們素材」）：
 * 貼上開示稿／見證稿／腳本 → AI 導演發想時自動讀取，夥伴不用每次重講背景。
 */
export function KnowledgeBase({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const list = trpc.knowledge.list.useQuery({ projectId });
  // 新增表單的標題／內容改用本地草稿：邊打邊存 localStorage，重整／當機也不掉逐字稿。
  const [title, setTitle, clearTitleDraft] = useLocalDraft(`knowledge-new-title-${projectId}`, "");
  const [content, setContent, clearContentDraft] = useLocalDraft(`knowledge-new-content-${projectId}`, "");
  const add = trpc.knowledge.add.useMutation({
    onSuccess: () => {
      utils.knowledge.list.invalidate({ projectId });
      // 成功加入後清掉草稿（順帶把畫面值還原成空），避免下一次開表單又冒出舊內容。
      clearTitleDraft();
      clearContentDraft();
      setOpen(false);
    },
  });
  const remove = trpc.knowledge.remove.useMutation({ onSuccess: () => utils.knowledge.list.invalidate({ projectId }) });

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("transcript");

  const totalChars = (list.data ?? []).reduce((s, r) => s + r.chars, 0);

  return (
    <section className="card" data-fb="專案知識庫">
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
            <KnowledgeRow key={k.id} k={k} projectId={projectId} remove={remove} />
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
          <p className="hint" style={{ marginTop: 4 }}>（草稿自動保留，重整不會不見）</p>
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

/**
 * 單筆知識：檢視時顯示摘要，「編輯」就地展開改標題／內容（沿用 App 的行內編輯手感：
 * 標題 Enter 送出、Esc 取消；內容用「儲存」鈕）。全文只在進入編輯時才透過 knowledge.get 拉，
 * 省流量。刪除鈕維持原文字與行為不動。
 */
function KnowledgeRow({
  k,
  projectId,
  remove,
}: {
  k: KnowledgeListItem;
  projectId: string;
  remove: ReturnType<typeof trpc.knowledge.remove.useMutation>;
}) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  // 全文只在編輯時才抓（列表 API 只回摘要）。
  const full = trpc.knowledge.get.useQuery({ id: k.id }, { enabled: editing });
  const update = trpc.knowledge.update.useMutation({
    onSuccess: () => {
      utils.knowledge.list.invalidate({ projectId });
      setEditing(false);
    },
  });

  const [editTitle, setEditTitle] = useState(k.title);
  const [editContent, setEditContent] = useState("");
  // 全文抓回來後填入編輯框（只填一次，避免覆蓋使用者正在改的字）。
  const seededRef = useRef(false);
  useEffect(() => {
    if (editing && full.data && !seededRef.current) {
      seededRef.current = true;
      setEditTitle(full.data.title);
      setEditContent(full.data.content);
    }
  }, [editing, full.data]);

  const openEdit = () => {
    seededRef.current = false;
    setEditTitle(k.title);
    setEditContent("");
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    seededRef.current = false;
  };
  const save = () => {
    const t = editTitle.trim();
    if (!t || !editContent.trim() || !seededRef.current) return;
    update.mutate({ id: k.id, title: t, content: editContent });
  };

  if (editing) {
    return (
      <div className="gen-row" style={{ gridTemplateColumns: "auto 1fr", alignItems: "start" }}>
        <span className="chip">{KIND_LABEL[k.kind] ?? k.kind}</span>
        <div style={{ minWidth: 0 }}>
          <input
            value={editTitle}
            disabled={update.isPending}
            aria-label="編輯知識標題"
            placeholder="標題"
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
            style={{ fontSize: 14, padding: "5px 8px" }}
          />
          <textarea
            value={full.isLoading && !seededRef.current ? "" : editContent}
            disabled={update.isPending || (full.isLoading && !seededRef.current)}
            aria-label="編輯知識內容"
            placeholder={full.isLoading && !seededRef.current ? "載入全文中…" : "貼上全文…"}
            rows={6}
            onChange={(e) => setEditContent(e.target.value)}
            style={{ marginTop: 6, fontSize: 13, padding: "5px 8px" }}
          />
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              className="primary"
              style={{ padding: "4px 14px", fontSize: 12 }}
              disabled={update.isPending || !editTitle.trim() || !editContent.trim() || !seededRef.current}
              onClick={save}
            >
              {update.isPending ? "儲存中…" : "儲存"}
            </button>
            <button style={{ padding: "4px 14px", fontSize: 12 }} disabled={update.isPending} onClick={cancelEdit}>
              取消
            </button>
          </div>
          {(update.error || full.error) && (
            <p className="error">{update.error?.message ?? full.error?.message}</p>
          )}
          {/* 長文版本歷史（#29）：編輯這筆時可展開檢視／還原歷次「更新前」的舊版全文 */}
          <VersionHistory knowledgeId={k.id} projectId={projectId} />
        </div>
      </div>
    );
  }

  return (
    <div className="gen-row" style={{ gridTemplateColumns: "auto 1fr auto", alignItems: "center" }}>
      <span className="chip">{KIND_LABEL[k.kind] ?? k.kind}</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{k.title}</div>
        <div className="meta" style={{ fontSize: 12 }}>{k.excerpt}{k.chars > 120 ? "…" : ""}（{k.chars.toLocaleString()} 字）</div>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={{ padding: "3px 12px", fontSize: 12 }} onClick={openEdit}>
          編輯
        </button>
        <button
          style={{ padding: "3px 12px", fontSize: 12, color: "var(--danger)" }}
          disabled={remove.isPending}
          onClick={() => window.confirm(`刪除知識「${k.title}」？`) && remove.mutate({ id: k.id })}
        >
          刪除
        </button>
      </div>
    </div>
  );
}
