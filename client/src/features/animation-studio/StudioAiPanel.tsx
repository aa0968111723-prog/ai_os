import { useEffect, useRef, useState } from "react";
// 欄位上限的單一真相在 shared——在元件裡再寫一次數字，遲早有一邊被調大變成後門
import { SCRIPT_AMBIENCE_MAX, SCRIPT_TITLE_MAX, SCRIPT_VOICEOVER_MAX } from "@shared/storyboardScript";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button, Card, Hint, Meta } from "../../components/ui";
import type { Stroke } from "./boardDoc";
import { boardFileName, type ExportResult } from "./boardExport";
import { boardDocFromSketch, clampSketchToCapacity } from "./sketchImport";
import type { BoardSummary } from "./boardSummary";
import { replaySketch, type ReplayHandle, type SketchPreview } from "./sketchReplay";
import type { StudioShot } from "./ShotStrip";
import type { StudioLayout } from "./studioLayout";
import { WHITEBOARD_IMAGE_MODES, type WhiteboardImageMode } from "@shared/whiteboardImage";

export interface StudioAiPanelProps {
  layout: StudioLayout;
  projectId: string;
  shot: StudioShot | null;
  canEdit: boolean;
  /** 白板是空的就不給存畫面（存一張白紙上去只會佔素材庫） */
  boardEmpty: boolean;
  /** 由白板算出 PNG；在這裡才呼叫，避免每次重繪都做一次匯出 */
  exportBoard: () => Promise<ExportResult | null>;
  /** 白板已存成畫面：父層據此清掉「未存手稿」標記 */
  onBoardSaved: (shotId: string) => void;
  /** AI 畫草圖：逐筆重播進白板（與手繪共用 pushStroke，尺寸與筆畫上限同一套） */
  sketch: {
    pushStroke: (stroke: Stroke) => void;
    /** 正在畫的那一筆的逐點預覽（白板 live 層）；null＝畫完或停止，要把預覽清掉 */
    preview: (preview: SketchPreview | null) => void;
    /** 白板現況摘要（畫布感知）：送出當下才算，AI 據此避開已有內容、不重畫外框 */
    summarize: () => BoardSummary;
    boardW: number;
    boardH: number;
    maxStrokes: number;
    /** 白板目前已有幾筆——AI 的畫只准填進剩餘空間，絕不擠掉使用者已畫的（addStroke 超限丟最舊） */
    strokeCount: number;
  };
}

/**
 * AI 協作欄：把白板上的手稿接回分鏡，並讓 AI 幫忙把畫面變成文字（提示詞、旁白、整份腳本）。
 *
 * 這些操作都用站內既有的能力，不另開後端：
 * - 存成畫面 → `/api/upload` 進素材庫 → `scenes.setVisualFromAsset` 綁到這一鏡
 * - 白板正式成品 → `director.generateWhiteboardImage` 走既有 generation / asset pipeline
 * - 就地編輯 → `scenes.update`
 * - 想不到怎麼描述 → `director.suggest`（AI 導演建議，可直接套用或另存成新鏡）
 * - 已經有腳本 → `director.splitScript`（一次拆成整份分鏡）
 */
