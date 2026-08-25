/**
 * 專案頁首屏狀態摘要（純函式）。
 *
 * 目標：使用者進入 Project 後 5 秒內知道——這是什麼專案的脈絡、
 * 現在做到哪、下一步、有沒有東西在跑、哪裡卡住。
 *
 * 進度區顯示真實工作流節點（故事 / 角色 / 場景 / 分鏡 / 圖片 / 影片 / 聲音 / 審核），
 * 全部由既有狀態推導：story readiness、characters、scenePresets、
 * shared/shotCompletion.computeProjectCompletion（image/video/voice/audio/review）。
 * 不另建 progress truth table。
 *
 * 語彙與 shared/phoneStages、mobile/stages 對齊。
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
  /** 真實工作流進度節點（可點） */
  progressItems: StatusItem[];
  runningItems: StatusItem[];
  attentionItems: StatusItem[];
};

export type DeriveProjectStatusInput = {
  archived?: boolean;
  hasStory: boolean;
  /** 角色定裝卡數量 */
  characterCount: number;
  /** 敘事人物數（worldview.people）；有則當角色分母 */
  peopleCount?: number;
  /** 場景定裝卡數量 */
  scenePresetCount: number;
  /** 故事場次數（boardRail.sceneCount）；有則當場景分母 */
  storySceneCount?: number;
  shots: number;
  /** 已有畫面的分鏡數（assetId） */
  shotsWithVisual: number;
  /** 有可生成內容的分鏡（prompt/action/asset） */
  shotsReady?: number;
  generationsDone: number;
  runningGenerations: number;
  awaitingGenerations: number;
  playableResultCount: number;
  /**
   * 來自 computeProjectCompletion.perTrack（shared/shotCompletion）。
   * 不傳則圖片/影片/聲音/審核節點略過或顯示 0。
   */
  perTrack?: {
    image: number;
    video: number;
    voice: number;
    audio: number;
    review: number;
  };
  /** 具體進行中列（最多 UI 顯示 3） */
  runningLabels?: Array<{ key: string; label: string; anchor?: string }>;
  /** 具體待處理列（最多 UI 顯示 3） */
  attentionLabels?: Array<{ key: string; label: string; anchor?: string }>;
  /** 比 continueLabel 更具體的下一步，例如「完成 Shot 09」 */
  nextShotLabel?: string | null;
};

function ratioLabel(name: string, done: number, total: number): string {
  if (total <= 0) return name;
  return `${name} ${done}/${total}`;
}

/**
 * 組裝首屏進度節點：故事 → 角色 → 場景 → 分鏡 → 圖片 → 影片 → 聲音 → 審核。
 * 分母與分子皆來自呼叫端已載入的真實狀態，不推估、不造假。
 */
export function buildProgressItems(input: DeriveProjectStatusInput): StatusItem[] {
  const shots = Math.max(0, input.shots);
  const charDenom = Math.max(input.characterCount, input.peopleCount ?? 0);
  const sceneDenom = Math.max(input.scenePresetCount, input.storySceneCount ?? 0);
  const shotsReady = input.shotsReady ?? input.shotsWithVisual;
  const track = input.perTrack;

  // 聲音：以配音（voice）為主——與 TRACK_LABEL.voice「配音」同源；
  // 環境音（audio）仍在 DeliveryRoom 細項，首屏不拆兩列以免與範例「聲音」衝突。
  const soundDone = track?.voice ?? 0;

  const items: StatusItem[] = [
    {
      key: "story",
      label: input.hasStory ? "故事 ✓" : "故事",
      done: input.hasStory,
      anchor: "stage-story",
    },
    {
      key: "characters",
      label:
        charDenom > 0
          ? ratioLabel("角色", input.characterCount, charDenom)
          : input.characterCount > 0
            ? `角色 ${input.characterCount}`
            : "角色",
      done: charDenom > 0 ? input.characterCount >= charDenom : input.characterCount > 0,
      anchor: "sec-characters",
    },
    {
      key: "scenes",
      label:
        sceneDenom > 0
          ? ratioLabel("場景", input.scenePresetCount, sceneDenom)
          : input.scenePresetCount > 0
            ? `場景 ${input.scenePresetCount}`
            : "場景",
      done: sceneDenom > 0 ? input.scenePresetCount >= sceneDenom : input.scenePresetCount > 0,
      anchor: "sec-scenes",
    },
    {
      key: "shots",
      label: shots > 0 ? ratioLabel("分鏡", Math.min(shotsReady, shots), shots) : "分鏡",
      done: shots > 0 && shotsReady >= shots,
      anchor: "stage-board",
    },
    {
      key: "image",
      label: shots > 0 ? ratioLabel("圖片", track?.image ?? input.shotsWithVisual, shots) : "圖片",
      done: shots > 0 && (track?.image ?? input.shotsWithVisual) >= shots,
      anchor: "stage-create",
    },
    {
      key: "video",
      label: shots > 0 ? ratioLabel("影片", track?.video ?? input.playableResultCount, shots) : "影片",
      done: shots > 0 && (track?.video ?? input.playableResultCount) >= shots,
      anchor: "stage-create",
    },
    {
      key: "sound",
      label: shots > 0 ? ratioLabel("聲音", soundDone, shots) : "聲音",
      done: shots > 0 && soundDone >= shots,
      anchor: "stage-create",
    },
    {
      key: "review",
      label: shots > 0 ? ratioLabel("審核", track?.review ?? 0, shots) : "審核",
      done: shots > 0 && (track?.review ?? 0) >= shots,
      anchor: "stage-deliver",
    },
  ];

  return items;
}

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

  const progressItems = buildProgressItems(input);

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
