import { useRef, useState } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { AssetImg } from "./MediaFallback";
import { Hint, Meta } from "./ui";

export interface ReferenceImage {
  id: string;
  url: string;
  title: string;
}

/**
 * 參考圖選擇器（角色定裝卡／場景設定卡共用）：
 * 兩條路綁一張圖片素材——「上傳參考圖」直接進素材庫再綁定；「從素材庫選」列出專案既有圖片點選。
 * 只是選擇器：實際存到哪張卡由呼叫端的 onChange 決定（建卡時暫存、既有卡直接打 update）。
 */
export function ReferenceImagePicker({
  projectId,
  value,
  onChange,
  disabled,
}: {
  projectId: string;
  value: ReferenceImage | null;
  onChange: (next: ReferenceImage | null) => void;
  disabled?: boolean;
}) {
  const utils = trpc.useUtils();
  const [libraryOpen, setLibraryOpen] = useState(false);
  // 素材庫清單只在打開挑選面板時才抓（enabled），平常不多打一次 API
  const assets = trpc.projects.assets.useQuery({ projectId }, { enabled: libraryOpen });
  const images = (assets.data ?? []).filter((a) => a.kind === "image" && a.url);

  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  /** 上傳走既有 /api/upload（multipart）：檔案入素材庫拿到 asset，再回給呼叫端綁定 */
  const doUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || uploading) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
      const data = (await res.json()) as { ok?: boolean; error?: string; asset?: { id: string; url: string; title: string } };
      if (!res.ok || !data.ok || !data.asset) {
        setError(data.error ?? `上傳失敗（${res.status}）`);
      } else {
        utils.projects.assets.invalidate({ projectId }); // 上傳同時入素材庫——列表跟著出現
        onChange({ id: data.asset.id, url: data.asset.url, title: data.asset.title });
        setLibraryOpen(false);
      }
    } catch {
      setError("上傳失敗——請檢查網路後重試");
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const smallBtn = { padding: "2px 10px", fontSize: 11 } as const;

  return (
    <div data-fb="參考圖選擇器" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {value && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AssetImg
            src={value.url}
            alt={`參考圖：${value.title}`}
            style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border-soft)" }}
            fallbackLabel="參考圖遺失"
            fallbackHeight={56}
            fallbackIconSize={14}
            fallbackStyle={{ width: 56, flex: "0 0 56px" }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <Meta as="div" style={{ fontSize: 11, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <Icon name="Image" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
              {value.title}
            </Meta>
          </div>
          <button type="button" style={smallBtn} disabled={disabled} onClick={() => onChange(null)}>
            <Icon name="X" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />移除
          </button>
        </div>
      )}
      {/* 已綁定時按鈕照樣顯示：直接上傳或改選即「換綁」，不必先移除再重選 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <button type="button" style={smallBtn} disabled={disabled || uploading} onClick={() => fileInput.current?.click()}>
          {uploading
            ? <><Icon name="Loader" className="spin" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />上傳中…</>
            : <><Icon name="Plus" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />{value ? "上傳換圖" : "上傳參考圖"}</>}
        </button>
        <button
          type="button"
          style={smallBtn}
          disabled={disabled}
          aria-expanded={libraryOpen}
          onClick={() => setLibraryOpen((v) => !v)}
        >
          <Icon name="Image" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          {libraryOpen ? "收起素材庫" : "從素材庫選"}
        </button>
      </div>
      <input ref={fileInput} type="file" hidden accept="image/*" onChange={(e) => doUpload(e.target.files)} />

      {libraryOpen && (
        assets.isLoading ? (
          <Meta as="p" style={{ margin: 0, fontSize: 11 }}>
            <Icon name="Loader" className="spin" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />載入素材庫…
          </Meta>
        ) : images.length === 0 ? (
          // 空狀態＋下一步：收掉會讓人卡在空面板前不知道能做什麼，所以兩種模式都顯示
          <Hint as="p" style={{ margin: 0, fontSize: 11 }}>素材庫還沒有圖片——用上面的「上傳參考圖」直接傳一張。</Hint>
        ) : (
          <div
            role="listbox"
            aria-label="從素材庫選參考圖"
            style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 6,
              maxHeight: 180, overflowY: "auto", padding: 6,
              border: "1px solid var(--border-soft)", borderRadius: 8,
            }}
          >
            {images.map((a) => (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={a.id === value?.id}
                title={a.title}
                disabled={disabled}
                onClick={() => { onChange({ id: a.id, url: a.url!, title: a.title }); setLibraryOpen(false); }}
                style={{ padding: 0, border: "1px solid var(--border-soft)", borderRadius: 8, overflow: "hidden", cursor: "pointer", background: "none", lineHeight: 0 }}
              >
                <AssetImg src={a.url!} alt={a.title} loading="lazy" style={{ width: "100%", height: 64, objectFit: "cover", display: "block" }} fallbackLabel="圖檔遺失" fallbackHeight={64} fallbackIconSize={14} />
              </button>
            ))}
          </div>
        )
      )}
      {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
