import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { useLocalDraft } from "../useLocalDraft";
import { Icon } from "./Icon";
import { CharCount, ConfirmButton } from "./interactions";
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

/* ── 需求 6.3：批次匯入 txt/md 的限制 ── */
/** 一次最多幾檔（避免一口氣灌爆後端與列表） */
const BATCH_MAX_FILES = 30;
/** 單檔大小上限：知識庫收的是文字稿，300KB 已是十幾萬字，超過多半是選錯檔 */
const BATCH_MAX_FILE_BYTES = 300 * 1024;
/** 單筆內容截斷長度：後端單筆上限 40,000 字，截前 39,000 留緩衝 */
const BATCH_MAX_CHARS = 39_000;
/** 手動貼文的單筆上限（與後端 knowledge.add / notes 的 MAX_CONTENT 一致） */
const MAX_CONTENT_CHARS = 40_000;

/** FileReader 包成 Promise，批次匯入逐檔讀文字用 */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("讀檔失敗"));
    reader.readAsText(file);
  });
}

/**
 * 專案知識庫（願景核心「真的懂我們素材」）：
 * 貼上開示稿／見證稿／腳本 → AI 導演發想時自動讀取，夥伴不用每次重講背景。
 * readOnly（2.3 檢視者）：隱藏新增／編輯／刪除控制——後端本就會擋，前端不再「按了才失敗」。
 */
