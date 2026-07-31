import { useMemo, useRef, useState } from "react";
import { trpc } from "../api";
import { MAX_GENERATE_CHARACTERS, MAX_GENERATE_SCENE_PRESETS } from "@shared/cardLimits";
import { MODELS, estimatePoints, getModel, tierLabel } from "@shared/models";
import { isSceneRefineModel, isSceneRegenModel, refineGroupOf, type SceneVersion } from "@shared/sceneVersions";
import { Icon } from "./Icon";
import { ConfirmButton, HelpTip, useFocusTrap } from "./interactions";
import { AssetAudio, AssetImg, AssetVideo } from "./MediaFallback";
import { relSeen } from "../push";
import { Button, Card, EmptyState, Hint, Meta, Pill, Skeleton, type PillStatus } from "./ui";

/** 提示詞上限：與後端 MAX_PROMPT_CHARS／scenes.update 同口徑 */
const MAX_PROMPT_CHARS = 4000;
/** 配音詞上限：與後端 scenes.update 的 voiceover z.string().max(2000) 同口徑 */
const MAX_VOICEOVER_CHARS = 2000;
/** 逐格生成的預設模型（與 SceneList 同一支，換頁不會突然變別的模型） */
const DEFAULT_REGEN_MODEL = "fal-ai/fast-lightning-sdxl";
/** 逐格配音的後端預設 TTS（scenes.generateVoiceover 未帶 modelId 時用它）——前端只拿來顯示預估點數 */
const DEFAULT_TTS_MODEL = "fal-ai/kokoro/mandarin-chinese";

/** 重生（文生圖／文生影片）與修正（吃底圖）兩份清單——判斷來自 shared，與後端守門同一份規則 */
const REGEN_MODELS = MODELS.filter(isSceneRegenModel);
const REFINE_MODELS = MODELS.filter(isSceneRefineModel);
/** 修正模型的預設：目錄裡標「推薦」的圖生圖（沒有就退回第一支） */
const DEFAULT_REFINE_MODEL =
  REFINE_MODELS.find((m) => m.recommended && m.kind === "image")?.id ?? REFINE_MODELS[0]?.id ?? "";

const VERSION_STATE: Record<SceneVersion["state"], { label: string; cls: PillStatus }> = {
  current: { label: "現用", cls: "done" },
  candidate: { label: "可切回", cls: "queued" },
  generating: { label: "生成中", cls: "running" },
  awaiting_approval: { label: "待核", cls: "running" },
  failed: { label: "失敗", cls: "failed" },
};

type StudioTab = "regen" | "refine" | "voice" | "versions";

const TABS: Array<{ id: StudioTab; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { id: "refine", label: "修正這張", icon: "Palette" },
  { id: "regen", label: "重畫這格", icon: "Sparkles" },
  { id: "voice", label: "配音", icon: "Mic" },
  { id: "versions", label: "版本", icon: "Clock" },
];

