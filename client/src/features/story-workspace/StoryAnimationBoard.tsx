import { useMemo, useState } from "react";
import { trpc } from "../../api";
import { Button, Card, Chip, Hint, Meta } from "../../components/ui";

const LIFECYCLE_LABEL: Record<string, string> = {
  storyboard: "分鏡",
  needs_keyframe: "待關鍵影格",
  keyframe_review: "關鍵影格待確認",
  animation_generation: "待產生動畫",
  animation_review: "動畫待確認",
  audio: "待聲音",
  continuity_review: "前後連貫待確認",
  complete: "完成",
};

const DIMENSION_LABEL: Record<string, string> = {
  semantic: "劇情",
  identity: "人物",
  look: "造型",
  scene: "場景",
  prop: "素材",
  style: "畫風",
  temporal: "前後連貫",
  physics: "動作",
};

function MediaPreview({
  media,
  label,
}: {
  media: { kind?: string; url: string } | null;
  label: string;
}) {
  return (
    <figure className="animation-board__preview">
      <figcaption>{label}</figcaption>
      {media ? (
        media.kind === "video"
          ? <video src={media.url} controls preload="metadata" aria-label={label} />
          : <img src={media.url} alt={label} loading="lazy" />
      ) : <div className="animation-board__placeholder">尚無畫面</div>}
    </figure>
  );
}

export function StoryAnimationBoard({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const board = trpc.creativeContext.animationBoard.useQuery({ projectId }, {
    refetchInterval: 30_000,
  });
  const [openShotId, setOpenShotId] = useState<string | null>(null);
  const [repairShotId, setRepairShotId] = useState<string | null>(null);
  const repair = trpc.creativeContext.animationRepairPlan.useQuery({
    projectId,
    shotIds: repairShotId ? [repairShotId] : [],
  }, { enabled: Boolean(repairShotId) });
  const review = trpc.scenes.review.useMutation({
    onSuccess: async () => {
      await utils.creativeContext.animationBoard.invalidate({ projectId });
      await utils.creativeContext.workspace.invalidate({ projectId });
    },
  });

  const rows = board.data?.rows ?? [];
  const openRow = useMemo(() => rows.find((row) => row.shotId === openShotId) ?? null, [rows, openShotId]);
  if (board.isLoading) return <Meta as="p">動畫製作狀態載入中…</Meta>;
  if (board.error || !board.data || rows.length === 0) return null;

  const primary = board.data.primaryAction;
  return (
    <Card as="section" className="animation-board" data-testid="animation-production-board" aria-label="動畫製作">
      <div className="animation-board__header">
        <div>
          <strong>動畫製作</strong>
          <Meta as="p">
            {board.data.summary.total} 鏡 · {board.data.summary.needsReview} 鏡需確認 · {board.data.summary.complete} 鏡完成
          </Meta>
        </div>
        {primary ? (
          <Button
            variant="primary"
            type="button"
            onClick={() => setOpenShotId(primary.shotId)}
          >
            {primary.label}
          </Button>
        ) : null}
      </div>

      {board.data.reviewQueue.length > 0 ? (
        <div className="animation-board__queue" role="list" aria-label="動畫待確認">
          {board.data.reviewQueue.map((row) => (
            <button
              key={row.shotId}
              type="button"
              role="listitem"
              className="animation-board__queue-row"
              aria-expanded={openShotId === row.shotId}
              onClick={() => setOpenShotId(openShotId === row.shotId ? null : row.shotId)}
            >
              <span>{row.orderIndex + 1}. {row.title}</span>
              <Chip>{LIFECYCLE_LABEL[row.lifecycle] ?? row.lifecycle}</Chip>
              <span>{row.findings[0]?.reason ?? (row.stale ? "上游設定已變更" : row.nextAction.label)}</span>
            </button>
          ))}
        </div>
      ) : (
        <Hint as="p">目前沒有需要處理的動畫一致性問題。</Hint>
      )}

      {openRow ? (
        <div className="animation-board__detail" role="region" aria-label={`${openRow.title} 比較`}>
          <div className="animation-board__comparison">
            <MediaPreview media={openRow.previous ? { url: openRow.previous.url } : null} label="上一鏡已採用畫面" />
            <MediaPreview media={openRow.current} label="目前採用" />
            <MediaPreview media={openRow.candidate} label="候選結果" />
            <MediaPreview media={openRow.next ? { url: openRow.next.url } : null} label="下一鏡已採用畫面" />
          </div>
          <div className="animation-board__findings">
            {openRow.findings.length ? openRow.findings.map((finding) => (
              <div key={`${finding.dimension}:${finding.code}`}>
                <Chip data-status={finding.severity}>
                  {DIMENSION_LABEL[finding.dimension] ?? finding.dimension}・{finding.severity === "blocker" ? "需修復" : "需確認"}
                </Chip>
                <Meta as="p">{finding.reason}</Meta>
                {finding.repairHint ? <Hint as="p">{finding.repairHint}</Hint> : null}
                <details>
                  <summary>查看判斷依據</summary>
                  <Meta as="p">Evidence: {finding.evidenceSourceIds.join("、") || "不足"}</Meta>
                </details>
              </div>
            )) : openRow.stale ? (
              <div>
                <Chip data-status="warning">連戲・需確認</Chip>
                <Meta as="p">上游角色、造型、場景或道具設定已變更；目前畫面保留，修復只會產生候選。</Meta>
              </div>
            ) : <Hint as="p">這一鏡沒有已記錄的 output finding。</Hint>}
          </div>
          {canEdit ? (
            <div className="animation-board__actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRepairShotId(openRow.shotId)}
              >
                規劃修復
              </Button>
              {openRow.current && !openRow.findings.some((finding) => finding.severity === "blocker") ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ sceneId: openRow.shotId, status: "approved" })}
                >
                  保留現用版本
                </Button>
              ) : null}
            </div>
          ) : null}
          {repairShotId === openRow.shotId && repair.data ? (
            <div className="animation-board__repair-plan" role="status">
              <strong>修復前確認</strong>
              <Meta as="p">只影響：{repair.data.affectedShotIds.length} 鏡</Meta>
              <Meta as="p">階段：{repair.data.affectedStages.join(" → ") || "無需重生"}</Meta>
              <Meta as="p">預計付費生成：{repair.data.projectedPaidOperations} 次；不會自動執行。</Meta>
              {repair.data.preservedAssetIds.length ? (
                <Hint as="p">會保留已通過的關鍵影格，不重生圖片。</Hint>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

