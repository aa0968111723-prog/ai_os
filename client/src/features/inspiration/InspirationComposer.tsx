/**
 * 上傳直發到靈感頻道。
 *
 * 為什麼要有這個入口：原本上架只有一條路——先進專案、找到素材庫或提示詞庫、按「發布」。
 * 這對「我手上就有一張圖想分享」的情境太遠，遠到沒人會走。
 *
 * 但**素材一定要落在某個專案**：權限、配額、儲存空間、回收桶全都掛在專案上，
 * 繞過它等於開一條沒有 ACL 的儲存路徑。所以這裡不是新的上傳管線，
 * 而是把既有的 `/api/upload`（連同它的組隔離、檢視者擋寫、MIME 檔頭驗證、
 * 磁碟配額檢查）串成一頁：選專案 → 傳檔 → 立刻發布。
 *
 * 送出前就先跑一次自動分類並顯示結果——作者看得到「系統會把它歸到哪」，
 * 想改就改標題／說明／標籤，不必發布後才發現分錯。
 */
import { useMemo, useRef, useState } from "react";
import { classifyInspiration } from "@shared/inspirationTaxonomy";
import { trpc } from "../../api";
import { Button, Hint, Meta } from "../../components/ui";
import { Icon } from "../../components/Icon";

/** 與 /api/upload 的 kindFromMime 對齊：這裡只用來預覽分類，實際 mediaKind 由伺服器決定 */
function mediaKindFromFile(file: File | null): string {
  const mime = (file?.type ?? "").toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "text";
}