export function KnowledgeBase({ projectId, readOnly = false }: { projectId: string; readOnly?: boolean }) {
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
  const remove = trpc.knowledge.remove.useMutation({
    onSuccess: () => {
      utils.knowledge.list.invalidate({ projectId });
      // 地毯實測缺陷修復：軟刪後回收桶要立即看得到（否則使用者以為救不回來）——
      // RecycleBin 掛載時已抓過 listDeleted，不失效它就要等重整才出現
      utils.projects.listDeleted.invalidate({ projectId });
    },
  });

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("transcript");

  // ── 需求 6.3：批次匯入 txt/md ──
  // 獨立 mutation 實例：批次成功不清單筆草稿、不關表單（那些是上面單筆 add 的 onSuccess 行為）。
  const batchAdd = trpc.knowledge.add.useMutation();
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const importingRef = useRef(false); // 防重入：state 版本在 async 閉包裡會過期
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);

  /**
   * 批次匯入主流程：過濾副檔名 → 上限 30 檔 → 逐檔 FileReader 讀文字 →
   * 序列化呼叫 knowledge.add（for-of await，不並發打爆後端），
   * 完成後彙總「成功 N・跳過 M（原因）」並重抓列表。
   */
  const importFiles = async (fileList: FileList | null) => {
    if (importingRef.current || !fileList || fileList.length === 0) return;
    importingRef.current = true;
    try {
      const all = Array.from(fileList); // 先同步取走（呼叫端隨後會清空 input.value）
      // 資料夾模式會夾雜圖片等其他檔：只收 .txt / .md
      const textFiles = all.filter((f) => /\.(txt|md)$/i.test(f.name));
      const batch = textFiles.slice(0, BATCH_MAX_FILES);
      const reasons: string[] = [];
      let skippedCount = all.length - batch.length;
      if (all.length > textFiles.length) reasons.push(`非 txt/md ×${all.length - textFiles.length}`);
      if (textFiles.length > BATCH_MAX_FILES) reasons.push(`超過一次 ${BATCH_MAX_FILES} 檔上限，後面 ${textFiles.length - BATCH_MAX_FILES} 檔請分批`);
      if (batch.length === 0) {
        setImportSummary(`成功 0・跳過 ${skippedCount}（${reasons.join("、") || "沒有可匯入的檔案"}）`);
        return;
      }
      setImportSummary(null);
      let ok = 0;
      let truncated = 0;
      let done = 0;
      for (const f of batch) {
        done++;
        setImporting({ done, total: batch.length });
        if (f.size > BATCH_MAX_FILE_BYTES) {
          skippedCount++;
          reasons.push(`${f.name} 超過 300KB`);
          continue;
        }
        try {
          let text = await readFileText(f);
          if (text.length > BATCH_MAX_CHARS) {
            // 後端單筆上限 40,000 字：超長截前 39,000 字（留緩衝），仍算成功但記入摘要
            text = text.slice(0, BATCH_MAX_CHARS);
            truncated++;
          }
          if (!text.trim()) {
            skippedCount++;
            reasons.push(`${f.name} 是空檔`);
            continue;
          }
          const fileTitle = f.name.replace(/\.(txt|md)$/i, "").trim().slice(0, 60) || "未命名檔";
          await batchAdd.mutateAsync({ projectId, kind: "note", title: fileTitle, content: text });
          ok++;
        } catch (err) {
          skippedCount++;
          reasons.push(`${f.name} ${err instanceof Error ? err.message : "匯入失敗"}`);
        }
      }
      setImportSummary(
        `成功 ${ok}・跳過 ${skippedCount}` +
          (reasons.length ? `（${reasons.join("、")}）` : "") +
          (truncated ? `；${truncated} 檔逾長，已截斷收錄前 ${BATCH_MAX_CHARS.toLocaleString()} 字` : ""),
      );
      if (ok > 0) utils.knowledge.list.invalidate({ projectId });
    } finally {
      importingRef.current = false;
      setImporting(null);
    }
  };

  const totalChars = (list.data ?? []).reduce((s, r) => s + r.chars, 0);

  return (
    <section className="card" data-fb="專案知識庫">
      <h2>專案知識庫（AI 讀得懂你的素材）</h2>
      <p className="hint">
        貼上師父開示稿、見證故事、腳本——AI 導演發想時會自動讀取，你不必每次重講背景。
        {list.data && list.data.length > 0 && `目前 ${list.data.length} 份・約 ${totalChars.toLocaleString()} 字。`}
      </p>

      {list.isLoading ? (
        <div style={{ marginTop: 8 }} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="gen-row">
              <div className="skeleton" style={{ height: 14 }} />
            </div>
          ))}
        </div>
      ) : list.data && list.data.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          {list.data.map((k) => (
            <KnowledgeRow key={k.id} k={k} projectId={projectId} remove={remove} readOnly={readOnly} />
          ))}
        </div>
      ) : (
        <div className="empty-state" style={{ marginTop: 8 }}>
          <h3>還沒有素材知識</h3>
          <p>加一份開示稿或腳本，讓 AI 真的懂這支片。</p>
        </div>
      )}

      {readOnly ? (
        <p className="hint" style={{ marginTop: 12 }}>你在此專案是檢視者（唯讀）——知識庫可瀏覽、不能新增或修改。</p>
      ) : open ? (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
          <label htmlFor={`kb-kind-${projectId}`}>類型</label>
          <select id={`kb-kind-${projectId}`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
          <label htmlFor={`kb-title-${projectId}`}>標題</label>
          <input id={`kb-title-${projectId}`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：2024 除夕開示・談放下" />
          <label htmlFor={`kb-content-${projectId}`}>內容（貼上全文）</label>
          <textarea
            id={`kb-content-${projectId}`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            maxLength={MAX_CONTENT_CHARS}
            placeholder="把開示逐字稿 / 見證故事 / 腳本貼進來…"
          />
          {/* 即時字數：長開示逼近 4 萬字是主要情境，不能等按下「加入」才被上限打回 */}
          <CharCount value={content} max={MAX_CONTENT_CHARS} />
          <p className="hint" style={{ marginTop: 4 }}>（草稿自動保留，重整不會不見）</p>
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="primary"
              disabled={!title.trim() || !content.trim() || add.isPending}
              onClick={() => add.mutate({ projectId, kind, title: title.trim(), content })}
            >
              {add.isPending ? "加入中…" : "加入知識庫"}
            </button>
            <button onClick={() => setOpen(false)}>取消</button>
            {/* 沉默 disable 說明：講清楚還差哪個欄位（比照生成鈕 disableReason 模式） */}
            {!add.isPending && (!title.trim() || !content.trim()) && (
              <span className="hint">{!title.trim() ? "先填標題" : "先貼內容"}</span>
            )}
          </div>
          {add.error && <p className="error">{add.error.message}</p>}

          {/* ── 需求 6.3：批次匯入 txt/md（多檔一次進知識庫；kind 一律「其他筆記」，標題取檔名） ── */}
          <div style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 4 }}>
            <label htmlFor={`kb-batch-${projectId}`}>批次匯入 txt/md（可多選，一次最多 {BATCH_MAX_FILES} 檔；標題自動取檔名）</label>
            <input
              id={`kb-batch-${projectId}`}
              type="file"
              multiple
              accept=".txt,.md,text/plain,text/markdown"
              disabled={!!importing}
              onChange={(e) => {
                void importFiles(e.currentTarget.files);
                e.currentTarget.value = ""; // 清空讓同一批檔案可以重選（importFiles 已同步取走清單）
              }}
            />
            <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={!!importing}
                style={{ padding: "4px 14px", fontSize: "var(--fs-12)" }}
                onClick={() => dirInputRef.current?.click()}
              >
                選資料夾匯入
              </button>
              <span className="hint">資料夾模式部分瀏覽器（如 Safari iOS）可能不支援；不行就用上面的多檔選取。</span>
            </div>
            {/*
             * 「選資料夾」變體：webkitdirectory 是非標準屬性（React 型別沒收錄），用 callback ref 補上。
             * Safari iOS 可能不支援資料夾選取，故以上方多檔模式為主、此鈕僅為變體。
             */}
            <input
              ref={(el) => {
                dirInputRef.current = el;
                el?.setAttribute("webkitdirectory", "");
              }}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                void importFiles(e.currentTarget.files);
                e.currentTarget.value = "";
              }}
            />
            {importing && (
              <p className="hint" style={{ margin: "6px 0 0", display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="Loader" size={12} className="spin" />匯入中 {importing.done}/{importing.total}…（逐檔上傳，先別關頁面）
              </p>
            )}
            {!importing && importSummary && <p className="hint" style={{ margin: "6px 0 0" }}>{importSummary}</p>}
          </div>
        </div>
      ) : (
        <button style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setOpen(true)}>
          <Icon name="Plus" size={14} />加入素材知識
        </button>
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
  readOnly = false,
}: {
  k: KnowledgeListItem;
  projectId: string;
  remove: ReturnType<typeof trpc.knowledge.remove.useMutation>;
  readOnly?: boolean;
}) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  // 全文只在編輯時才抓（列表 API 只回摘要）。
  const full = trpc.knowledge.get.useQuery({ id: k.id }, { enabled: editing });
  const update = trpc.knowledge.update.useMutation({
    onSuccess: () => {
      utils.knowledge.list.invalidate({ projectId });
      // 地毯實測缺陷修復（高）：全文快取也要失效——只失效 list 時，「儲存→立刻再編輯」
      // 會從過期的 knowledge.get 快取播種出「儲存前的舊全文」，使用者再按儲存＝靜默倒回舊版
      utils.knowledge.get.invalidate({ id: k.id });
      // 儲存成功才清編輯草稿（閉包引用下方宣告的 clear 函式，執行時已初始化完畢）
      clearEditTitleDraft();
      clearEditContentDraft();
      setEditing(false);
    },
  });

  // 編輯中的長文也走本地草稿（與新增表單同一套）：切頁/重整/手機被回收都不掉字；儲存成功才清
  const [editTitle, setEditTitle, clearEditTitleDraft] = useLocalDraft(`knowledge-edit-title-${k.id}`, "");
  const [editContent, setEditContent, clearEditContentDraft] = useLocalDraft(`knowledge-edit-content-${k.id}`, "");
  // 全文抓回來後填入編輯框（只填一次，且只填「沒有草稿」的欄位——上次改到一半的字比舊值優先）。
  const seededRef = useRef(false);
  useEffect(() => {
    if (editing && full.data && !seededRef.current) {
      seededRef.current = true;
      if (!editTitle) setEditTitle(full.data.title);
      if (!editContent) setEditContent(full.data.content);
    }
    // editTitle/editContent 刻意不入依賴：只在全文剛到時播種一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, full.data]);

  const openEdit = () => {
    seededRef.current = false;
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
            style={{ fontSize: "var(--fs-14)", padding: "5px 8px" }}
          />
          <textarea
            value={full.isLoading && !seededRef.current ? "" : editContent}
            disabled={update.isPending || (full.isLoading && !seededRef.current)}
            aria-label="編輯知識內容"
            placeholder={full.isLoading && !seededRef.current ? "載入全文中…" : "貼上全文…"}
            rows={6}
            maxLength={40_000}
            onChange={(e) => setEditContent(e.target.value)}
            style={{ marginTop: 6, fontSize: "var(--fs-13)", padding: "5px 8px" }}
          />
          {seededRef.current && <CharCount value={editContent} max={40_000} />}
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              className="primary"
              style={{ padding: "4px 14px", fontSize: "var(--fs-12)" }}
              disabled={update.isPending || !editTitle.trim() || !editContent.trim() || !seededRef.current}
              onClick={save}
            >
              {update.isPending ? "儲存中…" : "儲存"}
            </button>
            <button style={{ padding: "4px 14px", fontSize: "var(--fs-12)" }} disabled={update.isPending} onClick={cancelEdit}>
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
        <div style={{ fontSize: "var(--fs-14)", fontWeight: 600 }}>{k.title}</div>
        <div className="meta" style={{ fontSize: "var(--fs-12)" }}>{k.excerpt}{k.chars > 120 ? "…" : ""}（{k.chars.toLocaleString()} 字）</div>
      </div>
      {!readOnly && (
        <div style={{ display: "flex", gap: 4 }}>
          <button style={{ padding: "3px 12px", fontSize: "var(--fs-12)" }} onClick={openEdit}>
            編輯
          </button>
          <ConfirmButton
            onConfirm={() => remove.mutate({ id: k.id })}
            message={`刪除知識「${k.title}」？`}
            triggerStyle={{ padding: "3px 12px", fontSize: "var(--fs-12)", color: "var(--danger-ink)" }}
            disabled={remove.isPending}
          >
            刪除
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}
