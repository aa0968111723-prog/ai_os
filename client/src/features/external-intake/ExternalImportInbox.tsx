import { useMemo, useState } from "react";
import { trpc } from "../../api";
import { AssetAudio, AssetImg, AssetVideo } from "../../components/MediaFallback";
import { Icon } from "../../components/Icon";
import { Badge, Button, EmptyState, Hint, Meta } from "../../components/ui";

function formatMedia(media: unknown): string {
  if (!media || typeof media !== "object") return "";
  const value = media as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof value.duration === "number") parts.push(`${value.duration.toFixed(1)} 秒`);
  if (typeof value.width === "number" && typeof value.height === "number") parts.push(`${value.width}×${value.height}`);
  if (typeof value.aspectRatio === "number") parts.push(value.aspectRatio > 1.5 ? "橫式" : value.aspectRatio < 0.8 ? "直式" : "方形");
  return parts.join("・");
}

export function ExternalImportInbox({ projectId, compact = false, onChanged }: {
  projectId: string;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const [bulkStatus, setBulkStatus] = useState<{ message: string; error: boolean } | null>(null);
  const utils = trpc.useUtils();
  const inbox = trpc.externalIntake.inbox.useQuery({ projectId, limit: compact ? 20 : 100 });
  const confirm = trpc.externalIntake.confirm.useMutation({
    onSuccess: () => {
      void inbox.refetch();
      void utils.projects.assets.invalidate({ projectId });
      void utils.scenes.listByProject.invalidate({ projectId });
      // Confirmation completes any linked external-generation session. Refresh every
      // scene-scoped query so a finished Flow/Runway job no longer says "waiting".
      void utils.externalIntake.activeSessions.invalidate();
      onChanged?.();
    },
  });
  const pending = useMemo(() => (inbox.data?.items ?? []).filter((item) => item.status !== "ready"), [inbox.data]);
  const confirmAll = async () => {
    setBulkStatus({ message: `正在確認 ${pending.length} 個成果…`, error: false });
    let completed = 0;
    const failures: string[] = [];
    for (const item of pending) {
      try {
        await confirm.mutateAsync({
          assetId: item.asset.id,
          sceneId: item.suggestion?.scene?.id,
          bindingId: item.suggestion?.bindingId ?? undefined,
        });
        completed += 1;
      } catch (caught) {
        failures.push(`${item.asset.title}：${caught instanceof Error ? caught.message : "確認失敗"}`);
      }
    }
    setBulkStatus(failures.length
      ? { message: `${completed} 個已確認、${failures.length} 個失敗——${failures.join("；")}`, error: true }
      : { message: `✓ ${completed} 個成果已確認`, error: false });
  };
  if (inbox.isLoading) return <Meta as="p">正在讀取匯入收件匣…</Meta>;
  if (!pending.length) {
    return compact ? <Meta as="p">目前沒有待整理的成果。</Meta> : (
      <EmptyState icon={<Icon name="Inbox" />} title="匯入收件匣是空的" description="把外部 AI 生成的圖片、影片或聲音拖進來，系統會先安全保存，再幫你找位置。" />
    );
  }
  return (
    <section className="external-inbox" aria-label="匯入收件匣">
      <div className="external-inbox__head">
        <div>
          <strong>匯入收件匣</strong>
          <Meta as="p" style={{ margin: "2px 0 0" }}>
            {pending.length} 個待確認{inbox.data?.counts.unmatched ? `・${inbox.data.counts.unmatched} 個待整理` : ""}
          </Meta>
        </div>
        {pending.length > 1 && (
          <Button size="sm" variant="primary" disabled={confirm.isPending} onClick={() => { void confirmAll(); }}>
            全部確認
          </Button>
        )}
      </div>
      <div className="external-inbox__list">
        {pending.map((item) => {
          const { asset } = item;
          const analyzing = item.intelligence?.status === "pending" || item.intelligence?.status === "processing";
          return (
            <article key={asset.id} className="external-inbox__item">
              <div className="external-inbox__thumb">
                {asset.kind === "image" ? <AssetImg src={asset.url} alt="" />
                  : asset.kind === "video" ? <AssetVideo src={asset.url} controls={false} />
                    : asset.kind === "audio" ? <AssetAudio src={asset.url} controls={false} />
                      : <Icon name="FileText" />}
              </div>
              <div className="external-inbox__body">
                <strong>{asset.title}</strong>
                <Meta as="p" style={{ margin: "2px 0" }}>{formatMedia(item.media) || asset.kind}</Meta>
                {analyzing ? <Badge>正在整理</Badge> : item.intelligence?.category ? <Badge>{item.intelligence.category}</Badge> : null}
                {item.suggestion?.scene ? (
                  <Hint as="p" style={{ margin: "6px 0" }}>
                    可能屬於：第 {item.suggestion.scene.orderIndex} 鏡「{item.suggestion.scene.title}」
                    {item.suggestion.confidence != null ? `（${Math.round(item.suggestion.confidence * 100)}%）` : ""}
                  </Hint>
                ) : (
                  <Hint as="p" style={{ margin: "6px 0" }}>尚未找到可靠位置，素材已安全保存，可先留在待整理。</Hint>
                )}
              </div>
              <div className="external-inbox__actions">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={confirm.isPending}
                  onClick={() => confirm.mutate({
                    assetId: asset.id,
                    sceneId: item.suggestion?.scene?.id,
                    bindingId: item.suggestion?.bindingId ?? undefined,
                  })}
                >
                  {item.suggestion?.scene ? "套用" : "保留在素材庫"}
                </Button>
                <a className="btn-ghost btn-sm" href={asset.url} target="_blank" rel="noreferrer">查看</a>
              </div>
            </article>
          );
        })}
      </div>
      {bulkStatus && <p className={bulkStatus.error ? "error" : "success"} role={bulkStatus.error ? "alert" : "status"}>{bulkStatus.message}</p>}
      {confirm.error && <p className="error" role="alert">{confirm.error.message}</p>}
    </section>
  );
}
