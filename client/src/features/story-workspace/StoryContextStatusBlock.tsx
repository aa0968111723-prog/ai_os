/**
 * 專案脈絡狀態的自足消費者（PR-C 瘦身：ProjectPage 不再自己拼 counts）。
 *
 * 查詢 key 與頁面／子元件完全相同 → 共用快取，零額外請求；
 * server 的 workspace projection 是唯一真相，這裡不重算 readiness/consistency。
 */
import { trpc } from "../../api";
import { StoryContextStatus } from "./StoryContextStatus";
import { StoryScorecardRepair } from "./StoryScorecardRepair";
import { canonStatusLine } from "@shared/projectConsistencyGraph";

export function StoryContextStatusBlock({
  projectId,
  showSources = false,
  canEdit = false,
  onRepairShots,
}: {
  projectId: string;
  showSources?: boolean;
  canEdit?: boolean;
  /** closure §12：scorecard 修復 CTA（受影響鏡→重生成→Candidate→明確 Adopt） */
  onRepairShots?: (shotIds: string[]) => void;
}) {
  const storyMeta = trpc.story.get.useQuery({ projectId });
  const characters = trpc.characters.list.useQuery({ projectId });
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId });
  const propCards = trpc.props.list.useQuery({ projectId });
  const knowledge = trpc.knowledge.list.useQuery({ projectId });
  const assets = trpc.projects.assets.useQuery({ projectId });
  const workspace = trpc.creativeContext.workspace.useQuery({ projectId });
  const trainingAvailability = trpc.creativeContext.trainingAvailability.useQuery();

  const pending = Array.isArray(storyMeta.data?.pending) ? storyMeta.data.pending.length : 0;
  const counts = {
    characters: characters.data?.length ?? storyMeta.data?.summary.characters ?? 0,
    looks: storyMeta.data?.summary.looks ?? 0,
    scenes: scenePresets.data?.length ?? storyMeta.data?.summary.locations ?? 0,
    props: propCards.data?.length ?? storyMeta.data?.summary.props ?? 0,
    assets: assets.data?.length ?? 0,
    knowledge: knowledge.data?.length ?? 0,
    pending,
  };
  const applied = Boolean(storyMeta.data?.story?.lastParsedAt)
    && counts.characters + counts.scenes + counts.props > 0;

  return (
    <>
      <StoryContextStatus
        counts={counts}
        applied={applied}
        trainingAvailable={Boolean(trainingAvailability.data?.available)}
        compactStatus={workspace.data?.compactStatus}
        nextAction={workspace.data?.nextAction}
        canonSummary={canonStatusLine(workspace.data?.canonPins ?? [])}
        showSources={showSources}
      />
      {onRepairShots ? (
        <StoryScorecardRepair
          rows={workspace.data?.scorecard ?? []}
          canEdit={canEdit}
          onRepairShots={onRepairShots}
        />
      ) : null}
    </>
  );
}