/** localStorage 讀取包一層：無痕模式／被封鎖時只是少了記憶，不該讓工作室開不起來 */
function readStored(key: string, fallback: string, valid: (v: string) => boolean): string {
  try {
    const saved = window.localStorage.getItem(key);
    return saved && valid(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 單格工作室：把「一格」單獨拉到全螢幕反覆修，不牽動其他分鏡。
 *
 * 四件事在同一個畫面裡（這是與分鏡列最大的差別——分鏡列一次看全片，這裡只看一格）：
 * 1. **修正這張**：以現用畫面（或任何一版）當底圖送圖生圖／圖生影片——保留構圖只改指定的地方。
 * 2. **重畫這格**：換模型從頭重畫，適合構圖本身要換掉。
 * 3. **配音**：編這一格的配音詞、生成中文旁白、就地試聽——單格的深改只有這一個入口。
 * 4. **版本**：這一格歷來每一次生成都在，含模型／指示／花了幾點；一鍵切回任何一版，可逆。
 *
 * 現用是哪一版的單一真相是 scenes.assetId／narrationAssetId（伺服器端），
 * 本元件只呈現與觸發，不自己保存版本狀態。
 */
export function SceneStudio({
  sceneId,
  projectId,
  sceneNumber,
  canEdit,
  charIds,
  sceneIds,
  onClose,
  onChanged,
}: {
  sceneId: string;
  projectId: string;
  /** 第幾鏡（1 起算），只用於標題與無障礙標籤 */
  sceneNumber: number;
  canEdit: boolean;
  /** 生成台勾選的角色／場景卡：工作室的重生與修正也注入同一套錨點，畫風不分岔 */
  charIds?: string[];
  sceneIds?: string[];
  onClose: () => void;
  /** 這一格被改動（存檔／送生成／切版本）時通知外層刷新分鏡列 */
  onChanged: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true, onClose);
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<StudioTab>("refine");
  const [promptDraft, setPromptDraft] = useState<string | null>(null); // null＝跟隨伺服器
  const [voiceDraft, setVoiceDraft] = useState<string | null>(null); // null＝跟隨伺服器
  const [instruction, setInstruction] = useState("");
  /** 修正用的底圖；null＝這一格目前的畫面 */
  const [baseAssetId, setBaseAssetId] = useState<string | null>(null);
  /** 舞台上看的是哪一版；null＝現用 */
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [regenModelId, setRegenModelId] = useState(() =>
    readStored(`aios.scenegen.${projectId}`, DEFAULT_REGEN_MODEL, (v) => REGEN_MODELS.some((m) => m.id === v)),
  );
  const [refineModelId, setRefineModelId] = useState(() =>
    readStored(`aios.scenerefine.${projectId}`, DEFAULT_REFINE_MODEL, (v) => REFINE_MODELS.some((m) => m.id === v)),
  );
  const rememberModel = (key: string, value: string) => {
    try { window.localStorage.setItem(key, value); } catch { /* 持久化只是加分 */ }
  };

  const versions = trpc.scenes.versions.useQuery(
    { sceneId },
    {
      // 有版本在跑時加快輪詢（等出圖的人正盯著看），閒置時放慢到與分鏡列同節奏
      refetchInterval: (query) => (query.state.data?.summary.generating ? 4_000 : 20_000),
    },
  );
  const data = versions.data;
  const list = useMemo(() => data?.versions ?? [], [data]);
  const visualVersions = useMemo(() => list.filter((v) => v.role === "visual"), [list]);
  const narrationVersions = useMemo(() => list.filter((v) => v.role === "narration"), [list]);
  const currentVisual = visualVersions.find((v) => v.isCurrent);
  const isGenerating = data?.summary.generating ?? false;

  const refresh = () => {
    utils.scenes.versions.invalidate({ sceneId });
    onChanged();
  };
  const update = trpc.scenes.update.useMutation({ onSuccess: () => { setPromptDraft(null); refresh(); } });
  // 配音詞另開一支 update：存提示詞與存配音詞的 pending／已儲存回饋各自獨立，不互相污染
  const saveVoice = trpc.scenes.update.useMutation({ onSuccess: () => { setVoiceDraft(null); refresh(); } });
  // 冪等鍵（QA-007）：還沒成功的重送沿用同鍵——timeout 重按不重複扣點；成功才換新鍵
  const regenRequestId = useRef(crypto.randomUUID());
  const refineRequestId = useRef(crypto.randomUUID());
  const voiceRequestId = useRef(crypto.randomUUID());
  const regen = trpc.scenes.generateInto.useMutation({
    onSuccess: () => { regenRequestId.current = crypto.randomUUID(); setTab("versions"); refresh(); },
  });
  const refine = trpc.scenes.refine.useMutation({
    onSuccess: () => { refineRequestId.current = crypto.randomUUID(); setTab("versions"); refresh(); },
  });
  // 完成後留在配音頁（試聽就在同一頁出現），不像重畫/修正要跳到版本頁看進度
  const generateVoiceover = trpc.scenes.generateVoiceover.useMutation({
    onSuccess: () => { voiceRequestId.current = crypto.randomUUID(); refresh(); },
  });
  const setCurrent = trpc.scenes.setVisualFromAsset.useMutation({
    onSuccess: () => { setPreviewAssetId(null); refresh(); },
  });
  const actionError = update.error ?? saveVoice.error ?? regen.error ?? refine.error ?? generateVoiceover.error ?? setCurrent.error;

  const prompt = promptDraft ?? data?.prompt ?? "";
  const promptDirty = promptDraft !== null && promptDraft !== (data?.prompt ?? "");
  const voiceover = voiceDraft ?? data?.voiceover ?? "";
  const voiceDirty = voiceDraft !== null && voiceDraft !== (data?.voiceover ?? "");
  /** 後端生成旁白吃的是「已儲存」的配音詞——估點與可否生成都以它為準 */
  const savedVoiceover = data?.voiceover ?? "";

  const regenModel = getModel(regenModelId) ?? getModel(DEFAULT_REGEN_MODEL);
  const refineModel = getModel(refineModelId);
  const refinePoints = refineModel ? estimatePoints(refineModel, { promptChars: instruction.length }) : undefined;
  // 配音走按字計費的中文 TTS：估點依「已儲存的配音詞」長度算，與後端扣點同一函式——顯示＝扣點
  const ttsModel = getModel(DEFAULT_TTS_MODEL);
  const ttsPoints = ttsModel ? estimatePoints(ttsModel, { promptChars: savedVoiceover.length }) : undefined;
  const currentNarration = narrationVersions.find((v) => v.isCurrent);
  const isVoicing = narrationVersions.some((v) => v.state === "generating") || generateVoiceover.isPending;

  /** 修正的底圖：指定的那一版，或這一格現用畫面 */
  const baseVersion = baseAssetId ? list.find((v) => v.assetId === baseAssetId) : currentVisual;
  const baseUsable = !!baseVersion?.canRefineFrom;
  /** 舞台上顯示的那一版（預覽某一版時用它，否則現用） */
  const stageVersion = previewAssetId ? list.find((v) => v.assetId === previewAssetId) ?? currentVisual : currentVisual;

  const refineBlocked = !refineModel || !baseUsable || instruction.trim() === "" || isGenerating || refine.isPending;
  const regenBlocked = !regenModel || prompt.trim() === "" || isGenerating || regen.isPending;

  const useVersionAsBase = (v: SceneVersion) => {
    setBaseAssetId(v.assetId);
    setPreviewAssetId(v.assetId);
    setTab("refine");
  };

  return (
    <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Card
        className="modal-card scene-studio"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`第 ${sceneNumber} 鏡・單格工作室`}
      >
        <div className="scene-studio__head">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: "var(--fs-18)" }}>
              第 {sceneNumber} 鏡・單格工作室
              <HelpTip text="把這一格單獨拉出來反覆修：以現用畫面當底圖只改指定的地方、換模型重畫、或切回歷來任何一版。所有動作只影響這一格。" />
            </h2>
            <Meta as="div">{data?.title ?? ""}</Meta>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="關閉單格工作室">
            <Icon name="X" size={18} />
          </Button>
        </div>

        {versions.isError && (
          <p className="error" role="alert">
            版本讀不到（不是資料不見了）——
            <Button variant="ghost" size="sm" onClick={() => versions.refetch()}>再試一次</Button>
          </p>
        )}
        {actionError && <p className="error" role="alert">操作失敗：{actionError.message}</p>}

        <div className="scene-studio__body">
          {/* ── 舞台：這一格現在長什麼樣（或正在看的那一版） ───────────────── */}
          <div className="scene-studio__stage">
            {versions.isLoading ? (
              <Skeleton style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: "var(--r-12)" }} />
            ) : stageVersion?.assetUrl ? (
              stageVersion.assetKind === "video" ? (
                <AssetVideo
                  className="scene-studio__media"
                  src={stageVersion.assetUrl}
                  controls
                  preload="metadata"
                  fallbackLabel="素材遺失——可用右側重畫或修正補回"
                />
              ) : (
                <AssetImg
                  className="scene-studio__media"
                  src={stageVersion.assetUrl}
                  alt={`第 ${sceneNumber} 鏡${stageVersion.isCurrent ? "現用畫面" : `第 ${stageVersion.index} 版`}`}
                  fallbackLabel="素材遺失——可用右側重畫或修正補回"
                />
              )
            ) : (
              <EmptyState
                icon={<Icon name="Image" />}
                title={<>這一格還沒有畫面</>}
                description={<>先在右側寫提示詞、按「重畫這格」出第一版；之後就能以它為底圖反覆修。</>}
              />
            )}
            <div className="scene-studio__stagebar">
              {stageVersion ? (
                <>
                  <Pill status={VERSION_STATE[stageVersion.state].cls}>{VERSION_STATE[stageVersion.state].label}</Pill>
                  <Meta>
                    第 {stageVersion.index} 版
                    {stageVersion.modelId ? `・${getModel(stageVersion.modelId)?.label ?? stageVersion.modelId}` : "・外部帶入"}
                  </Meta>
                </>
              ) : null}
              {isGenerating && (
                <Meta role="status" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icon name="Loader" className="spin" size={13} /> 這一格正在生成…
                </Meta>
              )}
              {previewAssetId && (
                <Button size="sm" variant="ghost" onClick={() => setPreviewAssetId(null)}>
                  <Icon name="Undo2" size={13} /> 看回現用
                </Button>
              )}
              {stageVersion?.assetId && (
                <Button as="a" size="sm" variant="tonal" href={`/api/assets/${stageVersion.assetId}/file`} download>
                  <Icon name="Download" size={13} /> 下載這版
                </Button>
              )}
              {canEdit && stageVersion?.canSetCurrent && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={setCurrent.isPending}
                  onClick={() => setCurrent.mutate({ sceneId, assetId: stageVersion.assetId! })}
                >
                  <Icon name="Check" size={13} /> 用這一版
                </Button>
              )}
            </div>
            {narrationVersions.some((v) => v.isCurrent && v.assetUrl) && (
              <div className="scene-studio__narration">
                <Meta as="div" style={{ marginBottom: 4 }}>這一格的旁白</Meta>
                <AssetAudio
                  controls
                  preload="none"
                  src={narrationVersions.find((v) => v.isCurrent)!.assetUrl!}
                  aria-label={`第 ${sceneNumber} 鏡旁白試聽`}
                  style={{ height: 32, width: "100%" }}
                  fallbackLabel="旁白音檔遺失——可在「配音」分頁重生補回"
                />
              </div>
            )}
          </div>

          {/* ── 工具：提示詞 ＋ 三個分頁 ─────────────────────────────── */}
          <div className="scene-studio__tools">
            <div>
              <label htmlFor={`studio-prompt-${sceneId}`} style={{ fontSize: "var(--fs-12)", margin: 0 }}>
                這一格的提示詞
                <HelpTip text="只屬於這一格。改了之後「重畫這格」會用新的提示詞，其他分鏡不受影響。" />
              </label>
              <textarea
                id={`studio-prompt-${sceneId}`}
                value={prompt}
                disabled={!canEdit || update.isPending}
                maxLength={MAX_PROMPT_CHARS}
                rows={3}
                placeholder="這一格要畫什麼（例：黃昏的海邊，逆光剪影，遠景）"
                onChange={(e) => setPromptDraft(e.target.value)}
                style={{ fontSize: "var(--fs-13)", padding: "6px 9px", width: "100%" }}
              />
              {canEdit && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Button size="sm" disabled={!promptDirty || update.isPending} onClick={() => update.mutate({ sceneId, prompt })}>
                    {update.isPending ? "儲存中…" : "儲存提示詞"}
                  </Button>
                  {promptDirty ? <Meta>尚未儲存</Meta> : update.isSuccess ? <Meta style={{ color: "var(--success-ink)" }}>已儲存 <Icon name="Check" size={12} /></Meta> : null}
                </div>
              )}
            </div>

            <div className="scene-studio__tabs" role="tablist" aria-label="單格工作室工具">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`studio-tab-${t.id}-${sceneId}`}
                  aria-selected={tab === t.id}
                  aria-controls={`studio-panel-${t.id}-${sceneId}`}
                  className={`scene-studio__tab${tab === t.id ? " is-active" : ""}`}
                  onClick={() => setTab(t.id)}
                >
                  <Icon name={t.icon} size={14} /> {t.label}
                  {t.id === "versions" && visualVersions.length > 0 ? ` ${visualVersions.length}` : ""}
                </button>
              ))}
            </div>

            {/* 修正這張：以底圖為基準只改指定的地方 */}
            {tab === "refine" && (
              <div role="tabpanel" id={`studio-panel-refine-${sceneId}`} aria-labelledby={`studio-tab-refine-${sceneId}`}>
                {!canEdit ? (
                  <Hint layer="always">你是檢視者，只能回看版本，不能修改這一格。</Hint>
                ) : !baseUsable ? (
                  <Hint layer="always">
                    這一格還沒有可以當底圖的圖片。先用「重畫這格」出第一版，或在「版本」挑一版圖片當底圖（影片版本不能拿來修圖）。
                  </Hint>
                ) : (
                  <>
                    <div className="scene-studio__base">
                      <AssetImg
                        className="gen-thumb"
                        src={baseVersion!.assetUrl ?? ""}
                        alt="底圖"
                        fallbackClassName="gen-thumb"
                        fallbackLabel="底圖遺失"
                        fallbackIconSize={14}
                      />
                      <div style={{ minWidth: 0 }}>
                        <Meta as="div">
                          底圖：{baseVersion!.isCurrent ? "這一格現用畫面" : `第 ${baseVersion!.index} 版`}
                        </Meta>
                        {baseAssetId && (
                          <Button size="sm" variant="ghost" onClick={() => { setBaseAssetId(null); setPreviewAssetId(null); }}>
                            改用現用畫面
                          </Button>
                        )}
                      </div>
                    </div>
                    <label htmlFor={`studio-instruction-${sceneId}`} style={{ fontSize: "var(--fs-12)", margin: "8px 0 0" }}>
                      要改哪裡
                      <HelpTip text="像對修圖師交代：只講要動的地方，其餘寫「其餘不變」。構圖會沿用底圖，不會整張重畫。" />
                    </label>
                    <textarea
                      id={`studio-instruction-${sceneId}`}
                      value={instruction}
                      maxLength={MAX_PROMPT_CHARS}
                      rows={3}
                      placeholder="例：把天空換成黃昏、人物臉部再清楚一點，其餘不變"
                      onChange={(e) => setInstruction(e.target.value)}
                      style={{ fontSize: "var(--fs-13)", padding: "6px 9px", width: "100%" }}
                    />
                    <label htmlFor={`studio-refine-model-${sceneId}`} style={{ fontSize: "var(--fs-12)", margin: 0 }}>
                      用哪個模型修
                    </label>
                    <select
                      id={`studio-refine-model-${sceneId}`}
                      value={refineModelId}
                      onChange={(e) => { setRefineModelId(e.target.value); rememberModel(`aios.scenerefine.${projectId}`, e.target.value); }}
                      style={{ width: "100%", fontSize: "var(--fs-13)", padding: "6px 10px" }}
                    >
                      <optgroup label="改這張圖">
                        {REFINE_MODELS.filter((m) => refineGroupOf(m) === "image").map((m) => (
                          <option key={m.id} value={m.id}>{tierLabel(m.tier)}・{m.label} — {m.points} 點</option>
                        ))}
                      </optgroup>
                      <optgroup label="讓這張動起來（產出影片）">
                        {REFINE_MODELS.filter((m) => refineGroupOf(m) === "video").map((m) => (
                          <option key={m.id} value={m.id}>{tierLabel(m.tier)}・{m.label} — {m.points} 點</option>
                        ))}
                      </optgroup>
                    </select>
                    {refineModel && <Meta as="div">{refineModel.strengths}</Meta>}
                    <div style={{ marginTop: 8 }}>
                      {isGenerating || refine.isPending ? (
                        <Button variant="primary" disabled>生成中…</Button>
                      ) : (
                        <ConfirmButton
                          triggerClassName="primary"
                          disabled={refineBlocked}
                          triggerTitle="以底圖為基準送出修正，完成後成為這一格的新版本"
                          message={`即將以底圖修正這一格（${refineModel?.label ?? refineModelId}${refinePoints != null ? `，約 −${refinePoints} 點` : ""}）；失敗自動退點`}
                          confirmLabel="確認修正"
                          onConfirm={() =>
                            refine.mutate({
                              sceneId,
                              modelId: refineModelId,
                              prompt: instruction,
                              sourceAssetId: baseVersion!.assetId!,
                              clientRequestId: refineRequestId.current,
                              characterIds: charIds?.length ? charIds.slice(0, MAX_GENERATE_CHARACTERS) : undefined,
                              scenePresetIds: sceneIds?.length ? sceneIds.slice(0, MAX_GENERATE_SCENE_PRESETS) : undefined,
                            })
                          }
                        >
                          <Icon name="Palette" size={14} /> 修正這張{refinePoints != null ? `（約 −${refinePoints} 點）` : ""}
                        </ConfirmButton>
                      )}
                    </div>
                    <Hint style={{ marginTop: 6 }}>
                      修正不會覆蓋舊版：完成後成為新的一版，舊版仍留在「版本」裡隨時切回。
                    </Hint>
                  </>
                )}
              </div>
            )}

            {/* 重畫這格：換模型從頭生 */}
            {tab === "regen" && (
              <div role="tabpanel" id={`studio-panel-regen-${sceneId}`} aria-labelledby={`studio-tab-regen-${sceneId}`}>
                {!canEdit ? (
                  <Hint layer="always">你是檢視者，只能回看版本，不能修改這一格。</Hint>
                ) : (
                  <>
                    <label htmlFor={`studio-regen-model-${sceneId}`} style={{ fontSize: "var(--fs-12)", margin: 0 }}>
                      用哪個模型重畫
                      <HelpTip text="便宜的適合快速試構圖，旗艦的適合定稿。換模型不影響其他分鏡。" />
                    </label>
                    <select
                      id={`studio-regen-model-${sceneId}`}
                      value={regenModelId}
                      onChange={(e) => { setRegenModelId(e.target.value); rememberModel(`aios.scenegen.${projectId}`, e.target.value); }}
                      style={{ width: "100%", fontSize: "var(--fs-13)", padding: "6px 10px" }}
                    >
                      {REGEN_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>{tierLabel(m.tier)}・{m.label} — {m.points} 點</option>
                      ))}
                    </select>
                    {regenModel && <Meta as="div">{regenModel.strengths}</Meta>}
                    {prompt.trim() === "" && <Hint layer="always">先在上面寫這一格的提示詞才能重畫。</Hint>}
                    {promptDirty && <Hint layer="always">提示詞還沒儲存——先按「儲存提示詞」，重畫才會用新的。</Hint>}
                    <div style={{ marginTop: 8 }}>
                      {isGenerating || regen.isPending ? (
                        <Button variant="primary" disabled>生成中…</Button>
                      ) : (
                        <ConfirmButton
                          triggerClassName="primary"
                          disabled={regenBlocked}
                          triggerTitle="用這一格的提示詞重畫，完成後成為這一格的新版本"
                          message={`即將重畫這一格（${regenModel?.label ?? regenModelId}${regenModel ? `，約 −${regenModel.points} 點` : ""}）；失敗自動退點`}
                          confirmLabel="確認重畫"
                          onConfirm={() =>
                            regen.mutate({
                              sceneId,
                              modelId: regenModelId,
                              prompt,
                              clientRequestId: regenRequestId.current,
                              characterIds: charIds?.length ? charIds.slice(0, MAX_GENERATE_CHARACTERS) : undefined,
                              scenePresetIds: sceneIds?.length ? sceneIds.slice(0, MAX_GENERATE_SCENE_PRESETS) : undefined,
                            })
                          }
                        >
                          <Icon name="Sparkles" size={14} /> 重畫這格{regenModel ? `（約 −${regenModel.points} 點）` : ""}
                        </ConfirmButton>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* 配音：編這一格的配音詞、生成中文旁白、就地試聽——分鏡列的深改都收到這裡 */}
            {tab === "voice" && (
              <div role="tabpanel" id={`studio-panel-voice-${sceneId}`} aria-labelledby={`studio-tab-voice-${sceneId}`}>
                {!canEdit ? (
                  <Hint layer="always">你是檢視者，只能試聽旁白，不能修改配音詞。</Hint>
                ) : (
                  <>
                    <label htmlFor={`studio-voiceover-${sceneId}`} style={{ fontSize: "var(--fs-12)", margin: 0 }}>
                      這一格的配音詞
                      <HelpTip text="旁白唸的稿。存好後按「生成配音」會用中文 TTS 唸出來；改了稿要先儲存，生成才會用新的。" />
                    </label>
                    <textarea
                      id={`studio-voiceover-${sceneId}`}
                      value={voiceover}
                      disabled={saveVoice.isPending}
                      maxLength={MAX_VOICEOVER_CHARS}
                      rows={3}
                      placeholder="這一格旁白要唸什麼（可留白＝這格沒有旁白）"
                      onChange={(e) => setVoiceDraft(e.target.value)}
                      style={{ fontSize: "var(--fs-13)", padding: "6px 9px", width: "100%" }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Button size="sm" disabled={!voiceDirty || saveVoice.isPending} onClick={() => saveVoice.mutate({ sceneId, voiceover })}>
                        {saveVoice.isPending ? "儲存中…" : "儲存配音詞"}
                      </Button>
                      {voiceDirty ? <Meta>尚未儲存</Meta> : saveVoice.isSuccess ? <Meta style={{ color: "var(--success-ink)" }}>已儲存 <Icon name="Check" size={12} /></Meta> : null}
                    </div>
                    {savedVoiceover.trim() === "" && <Hint layer="always">先填配音詞並儲存，才能生成旁白。</Hint>}
                    {voiceDirty && savedVoiceover.trim() !== "" && (
                      <Hint layer="always">配音詞還沒儲存——先按「儲存配音詞」，生成才會用新的稿。</Hint>
                    )}
                    <div style={{ marginTop: 8 }}>
                      {isVoicing ? (
                        <Button variant="primary" disabled>配音生成中…</Button>
                      ) : (
                        <ConfirmButton
                          triggerClassName="primary"
                          disabled={savedVoiceover.trim() === "" || voiceDirty}
                          triggerTitle="用已儲存的配音詞生成中文旁白，完成後就在下方試聽"
                          message={`即將生成旁白配音（${ttsModel?.label ?? "中文 TTS"}${ttsPoints != null ? `，約 −${ttsPoints} 點` : ""}）；失敗自動退點`}
                          confirmLabel="確認生成"
                          onConfirm={() => generateVoiceover.mutate({ sceneId, clientRequestId: voiceRequestId.current })}
                        >
                          {currentNarration ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <Icon name="RotateCw" size={14} /> 重生配音{ttsPoints != null ? `（約 −${ttsPoints} 點）` : ""}
                            </span>
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <Icon name="Mic" size={14} /> 生成配音{ttsPoints != null ? `（約 −${ttsPoints} 點）` : ""}
                            </span>
                          )}
                        </ConfirmButton>
                      )}
                    </div>
                  </>
                )}
                {currentNarration?.assetUrl && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <AssetAudio
                      controls
                      preload="none"
                      src={currentNarration.assetUrl}
                      aria-label={`第 ${sceneNumber} 鏡旁白試聽`}
                      style={{ height: 32, flex: 1, minWidth: 180 }}
                      fallbackLabel="旁白音檔遺失——可用「重生配音」補回"
                    />
                    <Button as="a" size="sm" variant="tonal" href={`/api/assets/${currentNarration.assetId}/file`} download>
                      <Icon name="Download" size={13} /> 下載旁白
                    </Button>
                  </div>
                )}
                {canEdit && (
                  <Hint style={{ marginTop: 6 }}>
                    重生不會覆蓋舊旁白：完成後成為新的一版，舊版仍留在「版本」裡。
                  </Hint>
                )}
              </div>
            )}

            {/* 版本：歷來每一次生成，可切回、可當底圖、可抄提示詞 */}
            {tab === "versions" && (
              <div role="tabpanel" id={`studio-panel-versions-${sceneId}`} aria-labelledby={`studio-tab-versions-${sceneId}`}>
                {versions.isLoading ? (
                  <div aria-hidden="true">
                    {[0, 1].map((k) => (
                      <div key={k} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <Skeleton className="gen-thumb" />
                        <Skeleton style={{ height: 14, flex: 1 }} />
                      </div>
                    ))}
                  </div>
                ) : list.length === 0 ? (
                  <EmptyState
                    icon={<Icon name="Clock" />}
                    title={<>這一格還沒有版本</>}
                    description={<>每按一次「重畫」或「修正」都會留下一版，之後可以隨時切回來。</>}
                  />
                ) : (
                  <ul className="scene-studio__versions">
                    {list.map((v) => (
                      <li key={v.generationId ?? v.assetId} className={`scene-studio__version${v.isCurrent ? " is-current" : ""}`}>
                        {v.assetUrl && v.assetKind !== "audio" ? (
                          <button
                            type="button"
                            className="scene-studio__vthumb"
                            title="在左側看這一版"
                            aria-label={`預覽第 ${v.index} 版`}
                            onClick={() => setPreviewAssetId(v.assetId)}
                          >
                            {v.assetKind === "video" ? (
                              <AssetVideo className="gen-thumb" src={v.assetUrl} muted preload="metadata" fallbackClassName="gen-thumb" fallbackLabel="遺失" fallbackIconSize={14} />
                            ) : (
                              <AssetImg className="gen-thumb" src={v.assetUrl} alt="" fallbackClassName="gen-thumb" fallbackLabel="遺失" fallbackIconSize={14} />
                            )}
                          </button>
                        ) : (
                          <div className="gen-thumb scene-studio__vthumb--empty">
                            <Icon name={v.state === "generating" ? "Loader" : v.role === "narration" ? "Volume2" : "Image"} className={v.state === "generating" ? "spin" : undefined} size={16} />
                          </div>
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <b style={{ fontSize: "var(--fs-13)" }}>{v.role === "narration" ? "旁白" : "畫面"}第 {v.index} 版</b>
                            <Pill status={VERSION_STATE[v.state].cls}>{VERSION_STATE[v.state].label}</Pill>
                            {v.sourceUrl && <Meta>由底圖修出</Meta>}
                          </div>
                          <Meta as="div">
                            {v.modelId ? getModel(v.modelId)?.label ?? v.modelId : "外部帶入"}
                            {v.points > 0 ? `・${v.points} 點` : ""}・{relSeen(v.createdAt)}
                          </Meta>
                          {v.prompt && <Meta as="div" style={{ whiteSpace: "pre-wrap" }}>{v.prompt.length > 90 ? `${v.prompt.slice(0, 90)}…` : v.prompt}</Meta>}
                          {v.error && <Meta as="div" style={{ color: "var(--danger-ink)" }}>失敗：{v.error}（已退點）</Meta>}
                          {canEdit && (
                            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                              {v.canSetCurrent && (
                                <Button size="sm" disabled={setCurrent.isPending} onClick={() => setCurrent.mutate({ sceneId, assetId: v.assetId! })}>
                                  <Icon name="Check" size={13} /> 設為現用
                                </Button>
                              )}
                              {v.canRefineFrom && (
                                <Button size="sm" variant="ghost" onClick={() => useVersionAsBase(v)}>
                                  <Icon name="Palette" size={13} /> 以這版為底圖
                                </Button>
                              )}
                              {v.canReusePrompt && (
                                <Button size="sm" variant="ghost" onClick={() => setPromptDraft(v.prompt!)}>
                                  <Icon name="Copy" size={13} /> 用這版提示詞
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {data?.truncated && <Hint style={{ marginTop: 6 }}>版本很多，這裡只顯示最近 120 版。</Hint>}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
