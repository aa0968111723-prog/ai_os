import { useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";
import { Button, Chip, Hint, Meta } from "./ui";

/**
 * 筆記／知識庫的附件面板：上傳、預覽、下載、刪除。
 *
 * 為什麼需要它：會議紀錄真正的證據常常是白板照片、簽到表掃描檔、對方寄來的講義 PDF；
 * 知識庫的開示稿本身也多半就是一份 PDF/Word。過去只能把檔案丟去素材庫或私訊，
 * 內容與出處就此分家，回頭找「那場會的照片」得靠記憶。
 *
 * 上傳走 REST（multipart 不經 tRPC），清單／刪除走 tRPC——與資料庫文件同一條線。
 * 文件類會在後端抽出純文字；知識庫附件的文字會跟著注入 AI 導演，所以這裡會顯示
 * 「AI 讀得到 N 字」，讓使用者一眼看出這份 PDF 到底進不進得了 AI 的腦袋。
 */

/** 一次最多選幾檔（逐檔序列上傳，不並發打爆後端） */
const BATCH_MAX_FILES = 10;

export type AttachmentRefKind = "note" | "knowledge";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const MEDIA_ICON = {
  image: "Image",
  video: "Film",
  audio: "Music",
  doc: "FileText",
} as const;

export function AttachmentPanel({
  kind,
  refId,
  readOnly = false,
  /** 收合狀態下的精簡樣式（清單列用）；預設為完整面板 */
  compact = false,
  /** 附件增刪後回呼：讓母體清單重抓「📎 N」計數 */
  onChanged,
}: {
  kind: AttachmentRefKind;
  refId: string;
  readOnly?: boolean;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const utils = trpc.useUtils();
  const list = trpc.attachments.list.useQuery({ kind, refId });
  const remove = trpc.attachments.remove.useMutation({
    onSuccess: () => {
      utils.attachments.list.invalidate({ kind, refId });
      onChanged?.();
    },
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadingRef = useRef(false); // 防重入：state 在 async 閉包裡會過期
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * 逐檔 POST /api/attachments/upload。一檔失敗不中斷其餘檔案——
   * 選了五張照片卻因為第二張格式不支援就整批消失，是最讓人火大的失敗方式。
   */
  const upload = async (fileList: FileList | null) => {
    if (uploadingRef.current || !fileList || fileList.length === 0) return;
    uploadingRef.current = true;
    setError(null);
    try {
      const files = Array.from(fileList).slice(0, BATCH_MAX_FILES);
      const skipped = fileList.length - files.length;
      const failures: string[] = [];
      let done = 0;
      for (const file of files) {
        done += 1;
        setUploading({ done, total: files.length });
        const form = new FormData();
        form.append("file", file);
        form.append("kind", kind);
        form.append("refId", refId);
        form.append("name", file.name);
        try {
          const res = await fetch("/api/attachments/upload", { method: "POST", body: form, credentials: "same-origin" });
          const json = await res.json().catch(() => ({}) as { error?: string });
          if (!res.ok) failures.push(`${file.name}：${json.error ?? `上傳失敗（${res.status}）`}`);
        } catch {
          failures.push(`${file.name}：連線中斷`);
        }
      }
      const notes: string[] = [];
      if (skipped > 0) notes.push(`一次最多 ${BATCH_MAX_FILES} 檔，其餘 ${skipped} 檔請分批`);
      if (failures.length > 0) notes.push(...failures);
      setError(notes.length > 0 ? notes.join("；") : null);
      await utils.attachments.list.invalidate({ kind, refId });
      onChanged?.();
    } finally {
      uploadingRef.current = false;
      setUploading(null);
    }
  };

  const items = list.data ?? [];

  return (
    <div style={{ marginTop: compact ? 6 : 10 }}>
      {!readOnly && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button
            size="sm"
            disabled={!!uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="Paperclip" size={13} />加附件
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              void upload(e.currentTarget.files);
              e.currentTarget.value = ""; // 允許再選同一個檔
            }}
          />
          {uploading && (
            <Meta as="span" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="Loader" size={12} className="spin" />上傳中 {uploading.done}/{uploading.total}…
            </Meta>
          )}
          {!compact && !uploading && (
            <Hint>圖片、PDF、Word、Excel、影音都收得下。PDF／Word 會自動抽出文字{kind === "knowledge" ? "，AI 導演讀得到" : ""}。</Hint>
          )}
        </div>
      )}

      {error && <p className="error" role="alert" style={{ marginTop: 6 }}>{error}</p>}
      {list.error && <p className="error" style={{ marginTop: 6 }}>{list.error.message}</p>}
      {remove.error && <p className="error" style={{ marginTop: 6 }}>{remove.error.message}</p>}

      {items.length > 0 && (
        <ul className="attachment-list" aria-label="附件清單">
          {items.map((a) => (
            <li key={a.id} className="attachment-item">
              <a href={a.url} target="_blank" rel="noreferrer" className="attachment-link" title={`${a.name}（${formatBytes(a.sizeBytes)}）`}>
                {a.media === "image" ? (
                  // 縮圖直接指向檔案服務（同源、帶 cookie）；圖片走 inline，不受 Content-Disposition 影響
                  <img src={a.url} alt={a.name} className="attachment-thumb" loading="lazy" />
                ) : (
                  <span className="attachment-thumb attachment-thumb--file">
                    <Icon name={MEDIA_ICON[a.media]} size={18} />
                  </span>
                )}
                <span className="attachment-name">{a.name}</span>
              </a>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Meta as="span">{formatBytes(a.sizeBytes)}</Meta>
                {a.readableChars > 0 && (
                  <Chip title={kind === "knowledge" ? "這份檔案的文字會注入 AI 導演" : "已抽出純文字，AI 讀得到"}>
                    <Icon name="Sparkles" size={10} style={{ verticalAlign: "-1px" }} /> {a.readableChars.toLocaleString()} 字
                  </Chip>
                )}
                {!readOnly && (
                  <ConfirmButton
                    onConfirm={() => remove.mutate({ id: a.id })}
                    message={`刪除附件「${a.name}」？原檔會一起刪掉，無法復原。`}
                    triggerClassName="btn-sm"
                    triggerStyle={{ color: "var(--danger-ink)" }}
                    disabled={remove.isPending}
                  >
                    刪除
                  </ConfirmButton>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!list.isLoading && items.length === 0 && !readOnly && !compact && (
        <Meta as="p" style={{ margin: "6px 0 0" }}>還沒有附件。</Meta>
      )}
    </div>
  );
}