export function StudioAiPanel({
  layout,
  projectId,
  shot,
  canEdit,
  boardEmpty,
  exportBoard,
  onBoardSaved,
  sketch,
}: StudioAiPanelProps) {
  const utils = trpc.useUtils();
  const [prompt, setPrompt] = useState(shot?.prompt ?? "");
  const [voiceover, setVoiceover] = useState(shot?.voiceover ?? "");
  const [ambience, setAmbience] = useState(shot?.ambience ?? "");
  const [title, setTitle] = useState(shot?.title ?? "");
  const [durationSec, setDurationSec] = useState(shot?.durationSec ?? 5);
  const [saveState, setSaveState] = useState<"idle" | "uploading" | "done">("idle");
  const [saveError, setSaveError] = useState("");
  const [rawScript, setRawScript] = useState<string | null>(null);

  /**
   * 切換分鏡時把欄位換成那一鏡的內容（本地編輯中的草稿刻意丟棄——
   * 保留它會讓人在第 3 鏡看到第 2 鏡沒存的字，比丟掉更難解釋）。
   *
   * 依賴只跟 `shot?.id`，不跟各欄位的伺服器值：同一列的環境音／旁白在別處
   * （分鏡表的單格工作室）也改得動，跟著伺服器值重設等於「別人存檔時，
   * 你在這裡打到一半的提示詞會被清掉」。切鏡才重設，就是這段註解原本的意圖。
   */
  useEffect(() => {
    setPrompt(shot?.prompt ?? "");
    setVoiceover(shot?.voiceover ?? "");
    setAmbience(shot?.ambience ?? "");
    setTitle(shot?.title ?? "");
    setDurationSec(shot?.durationSec ?? 5);
    setSaveState("idle");
    setSaveError("");
    setImageGenerationId(null);
    setImageError("");
    setReferenceName(shot?.title ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot?.id]);

  const invalidateScenes = () => { void utils.scenes.listByProject.invalidate({ projectId }); };

  const update = trpc.scenes.update.useMutation({ onSuccess: invalidateScenes });
  const addDraft = trpc.scenes.addDraft.useMutation({ onSuccess: invalidateScenes });
  const setVisual = trpc.scenes.setVisualFromAsset.useMutation({ onSuccess: invalidateScenes });
  const setVisualFromGeneration = trpc.scenes.setVisualFromGeneration.useMutation({ onSuccess: invalidateScenes });
  const addCharacterReference = trpc.characters.add.useMutation({
    onSuccess: () => void utils.characters.list.invalidate({ projectId }),
  });
  const addSceneReference = trpc.scenePresets.add.useMutation({
    onSuccess: () => void utils.scenePresets.list.invalidate({ projectId }),
  });
  const suggest = trpc.director.suggest.useMutation();

  // ── AI 畫草圖 ────────────────────────────────────────────
  const [sketchPrompt, setSketchPrompt] = useState("");
  /** 至少四個字才送：一兩個字畫出來的構圖跟亂數沒兩樣，白花一次等待 */
  const SKETCH_PROMPT_MIN = 4;
  const [replaying, setReplaying] = useState(false);
  /** 因白板空間不足被裁掉的筆數（>0 必須告知，不准默默少畫） */
  const [clippedByBoard, setClippedByBoard] = useState(0);
  const [whiteboardMode, setWhiteboardMode] = useState<WhiteboardImageMode>("quality");
  const [imageGenerationId, setImageGenerationId] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const [referenceName, setReferenceName] = useState("");
  const replayRef = useRef<ReplayHandle | null>(null);
  /** 卸載後才回來的 onSuccess 不准開新重播（react-query 的 mutation 不隨卸載中止） */
  const mountedRef = useRef(true);
  const sketchMutation = trpc.director.sketchBoard.useMutation({
    onSuccess: (data) => {
      if (!mountedRef.current) return;
      // LLM 失敗的 fallback **不畫**：未經同意把 13 筆無關的示範圖蓋在使用者的草稿上，
      // 比畫不出來更糟——錯誤用 alert 區塊講清楚（見下方渲染）。示範模式（mock 非 fallback）照畫。
      if (data.fallback) return;
      // 伺服器輸出照樣過 parseBoard 防禦閘（boardDocFromSketch 內），與 localStorage 讀回同一道門
      const board = boardDocFromSketch(data.doc);
      if (!board || board.strokes.length === 0) return;
      // 只填進剩餘空間：addStroke 超限丟「最舊」，不裁的話 AI 會把使用者已畫的擠掉
      const { doc, clipped } = clampSketchToCapacity(board, sketch.strokeCount, sketch.maxStrokes);
      setClippedByBoard(clipped);
      if (doc.strokes.length === 0) return;
      const reducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setReplaying(true);
      replayRef.current = replaySketch(doc, sketch.pushStroke, {
        reducedMotion,
        // 逐點預覽進白板 live 層：使用者看得到筆尖在走、線一段一段長出來
        onPreview: sketch.preview,
        onDone: () => setReplaying(false),
      });
    },
  });
  const whiteboardImagePlan = trpc.director.whiteboardImagePlan.useQuery(
    { projectId, mode: whiteboardMode },
    { enabled: Boolean(shot && !boardEmpty && canEdit) },
  );
  const generateWhiteboardImage = trpc.director.generateWhiteboardImage.useMutation();
  const imageStatus = trpc.generation.status.useQuery(
    { id: imageGenerationId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(imageGenerationId), refetchInterval: imageGenerationId ? 3_000 : false },
  );
  const generatedAsset = trpc.generation.assetFor.useQuery(
    { generationId: imageGenerationId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(imageGenerationId && imageStatus.data?.status === "done") },
  );
  // 離開創作室時停掉還在畫的重播；已落的筆畫留著（本機草稿，可 undo 可清空）
  useEffect(() => () => {
    mountedRef.current = false;
    replayRef.current?.cancel();
  }, []);
  // 切換分鏡也要停：switchTo 換掉白板文件但不 unmount 面板，殘餘的 timer 會把
  // AI 筆畫灌進「新載入那一鏡」的白板，再被自動存檔寫進錯誤分鏡的本機草稿
  useEffect(() => {
    replayRef.current?.cancel();
    setReplaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot?.id]);
  const stopReplay = () => {
    replayRef.current?.cancel();
    setReplaying(false);
  };
  const split = trpc.director.splitScript.useMutation({
    onSuccess: (data) => {
      // 有截斷就把原文留著：尾段沒拆進來這件事收掉面板等於沒講
      if (!data?.truncation) setRawScript(null);
      invalidateScenes();
    },
  });

  /** 白板 → PNG → 素材庫 → 綁成這一鏡的畫面 */
  const saveBoardToShot = async () => {
    if (!shot || boardEmpty) return;
    setSaveState("uploading");
    setSaveError("");
    try {
      const exported = await exportBoard();
      if (!exported) throw new Error("白板匯出失敗");
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", new File([exported.blob], boardFileName(shot.title), { type: "image/png" }));
      const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
      const data = (await res.json()) as { ok?: boolean; error?: string; asset?: { id: string } };
      if (!res.ok || !data.ok || !data.asset) throw new Error(data.error ?? `上傳失敗（${res.status}）`);
      await setVisual.mutateAsync({ sceneId: shot.id, assetId: data.asset.id });
      void utils.projects.assets.invalidate({ projectId });
      setSaveState("done");
      onBoardSaved(shot.id);
    } catch (err) {
      setSaveState("idle");
      setSaveError(err instanceof Error ? err.message : "存成畫面失敗——請檢查網路後重試");
    }
  };

  const generateFinishedWhiteboardImage = async () => {
    if (!shot || boardEmpty || !canEdit) return;
    setImageError("");
    try {
      const exported = await exportBoard();
      if (!exported) throw new Error("白板匯出失敗");
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", new File([exported.blob], boardFileName(`${shot.title}-構圖參考`), { type: "image/png" }));
      const uploadResponse = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
      const upload = (await uploadResponse.json()) as { ok?: boolean; error?: string; asset?: { id: string } };
      if (!uploadResponse.ok || !upload.ok || !upload.asset) throw new Error(upload.error ?? "構圖參考上傳失敗");
      void utils.projects.assets.invalidate({ projectId });
      const result = await generateWhiteboardImage.mutateAsync({
        projectId,
        prompt: (sketchPrompt.trim() || shot.prompt || "完成這個分鏡畫面").slice(0, 8_000),
        mode: whiteboardMode,
        sourceAssetId: upload.asset.id,
        characterIds: undefined,
        scenePresetIds: undefined,
        propIds: undefined,
        continuityMode: true,
      });
      setImageGenerationId(result.generationId);
      setReferenceName(shot.title);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "白板 AI 繪畫失敗");
    }
  };

  const generatedImageUrl = imageStatus.data?.resultUrl ?? null;
  const generatedImageDone = imageStatus.data?.status === "done" && Boolean(generatedImageUrl);
  const generatedAssetId = generatedAsset.data?.id;

  const dirty =
    !!shot &&
    (title !== shot.title ||
      prompt !== (shot.prompt ?? "") ||
      voiceover !== (shot.voiceover ?? "") ||
      ambience !== (shot.ambience ?? "") ||
      durationSec !== shot.durationSec);

  return (
    <div className="studio-ai" data-mode={layout.mode}>
      <Card as="section" variant="quiet" data-fb="whiteboard-ai-image">
        <h3 className="studio-ai__title">
          <Icon name="Image" size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          AI 繪畫成品
        </h3>
        <Hint>白板會以構圖、主體位置、鏡位與畫面安排作為參考，生成正式、高細節的分鏡畫面，不會把草圖當成普通塗鴉。</Hint>
        <div className="studio-ai__actions" role="radiogroup" aria-label="AI 繪畫品質模式">
          {WHITEBOARD_IMAGE_MODES.map((mode) => (
            <Button key={mode.id} size="sm" variant={whiteboardMode === mode.id ? "primary" : "tonal"} disabled={!canEdit || generateWhiteboardImage.isPending} onClick={() => setWhiteboardMode(mode.id)} aria-pressed={whiteboardMode === mode.id}>
              {mode.label}
            </Button>
          ))}
        </div>
        <Meta as="p" style={{ margin: "6px 0", fontSize: "var(--fs-11)" }}>
          {WHITEBOARD_IMAGE_MODES.find((mode) => mode.id === whiteboardMode)?.description}
        </Meta>
        {whiteboardImagePlan.data && (
          <Meta as="p" role="status" style={{ margin: "6px 0" }}>
            將使用 {whiteboardImagePlan.data.model.label}（{whiteboardImagePlan.data.model.tier}，健康：{whiteboardImagePlan.data.model.health}）・預估 {whiteboardImagePlan.data.estimatedPoints} 點（NT${whiteboardImagePlan.data.estimatedTwd}）。{whiteboardImagePlan.data.noSilentDowngrade ? " 最精緻模式不會自動降級。" : ""}
          </Meta>
        )}
        {whiteboardImagePlan.error && <p className="error" role="alert">{whiteboardImagePlan.error.message}</p>}
        <div className="studio-ai__actions">
          <Button size="sm" variant="primary" disabled={!canEdit || !shot || boardEmpty || generateWhiteboardImage.isPending || Boolean(whiteboardImagePlan.error)} onClick={() => { void generateFinishedWhiteboardImage(); }}>
            {generateWhiteboardImage.isPending ? "生成中…" : "生成正式畫面"}
          </Button>
          {boardEmpty && <Hint>先在白板畫出構圖，AI 才能保留你的畫面安排。</Hint>}
        </div>
        {generateWhiteboardImage.data && !generateWhiteboardImage.isPending && <Meta as="p" role="status" style={{ margin: "6px 0" }}>已送出 {generateWhiteboardImage.data.model.label}；完成後會自動進入素材庫。</Meta>}
        {imageGenerationId && imageStatus.data?.status !== "done" && <Meta as="p" role="status" style={{ margin: "6px 0" }}>生成狀態：{imageStatus.data?.status ?? "queued"}…</Meta>}
        {imageStatus.data?.status === "failed" && <p className="error" role="alert">{imageStatus.data.error ?? "生成失敗"}</p>}
        {imageError && <p className="error" role="alert">{imageError}</p>}
        {generatedImageDone && generatedImageUrl && (
          <div style={{ marginTop: 10 }}>
            <img src={generatedImageUrl} alt="白板 AI 繪畫成品" style={{ width: "100%", borderRadius: 8, display: "block" }} />
            <input aria-label="參考卡名稱" value={referenceName} onChange={(event) => setReferenceName(event.target.value)} placeholder="參考卡名稱" disabled={!canEdit} style={{ marginTop: 8 }} />
            <div className="studio-ai__actions" style={{ marginTop: 8 }}>
              <Button size="sm" variant="primary" disabled={!canEdit || !shot || setVisualFromGeneration.isPending} onClick={() => shot && imageGenerationId && setVisualFromGeneration.mutate({ sceneId: shot.id, generationId: imageGenerationId })}>存成該鏡畫面</Button>
              <Button size="sm" variant="tonal" disabled={!canEdit || !generatedAssetId || addCharacterReference.isPending} onClick={() => generatedAssetId && addCharacterReference.mutate({ projectId, name: `${referenceName.trim() || shot?.title || "未命名"} 角色參考`, appearance: `以白板構圖生成的正式角色參考。${sketchPrompt.trim() || shot?.prompt || ""}`, referenceAssetId: generatedAssetId, clientRequestId: crypto.randomUUID() })}>作為角色參考</Button>
              <Button size="sm" variant="tonal" disabled={!canEdit || !generatedAssetId || addSceneReference.isPending} onClick={() => generatedAssetId && addSceneReference.mutate({ projectId, name: `${referenceName.trim() || shot?.title || "未命名"} 場景參考`, palette: "依生成畫面", lighting: "依生成畫面", referenceAssetId: generatedAssetId, clientRequestId: crypto.randomUUID() })}>作為場景參考</Button>
            </div>
            <Meta as="p" style={{ margin: "6px 0 0", fontSize: "var(--fs-11)" }}>成品已保存到素材庫；可直接套用到本鏡，或建立角色／場景參考卡。</Meta>
          </div>
        )}
      </Card>
      <Card as="section" variant="quiet" data-fb="創作室・這一鏡">
        <h3 className="studio-ai__title">
          <Icon name="Clapperboard" size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          這一鏡
        </h3>
        {!shot ? (
          <Hint>
            還沒選分鏡。白板上畫的東西會存成「自由塗鴉」，選一鏡之後才能把手稿存成那一鏡的畫面。
          </Hint>
        ) : (
          <>
            <label htmlFor="studio-shot-title">標題</label>
            <input id="studio-shot-title" value={title} maxLength={SCRIPT_TITLE_MAX} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} />

            <label htmlFor="studio-shot-duration">秒數</label>
            <input
              id="studio-shot-duration"
              type="number"
              min={1}
              max={60}
              value={durationSec}
              disabled={!canEdit}
              onChange={(e) => setDurationSec(Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
            />

            <label htmlFor="studio-shot-prompt">畫面（生成提示詞）</label>
            <textarea
              id="studio-shot-prompt"
              rows={layout.mode === "lite" ? 3 : 5}
              value={prompt}
              disabled={!canEdit}
              placeholder="這一鏡要看到什麼：主體、動作、鏡位、光線⋯⋯"
              onChange={(e) => setPrompt(e.target.value)}
            />

            <label htmlFor="studio-shot-voiceover">旁白</label>
            <textarea
              id="studio-shot-voiceover"
              rows={2}
              value={voiceover}
              maxLength={SCRIPT_VOICEOVER_MAX}
              disabled={!canEdit}
              onChange={(e) => setVoiceover(e.target.value)}
            />

            {/* 環境音：分鏡的第三軌（畫面／旁白／環境音）。這裡只編描述——
                真的要生成音效請到分鏡表的單格工作室「環境音」分頁，
                那裡有模型選擇、預估點數與試聽，不在創作室重做一套。 */}
            <label htmlFor="studio-shot-ambience">環境音（這一鏡聽得到什麼）</label>
            <textarea
              id="studio-shot-ambience"
              rows={2}
              value={ambience}
              maxLength={SCRIPT_AMBIENCE_MAX}
              disabled={!canEdit}
              placeholder="例：遠處鐘聲，細微鳥鳴，風吹過樹葉（可留白＝這鏡沒有環境音）"
              onChange={(e) => setAmbience(e.target.value)}
            />
            <Hint>寫的是聲音本身、不是台詞。存好之後到單格工作室的「環境音」分頁就能生成。</Hint>

            <div className="studio-ai__actions">
              <Button
                size="sm"
                variant="primary"
                disabled={!canEdit || !dirty || update.isPending}
                onClick={() =>
                  update.mutate({ sceneId: shot.id, title: title.trim() || shot.title, durationSec, prompt, voiceover, ambience })
                }
              >
                {update.isPending ? "儲存中…" : dirty ? "儲存這一鏡" : "已儲存 ✓"}
              </Button>
              <Button
                size="sm"
                variant="tonal"
                disabled={!canEdit || boardEmpty || saveState === "uploading"}
                onClick={() => { void saveBoardToShot(); }}
              >
                <Icon name="Image" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                {saveState === "uploading" ? "存入中…" : "把白板存成這一鏡的畫面"}
              </Button>
            </div>
            {boardEmpty && <Hint>白板還是空的——畫幾筆之後就能把手稿存成這一鏡的畫面（進素材庫，可再換回舊版本）。</Hint>}
            {saveState === "done" && <Meta role="status" style={{ color: "var(--success-ink)" }}>已存成這一鏡的畫面 ✓</Meta>}
            {saveError && <p className="error" role="alert">{saveError}</p>}
            {update.error && <p className="error" role="alert">儲存失敗：{update.error.message}</p>}
          </>
        )}
      </Card>

      <Card as="section" variant="quiet" data-fb="創作室・AI 畫草圖">
        <h3 className="studio-ai__title">
          <Icon name="Sparkles" size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          AI 畫草圖
        </h3>
        <label htmlFor="studio-sketch-prompt">跟 AI 說這一鏡要看到什麼，它畫在白板上</label>
        <textarea
          id="studio-sketch-prompt"
          rows={2}
          value={sketchPrompt}
          maxLength={500}
          disabled={!canEdit || sketchMutation.isPending || replaying}
          placeholder="例：一個人在山路上往右走，遠處有夕陽"
          onChange={(e) => setSketchPrompt(e.target.value)}
        />
        <div className="studio-ai__actions">
          {replaying ? (
            <Button size="sm" variant="tonal" onClick={stopReplay}>
              <Icon name="X" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              停（已畫的留著）
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={!canEdit || sketchMutation.isPending || sketchPrompt.trim().length < SKETCH_PROMPT_MIN}
              onClick={() => {
                // 白板現況在按下的瞬間算（不是 render 時）：AI 拿到的是送出當下的畫面
                const board = sketch.summarize();
                sketchMutation.mutate({
                  projectId,
                  prompt: sketchPrompt.trim(),
                  // 選了分鏡就帶上：伺服器抓前後鏡做連戲（主體、場景、銀幕方向接上一鏡）
                  sceneId: shot?.id,
                  // 空白板不帶摘要：省 token，AI 的空白板提示與從前完全一致
                  board: board.strokeCount > 0 ? board : undefined,
                  boardW: sketch.boardW,
                  boardH: sketch.boardH,
                  maxStrokes: sketch.maxStrokes,
                });
              }}
            >
              {sketchMutation.isPending ? "AI 構圖中…" : "AI 畫草圖（0 點）"}
            </Button>
          )}
          {shot?.prompt && !replaying && !sketchMutation.isPending && (
            <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => setSketchPrompt(shot.prompt ?? "")}>
              帶入這一鏡的提示詞
            </Button>
          )}
        </div>
        {/* 停用的按鈕在手機上按下去毫無反應，畫面又沒說原因——看起來就是「這功能壞了」。
            按鈕本身停用（避免送出注定畫不好的一兩個字），但一定要講清楚差在哪。 */}
        {!replaying && !sketchMutation.isPending && canEdit && sketchPrompt.trim().length < SKETCH_PROMPT_MIN && (
          <Hint role="status">
            {sketchPrompt.trim().length === 0
              ? `先在上面寫這一鏡要看到什麼（至少 ${SKETCH_PROMPT_MIN} 個字），按鈕就會亮起來。`
              : `再多寫幾個字（至少 ${SKETCH_PROMPT_MIN} 個字）就能按了。`}
          </Hint>
        )}
        {!canEdit && <Hint role="status">你在這個專案是檢視者，不能請 AI 畫草圖。</Hint>}
        {sketchMutation.error && <p className="error" role="alert">AI 畫圖失敗：{sketchMutation.error.message}</p>}
        {replaying && (
          <Meta role="status" as="p" style={{ margin: "4px 0 0" }}>
            AI 正在白板上作畫…可隨時按停，已畫的會留著。
          </Meta>
        )}
        {sketchMutation.data?.fallback && !sketchMutation.isPending && (
          // LLM 失敗：沒有畫任何東西——這是錯誤不是成果，不准講成「畫好了」
          <p className="error" role="alert">
            AI 暫時沒回應，這次沒有畫任何東西。
            {sketchMutation.data.limitNotice ? `（${sketchMutation.data.limitNotice}）` : "稍等一下再試一次。"}
          </p>
        )}
        {sketchMutation.data && !sketchMutation.data.fallback && !replaying && !sketchMutation.isPending && (
          <Meta role="status" as="p" style={{ margin: "4px 0 0" }}>
            畫好了：{sketchMutation.data.doc.strokes.length} 筆
            {sketchMutation.data.droppedStrokes > 0 ? `（超過白板上限，省略了 ${sketchMutation.data.droppedStrokes} 筆）` : ""}
            {clippedByBoard > 0 ? `（白板剩餘空間不足，另有 ${clippedByBoard} 筆沒畫上——清空白板可畫完整版）` : ""}
            {sketchMutation.data.mock ? "・示範模式（不是依你的描述畫的）" : ""}
            {shot
              ? "。看完沒問題，就用上面「把白板存成這一鏡的畫面」收進分鏡。"
              : "。目前沒選分鏡，這張會存成自由塗鴉——到分鏡表選一鏡後，才能把它存成那一鏡的畫面。"}
          </Meta>
        )}
        <Hint>
          AI 畫的是分鏡構圖草稿（框、簡筆人物、運鏡箭頭），不是精緻插畫。
          {shot ? "會參考上一鏡／下一鏡的畫面與走位自動連戲。" : "選一鏡再畫，AI 會參考前後鏡自動連戲。"}
          白板已有筆畫時，AI 看得到哪裡有東西——會把新內容補進空白處、不重畫外框；想從白紙開始，先按白板的清空。
        </Hint>
      </Card>

      <Card as="section" variant="quiet" data-fb="創作室・AI 導演建議">
        <h3 className="studio-ai__title">
          <Icon name="Sparkles" size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          想不到怎麼描述
        </h3>
        <Button size="sm" variant="tonal" disabled={!canEdit || suggest.isPending} onClick={() => suggest.mutate({ projectId })}>
          {suggest.isPending ? "AI 想中…" : "讓 AI 依專案背景給 3 個畫面建議"}
        </Button>
        {suggest.error && <p className="error" role="alert">{suggest.error.message}</p>}
        {suggest.data?.limitNotice && <Hint role="status">{suggest.data.limitNotice}</Hint>}
        {suggest.data && (
          <ul className="studio-ai__suggestions">
            {suggest.data.suggestions.map((s, i) => (
              <li key={`${s.title}-${i}`}>
                <b>{s.title}</b>
                <p>{s.prompt}</p>
                <span className="studio-ai__suggestion-actions">
                  {shot && (
                    <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => setPrompt(s.prompt)}>
                      填進這一鏡
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canEdit || addDraft.isPending}
                    onClick={() => addDraft.mutate({ projectId, title: s.title.slice(0, 60), prompt: s.prompt })}
                  >
                    存成新的一鏡
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {suggest.data?.mock && (
          <Meta as="p" style={{ fontSize: "var(--fs-11)" }}>
            {suggest.data.fallback ? "AI 暫時沒回應，先給你一組示範方向。" : "示範模式：這是範例建議，不是 AI 生成的。"}
          </Meta>
        )}
      </Card>

      <Card as="section" variant="quiet" data-fb="創作室・拆分鏡">
        <h3 className="studio-ai__title">
          <Icon name="FileText" size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          已經有腳本
        </h3>
        {rawScript === null ? (
          <Button size="sm" variant="tonal" disabled={!canEdit} onClick={() => setRawScript("")}>
            貼腳本，一次拆成整份分鏡
          </Button>
        ) : (
          <>
            <label htmlFor="studio-raw-script">貼上腳本（AI 會切成一幕一幕，接在現有分鏡後面）</label>
            <textarea
              id="studio-raw-script"
              rows={6}
              value={rawScript}
              onChange={(e) => setRawScript(e.target.value)}
              placeholder="貼上完整腳本或開示稿；空白行分段。留空則改用知識庫裡的腳本。"
            />
            <div className="studio-ai__actions">
              <Button
                size="sm"
                variant="primary"
                disabled={split.isPending}
                onClick={() => split.mutate({ projectId, scriptText: rawScript.trim() || undefined })}
              >
                {split.isPending ? "拆分鏡中…" : "AI 拆分鏡"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setRawScript(null); split.reset(); }}>取消</Button>
            </div>
            {split.error && <p className="error" role="alert">拆分鏡失敗：{split.error.message}</p>}
            {split.data?.truncation && (
              <Hint role="status" style={{ color: "var(--gold-ink)" }}>
                腳本過長，這次只送了前 {split.data.truncation.sentChars.toLocaleString()} 字
                （共 {split.data.truncation.totalChars.toLocaleString()} 字）——尾段沒有拆進來。
                刪掉已拆好的前段，再按一次就能接著拆。
              </Hint>
            )}
          </>
        )}
        <Hint>拆出來的是草稿分鏡（含建議畫面與旁白），不會動到現有的鏡，也不會自動出圖。</Hint>
      </Card>
    </div>
  );
}