function splitTags(raw: string): string[] {
  return raw
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function InspirationComposer({ onPublished }: { onPublished: () => void }) {
  const projects = trpc.projects.list.useQuery();
  const publish = trpc.community.publishFromSource.useMutation();

  const fileInput = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [promptText, setPromptText] = useState("");
  const [modelId, setModelId] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const tags = useMemo(() => splitTags(tagsRaw), [tagsRaw]);

  // 即時分類預覽：跟伺服器發布時跑的是同一支純函式，所以預覽＝結果
  const preview = useMemo(
    () =>
      classifyInspiration({
        mediaKind: mediaKindFromFile(files[0] ?? null),
        sourceType: "asset",
        title: title || files[0]?.name || "",
        description,
        promptText,
        tags,
        fileName: files[0]?.name ?? null,
      }),
    [files, title, description, promptText, tags],
  );

  const pickFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setFiles(Array.from(list).slice(0, 10));
    setError("");
  };

  const submit = async () => {
    if (files.length === 0) return setError("先選一個檔案");
    if (!projectId) return setError("選一個要存放素材的專案——素材的權限與空間都掛在專案上");

    setBusy(true);
    setError("");
    const failures: string[] = [];
    let published = 0;

    for (const [i, file] of files.entries()) {
      setStep(files.length > 1 ? `上傳中…（${i + 1}/${files.length}）` : "上傳中…");
      try {
        const form = new FormData();
        form.append("projectId", projectId);
        form.append("file", file);
        // 多檔時每個檔案用自己的檔名當標題，單檔才吃輸入框
        if (files.length === 1 && title.trim()) form.append("title", title.trim());
        const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
        const data = (await res.json()) as { ok?: boolean; error?: string; asset?: { id: string } };
        if (!res.ok || !data.ok || !data.asset) {
          failures.push(`${file.name}：${data.error ?? `上傳失敗（${res.status}）`}`);
          continue;
        }

        setStep(files.length > 1 ? `發布中…（${i + 1}/${files.length}）` : "發布中…");
        await publish.mutateAsync({
          sourceType: "asset",
          sourceId: data.asset.id,
          title: files.length === 1 && title.trim() ? title.trim() : undefined,
          description: description.trim() || undefined,
          promptText: promptText.trim() || undefined,
          modelId: modelId.trim() || undefined,
          tags: tags.length > 0 ? tags : undefined,
        });
        published += 1;
      } catch (err) {
        failures.push(`${file.name}：${err instanceof Error ? err.message : "發布失敗"}`);
      }
    }

    setBusy(false);
    setStep("");
    if (failures.length > 0) {
      setError(
        published > 0
          ? `${published} 個已上架、${failures.length} 個失敗——${failures.join("；")}`
          : failures.join("；"),
      );
    }
    if (published > 0) {
      setFiles([]);
      setTitle("");
      setDescription("");
      setPromptText("");
      setModelId("");
      setTagsRaw("");
      if (fileInput.current) fileInput.current.value = "";
      onPublished();
    }
  };

  return (
    <div
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: 16,
        border: "1px solid var(--border)",
        background: "var(--card2, rgba(0,0,0,0.02))",
      }}
      data-fb="靈感頻道上傳"
    >
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pickFiles(e.dataTransfer.files);
        }}
        style={{
          padding: "18px 14px",
          borderRadius: 12,
          border: "1px dashed var(--border)",
          textAlign: "center",
          background: "var(--field, transparent)",
        }}
      >
        <Icon name="Image" size={20} />
        <div style={{ marginTop: 6, fontSize: "var(--fs-13)" }}>
          {files.length > 0
            ? files.map((f) => f.name).join("、")
            : "把圖片／影片／音訊拖進來，或點下面的按鈕選檔"}
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          style={{ display: "none" }}
          onChange={(e) => pickFiles(e.target.files)}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          style={{ marginTop: 8 }}
          onClick={() => fileInput.current?.click()}
        >
          選擇檔案
        </Button>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <label style={{ fontSize: "var(--fs-12)" }}>
          存放專案
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            style={{ width: "100%", marginTop: 4 }}
          >
            <option value="">— 選一個專案 —</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>

        {files.length <= 1 && (
          <label style={{ fontSize: "var(--fs-12)" }}>
            標題（留空用檔名）
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%", marginTop: 4 }} />
          </label>
        )}

        <label style={{ fontSize: "var(--fs-12)" }}>
          用了什麼提示詞（別人「一鍵再用」拿到的就是這段）
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={3}
            style={{ width: "100%", marginTop: 4 }}
          />
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: "var(--fs-12)", flex: "1 1 180px" }}>
            模型（選填）
            <input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="fal-ai/flux/dev"
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: "var(--fs-12)", flex: "1 1 180px" }}>
            標籤（逗號分隔，選填）
            <input
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="夜景, 霓虹"
              style={{ width: "100%", marginTop: 4 }}
            />
          </label>
        </div>

        <label style={{ fontSize: "var(--fs-12)" }}>
          說明／創作心得（選填）
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{ width: "100%", marginTop: 4 }}
          />
        </label>
      </div>

      <div style={{ marginTop: 10 }}>
        <Meta as="div" style={{ marginBottom: 4 }}>
          自動分類預覽（發布後可被別人依這些分類找到）
        </Meta>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {preview.hits.map((hit) => (
            <span
              key={hit.tag}
              title={`${hit.facetLabel}：命中 ${hit.score} 個關鍵詞`}
              style={{
                padding: "3px 9px",
                borderRadius: 999,
                fontSize: "var(--fs-11)",
                border: "1px solid var(--border-soft)",
                background: hit.tag === preview.category ? "var(--gold-soft, #faf0d8)" : "transparent",
              }}
            >
              {hit.facetLabel}·{hit.label}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <p className="error" style={{ marginTop: 10, fontSize: "var(--fs-12)" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <Button type="button" size="sm" variant="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? step || "處理中…" : "上傳並發布"}
        </Button>
        {projects.data && projects.data.length === 0 && <Meta>你還沒有專案——先到今日工作台建立一個。</Meta>}
      </div>

      <Hint style={{ marginTop: 10 }}>
        檔案會存進所選專案的素材庫（權限、空間與回收桶都跟著那個專案），同時在靈感頻道上架。
        隨時可以在「我的發布」下架，素材本身不受影響。
      </Hint>
    </div>
  );
}
