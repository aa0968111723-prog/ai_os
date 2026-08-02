import { useRef, useState } from "react";
import { trpc } from "../../api";
import { Button, Hint, Meta } from "../../components/ui";

export type GenerationSourceAsset = { id: string; title: string; kind: string };

export function sourceAccept(needs: string): string {
  if (needs === "image") return "image/*";
  if (needs === "video") return "video/*";
  if (needs === "audio") return "audio/*,video/*";
  if (needs === "zip") return ".zip,.safetensors,application/zip,application/x-safetensors";
  return "*/*";
}

export function sourceKindLabel(needs: string): string {
  if (needs === "image") return "圖片";
  if (needs === "video") return "影片";
  if (needs === "audio") return "音訊（轉錄模型也可選影片）";
  if (needs === "zip") return "ZIP 訓練包或 .safetensors LoRA";
  return "檔案";
}

export function fileMatchesSource(file: Pick<File, "name" | "type">, needs: string): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (needs === "image") return type.startsWith("image/");
  if (needs === "video") return type.startsWith("video/");
  if (needs === "audio") return type.startsWith("audio/") || type.startsWith("video/");
  if (needs === "zip") {
    return name.endsWith(".zip") || name.endsWith(".safetensors") || type === "application/zip" || type === "application/x-safetensors";
  }
  return true;
}

/**
 * 所有需要來源檔的 Fal 模型共用：本機上傳、專案素材庫、雲端公開網址三條路。
 * 本機檔先進既有持久化素材庫，再以 assetId 送生成，避免把短效瀏覽器 URL 傳給 Fal。
 */
export function GenerationSourcePicker({
  projectId,
  needs,
  sourceHint,
  options,
  value,
  sourceUrl,
  sourceUrlError,
  onChange,
  onSourceUrlChange,
  onSourceUrlError,
  idPrefix = "gen-source",
}: {
  projectId: string;
  needs: string;
  sourceHint?: string | null;
  options: GenerationSourceAsset[];
  value: GenerationSourceAsset | null;
  sourceUrl: string;
  sourceUrlError: string;
  onChange: (asset: GenerationSourceAsset | null) => void;
  onSourceUrlChange: (url: string) => void;
  onSourceUrlError: (message: string) => void;
  idPrefix?: string;
}) {
  const utils = trpc.useUtils();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const upload = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploadError("");
    if (!fileMatchesSource(file, needs)) {
      setUploadError(`這個模型需要${sourceKindLabel(needs)}，不能使用「${file.name}」`);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        asset?: GenerationSourceAsset;
      };
      if (!res.ok || !data.ok || !data.asset) {
        throw new Error(data.error ?? `上傳失敗（${res.status}）`);
      }
      onChange({ id: data.asset.id, title: data.asset.title, kind: data.asset.kind });
      onSourceUrlChange("");
      onSourceUrlError("");
      await utils.projects.assets.invalidate({ projectId });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上傳失敗——請檢查網路後重試");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div role="group" aria-label="來源檔案" style={{ display: "grid", gap: 8 }}>
      <Hint layer="always" style={{ margin: 0 }}>
        需要：{sourceHint || sourceKindLabel(needs)}。可直接上傳，或從素材庫／雲端網址擇一。
      </Hint>

      <input
        ref={fileInput}
        type="file"
        accept={sourceAccept(needs)}
        aria-label={`從電腦上傳${sourceKindLabel(needs)}`}
        style={{ display: "none" }}
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      <Button type="button" disabled={uploading} onClick={() => fileInput.current?.click()}>
        {uploading ? "上傳中…" : `從電腦上傳${sourceKindLabel(needs)}`}
      </Button>
      {uploadError && <p className="error" role="alert" style={{ margin: 0 }}>{uploadError}</p>}

      <label htmlFor={`${idPrefix}-asset`}>從專案素材庫選</label>
      <select
        id={`${idPrefix}-asset`}
        value={value?.id ?? ""}
        onChange={(e) => {
          const picked = options.find((a) => a.id === e.target.value) ?? null;
          onChange(picked);
          if (picked) {
            onSourceUrlChange("");
            onSourceUrlError("");
          }
        }}
      >
        <option value="">選擇相容素材…</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>[{a.kind}] {a.title}</option>
        ))}
      </select>
      {options.length === 0 && (
        <Meta as="p" style={{ margin: 0 }}>素材庫還沒有相容檔案，可直接從電腦上傳。</Meta>
      )}

      {value ? (
        <Meta as="p" style={{ margin: 0 }}>
          已選：{value.title}（素材庫）
          <Button size="sm" type="button" style={{ marginLeft: 8 }} onClick={() => onChange(null)}>
            改用雲端網址
          </Button>
        </Meta>
      ) : (
        <>
          <label htmlFor={`${idPrefix}-url`}>雲端／公開網址</label>
          <input
            id={`${idPrefix}-url`}
            value={sourceUrl}
            onChange={(e) => {
              onSourceUrlChange(e.target.value);
              onSourceUrlError("");
            }}
            onBlur={(e) => {
              const url = e.target.value.trim();
              if (!url) return onSourceUrlError("");
              try {
                const parsed = new URL(url);
                onSourceUrlError(parsed.protocol === "https:" ? "" : "網址需以 https:// 開頭，且 Fal 必須能公開讀取");
              } catch {
                onSourceUrlError("網址格式不對，需以 https:// 開頭");
              }
            }}
            placeholder="https://…（需允許 Fal 公開讀取）"
          />
          {sourceUrlError && <p className="error" role="alert" style={{ margin: 0 }}>{sourceUrlError}</p>}
        </>
      )}
    </div>
  );
}
