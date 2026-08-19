/**
 * 專案脈絡狀態的自足消費者（PR-C 瘦身：ProjectPage 不再自己拼 counts）。
 *
 * 查詢 key 與頁面／子元件完全相同 → 共用快取，零額外請求；
 * server 的 workspace projection 是唯一真相，這裡不重算 readiness/consistency。
 */
import { useState } from "react";
import { trpc } from "../../api";
import { StoryContextStatus } from "./StoryContextStatus";
import { StoryScorecardRepair } from "./StoryScorecardRepair";
import { StoryAnimationBoard } from "./StoryAnimationBoard";
import { canonStatusLine, type ScorecardRow } from "@shared/projectConsistencyGraph";
import { parseWorldviewSafe } from "@shared/parseWorldviewSafe";
import { revealStoryInlineSection } from "./storyInlineNav";
import { revealProjectContext } from "../project-nav/projectContextNav";
import { focusAndReveal } from "../../lib/scrollIntoViewForChrome";
import { Hint } from "../../components/ui";
import { useCharacterSheetGenerate } from "../../components/useCharacterSheetGenerate";
import { characterHasLiveSheet } from "@shared/studioReferenceImage";

function uniqueJoined(values: Array<string | null | undefined>): string {
  return [...new Set(values.map((row) => row?.trim()).filter((row): row is string => Boolean(row)))].join("、");
}

export function StoryContextStatusBlock({
  projectId,
  showSources = false,
  canEdit = false,
  onRepairShots,
}: {
  projectId: string;
  showSources?: boolean;
  canEdit?: boolean;
  /** closure §12：scorecard 修復 CTA（分軌：voice/sound→音訊重生；其餘→視覺批次） */
  onRepairShots?: (row: ScorecardRow) => void;
}) {
  const utils = trpc.useUtils();
  const [setupError, setSetupError] = useState<string | null>(null);
  const storyMeta = trpc.story.get.useQuery({ projectId });
  const characters = trpc.characters.list.useQuery({ projectId });
  const scenePresets = trpc.scenePresets.list.useQuery({ projectId });
  const propCards = trpc.props.list.useQuery({ projectId });
  const knowledge = trpc.knowledge.list.useQuery({ projectId });
  const assets = trpc.projects.assets.useQuery({ projectId });
  const project = trpc.projects.get.useQuery({ id: projectId });
  const scenes = trpc.scenes.listByProject.useQuery({ projectId });
  const workspace = trpc.creativeContext.workspace.useQuery({ projectId });
  const trainingAvailability = trpc.creativeContext.trainingAvailability.useQuery();
  const pinCanon = trpc.canon.createProjectCanon.useMutation({
    onSuccess: async () => {
      setSetupError(null);
      await Promise.all([
        utils.canon.projectPins.invalidate(),
        utils.creativeContext.workspace.invalidate(),
      ]);
    },
    onError: (err) => setSetupError(err.message),
  });
  const sheet = useCharacterSheetGenerate(projectId);

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
  const wv = parseWorldviewSafe(project.data?.worldview);
  const suggestedSound = {
    ambience: uniqueJoined((scenes.data ?? []).map((row) => row.ambience)) || undefined,
    music: uniqueJoined((scenes.data ?? []).map((row) => row.music)) || undefined,
  };

  const setupDimension = (row: ScorecardRow, draft?: { ambience?: string; music?: string }) => {
    if (row.dimension === "style") {
      if (!wv.styles.length) {
        revealProjectContext("worldview", { projectId, returnTo: "scenes" });
        window.setTimeout(() => {
          focusAndReveal(document.getElementById("wv-styles"));
        }, 80);
        return;
      }
      pinCanon.mutate({
        projectId,
        kind: "style",
        name: "專案視覺風格",
        descriptor: { styles: wv.styles },
        confirmRights: true,
      });
      return;
    }
    if (row.dimension === "sound_world") {
      const ambience = draft?.ambience?.trim() || suggestedSound.ambience;
      const music = draft?.music?.trim() || suggestedSound.music;
      if (!ambience && !music) return;
      pinCanon.mutate({
        projectId,
        kind: "sound_world",
        name: "專案聲音世界",
        descriptor: { ...(ambience ? { ambience } : {}), ...(music ? { music } : {}) },
        confirmRights: true,
      });
    }
  };

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
        onOpenStoryboard={() => revealStoryInlineSection("storyboard", { projectId, scroll: true })}
      />
      {onRepairShots ? (
        <>
          <StoryScorecardRepair
            rows={workspace.data?.scorecard ?? []}
            canEdit={canEdit}
            onRepairShots={onRepairShots}
            onSetupDimension={canEdit ? setupDimension : undefined}
            onGenerateSheets={canEdit ? () => {
              const missing = (characters.data ?? [])
                .filter((row) => !characterHasLiveSheet(row))
                .map((row) => row.id);
              sheet.startMany(missing);
            } : undefined}
            hasWorldviewStyles={wv.styles.length > 0}
            suggestedSound={suggestedSound.ambience || suggestedSound.music ? suggestedSound : undefined}
            onOpenDelivery={() => revealStoryInlineSection("delivery", { projectId, scroll: true })}
          />
          {setupError ? <Hint as="p">{setupError}</Hint> : null}
          {sheet.error ? <Hint as="p">定裝生成失敗：{sheet.error.message}</Hint> : null}
          <StoryAnimationBoard projectId={projectId} canEdit={canEdit} />
        </>
      ) : null}
    </>
  );
}
