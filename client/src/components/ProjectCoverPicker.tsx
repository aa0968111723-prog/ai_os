import { useEffect, useRef } from "react";
import { trpc } from "../api";
import { Icon } from "./Icon";
import { AssetImg } from "./MediaFallback";
import { ReferenceImagePicker } from "./ReferenceImagePicker";
import { Button, Card, Hint, Meta } from "./ui";

/**
 * 專案封面圖對話框（作業台卡片的「換圖」）：
 * 沿用 ReferenceImagePicker 的兩條路——上傳一張新圖（直接進本專案素材庫）或從素材庫既有圖片挑，
 * 選好即刻寫回 projects.setCover；「移除」則清成 null，卡片退回原本的首字色塊封面。
 *
 * 之所以不做成卡片內嵌面板：卡片本身是連結，內嵌選擇器會讓每次點擊都在「進專案」與「改封面」
 * 之間爭搶；拉成對話框後兩者互不干擾，手機上也有完整寬度可以看縮圖。
 */
export function ProjectCoverPicker({
  projectId,
  projectTitle,
  coverAssetId,
  coverUrl,
  onClose,
}: {
  projectId: string;
  projectTitle: string;
  coverAssetId: string | null;
  coverUrl: string | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const panelRef = useRef<HTMLDivElement>(null);
  const setCover = trpc.projects.setCover.useMutation({
    onSuccess: () => {
      // 作業台卡格與專案頁 header 都吃這兩個查詢——換完圖兩邊同時跟上
      utils.projects.list.invalidate();
      utils.projects.get.invalidate({ id: projectId });
    },
  });

  // Esc 關閉＋開啟時把焦點帶進對話框（與 SceneStudio 同一組鍵盤行為）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Card
        className="modal-card"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`更換「${projectTitle}」的封面圖`}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: "var(--fs-18)" }}>更換封面圖</h2>
            <Meta as="div" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {projectTitle}
            </Meta>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="關閉更換封面圖">
            <Icon name="X" size={18} />
          </Button>
        </div>

        {/* 目前封面：直接把卡片上會看到的比例（16:10）擺出來，選之前就知道會被裁成什麼樣 */}
        <div style={{ marginTop: "var(--sp-12)" }}>
          {coverUrl ? (
            <AssetImg
              src={coverUrl}
              alt={`${projectTitle} 目前的封面圖`}
              style={{
                width: "100%",
                aspectRatio: "16 / 10",
                objectFit: "cover",
                borderRadius: 10,
                border: "1px solid var(--border-soft)",
                display: "block",
              }}
              fallbackLabel="封面圖遺失——可重新選一張"
              fallbackHeight={140}
            />
          ) : (
            <Hint as="p" style={{ margin: 0 }}>
              目前用的是自動配色封面（專案名稱首字）——選一張圖就會換掉它。
            </Hint>
          )}
        </div>

        <div style={{ marginTop: "var(--sp-12)" }}>
          <ReferenceImagePicker
            projectId={projectId}
            value={coverAssetId && coverUrl ? { id: coverAssetId, url: coverUrl, title: "專案封面圖" } : null}
            onChange={(next) => setCover.mutate({ id: projectId, assetId: next?.id ?? null })}
            disabled={setCover.isPending}
          />
        </div>

        {setCover.isPending && (
          <Meta as="p" role="status" style={{ marginTop: 8 }}>
            <Icon name="Loader" className="spin" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
            儲存中…
          </Meta>
        )}
        {setCover.error && (
          <p className="error" role="alert" style={{ marginTop: 8 }}>
            換封面失敗：{setCover.error.message}
          </p>
        )}

        <div style={{ marginTop: "var(--sp-16)", display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={onClose}>完成</Button>
        </div>
      </Card>
    </div>
  );
}
