import { useEffect, useRef, useState } from "react";
import { getModel, supportsCardAnchors, CATEGORIES } from "@shared/models";
import { trpc } from "../../../api";
import { ModelPicker, type PickedModel } from "../../../components/ModelPicker";
import { Icon } from "../../../components/Icon";
import { CollabZone, type CollabPeer } from "../../../realtime";
import { CreationCostSummary } from "../CreationCostSummary";
import type { CreationDraft, DraftPatch } from "../creationDraft";
import {
  approvalThresholdNotice,
  buildGenerationSubmitInput,
  estimateGenerationPoints,
  filterCompatibleSources,
  getGenerationDisableReason,
  isGenerateButtonDisabled,
  isUsageBasedPoints,
  shouldShowApprovalThresholdNotice,
} from "../generationGates";
import { focusAndReveal } from "../../../lib/scrollIntoViewForChrome";
import { revealWorkbenchAnchor, scrollToSelector } from "../workbenchNav";
import { Button, Card, Chip, Hint, Meta } from "../../../components/ui";
import { GenerationSourcePicker } from "../GenerationSourcePicker";
import type { CreativePromptOverride } from "@shared/aiTrace";
import { AiUnderstandingPanel } from "../AiUnderstandingPanel";
/** External fill from PromptLibrary / GenerationList / SceneList / AssetLibrary. */
export type DirectGenerateApplyRequest = {
  nonce: number;
  /** Replace prompt text (caller already confirmed overwrite when needed). */
  prompt?: string;
  modelId?: string | null;
  /** Resolve from assets list if still present. */
  sourceAssetId?: string | null;
  /** Direct source pick (AssetLibrary). */
  sourceAsset?: { id: string; title: string; kind: string } | null;
};

export type StudioCollabProps = {
  zone: string;
  watchers: CollabPeer[];
  sendFocus: (zone: string | null) => void;
  mirrorActive?: boolean;
};

/**
 * WB-02: full generate form moved from ProjectPage #sec-studio.
 * Single generation.submit path; gates via generationGates helpers; draft-synced fields.
 * Progressive disclosure: source under「進階設定」when model.needs is set (default collapsed).
 */
