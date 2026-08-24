/**
 * 專案頁首屏狀態摘要（純函式）。
 *
 * 目標：使用者進入 Project 後 5 秒內知道——這是什麼專案的脈絡、
 * 現在做到哪、下一步、有沒有東西在跑、哪裡卡住。
 *
 * 語彙與 shared/phoneStages、mobile/stages 對齊，不另建資料模型。
 */

import { inferPhoneStage, type PhoneStage } from "@shared/phoneStages";
import {
  continueAnchor,
  continueLabel,
  stageLabel as mobileStageLabel,
  stageSentence,
} from "../../mobile/stages";

export type StatusItem = {
  key: string;
  label: string;
  done?: boolean;
  /** DOM 錨點 id（不含 #），例如 stage-board */
  anchor?: string;
};

export type ProjectStatusSummary = {
  stageId: PhoneStage;
  /** 例如「分鏡階段」 */
  stageLabel: string;
  /** stageSentence 一句話 */
  statusLine: string;
  nextLabel: string;
  nextAnchor: string;
  progressItems: StatusItem[];
  runningItems: StatusItem[];
  attentionItems: StatusItem[];
};

export type DeriveProjectStatusInput = {
  archived?: boolean;
  hasStory: boolean;
  characterCount: number;
  shots: number;
  shotsWithVisual: number;
  generationsDone: number;
  runningGenerations: number;
  awaitingGenerations: number;
  playableResultCount: number;
  /** 具體進行中列（最多 UI 顯示 3） */
  runningLabels?: Array<{ key: string; label: string; anchor?: string }>;
  /** 具體待處理列（最多 UI 顯示 3） */
  attentionLabels?: Array<{ key: string; label: string; anchor?: string }>;
  /** 比 continueLabel 更具體的下一步，例如「完成 Shot 09」 */
  nextShotLabel?: string | null;
};

export function deriveProjectStatusSummary(
  input: DeriveProjectStatusInput,
): ProjectStatusSummary {
  const stageId = inferPhoneStage({
    hasStory: input.hasStory,
    shots: input.shots,
    shotsWithVisual: input.shotsWithVisual,
    generationsDone: input.generationsDone,
    archived: Boolean(input.archived),
  });

  // 有待裁決時偏向「生成」語意（與 ProgressStepper / 手機 statusLine 一致）
  const effectiveStage: PhoneStage =
    input.awaitingGenerations > 0 && stageId !== "deliver" ? "generate" : stageId;

  const baseLabel = mobileStageLabel(effectiveStage);
  const stageLabelText = `${baseLabel}階段`;

  const statusLine = stageSentence({
    stage: effectiveStage,
    shots: input.shots,
    shotsWithVisual: input.shotsWithVisual,
    awaitingGenerations: input.awaitingGenerations,
  });

  const nextLabel = input.nextShotLabel?.trim() || continueLabel(effectiveStage);
  const nextAnchor = continueAnchor(effectiveStage);

  const progressItems: StatusItem[] = [
    {
      key: "story",
      label: input.hasStory ? "故事 ✓" : "故事",
      done: input.hasStory,
      anchor: "stage-story",
    },
    {
      key: "characters",
      label: input.characterCount > 0 ? "角色 ✓" : "角色",
      done: input.characterCount > 0,
      anchor: "sec-characters",
    },
    {
      key: "shots",
      label:
        input.shots > 0
          ? `分鏡 ${input.shotsWithVisual}/${input.shots}`
          : "分鏡",
      done: input.shots > 0 && input.shotsWithVisual >= input.shots,
      anchor: "stage-board",
    },
    {
      key: "film",
      label:
        input.shots > 0
          ? `影片 ${input.playableResultCount}/${input.shots}`
          : "影片",
      done: input.shots > 0 && input.playableResultCount >= input.shots,
      anchor: "stage-create",
    },
  ];

  const runningItems: StatusItem[] =
    input.runningLabels && input.runningLabels.length > 0
      ? input.runningLabels.slice(0, 3)
      : input.runningGenerations > 0
        ? [
            {
              key: "running",
              label: `${input.runningGenerations} 筆生成進行中`,
              anchor: "stage-create",
            },
          ]
        : [];

  const attentionItems: StatusItem[] =
    input.attentionLabels && input.attentionLabels.length > 0
      ? input.attentionLabels.slice(0, 3)
      : input.awaitingGenerations > 0
        ? [
            {
              key: "awaiting",
              label: `${input.awaitingGenerations} 筆等待審核`,
              anchor: "stage-create",
            },
          ]
        : [];

  return {
    stageId: effectiveStage,
    stageLabel: stageLabelText,
    statusLine,
    nextLabel,
    nextAnchor,
    progressItems,
    runningItems,
    attentionItems,
  };
}
