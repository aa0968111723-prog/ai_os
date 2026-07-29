/**
 * WB-00 baseline: pure generate-button gate logic extracted from ProjectPage.
 * Locks viewer/editor disable reasons, source compatibility, estimate wiring,
 * approval-threshold copy, and submit payload shape before workbench refactor.
 * Strings and semantics must stay exact.
 */
import { estimatePoints, getModel, type ModelEntry } from "@shared/models";
import { SOURCE_INCOMPAT as SHARED_SOURCE_INCOMPAT } from "@shared/sourceIncompat";

/** Re-export shared table so client tests/callers keep a stable import path. */
export const SOURCE_INCOMPAT: Record<string, readonly string[]> = SHARED_SOURCE_INCOMPAT;

/** viewer 唯讀；其餘角色（member / leader / owner 等）可編輯生成 */
export function projectCanEdit(myProjectRole: string | null | undefined): boolean {
  return myProjectRole !== "viewer";
}

export type GenerationGateModel = {
  id: string;
  points: number;
  needs: string | null;
};

export type GenerationGateSource = {
  id: string;
  title: string;
  kind: string;
};

export type GenerationGateInput = {
  canEdit: boolean;
  model: GenerationGateModel | null | undefined;
  prompt: string;
  sourceAsset: GenerationGateSource | null;
  sourceUrl: string;
  sourceUrlError: string;
};

/**
 * 生成鈕 disable 時旁白顯示的原因字串（與 ProjectPage 生成台完全一致）。
 * null = 可送出（仍可能因 submit.isPending 被鎖）。
 */
export function getGenerationDisableReason(input: GenerationGateInput): string | null {
  const { canEdit, model, prompt, sourceAsset, sourceUrl, sourceUrlError } = input;
  const needs = model?.needs;
  const missingSource = model != null && needs != null && !sourceAsset && !sourceUrl.trim();
  const badSourceUrl =
    model != null && needs != null && !sourceAsset && sourceUrl.trim() !== "" && sourceUrlError !== "";
  const incompatSource =
    !!needs && !!sourceAsset && (SOURCE_INCOMPAT[needs] ?? []).includes(sourceAsset.kind);

  return !canEdit
    ? "你在此專案是檢視者（唯讀），不能生成——需要編輯請組長到「成員權限」調整"
    : !model
      ? "模型清單還在載入，稍等一下就能生成"
      : !prompt.trim()
        ? "先填一句提示詞，描述想要的畫面"
        : missingSource
          ? "這個模型需要來源素材——從素材庫選一個，或貼上網址"
          : incompatSource
            ? `選到的素材是${sourceAsset!.kind === "audio" ? "音訊" : sourceAsset!.kind === "image" ? "圖片" : sourceAsset!.kind}，這個模型不能用它——請換一個來源`
            : badSourceUrl
              ? "網址格式不對，需以 https:// 開頭"
              : null;
}

/** 主生成鈕：disableReason 或 submit 進行中都鎖（pending 刻意留在 helper 外也可；此函式鎖定 OR 語意） */
export function isGenerateButtonDisabled(
  disableReason: string | null,
  submitPending: boolean,
): boolean {
  return disableReason != null || submitPending;
}

/** 來源下拉只列「明顯相容」的素材；已選中的不相容素材仍保留，避免 select 空白 */
export function filterCompatibleSources<T extends { id: string; kind: string }>(
  assets: T[],
  needs: string | null | undefined,
  selectedSourceId?: string | null,
): T[] {
  return assets.filter(
    (a) => a.id === selectedSourceId || !needs || !(SOURCE_INCOMPAT[needs] ?? []).includes(a.kind),
  );
}

/**
 * 生成台顯示估點：與 ProjectPage estPoints 相同口徑——
 * full model 走 shared estimatePoints（TTS 按字）；找不到 full 時退回清單 points。
 */
export function estimateGenerationPoints(
  model: GenerationGateModel | null | undefined,
  promptChars: number,
  resolveFull: (id: string) => ModelEntry | undefined = getModel,
): number {
  if (!model) return 0;
  const full = resolveFull(model.id);
  return full ? estimatePoints(full, { promptChars }) : model.points;
}

/** 是否顯示「依文字長度即時計費」提示（確認框用） */
export function isUsageBasedPoints(
  modelId: string,
  resolveFull: (id: string) => ModelEntry | undefined = getModel,
): boolean {
  const full = resolveFull(modelId);
  if (!full) return false;
  return estimatePoints(full, { promptChars: 2000 }) !== estimatePoints(full, { promptChars: 1 });
}

/**
 * 成本審核門檻：組員單筆估點 ≥ 組長門檻 → 確認框顯示待核准提醒。
 * 用 estPoints（真估點）比門檻，不用 model.points（TTS 會漂移）。
 */
export function shouldShowApprovalThresholdNotice(input: {
  myRole: string | null | undefined;
  approvalThreshold: number | null | undefined;
  estPoints: number;
}): boolean {
  const { myRole, approvalThreshold, estPoints } = input;
  return (
    myRole === "member" &&
    approvalThreshold != null &&
    approvalThreshold > 0 &&
    estPoints >= approvalThreshold
  );
}

/** 確認框核准門檻文案（與 ProjectPage 完全一致） */
export function approvalThresholdNotice(estPoints: number, threshold: number): string {
  return `⏳ 這筆需要組長核准後才會開始生成（${estPoints} 點 ≥ 門檻 ${threshold} 點）`;
}

export type GenerationSubmitInput = {
  projectId: string;
  modelId: string;
  prompt: string;
  sourceAssetId?: string;
  sourceUrl?: string;
  characterIds?: string[];
  scenePresetIds?: string[];
  clientRequestId: string;
};

/** generation.submit mutation 載荷形狀（確認生成鈕 onClick） */
export function buildGenerationSubmitInput(input: {
  projectId: string;
  model: GenerationGateModel;
  prompt: string;
  sourceAsset: GenerationGateSource | null;
  sourceUrl: string;
  characterIds: string[];
  scenePresetIds: string[];
  clientRequestId: string;
}): GenerationSubmitInput {
  const { projectId, model, prompt, sourceAsset, sourceUrl, characterIds, scenePresetIds, clientRequestId } =
    input;
  return {
    projectId,
    modelId: model.id,
    prompt: prompt.trim(),
    sourceAssetId: model.needs && sourceAsset ? sourceAsset.id : undefined,
    sourceUrl: model.needs && !sourceAsset && sourceUrl.trim() ? sourceUrl.trim() : undefined,
    characterIds: characterIds.length ? characterIds : undefined,
    scenePresetIds: scenePresetIds.length ? scenePresetIds : undefined,
    clientRequestId,
  };
}