export function DirectGenerateMode({
  projectId,
  groupId,
  canEdit,
  myRole,
  projectFormat,
  worldview,
  wvReady,
  characterIds,
  scenePresetIds,
  propIds = [],
  panelId,
  labelledBy,
  active,
  goal,
  draft,
  setDraft,
  applyRequest,
  onReuseSettings: _onReuseSettings,
  onSourceChange,
  collab,
}: {
  projectId: string;
  groupId: string;
  canEdit: boolean;
  myRole: string | null | undefined;
  projectFormat: string;
  worldview: {
    logline?: string;
    message?: string;
    tones: string[];
    styles: string[];
    taboos: string[];
  };
  wvReady: boolean;
  characterIds: string[];
  scenePresetIds: string[];
  /** 素材設定卡（道具）勾選；預設空陣列讓既有呼叫端不必改 */
  propIds?: string[];
  panelId: string;
  labelledBy: string;
  active: boolean;
  goal?: string;
  draft: CreationDraft;
  setDraft: (patch: DraftPatch) => void;
  /** Parent-driven apply (PromptLibrary / AssetLibrary / SceneList). */
  applyRequest?: DirectGenerateApplyRequest | null;
  /**
   * @deprecated WB-05: GenerationList moved to CreationResourceDrawer; reuse is wired there.
   * Kept optional so callers need not change signatures this PR.
   */
  onReuseSettings?: (
    text: string,
    settings?: {
      modelId?: string | null;
      characterIds?: string[] | null;
      scenePresetIds?: string[] | null;
      propIds?: string[] | null;
      sourceAssetId?: string | null;
    },
  ) => void;
  /** Keep AssetLibrary highlight in sync when form source changes / clears. */
  onSourceChange?: (sourceAssetId: string | null) => void;
  collab?: StudioCollabProps | null;
}) {
  void _onReuseSettings;
  const utils = trpc.useUtils();
  const [model, setModel] = useState<PickedModel | null>(null);
  const [sourceAsset, setSourceAsset] = useState<{ id: string; title: string; kind: string } | null>(
    null,
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceUrlError, setSourceUrlError] = useState("");
  const [secondarySourceAsset, setSecondarySourceAsset] = useState<{ id: string; title: string; kind: string } | null>(null);
  const [secondarySourceUrl, setSecondarySourceUrl] = useState("");
  const [secondarySourceUrlError, setSecondarySourceUrlError] = useState("");
  const [pickReq, setPickReq] = useState<{ modelId: string; nonce: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitNotice, setSubmitNotice] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [promptOverride, setPromptOverride] = useState<CreativePromptOverride>({});
  const [continuityLocked, setContinuityLocked] = useState(true);
  const [traceSessionId, setTraceSessionId] = useState<string | null>(null);

  const prompt = draft.prompt ?? "";
  const setPrompt = (next: string) => setDraft({ prompt: next });
  /** 有勾任何一種一致性卡片（角色／場景／素材）——決定要不要提醒此模型吃不吃卡片 */
  const cardsPicked = characterIds.length > 0 || scenePresetIds.length > 0 || propIds.length > 0;

  const assets = trpc.projects.assets.useQuery({ projectId });
  const quota = trpc.quota.my.useQuery({ groupId }, { enabled: confirming && !!groupId });
  const savePrompt = trpc.prompts.save.useMutation({
    onSuccess: () => utils.prompts.list.invalidate({ projectId }),
  });
  const preview = trpc.generation.preview?.useMutation?.() ?? {
    data: undefined,
    error: null,
    isPending: false,
    mutate: (_input: unknown) => undefined,
  };

  const submitRequestId = useRef<string>(crypto.randomUUID());
  const submit = trpc.generation.submit.useMutation({
    onSuccess: (data, vars) => {
      setTraceSessionId(data.traceSessionId);
      submitRequestId.current = crypto.randomUUID();
      if (data.status !== "awaiting_approval" && data.status !== "rejected") {
        savePrompt.mutate({
          projectId,
          text: vars.prompt,
          modelId: vars.modelId,
          characterIds: vars.characterIds ?? [],
          scenePresetIds: vars.scenePresetIds ?? [],
          propIds: vars.propIds ?? [],
        });
      }
      setPrompt("");
      setPromptOverride({});
      setConfirming(false);
      setSubmitNotice(
        data.status === "awaiting_approval"
          ? "⏳ 已送組長核准——核准後才會開始生成"
          : "✅ 已送出，生成中——完成會推播通知，可先離開這頁",
      );
    },
    onSettled: () => {
      utils.generation.listByProject.invalidate({ projectId });
      utils.generation.listByProjectPaged.invalidate({ projectId });
      utils.quota.my.invalidate();
    },
  });

  // Drop deleted source asset from selection (same as former ProjectPage effect).
  useEffect(() => {
    const list = assets.data;
    if (!list || !sourceAsset) return;
    if (!list.some((a) => a.id === sourceAsset.id)) setSourceAsset(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets.data]);

  // Sync source ids into draft for cross-mode persistence.
  useEffect(() => {
    const ids = sourceAsset ? [sourceAsset.id] : [];
    const prev = draft.sourceAssetIds;
    if (ids.length === prev.length && ids.every((id, i) => id === prev[i])) return;
    setDraft({ sourceAssetIds: ids });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceAsset?.id]);

  // Sync modelId into draft when picker settles.
  useEffect(() => {
    if (!model) return;
    if (draft.modelId === model.id) return;
    setDraft({ modelId: model.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id]);

  // Restore model from draft once (remount / refresh) if no external pick yet.
  const restoredModelRef = useRef(false);
  useEffect(() => {
    if (restoredModelRef.current) return;
    if (!draft.modelId) return;
    restoredModelRef.current = true;
    setPickReq((prev) => ({ modelId: draft.modelId!, nonce: (prev?.nonce ?? 0) + 1 }));
  }, [draft.modelId]);

  // Restore source from draft.sourceAssetIds when assets load.
  const restoredSourceRef = useRef(false);
  useEffect(() => {
    if (restoredSourceRef.current) return;
    const first = draft.sourceAssetIds[0];
    if (!first || !assets.data) return;
    restoredSourceRef.current = true;
    const src = assets.data.find((a) => a.id === first);
    if (src) setSourceAsset({ id: src.id, title: src.title, kind: src.kind });
  }, [assets.data, draft.sourceAssetIds]);

  // Mirror form source → parent (AssetLibrary highlight).
  useEffect(() => {
    onSourceChange?.(sourceAsset?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceAsset?.id]);

  // Parent applyRequest (PromptLibrary / AssetLibrary / SceneList via ProjectPage).
  // sourceAssetId may arrive before assets load — keep pending until resolved.
  const lastApplyNonce = useRef(0);
  const pendingSourceIdRef = useRef<string | null>(null);

  const applySourceFromList = (id: string): boolean => {
    const src = assets.data?.find((a) => a.id === id);
    if (!src) return false;
    setSourceAsset({ id: src.id, title: src.title, kind: src.kind });
    setSourceUrl("");
    setSourceUrlError("");
    setAdvancedOpen(true);
    return true;
  };

  useEffect(() => {
    if (!applyRequest || applyRequest.nonce === lastApplyNonce.current) return;
    lastApplyNonce.current = applyRequest.nonce;

    if (typeof applyRequest.prompt === "string") {
      setPrompt(applyRequest.prompt);
    }
    if (applyRequest.modelId) {
      setPickReq((prev) => ({ modelId: applyRequest.modelId!, nonce: (prev?.nonce ?? 0) + 1 }));
    }
    if (applyRequest.sourceAsset) {
      pendingSourceIdRef.current = null;
      setSourceAsset(applyRequest.sourceAsset);
      setSourceUrl("");
      setSourceUrlError("");
      setAdvancedOpen(true);
    } else if (applyRequest.sourceAssetId) {
      if (!applySourceFromList(applyRequest.sourceAssetId)) {
        pendingSourceIdRef.current = applyRequest.sourceAssetId;
      } else {
        pendingSourceIdRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyRequest?.nonce]);

  // Retry pending sourceAssetId once assets list is available.
  useEffect(() => {
    const pending = pendingSourceIdRef.current;
    if (!pending || !assets.data) return;
    if (applySourceFromList(pending)) pendingSourceIdRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets.data]);

  const needs = model?.needs;
  const secondaryNeeds = model?.secondaryNeeds;
  const fullModel = model ? getModel(model.id) : undefined;
  const estPoints = estimateGenerationPoints(model, prompt.length, getModel, model?.usdToTwdRate);
  const disableReason = getGenerationDisableReason({
    canEdit,
    model,
    prompt,
    sourceAsset,
    sourceUrl,
    sourceUrlError,
    secondarySourceAsset,
    secondarySourceUrl,
    secondarySourceUrlError,
  });
  const sourceOptions = filterCompatibleSources(assets.data ?? [], needs, sourceAsset?.id);
  const secondarySourceOptions = filterCompatibleSources(assets.data ?? [], secondaryNeeds, secondarySourceAsset?.id);

  useEffect(() => {
    if (secondaryNeeds) return;
    setSecondarySourceAsset(null);
    setSecondarySourceUrl("");
    setSecondarySourceUrlError("");
  }, [secondaryNeeds]);

  const approvalNeeded = shouldShowApprovalThresholdNotice({
    myRole,
    approvalThreshold: quota.data?.approvalThreshold,
    estPoints,
  });

  const remainingLabel =
    confirming && quota.data
      ? [
          quota.data.totalRemaining != null
            ? `目前剩 ${quota.data.totalRemaining.toLocaleString()} 點`
            : "額度不限",
          quota.data.weeklyQuota != null
            ? `本週 ${quota.data.weeklyUsed}/${quota.data.weeklyQuota}`
            : "",
          quota.data.dailyQuota != null
            ? `今日 ${quota.data.dailyUsed}/${quota.data.dailyQuota}`
            : "",
        ]
          .filter(Boolean)
          .join("・")
      : undefined;

  // `on` 是「這項上下文已備妥」的視覺標示，不是切換態——點下去只是捲到該區塊。
  // 所以走 className 給 .on，不傳 selected：否則會輸出 aria-pressed，把一次性動作
  // 講成「未按下的切換鈕」，對讀屏使用者謊報元件性質。
  const summaryChip = (label: string, target: string, on = false) => (
    <Chip
      className={on ? "on" : undefined}
      onClick={() => scrollToSelector(target)}
    >
      {label}
    </Chip>
  );

  const form = (
    <div data-fb="生成台" id="sec-studio">
      {goal ? (
        <Meta as="p" style={{ marginTop: 4 }}>
          目前目標：
          <b>
            {goal.slice(0, 80)}
            {goal.length > 80 ? "…" : ""}
          </b>
        </Meta>
      ) : null}

      <ModelPicker onChange={setModel} pickRequest={pickReq} />

      <label htmlFor="gen-prompt">
        {model?.secondaryNeeds
          ? "處理說明（例如：中文配音版；兩個來源檔請在下方選）"
          : model?.kind === "audio" && model.needs == null
          ? "要唸的文字/音樂描述"
          : "提示詞（這支片的固定設定會自動帶，不用重講）"}
      </label>
      <textarea
        id="gen-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onFocus={(e) => focusAndReveal(e.currentTarget)}
        placeholder={model?.secondaryNeeds ? "例：中文配音版，保留原人物表情" : "例：清晨禪堂，柔和光線灑落，一炷香的靜謐"}
      />

      <div className="ctx-summary" style={{ marginTop: 8 }} role="group" aria-label="這次生成會帶入的上下文">
        帶入：
        {summaryChip(`設定${wvReady ? " ✓" : "（待設）"}`, "#onboard-worldview", wvReady)}
        {summaryChip(`角色 ${characterIds.length}`, "#sec-characters", characterIds.length > 0)}
        {summaryChip(`場景 ${scenePresetIds.length}`, "#sec-scenes", scenePresetIds.length > 0)}
        {summaryChip(`素材 ${propIds.length}`, "#sec-props", propIds.length > 0)}
      </div>

      {cardsPicked &&
        fullModel &&
        !supportsCardAnchors(fullModel.category) && (
          <Hint layer="always" role="alert" style={{ color: "var(--gold-ink)", marginTop: 6 }}>
            ⚠ 此模型（{CATEGORIES.find((c) => c.id === fullModel.category)?.label ?? fullModel.category}
            ）不會使用角色卡／場景卡／素材卡——已勾選的卡片不影響本次生成
          </Hint>
        )}
      {cardsPicked &&
        fullModel &&
        supportsCardAnchors(fullModel.category) && (
          <Hint style={{ marginTop: 6, fontSize: 12 }}>
            {needs === "image"
              ? // QA 2026-08-01：這類模型要一張來源圖，沒挑就用卡片上的參考圖——先前綁了圖卻不生效
                "角色卡／場景卡／素材卡以「文字描述」注入提示詞；沒有另外挑來源圖時，會自動用卡片上的參考圖當來源（角色 → 場景 → 素材）"
              : "角色卡／場景卡／素材卡以「文字描述」注入提示詞；參考圖只在「圖生圖／參考圖」這類模型才會當來源"}
          </Hint>
        )}

      {/* Progressive disclosure (4.4): source under 進階設定 — only when model needs source */}
      {model?.needs && (
        <Card as="details" variant="quiet"
          style={{ marginTop: 10, padding: "8px 10px" }}
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            <Icon name="SlidersHorizontal" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            進階設定
            {(sourceAsset || sourceUrl.trim()) && (!model.secondaryNeeds || secondarySourceAsset || secondarySourceUrl.trim())
              ? `（已設${model.secondaryNeeds ? "兩個" : ""}來源）`
              : `（${model.sourceHint ?? "來源素材"}）`}
          </summary>
          <div style={{ marginTop: 8 }}>
            <GenerationSourcePicker
              projectId={projectId}
              needs={model.needs}
              sourceHint={model.sourceHint}
              options={sourceOptions}
              value={sourceAsset}
              sourceUrl={sourceUrl}
              sourceUrlError={sourceUrlError}
              onChange={setSourceAsset}
              onSourceUrlChange={setSourceUrl}
              onSourceUrlError={setSourceUrlError}
              idPrefix="gen-source-primary"
            />
            {model.secondaryNeeds && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}>
                <GenerationSourcePicker
                  projectId={projectId}
                  needs={model.secondaryNeeds}
                  sourceHint={model.secondarySourceHint}
                  options={secondarySourceOptions}
                  value={secondarySourceAsset}
                  sourceUrl={secondarySourceUrl}
                  sourceUrlError={secondarySourceUrlError}
                  onChange={setSecondarySourceAsset}
                  onSourceUrlChange={setSecondarySourceUrl}
                  onSourceUrlError={setSecondarySourceUrlError}
                  idPrefix="gen-source-secondary"
                />
              </div>
            )}
          </div>
        </Card>
      )}

      <CreationCostSummary
        modeLabel="直接出圖"
        estimateLabel={model ? `約 ${estPoints} 點` : "依所選模型計算"}
        usageBasedNote={model && isUsageBasedPoints(model.id) ? "（依文字長度即時計費）" : undefined}
        outputSpec={model ? `${model.label}・${projectFormat}` : undefined}
        approvalLabel={
          // Only after quota loads — avoid flicker of「否」while threshold is still unknown.
          confirming && quota.data
            ? approvalNeeded
              ? `是（${estPoints} 點 ≥ 門檻 ${quota.data.approvalThreshold} 點）`
              : "否"
            : undefined
        }
        remainingLabel={remainingLabel}
      />

      {cardsPicked && fullModel && supportsCardAnchors(fullModel.category) ? (
        <div style={{ margin: "12px 0", padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
          <button
            type="button"
            aria-pressed={continuityLocked}
            onClick={() => setContinuityLocked((value) => !value)}
          >
            一致性鎖定：{continuityLocked ? "開" : "關"}
          </button>
          <Hint as="p" layer="always" style={{ margin: "8px 0 0" }}>
            {continuityLocked
              ? "會凍結本次角色、場景與素材版本；模型支援時，自動按角色→場景→道具順序送入多張參考圖。"
              : "仍會注入卡片文字，但不附加多張一致性參考圖；之後重試也不視為鎖定版本。"}
          </Hint>
        </div>
      ) : null}

      {canEdit ? <AiUnderstandingPanel
        projectId={projectId}
        preview={preview.data}
        previewPending={preview.isPending}
        previewError={preview.error?.message ?? (!model ? "請先選擇模型。" : !prompt.trim() ? "請先填寫提示詞。" : undefined)}
        onPreview={() => {
          if (!model || !prompt.trim()) return;
          const base = buildGenerationSubmitInput({
            projectId,
            model,
            prompt,
            sourceAsset,
            sourceUrl,
            secondarySourceAsset,
            secondarySourceUrl,
            characterIds,
            scenePresetIds,
            propIds,
            continuityMode: continuityLocked,
            clientRequestId: submitRequestId.current,
          });
          preview.mutate({ ...base, promptOverride: Object.values(promptOverride).some(Boolean) ? promptOverride : undefined });
        }}
        traceSessionId={traceSessionId}
        override={promptOverride}
        onOverrideChange={setPromptOverride}
      /> : null}

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          className="primary"
          data-fb="生成按鈕"
          disabled={isGenerateButtonDisabled(disableReason, submit.isPending)}
          onClick={() => {
            setSubmitNotice("");
            setConfirming(true);
          }}
        >
          {!model ? "模型載入中…" : submit.isPending ? "送出中…" : `生成（−${estPoints} 點）`}
        </button>
        <Hint as="span" layer="always">{disableReason ?? "失敗自動退點・額度由管理員調整"}</Hint>
      </div>

      {confirming && model && (
        <div className="confirm-panel">
          <h3 style={{ margin: "0 0 8px" }}>即將生成</h3>
          <p style={{ margin: "4px 0" }}>
            <b>{model.label}</b>・{projectFormat}
            {characterIds.length > 0 && <>・帶入 {characterIds.length} 個角色定裝</>}
            {scenePresetIds.length > 0 && <>・{scenePresetIds.length} 個場景設定</>}
            {propIds.length > 0 && <>・{propIds.length} 個素材設定</>}
            {cardsPicked && continuityLocked && <>・一致性快照已鎖定</>}
          </p>
          {cardsPicked &&
            fullModel &&
            !supportsCardAnchors(fullModel.category) && (
              <p role="alert" style={{ margin: "4px 0", fontSize: 13, color: "var(--gold-ink)" }}>
                ⚠ 此模型不會使用角色卡／場景卡／素材卡——期待角色/場景/道具一致請改用文生圖、圖生圖或影片類模型
              </p>
            )}
          <p style={{ margin: "4px 0", fontSize: 13 }}>
            提示詞：{prompt.trim().slice(0, 80)}
            {prompt.trim().length > 80 ? "…" : ""}
          </p>
          {(worldview.tones.length > 0 ||
            worldview.styles.length > 0 ||
            worldview.taboos.length > 0 ||
            !!(worldview.logline?.trim() || worldview.message?.trim())) && (
            <Meta as="p" style={{ margin: "4px 0", fontSize: 12 }}>
              自動注入：
              {[
                worldview.logline?.trim() ? "故事錨點" : "",
                worldview.message?.trim() ? "核心訊息" : "",
                worldview.tones.length
                  ? `調性（${worldview.tones.slice(0, 2).join("、")}${worldview.tones.length > 2 ? "…" : ""}）`
                  : "",
                worldview.styles.length
                  ? `風格主要「${worldview.styles[0]}」${worldview.styles.length > 1 ? `（另 ${worldview.styles.length - 1} 備選不進圖）` : ""}`
                  : "",
                worldview.taboos.length ? `禁忌 ${worldview.taboos.length} 條` : "",
              ]
                .filter(Boolean)
                .join("・")}
            </Meta>
          )}
          <p style={{ margin: "8px 0" }}>
            預估{" "}
            <b style={{ color: "var(--primary-ink)", fontSize: 18 }}>約 {estPoints} 點</b>
            {isUsageBasedPoints(model.id) && (
              <Hint as="span" layer="always" style={{ marginLeft: 6, fontSize: 12 }}>
                （依文字長度即時計費）
              </Hint>
            )}
            {quota.data && (
              <Meta style={{ marginLeft: 8 }}>
                {quota.data.totalRemaining != null
                  ? `目前剩 ${quota.data.totalRemaining.toLocaleString()} 點`
                  : "額度不限"}
                {quota.data.weeklyQuota != null
                  ? `・本週 ${quota.data.weeklyUsed}/${quota.data.weeklyQuota}`
                  : ""}
                {quota.data.dailyQuota != null
                  ? `・今日 ${quota.data.dailyUsed}/${quota.data.dailyQuota}`
                  : ""}
              </Meta>
            )}
          </p>
          {approvalNeeded && (
            <p style={{ margin: "4px 0", fontSize: 13, color: "var(--gold-ink)" }}>
              {approvalThresholdNotice(estPoints, quota.data!.approvalThreshold!)}
            </p>
          )}
          <Hint layer="always" style={{ fontSize: 12 }}>失敗全額退點。正式模式會實際呼叫 AI 生成。</Hint>
          {/* MOB-03：長任務可離開——背景 runner 不綁 cookie；完成會推播到已連結裝置 */}
          <Hint style={{ fontSize: 12, marginTop: 6 }}>
            可關閉此頁，完成會推播到已連結裝置。
          </Hint>
          <div className="confirm-actions" style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button
              type="button"
              className="primary"
              disabled={submit.isPending}
              onClick={() =>
                model &&
                submit.mutate({
                  ...buildGenerationSubmitInput({
                    projectId,
                    model,
                    prompt,
                    sourceAsset,
                    sourceUrl,
                    secondarySourceAsset,
                    secondarySourceUrl,
                    characterIds,
                    scenePresetIds,
                    propIds,
                    continuityMode: continuityLocked,
                    clientRequestId: submitRequestId.current,
                  }),
                  promptOverride: Object.values(promptOverride).some(Boolean) ? promptOverride : undefined,
                })
              }
            >
              {submit.isPending ? "生成中…" : "確認生成"}
            </button>
            <button type="button" disabled={submit.isPending} onClick={() => setConfirming(false)}>
              再想想
            </button>
          </div>
        </div>
      )}

      {submitNotice && (
        <Meta as="p" role="status" style={{ marginTop: 10, color: "var(--gold-ink)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {submitNotice}
          <Button size="sm" onClick={() => revealWorkbenchAnchor("#sec-generations", { projectId })}>看進度</Button>
        </Meta>
      )}
      {submit.error && <p className="error">{submit.error.message}</p>}

      {/* GenerationList lives in CreationResourceDrawer (WB-05) — avoid duplicate long card here. */}
      <Hint layer="always" style={{ marginTop: 12 }}>
        生成紀錄與「再用此設定」已移到下方「資源與結果」抽屜。
      </Hint>
    </div>
  );

  return (
    <div role="tabpanel" id={panelId} aria-labelledby={labelledBy} hidden={!active}>
      {collab ? (
        <CollabZone
          zone={collab.zone}
          watchers={collab.watchers}
          sendFocus={collab.sendFocus}
          mirrorActive={collab.mirrorActive}
        >
          {form}
        </CollabZone>
      ) : (
        form
      )}
    </div>
  );
}
