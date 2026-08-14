import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../api";
import { MAX_GENERATE_CHARACTERS, MAX_GENERATE_PROPS, MAX_GENERATE_SCENE_PRESETS } from "@shared/cardLimits";
import { MODELS, estimatePoints, getModel, tierLabel } from "@shared/models";
import { groupVisualVariantBatches, isSceneRefineModel, isSceneRegenModel, refineGroupOf, type SceneVersion, type SceneVersionRole } from "@shared/sceneVersions";
import { parseSpeechLines } from "@shared/sceneSpeech";
import { parseMusicMarker } from "@shared/sceneMusic";
import { CREATIVE_KEEP_LABEL, MAX_CREATIVE_DIRECTIONS, MIN_CREATIVE_DIRECTIONS, diagnoseDirectionBatch, sanitizeDirection, type CreativeKeepFamily } from "@shared/creativeDirections";
import { CREATIVE_INTENTS, defaultCreativeDirections, findCreativeIntent } from "@shared/creativeDirectionPresets";
import { VisualChoicePreview } from "../features/storyboard-center/VisualChoicePreview";
import { Icon } from "./Icon";
import { SceneAnnotationLayer } from "./SceneAnnotationLayer";
import { ConfirmButton, HelpTip, useFocusTrap } from "./interactions";
import { AssetAudio, AssetImg, AssetVideo } from "./MediaFallback";
import { relSeen } from "../push";
import { Button, Card, EmptyState, Hint, Meta, Pill, Skeleton, type PillStatus } from "./ui";
import { ConflictNotice, conflictFromError } from "./ConflictNotice";
import { formatTMs } from "@shared/timecode";
import { discussInMessages } from "../discuss";

/** 提示詞上限：與後端 MAX_PROMPT_CHARS／scenes.update 同口徑 */
const MAX_PROMPT_CHARS = 4000;
/** 配音詞上限：與後端 scenes.update 的 voiceover z.string().max(2000) 同口徑 */
const MAX_VOICEOVER_CHARS = 2000;
/** 逐格生成的預設模型（與 SceneList 同一支，換頁不會突然變別的模型） */
const DEFAULT_REGEN_MODEL = "fal-ai/fast-lightning-sdxl";
/** 對白上限：與後端 scenes.update 的 dialogue z.string().max(2000) 同口徑 */
const MAX_DIALOGUE_CHARS = 2000;

/** 配樂標記上限：與後端 scenes.update 的 music z.string().max(300) 同口徑 */
const MAX_MUSIC_CHARS = 300;

/** 動作走位上限：與後端 scenes.update 的 action z.string().max(500) 同口徑 */
const MAX_ACTION_CHARS = 500;

/** 環境音描述上限：與後端 scenes.update 的 ambience z.string().max(500) 同口徑 */
const MAX_AMBIENCE_CHARS = 500;

/** 逐格環境音的後端預設音效模型（scenes.generateAmbience 未帶 modelId 時用它）——前端只拿來顯示預估點數 */
const DEFAULT_AMBIENCE_MODEL = "fal-ai/elevenlabs/sound-effects/v2";

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

/**
 * 版本清單的三段（畫面／旁白／環境音），順序＝工作室分頁的順序。
 *
 * 三軌各自編版次（`buildSceneVersions` 的 counters 就是分 role 數的），所以清單一定要跟著分段：
 * 混在一起渲染會出現「第 1 版」連續出現三次，而且看不出哪一版屬於哪一軌——
 * 更糟的是切現用時分不清要寫進哪個指標欄。label 也在這裡定義，避免各處自己拼字串而漏掉環境音。
 */
const VERSION_SECTIONS: Array<{ role: SceneVersionRole; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { role: "visual", label: "畫面", icon: "Image" },
  { role: "narration", label: "旁白", icon: "Volume2" },
  { role: "ambience", label: "環境音", icon: "Music" },
];

type StudioTab = "regen" | "refine" | "voice" | "ambience" | "versions" | "annotations";

const TABS: Array<{ id: StudioTab; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { id: "refine", label: "修正這張", icon: "Palette" },
  { id: "regen", label: "重畫這格", icon: "Sparkles" },
  { id: "voice", label: "配音", icon: "Mic" },
  { id: "ambience", label: "環境音", icon: "Music" },
  { id: "versions", label: "版本", icon: "Clock" },
  { id: "annotations", label: "標注", icon: "Highlighter" },
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
 * 五件事在同一個畫面裡（這是與分鏡列最大的差別——分鏡列一次看全片，這裡只看一格）：
 * 1. **修正這張**：以現用畫面（或任何一版）當底圖送圖生圖／圖生影片——保留構圖只改指定的地方。
 * 2. **重畫這格**：換模型從頭重畫，適合構圖本身要換掉。
 * 3. **配音**：編這一格的配音詞、生成中文旁白、就地試聽——單格的深改只有這一個入口。
 * 4. **環境音**：這一鏡聽得到什麼（鐘聲、蟲鳴）。與配音同流程但送音效模型，各自成軌。
 * 5. **版本**：這一格歷來每一次生成都在，含模型／指示／花了幾點；一鍵切回任何一版，可逆。
 *
 * 現用是哪一版的單一真相是 scenes.assetId／narrationAssetId／ambienceAssetId（伺服器端），
 * 本元件只呈現與觸發，不自己保存版本狀態。
 */
export function SceneStudio({
  sceneId,
  projectId,
  sceneNumber,
  canEdit,
  charIds,
  sceneIds,
  propIds,
  onClose,
  onChanged,
  nav,
}: {
  sceneId: string;
  projectId: string;
  /** 第幾鏡（1 起算），只用於標題與無障礙標籤 */
  sceneNumber: number;
  canEdit: boolean;
  /** 前後鏡導航（§4）：由呼叫端傳入，工作室本身不需要知道整片有幾鏡 */
  nav?: import("react").ReactNode;
  /** 生成台勾選的角色／場景卡：工作室的重生與修正也注入同一套錨點，畫風不分岔 */
  charIds?: string[];
  sceneIds?: string[];
  /** 素材設定卡：與角色／場景同口徑，只在這一鏡沒有自己的綁定時當 fallback */
  propIds?: string[];
  onClose: () => void;
  /** 這一格被改動（存檔／送生成／切版本）時通知外層刷新分鏡列 */
  onChanged: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLElement>(null);
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<StudioTab>("refine");
  const [promptDraft, setPromptDraft] = useState<string | null>(null); // null＝跟隨伺服器
  const [voiceDraft, setVoiceDraft] = useState<string | null>(null); // null＝跟隨伺服器
  const [ambienceDraft, setAmbienceDraft] = useState<string | null>(null); // null＝跟隨伺服器
  const [actionDraft, setActionDraft] = useState<string | null>(null); // null＝跟隨伺服器
  const [dialogueDraft, setDialogueDraft] = useState<string | null>(null); // null＝跟隨伺服器
  const [musicDraft, setMusicDraft] = useState<string | null>(null); // null＝跟隨伺服器
  const [instruction, setInstruction] = useState("");
  /** 修正用的底圖；null＝這一格目前的畫面 */
  const [baseAssetId, setBaseAssetId] = useState<string | null>(null);
  /** 舞台上看的是哪一版；null＝現用 */
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  /** 只存使用者勾來比較的既有 asset ids；版本內容仍以 scenes.versions 為唯一真相。 */
  const [compareAssetIds, setCompareAssetIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  /** 並排 vs 同位置快速切換——細微的光線／構圖差異只有在同位置切換時看得出來 */
  const [compareMode, setCompareMode] = useState<"grid" | "ab">("grid");
  const [abIndex, setAbIndex] = useState(0);
  /**
   * 這一批「送出當下就失敗、連生成列都沒建起來」的 slot（額度不足／政策擋下 → 伺服器
   * 刪掉待生成列，DB 沒有痕跡可推導）。只有這一類是真的推不出來的，所以只有它留在
   * 記憶體，並且明說「重新整理後就看不到了」——其餘狀態一律由版本清單推導。
   */
  const [launchErrors, setLaunchErrors] = useState<Array<{ directionLabel: string; error: string }>>([]);
  /** 使用者這一輪挑的創作方向；空＝用起手包預設三方向 */
  const [directionIntentId, setDirectionIntentId] = useState<string>(CREATIVE_INTENTS[0]!.id);
  const [pickedDirectionIds, setPickedDirectionIds] = useState<string[] | null>(null);
  /** 血緣：從哪一版按下「再用這版變體」的（null＝從這一鏡當下的狀態出發） */
  const [variantParentAssetId, setVariantParentAssetId] = useState<string | null>(null);
  useFocusTrap(panelRef, !compareOpen, onClose);
  useFocusTrap(compareRef, compareOpen, () => setCompareOpen(false));
  /**
   * 標注模式（顯式開關，不是「按著某個鍵」）：開啟時舞台不吃捲動手勢、游標變十字。
   * 手機上沒有 hover 也沒有修飾鍵，隱式模式在觸控裝置上根本用不了。
   */
  const [annotating, setAnnotating] = useState(false);
  /** 舞台容器：時間碼留言的「點留言 → seek 到 00:18」要找得到舞台上的 video */
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** 把舞台影片跳到某個時間碼並暫停——暫停是刻意的：跳過去是要「看那一格畫面」，不是繼續播 */
  const seekStageTo = (tMs: number) => {
    const video = stageRef.current?.querySelector("video");
    if (!video) return;
    video.currentTime = tMs / 1000;
    video.pause();
  };
  /** 剛點下、還沒送出的座標；null＝沒有待輸入的標注 */
  const [pendingPoint, setPendingPoint] = useState<{ ax: number; ay: number; tMs?: number } | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
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
      // 真的有東西在跑才用快節奏。v3 是「批次還沒自動開過 Compare」就一直 4 秒一次，
      // 於是卡在等待成本核准的批次會讓整個工作室無限期高頻輪詢（組長可能隔天才來核准）。
      refetchInterval: (query) => (query.state.data?.summary.generating ? 4_000 : 20_000),
    },
  );
  const data = versions.data;
  const list = useMemo(() => data?.versions ?? [], [data]);
  const visualVersions = useMemo(() => list.filter((v) => v.role === "visual"), [list]);
  const narrationVersions = useMemo(() => list.filter((v) => v.role === "narration"), [list]);
  const ambienceVersions = useMemo(() => list.filter((v) => v.role === "ambience"), [list]);
  /** 版本頁分段渲染的資料來源；空的段落先濾掉——沒有環境音的分鏡不該看到一個空的「環境音」標題 */
  const versionSections = useMemo(
    () =>
      VERSION_SECTIONS.map((section) => ({
        ...section,
        items:
          section.role === "narration" ? narrationVersions : section.role === "ambience" ? ambienceVersions : visualVersions,
      })).filter((section) => section.items.length > 0),
    [visualVersions, narrationVersions, ambienceVersions],
  );
  const currentVisual = visualVersions.find((v) => v.isCurrent);
  const compareVersions = useMemo(
    () => compareAssetIds
      .map((assetId) => visualVersions.find((version) => version.assetId === assetId))
      .filter((version): version is SceneVersion => !!version?.assetUrl),
    [compareAssetIds, visualVersions],
  );
  /**
   * 變體批次**完全由持久化的版本清單推導**（batchId 存在 generations.params 內）。
   *
   * v3 是把批次身分放在 React state：關掉工作室、換一鏡、按 F5，「A 成功／B 失敗／
   * C 等待核准」就整組消失，reload 之後只剩一串沒有分組的版本。現在同一批在任何一次
   * 查詢都湊得回來，也不需要第二個 candidate 資料表。
   */
  /** A/B 目前看的是哪一版；比較清單變短時夾回範圍內，不要指到不存在的索引 */
  const abVersion = compareVersions[Math.min(abIndex, Math.max(0, compareVersions.length - 1))];
  const variantBatches = useMemo(() => groupVisualVariantBatches(visualVersions), [visualVersions]);
  const latestBatch = variantBatches[0] ?? null;
  /** 這一批還沒結算＝要加快輪詢；等待成本核准可能拖很久，那段改用慢節奏（見下方 refetchInterval） */
  const batchRunning = !!latestBatch && latestBatch.generating.length > 0;

  /**
   * 自動開 Compare 只對「這次工作室裡送出的那一批」做一次。
   *
   * 只比對 batchId 不夠：每次打開工作室，上一次留下的已結算批次都是「還沒自動開過」，
   * 於是一進來就被全螢幕 Compare 蓋住。這裡只認本次 mount 之後由使用者送出的批次。
   */
  const launchedBatchId = useRef<string | null>(null);
  const autoOpenedBatchId = useRef<string | null>(null);
  useEffect(() => {
    if (!latestBatch || !latestBatch.settled) return;
    if (launchedBatchId.current !== latestBatch.batchId) return; // 不是這次送出的，不要跳出來
    if (autoOpenedBatchId.current === latestBatch.batchId) return;
    autoOpenedBatchId.current = latestBatch.batchId;
    if (latestBatch.compareAssetIds.length >= 2) {
      setCompareAssetIds(latestBatch.compareAssetIds);
      setCompareOpen(true);
    }
  }, [latestBatch]);
  // 畫面的寫入 gate 只看 visual：summary.generating 不分 role（它的用途是決定輪詢節奏），
  // 拿它擋修正/重畫會讓「配音生成中」連帶鎖死畫面——與後端明寫的
  // 「旁白獨立於畫面，配音生成中不該擋住畫面重生，反之亦然」相反，
  // 也與分鏡列不一致（listByProject 的 pendingGenStatus 已排除 narration）。
  const isGenerating = visualVersions.some((v) => v.state === "generating");

  /**
   * 這一格的標注。includeResolved：已改好的仍要看得到（空心圓點），
   * 否則「處理完了」在畫面上等同「從來沒發生過」，沒人知道那裡曾經被指出過問題。
   */
  const annotationsQ = trpc.messages.listByRef.useQuery(
    { projectId, refType: "scene", refId: sceneId, includeResolved: true },
    { refetchInterval: 30_000 },
  );
  const annotations = useMemo(() => annotationsQ.data ?? [], [annotationsQ.data]);
  /**
   * 舞台上這一版的圓點。
   *
   * **標注釘死在它被畫下的那一版，不自動浮動**——換版往往換構圖，自動浮到新版上一定會
   * 標錯地方，比不指還糟。所以這裡嚴格比對 anchorAssetId；其他版的標注收成上方橫幅。
   * 編號用「這一版之內的序號」，使用者看到的 1/2/3 與圓點一致。
   */

  const refresh = () => {
    utils.scenes.versions.invalidate({ sceneId });
    onChanged();
  };
  const refreshAnnotations = () => {
    utils.messages.listByRef.invalidate({ projectId, refType: "scene", refId: sceneId });
    utils.messages.openCountsByScene.invalidate({ projectId });
  };
  const postAnnotation = trpc.messages.postAnnotation.useMutation({
    onSuccess: () => {
      setPendingPoint(null);
      setAnnotationDraft("");
      refreshAnnotations();
    },
  });
  const resolveAnnotation = trpc.messages.resolveAnnotation.useMutation({ onSuccess: refreshAnnotations });
  /**
   * meta.collabScope：讓協作廣播帶得出「改的是哪一格」，接收端才只失效分鏡相關查詢
   * 而不是整棵 tRPC 快取，並在那一格上亮一下。**沒標的沿用全域失效**——這是刻意的
   * 漸進遷移，首波只標分鏡這幾支（標錯 scope 比不標更糟：對方該刷新的東西沒刷新，
   * 而且畫面上完全看不出來）。
   */
  const sceneScope = { collabScope: { kind: "scene", id: sceneId } } as const;
  const update = trpc.scenes.update.useMutation({
    meta: { ...sceneScope, collabLabel: "改了這一鏡的內容" },
    onSuccess: () => { setPromptDraft(null); refresh(); },
  });
  // 配音詞另開一支 update：存提示詞與存配音詞的 pending／已儲存回饋各自獨立，不互相污染
  const saveVoice = trpc.scenes.update.useMutation({ onSuccess: () => { setVoiceDraft(null); refresh(); } });
  // 冪等鍵（QA-007）：還沒成功的重送沿用同鍵——timeout 重按不重複扣點；成功才換新鍵
  const regenRequestId = useRef(crypto.randomUUID());
  /**
   * 這一輪變體的分組鍵與每個 slot 的冪等鍵。送出成功後整組換新——
   * 沿用舊鍵會撞回同一批（伺服器正確地不重複計費，但使用者會以為自己又產了三個新的）。
   * 送出失敗時**刻意不換**：那才是「重送同一批不重複計費」真正成立的情況。
   */
  const variantBatchRef = useRef({
    batchId: crypto.randomUUID(),
    requestIds: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
  });
  const refineRequestId = useRef(crypto.randomUUID());
  const voiceRequestId = useRef(crypto.randomUUID());
  const ambienceRequestId = useRef(crypto.randomUUID());
  const regen = trpc.scenes.generateInto.useMutation({
    onSuccess: () => { regenRequestId.current = crypto.randomUUID(); setTab("versions"); refresh(); },
  });
  const generateVariants = trpc.scenes.generateVariants.useMutation({
    onSuccess: (result) => {
      // 成功送出的 slot 不必記在前端——它們的 batchId 已經落在 generations 裡，
      // 版本清單自己湊得回來。這裡只留下「連生成列都沒建起來」的那幾個 slot 的原因，
      // 因為那一類伺服器端沒有留痕，不留就等於使用者被靜默少給一個變體。
      const failures = result.results.filter((row): row is Extract<(typeof result.results)[number], { ok: false }> => !row.ok);
      setLaunchErrors(failures.map((row) => ({ directionLabel: row.directionLabel, error: row.error })));
      launchedBatchId.current = result.batchId; // 只有這一批完成時才自動跳出 Compare
      /*
       * 冪等鍵只在**整批都成功**時換新。
       *
       * generateVariants 是 Promise.allSettled：部分 slot 失敗時整支 mutation 仍然
       * resolve，所以這裡照樣會跑。舊版無條件換鍵 ⇒ 使用者照著畫面上的
       * 「重按不重複計費」再按一次，送出的是三把全新的鍵，已經成功的那個方向
       * 會被重新生成、重新扣點——而額度冪等是綁 generationId 的，全新的鍵救不了。
       * 失敗時保留整批鍵：重按會用同一批鍵補送，成功的那幾筆撞回既有列不重複計費。
       */
      if (failures.length === 0) {
        variantBatchRef.current = {
          batchId: crypto.randomUUID(),
          requestIds: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
        };
        setVariantParentAssetId(null); // 血緣綁定只屬於這一批，不該延續到下一批
      }
      setTab("versions");
      refresh();
    },
  });
  const refine = trpc.scenes.refine.useMutation({
    onSuccess: () => { refineRequestId.current = crypto.randomUUID(); setTab("versions"); refresh(); },
  });
  // 完成後留在配音頁（試聽就在同一頁出現），不像重畫/修正要跳到版本頁看進度
  const generateVoiceover = trpc.scenes.generateVoiceover.useMutation({
    onSuccess: () => { voiceRequestId.current = crypto.randomUUID(); refresh(); },
  });
  // 環境音描述另開一支 update，理由同配音詞：三種「儲存中／已儲存」回饋不能互相污染
  const saveAmbience = trpc.scenes.update.useMutation({ onSuccess: () => { setAmbienceDraft(null); refresh(); } });
  // 走位另開一支 update，理由同配音詞與環境音：各自的「儲存中／已儲存」不能互相污染
  const saveAction = trpc.scenes.update.useMutation({ onSuccess: () => { setActionDraft(null); refresh(); } });
  const saveDialogue = trpc.scenes.update.useMutation({ onSuccess: () => { setDialogueDraft(null); refresh(); } });
  const saveMusic = trpc.scenes.update.useMutation({ onSuccess: () => { setMusicDraft(null); refresh(); } });
  const generateAmbience = trpc.scenes.generateAmbience.useMutation({
    onSuccess: () => { ambienceRequestId.current = crypto.randomUUID(); refresh(); },
  });
  /** 採用時如果一併同步了鏡頭語言，把伺服器回報的差異顯示出來（不做靜默寫入） */
  const [adoptedDirection, setAdoptedDirection] = useState<string[]>([]);
  const setCurrent = trpc.scenes.setVisualFromAsset.useMutation({
    meta: { ...sceneScope, collabLabel: "換了這一鏡的現用版本" },
    onSuccess: (result) => {
      setPreviewAssetId(null);
      setAdoptedDirection((result as { adoptedDirection?: string[] })?.adoptedDirection ?? []);
      refresh();
    },
  });
  const actionError = update.error ?? saveVoice.error ?? saveAmbience.error ?? saveAction.error ?? saveDialogue.error ?? saveMusic.error ?? regen.error ?? generateVariants.error ?? refine.error ?? generateVoiceover.error ?? generateAmbience.error ?? setCurrent.error;

  /**
   * 存檔載荷的併發欄位（shared/revision.ts）。
   *
   * `expectedRev` 是我載入這一格時的版本，`baseline` 是我要改的那一欄當時的值。
   * 伺服器靠這兩樣分得出「我們改了同一欄」（要問人）與「我們各改各的」（直接合併），
   * 不會拿一個根本沒衝突的衝突來煩人，也不會讓誰的字靜默消失。
   */
  const revArgs = (field: string) => ({
    expectedRev: data?.rev,
    baseline: { [field]: (data as Record<string, unknown> | undefined)?.[field] ?? null },
  });

  /** 目前撞到的欄位（哪一支存檔撞的）——衝突卡要知道「重新套用」該重送什麼 */
  const conflictField =
    (update.error && "prompt") ||
    (saveVoice.error && "voiceover") ||
    (saveAction.error && "action") ||
    (saveDialogue.error && "dialogue") ||
    (saveAmbience.error && "ambience") ||
    (saveMusic.error && "music") ||
    null;
  const conflict = conflictFromError(actionError);

  /**
   * 「重新套用我的修改」：以**對方那一版的 rev** 重送我的值。
   *
   * 刻意仍然走一次併發檢查，而不是無條件寫回去——無條件寫回只是把靜默覆蓋
   * 換了個按鈕名字。若在我看衝突卡的期間又有第三個人改了，這一發會再撞一次，
   * 而那正是應該的。
   */
  const reapply = () => {
    if (!conflict || !conflictField) return;
    const value =
      conflictField === "prompt" ? prompt
      : conflictField === "voiceover" ? voiceover
      : conflictField === "action" ? action
      : conflictField === "dialogue" ? dialogue
      : conflictField === "ambience" ? ambience
      : music;
    const args = {
      sceneId,
      [conflictField]: value,
      expectedRev: conflict.currentRev,
      baseline: { [conflictField]: (conflict.currentData as Record<string, unknown>)[conflictField] ?? null },
    } as Parameters<typeof update.mutate>[0];
    const runner =
      conflictField === "prompt" ? update
      : conflictField === "voiceover" ? saveVoice
      : conflictField === "action" ? saveAction
      : conflictField === "dialogue" ? saveDialogue
      : conflictField === "ambience" ? saveAmbience
      : saveMusic;
    runner.mutate(args);
  };

  /** 「查看新版」：把我的草稿換成對方的版本（我的字進了輸入框歷程，仍可用復原鍵拿回） */
  const viewLatest = () => {
    if (!conflict || !conflictField) return;
    const next = String((conflict.currentData as Record<string, unknown>)[conflictField] ?? "");
    const setter =
      conflictField === "prompt" ? setPromptDraft
      : conflictField === "voiceover" ? setVoiceDraft
      : conflictField === "action" ? setActionDraft
      : conflictField === "dialogue" ? setDialogueDraft
      : conflictField === "ambience" ? setAmbienceDraft
      : setMusicDraft;
    setter(next);
    refresh();
  };

  const prompt = promptDraft ?? data?.prompt ?? "";
  const promptDirty = promptDraft !== null && promptDraft !== (data?.prompt ?? "");
  const voiceover = voiceDraft ?? data?.voiceover ?? "";
  const voiceDirty = voiceDraft !== null && voiceDraft !== (data?.voiceover ?? "");
  /** 後端生成旁白吃的是「已儲存」的配音詞——估點與可否生成都以它為準 */
  const savedVoiceover = data?.voiceover ?? "";
  const dialogue = dialogueDraft ?? data?.dialogue ?? "";
  const dialogueDirty = dialogueDraft !== null && dialogueDraft !== (data?.dialogue ?? "");
  const savedDialogue = data?.dialogue ?? "";
  // 即時回饋「系統讀懂了幾句、誰是誰」——@ 打錯就會看到句數不對，不必等生成完才發現
  const speechPreview = useMemo(() => parseSpeechLines(dialogue), [dialogue]);
  const music = musicDraft ?? data?.music ?? "";
  const musicDirty = musicDraft !== null && musicDraft !== (data?.music ?? "");
  const musicMarker = useMemo(() => parseMusicMarker(music), [music]);
  const action = actionDraft ?? data?.action ?? "";
  const actionDirty = actionDraft !== null && actionDraft !== (data?.action ?? "");
  const ambience = ambienceDraft ?? data?.ambience ?? "";
  const ambienceDirty = ambienceDraft !== null && ambienceDraft !== (data?.ambience ?? "");
  const savedAmbience = data?.ambience ?? "";

  const regenModel = getModel(regenModelId) ?? getModel(DEFAULT_REGEN_MODEL);

  /**
   * 這一輪要生成的創作方向。
   *
   * 預設＝所選意圖的全部方向；使用者可以取消勾選（少花點數）或自己組合。
   * 上限與伺服器的 MAX_CREATIVE_DIRECTIONS 同一個常數，不在 UI 另寫一個數字。
   */
  const intentDirections = useMemo(
    () => findCreativeIntent(directionIntentId)?.directions ?? defaultCreativeDirections(),
    [directionIntentId],
  );
  const activeDirections = useMemo(() => {
    const chosen = pickedDirectionIds
      ? intentDirections.filter((direction) => pickedDirectionIds.includes(direction.id))
      : intentDirections;
    return chosen.slice(0, MAX_CREATIVE_DIRECTIONS);
  }, [intentDirections, pickedDirectionIds]);
  const toggleDirection = (id: string) => {
    setPickedDirectionIds((current) => {
      const base = current ?? intentDirections.map((direction) => direction.id);
      return base.includes(id) ? base.filter((row) => row !== id) : [...base, id];
    });
  };
  /** 這批方向套到這一鏡之後真的彼此不同嗎——重疊就先講，不要等使用者花完點數才發現 */
  const directionDiagnosis = useMemo(
    () => diagnoseDirectionBatch(
      { camera: data?.camera ?? null, performance: data?.performance ?? null, action: data?.action ?? null },
      activeDirections,
    ),
    [data?.camera, data?.performance, data?.action, activeDirections],
  );
  // 估點跟著實際要送的方向數走；寫死 ×3 會在使用者只選兩個方向時多報一個工作的錢
  const variantEstimatedPoints = (regenModel?.points ?? 0) * activeDirections.length;
  const refineModel = getModel(refineModelId);
  const refinePoints = refineModel ? estimatePoints(refineModel, { promptChars: instruction.length }) : undefined;
  // 配音走按字計費的中文 TTS：估點依「已儲存的配音詞」長度算，與後端扣點同一函式——顯示＝扣點
  const ttsModel = getModel(DEFAULT_TTS_MODEL);
  const ttsPoints = ttsModel ? estimatePoints(ttsModel, { promptChars: savedVoiceover.length }) : undefined;
  const currentNarration = narrationVersions.find((v) => v.isCurrent);
  /**
   * 待核准也算「這一軌被佔住」——與後端 generateVoiceover 的在途判定同口徑。
   * 只看 generating 的話，超額進入待核的那筆不會讓按鈕變成停用狀態，使用者按下去必吃
   * CONFLICT 紅字，而且畫面上完全沒有「在等組長核准」的線索——看起來就是按鈕壞了。
   */
  const isVoicing =
    narrationVersions.some((v) => v.state === "generating" || v.state === "awaiting_approval")
    || generateVoiceover.isPending;
  const voicingAwaitingApproval = narrationVersions.some((v) => v.state === "awaiting_approval");
  // 環境音走 text-to-audio（音效），估點口徑與配音同一支 estimatePoints
  const ambienceModel = getModel(DEFAULT_AMBIENCE_MODEL);
  const ambiencePoints = ambienceModel ? estimatePoints(ambienceModel, { promptChars: savedAmbience.length }) : undefined;
  const currentAmbience = ambienceVersions.find((v) => v.isCurrent);
  /** 同 isVoicing：後端把 awaiting_approval 也算在途，前端 gate 不跟上就只剩紅字 */
  const isAmbiencing =
    ambienceVersions.some((v) => v.state === "generating" || v.state === "awaiting_approval")
    || generateAmbience.isPending;
  const ambiencingAwaitingApproval = ambienceVersions.some((v) => v.state === "awaiting_approval");

  /** 修正的底圖：指定的那一版，或這一格現用畫面 */
  const baseVersion = baseAssetId ? list.find((v) => v.assetId === baseAssetId) : currentVisual;
  const baseUsable = !!baseVersion?.canRefineFrom;
  /** 舞台上顯示的那一版（預覽某一版時用它，否則現用） */
  const stageVersion = previewAssetId ? list.find((v) => v.assetId === previewAssetId) ?? currentVisual : currentVisual;

  const stageAssetId = stageVersion?.assetId ?? null;
  const stageDots = useMemo(
    () =>
      annotations
        .filter((a) => a.anchorAssetId && a.anchorAssetId === stageAssetId && a.ax != null && a.ay != null)
        .map((a, i) => ({ id: a.id, ax: a.ax!, ay: a.ay!, resolvedAt: a.resolvedAt, index: i + 1, tMs: a.tMs })),
    [annotations, stageAssetId],
  );
  /** 不在這一版、且還沒改好的標注數——換版之後「還有東西沒處理」不能就這樣消失在畫面外 */
  const otherOpenCount = useMemo(
    () => annotations.filter((a) => !a.resolvedAt && a.anchorAssetId && a.anchorAssetId !== stageAssetId).length,
    [annotations, stageAssetId],
  );

  const refineBlocked = !refineModel || !baseUsable || instruction.trim() === "" || isGenerating || refine.isPending;
  const regenBlocked = !regenModel || prompt.trim() === "" || isGenerating || regen.isPending || generateVariants.isPending;

  const useVersionAsBase = (v: SceneVersion) => {
    setBaseAssetId(v.assetId);
    setPreviewAssetId(v.assetId);
    setTab("refine");
  };

  /**
   * 切成現用：音訊一定要把 role 帶上去。
   * 不帶的話後端 setVisualFromAsset 會走 sceneSlotForAssetKind("audio") 的預設落點（旁白軌），
   * 於是在環境音那一段按「設為現用」會把音效寫進 narrationAssetId——環境音沒換到、旁白反而被蓋掉。
   * 反過來，畫面那一段不能帶 role：後端明擋「只有音訊素材可以指定要進旁白還是環境音」。
   */
  /**
   * 採用某一版。
   *
   * 單格工作室是「人正看著這一鏡」的地方，所以這裡帶 acknowledgeApproved——
   * 已通過的鏡在這裡換得掉畫面（伺服器會同時把審核狀態退回「需要修改」），
   * 而分鏡中心的批次套用不帶這個旗標，因此換不動已通過的鏡。
   */
  /**
   * 採用某一版。
   *
   * `syncShotDirection` 只在單格工作室帶：這裡是人正看著這一鏡、看得到方向標籤的地方，
   * 而且採用之後 UI 會把伺服器回報的 adoptedDirection 明白列出來。分鏡中心的批次
   * 「套用素材」不帶這個旗標，所以不會用一張圖的凍結設定覆寫 N 鏡的鏡頭語言。
   */
  const setCurrentVersion = (role: SceneVersionRole, assetId: string) =>
    setCurrent.mutate(role === "visual"
      ? { sceneId, assetId, acknowledgeApproved: true, syncShotDirection: true }
      : { sceneId, assetId, role });

  const toggleCompare = (assetId: string) => {
    setCompareAssetIds((current) => {
      if (current.includes(assetId)) return current.filter((id) => id !== assetId);
      return current.length >= 3 ? [...current.slice(1), assetId] : [...current, assetId];
    });
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

        {/* §4 前後鏡導航：不必關掉工作室、回分鏡表、再點下一鏡——那三步會把連續製作切碎 */}
        {nav}

        {versions.isError && (
          <p className="error" role="alert">
            版本讀不到（不是資料不見了）——
            <Button variant="ghost" size="sm" onClick={() => versions.refetch()}>再試一次</Button>
          </p>
        )}
        {/* 併發衝突走專屬的卡片：它要說出「誰改了什麼」並給出路，
            而不是把使用者丟在一句「操作失敗」前面重打一次然後再撞一次。 */}
        {conflict ? (
          <ConflictNotice
            conflict={conflict}
            onReapply={reapply}
            onViewLatest={viewLatest}
            reapplying={update.isPending || saveVoice.isPending || saveAction.isPending || saveDialogue.isPending || saveAmbience.isPending || saveMusic.isPending}
          />
        ) : actionError ? (
          <p className="error" role="alert">操作失敗：{actionError.message}</p>
        ) : null}

        <div className="scene-studio__body">
          {/* ── 舞台：這一格現在長什麼樣（或正在看的那一版） ───────────────── */}
          <div className="scene-studio__stage" ref={stageRef}>
            {versions.isLoading ? (
              <Skeleton style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: "var(--r-12)" }} />
            ) : stageVersion?.assetUrl ? (
              <SceneAnnotationLayer
                annotations={stageDots}
                annotating={annotating}
                onPick={(p) => { setPendingPoint(p); setTab("annotations"); }}
                onSelect={(id) => { setSelectedAnnotationId(id); setTab("annotations"); }}
                selectedId={selectedAnnotationId}
              >
              {stageVersion.assetKind === "video" ? (
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
              )}
              </SceneAnnotationLayer>
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
              {canEdit && stageVersion?.assetId && (
                <Button
                  size="sm"
                  variant={annotating ? "primary" : "tonal"}
                  aria-pressed={annotating}
                  onClick={() => { setAnnotating((v) => !v); setPendingPoint(null); }}
                  title="開啟後在畫面上點一下，就能指出這裡要改"
                >
                  <Icon name="Highlighter" size={13} /> {annotating ? "標注中（點畫面）" : "標注"}
                </Button>
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
                  onClick={() => setCurrent.mutate({ sceneId, assetId: stageVersion.assetId!, acknowledgeApproved: true })}
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
                  <Button size="sm" disabled={!promptDirty || update.isPending} onClick={() => update.mutate({ sceneId, prompt, ...revArgs("prompt") })}>
                    {update.isPending ? "儲存中…" : "儲存提示詞"}
                  </Button>
                  {promptDirty ? <Meta>尚未儲存</Meta> : update.isSuccess ? <Meta style={{ color: "var(--success-ink)" }}>已儲存 <Icon name="Check" size={12} /></Meta> : null}
                </div>
              )}
            </div>

            <div>
              <label htmlFor={`studio-action-${sceneId}`} style={{ fontSize: "var(--fs-12)", margin: 0 }}>
                這一鏡的動作走位
                <HelpTip text="誰做了什麼、從哪走到哪。刻意與提示詞分開：走位是會動的，單張圖畫不出來——所以它只會送給影片類模型，重畫靜圖時不會用到。" />
              </label>
              <textarea
                id={`studio-action-${sceneId}`}
                value={action}
                disabled={!canEdit || saveAction.isPending}
                maxLength={MAX_ACTION_CHARS}
                rows={2}
                placeholder="例：安倢從門口走到窗邊，停下（可留白＝這鏡沒有特別的走位）"
                onChange={(e) => setActionDraft(e.target.value)}
                style={{ fontSize: "var(--fs-13)", padding: "6px 9px", width: "100%" }}
              />
              {canEdit && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Button size="sm" disabled={!actionDirty || saveAction.isPending} onClick={() => saveAction.mutate({ sceneId, action, ...revArgs("action") })}>
                    {saveAction.isPending ? "儲存中…" : "儲存走位"}
                  </Button>
                  {actionDirty ? <Meta>尚未儲存</Meta> : saveAction.isSuccess ? <Meta style={{ color: "var(--success-ink)" }}>已儲存 <Icon name="Check" size={12} /></Meta> : null}
                  <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>只送影片模型，出靜圖不吃</Meta>
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
                  <Hint>你是檢視者，只能回看版本，不能修改這一格。</Hint>
                ) : !baseUsable ? (
                  <Hint>
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
                    {/*
                      動作走位唯一接得上的生成路徑。
                      「重畫這格」選影片模型時，走位由 sceneVisualPrompt 自動接在畫面後面；但「讓這張動起來」
                      走的是修正這條路，提示詞是使用者當場打的指示，伺服器不該擅自接上去（那會跟他打的字打架）。
                      於是這一鏡明明寫好了「安倢從門口走到窗邊」，要讓它動起來時還得再打一次。
                      一顆按鈕把它填進去就好——只在指示還空著時出現，永遠不會蓋掉使用者打的字。
                    */}
                    {refineModel && refineGroupOf(refineModel) === "video" && action.trim() !== "" && instruction.trim() === "" && (
                      <Hint>
                        這一鏡的動作走位是「{action.trim()}」。
                        <Button size="sm" variant="ghost" onClick={() => setInstruction(action.trim())}>
                          用它當修正指示
                        </Button>
                      </Hint>
                    )}
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
                              propIds: propIds?.length ? propIds.slice(0, MAX_GENERATE_PROPS) : undefined,
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
                  <Hint>你是檢視者，只能回看版本，不能修改這一格。</Hint>
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
                    {prompt.trim() === "" && <Hint>先在上面寫這一格的提示詞才能重畫。</Hint>}
                    {promptDirty && <Hint>提示詞還沒儲存——先按「儲存提示詞」，重畫才會用新的。</Hint>}
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
                              propIds: propIds?.length ? propIds.slice(0, MAX_GENERATE_PROPS) : undefined,
                            })
                          }
                        >
                          <Icon name="Sparkles" size={14} /> 重畫這格{regenModel ? `（約 −${regenModel.points} 點）` : ""}
                        </ConfirmButton>
                      )}
                    </div>
                    <section className="scene-variant-launch" aria-label="創作方向">
                      <div className="scene-variant-launch__head">
                        <div>
                          <strong>換個方向再試一次</strong>
                          <Meta as="div">
                            選一個你想解決的問題，Aios 給你 {activeDirections.length} 個真的不同的做法。
                            角色臉、造型、場景、Style 都保持不變，只換鏡頭、光線與動作。
                          </Meta>
                        </div>
                        {variantParentAssetId && (
                          // 誠實用字：這一批走的是「重畫」模型（沒有圖片輸入槽），
                          // parentAssetId 記錄的是「從哪一版接著想」，不是「以那張圖為底重繪」。
                          // 想以某張圖為底改，那是「以這版修正」（image-to-image）那條路。
                          <button
                            type="button"
                            className="scene-lineage-chip"
                            aria-label="取消這次的延伸標記"
                            onClick={() => setVariantParentAssetId(null)}
                          >
                            接續 V{visualVersions.find((v) => v.assetId === variantParentAssetId)?.index ?? "?"} 的想法（重新生成，不以該圖為底）
                            <Icon name="X" size={12} />
                          </button>
                        )}
                      </div>

                      <div className="scene-intent-strip" role="tablist" aria-label="你想解決什麼">
                        {CREATIVE_INTENTS.map((intent) => (
                          <button
                            key={intent.id}
                            type="button"
                            role="tab"
                            aria-selected={directionIntentId === intent.id}
                            className={directionIntentId === intent.id ? "is-active" : undefined}
                            title={intent.hint}
                            onClick={() => { setDirectionIntentId(intent.id); setPickedDirectionIds(null); }}
                          >
                            {intent.label}
                          </button>
                        ))}
                      </div>

                      <div className="scene-direction-grid" role="group" aria-label="這一輪要生成哪幾個方向">
                        {intentDirections.map((direction) => {
                          const picked = activeDirections.some((row) => row.id === direction.id);
                          return (
                            <button
                              key={direction.id}
                              type="button"
                              aria-pressed={picked}
                              className={`scene-direction-card${picked ? " is-picked" : ""}`}
                              disabled={!canEdit}
                              onClick={() => toggleDirection(direction.id)}
                            >
                              {direction.previewResource && <VisualChoicePreview resource={direction.previewResource} />}
                              <span className="scene-direction-card__copy">
                                <strong>{direction.label}</strong>
                                {direction.rationale && <Meta as="span">{direction.rationale}</Meta>}
                              </span>
                              {picked && <Pill status="queued">會生成</Pill>}
                            </button>
                          );
                        })}
                      </div>

                      {directionDiagnosis.duplicates.length > 0 && (
                        <Hint>這幾個方向對這一鏡的效果重疊，換一個組合比較不會白花點數。</Hint>
                      )}
                      {directionDiagnosis.noop.length > 0 && (
                        <Hint>
                          有 {directionDiagnosis.noop.length} 個方向這一鏡已經是這樣了——生成出來會很接近現在這張，仍然會扣點。
                        </Hint>
                      )}
                      {activeDirections.length < MIN_CREATIVE_DIRECTIONS && (
                        // 按鈕變灰而沒有理由，使用者只會以為壞了
                        <Hint id={`variant-min-${sceneId}`}>
                          至少選 2 個方向才能比較。只想改一項的話，用上面的「重畫這格」或「修正這張」。
                        </Hint>
                      )}

                      <ConfirmButton
                        triggerClassName="tonal"
                        disabled={regenBlocked || activeDirections.length < MIN_CREATIVE_DIRECTIONS}
                        triggerTitle="每個方向各送出一個真實生成工作"
                        message={`將送出 ${activeDirections.length} 個各自獨立的生成（${regenModel?.label ?? regenModelId}，合計預估 −${variantEstimatedPoints} 點）：${activeDirections.map((row) => row.label).join("、")}。完成前不會換掉這一鏡現在的畫面。若其中幾個沒送出成功，再按一次只會補送沒成功的那幾個，不會重複收費。`}
                        confirmLabel={`確認產生 ${activeDirections.length} 個方向`}
                        onConfirm={() => {
                          setLaunchErrors([]);
                          generateVariants.mutate({
                            sceneId,
                            modelId: regenModelId,
                            batchId: variantBatchRef.current.batchId,
                            ...(variantParentAssetId ? { parentAssetId: variantParentAssetId } : {}),
                            variants: activeDirections.map((direction, index) => ({
                              clientRequestId: variantBatchRef.current.requestIds[index]!,
                              // sanitizeDirection 是送出邊界：起手包的方向帶著 previewResource
                              // 這種純顯示欄位，而伺服器的 schema 是 .strict()——直接送整包會被
                              // 400 擋掉（實際踩過：每一次「產生方向」都靜默失敗）。
                              // 它同時也是越權欄位的第二道濾網（AI 提案／未來的自訂方向都走這裡）。
                              direction: sanitizeDirection(direction),
                            })),
                            characterIds: charIds?.length ? charIds.slice(0, MAX_GENERATE_CHARACTERS) : undefined,
                            scenePresetIds: sceneIds?.length ? sceneIds.slice(0, MAX_GENERATE_SCENE_PRESETS) : undefined,
                            propIds: propIds?.length ? propIds.slice(0, MAX_GENERATE_PROPS) : undefined,
                          });
                        }}
                      >
                        <Icon name="LayoutGrid" size={14} />{" "}
                        {generateVariants.isPending ? "送出中…" : `產生 ${activeDirections.length} 個方向（約 −${variantEstimatedPoints} 點）`}
                      </ConfirmButton>
                    </section>
                  </>
                )}
              </div>
            )}

            {/* 配音：編這一格的配音詞、生成中文旁白、就地試聽——分鏡列的深改都收到這裡 */}
            {tab === "voice" && (
              <div role="tabpanel" id={`studio-panel-voice-${sceneId}`} aria-labelledby={`studio-tab-voice-${sceneId}`}>
                {!canEdit ? (
                  <Hint>你是檢視者，只能試聽旁白，不能修改配音詞。</Hint>
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
                      <Button size="sm" disabled={!voiceDirty || saveVoice.isPending} onClick={() => saveVoice.mutate({ sceneId, voiceover, ...revArgs("voiceover") })}>
                        {saveVoice.isPending ? "儲存中…" : "儲存配音詞"}
                      </Button>
                      {voiceDirty ? <Meta>尚未儲存</Meta> : saveVoice.isSuccess ? <Meta style={{ color: "var(--success-ink)" }}>已儲存 <Icon name="Check" size={12} /></Meta> : null}
                    </div>
                    <label htmlFor={`studio-dialogue-${sceneId}`} style={{ fontSize: "var(--fs-12)", margin: "10px 0 0" }}>
                      這一鏡的對白
                      <HelpTip text="一行一句：@師父：坐吧。旁白要插在中間就寫 @旁白：…，順序就是唸出來的順序。括號寫表演指示（@安倢（小聲）：…），不會被唸出來。" />
                    </label>
                    <textarea
                      id={`studio-dialogue-${sceneId}`}
                      value={dialogue}
                      disabled={saveDialogue.isPending}
                      maxLength={MAX_DIALOGUE_CHARS}
                      rows={4}
                      placeholder={"@師父：坐吧。心急的人，茶會燙。\n@安倢（小聲）：謝謝師父。"}
                      onChange={(e) => setDialogueDraft(e.target.value)}
                      style={{ fontSize: "var(--fs-13)", padding: "6px 9px", width: "100%" }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Button size="sm" disabled={!dialogueDirty || saveDialogue.isPending} onClick={() => saveDialogue.mutate({ sceneId, dialogue, ...revArgs("dialogue") })}>
                        {saveDialogue.isPending ? "儲存中…" : "儲存對白"}
                      </Button>
                      {dialogueDirty ? <Meta>尚未儲存</Meta> : saveDialogue.isSuccess ? <Meta style={{ color: "var(--success-ink)" }}>已儲存 <Icon name="Check" size={12} /></Meta> : null}
                      {speechPreview.length > 0 && (
                        <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
                          {speechPreview.filter((l) => !l.isNarration).length} 句對白・
                          {speechPreview.filter((l) => l.isNarration).length} 句旁白
                        </Meta>
                      )}
                    </div>
                    {savedVoiceover.trim() === "" && savedDialogue.trim() === "" && <Hint>先填旁白或對白並儲存，才能生成配音。</Hint>}
                    {voiceDirty && savedVoiceover.trim() !== "" && (
                      <Hint>配音詞還沒儲存——先按「儲存配音詞」，生成才會用新的稿。</Hint>
                    )}
                    <div style={{ marginTop: 8 }}>
                      {isVoicing ? (
                        <Button variant="primary" disabled>
                          {voicingAwaitingApproval ? "配音待核准中…" : "配音生成中…"}
                        </Button>
                      ) : (
                        <ConfirmButton
                          triggerClassName="primary"
                          disabled={(savedVoiceover.trim() === "" && savedDialogue.trim() === "") || voiceDirty || dialogueDirty}
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

            {/* 環境音：這一鏡聽得到什麼。與配音同一套流程，差別只有送去的是音效模型而非 TTS */}
            {tab === "ambience" && (
              <div role="tabpanel" id={`studio-panel-ambience-${sceneId}`} aria-labelledby={`studio-tab-ambience-${sceneId}`}>
                {!canEdit ? (
                  <Hint>你是檢視者，只能試聽環境音，不能修改描述。</Hint>
                ) : (
                  <>
                    <label htmlFor={`studio-ambience-${sceneId}`} style={{ fontSize: "var(--fs-12)", margin: 0 }}>
                      這一鏡聽得到什麼
                      <HelpTip text="描述聲音本身，不是台詞：例「遠處鐘聲，細微鳥鳴，風吹過樹葉」。存好後按「生成環境音」會用音效模型做出來。" />
                    </label>
                    <textarea
                      id={`studio-ambience-${sceneId}`}
                      value={ambience}
                      disabled={saveAmbience.isPending}
                      maxLength={MAX_AMBIENCE_CHARS}
                      rows={3}
                      placeholder="例：遠處鐘聲，細微鳥鳴，風吹過樹葉（可留白＝這鏡沒有環境音）"
                      onChange={(e) => setAmbienceDraft(e.target.value)}
                      style={{ fontSize: "var(--fs-13)", padding: "6px 9px", width: "100%" }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Button size="sm" disabled={!ambienceDirty || saveAmbience.isPending} onClick={() => saveAmbience.mutate({ sceneId, ambience, ...revArgs("ambience") })}>
                        {saveAmbience.isPending ? "儲存中…" : "儲存描述"}
                      </Button>
                      {ambienceDirty ? <Meta>尚未儲存</Meta> : saveAmbience.isSuccess ? <Meta style={{ color: "var(--success-ink)" }}>已儲存 <Icon name="Check" size={12} /></Meta> : null}
                    </div>
                    {savedAmbience.trim() === "" && <Hint>先填環境音描述並儲存，才能生成。</Hint>}
                    {ambienceDirty && savedAmbience.trim() !== "" && (
                      <Hint>描述還沒儲存——先按「儲存描述」，生成才會用新的。</Hint>
                    )}
                    <div style={{ marginTop: 8 }}>
                      {isAmbiencing ? (
                        <Button variant="primary" disabled>
                          {ambiencingAwaitingApproval ? "環境音待核准中…" : "環境音生成中…"}
                        </Button>
                      ) : (
                        <ConfirmButton
                          triggerClassName="primary"
                          disabled={savedAmbience.trim() === "" || ambienceDirty}
                          triggerTitle="用已儲存的描述生成環境音，完成後就在下方試聽"
                          message={`即將生成環境音（${ambienceModel?.label ?? "音效模型"}${ambiencePoints != null ? `，約 −${ambiencePoints} 點` : ""}）；失敗自動退點`}
                          confirmLabel="確認生成"
                          onConfirm={() => generateAmbience.mutate({ sceneId, clientRequestId: ambienceRequestId.current })}
                        >
                          {currentAmbience ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <Icon name="RotateCw" size={14} /> 重生環境音{ambiencePoints != null ? `（約 −${ambiencePoints} 點）` : ""}
                            </span>
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <Icon name="Music" size={14} /> 生成環境音{ambiencePoints != null ? `（約 −${ambiencePoints} 點）` : ""}
                            </span>
                          )}
                        </ConfirmButton>
                      )}
                    </div>
                  </>
                )}
                {canEdit && (
                  <>
                    <label htmlFor={`studio-music-${sceneId}`} style={{ fontSize: "var(--fs-12)", margin: "12px 0 0" }}>
                      配樂（跨鏡）
                      <HelpTip text="配樂通常橫跨好幾鏡：在開始的那一鏡寫「起｜描述」，在結束的下一鏡寫「止」。中間的鏡不必寫。鏡被搬動時區間會自動跟著走。" />
                    </label>
                    <input
                      id={`studio-music-${sceneId}`}
                      value={music}
                      disabled={saveMusic.isPending}
                      maxLength={MAX_MUSIC_CHARS}
                      placeholder="起｜單音鋼琴，極簡，很慢　或　止"
                      onChange={(e) => setMusicDraft(e.target.value)}
                      style={{ fontSize: "var(--fs-13)", padding: "6px 9px", width: "100%" }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Button size="sm" disabled={!musicDirty || saveMusic.isPending} onClick={() => saveMusic.mutate({ sceneId, music, ...revArgs("music") })}>
                        {saveMusic.isPending ? "儲存中…" : "儲存配樂標記"}
                      </Button>
                      {musicDirty ? <Meta>尚未儲存</Meta> : saveMusic.isSuccess ? <Meta style={{ color: "var(--success-ink)" }}>已儲存 <Icon name="Check" size={12} /></Meta> : null}
                      {musicMarker && (
                        <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
                          {musicMarker.kind === "stop" ? "這一鏡起停止配樂" : "從這一鏡開始播"}
                        </Meta>
                      )}
                    </div>
                  </>
                )}
                {currentAmbience?.assetUrl && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <AssetAudio
                      controls
                      preload="none"
                      src={currentAmbience.assetUrl}
                      aria-label={`第 ${sceneNumber} 鏡環境音試聽`}
                      style={{ height: 32, flex: 1, minWidth: 180 }}
                      fallbackLabel="環境音檔遺失——可用「重生環境音」補回"
                    />
                    <Button as="a" size="sm" variant="tonal" href={`/api/assets/${currentAmbience.assetId}/file`} download>
                      <Icon name="Download" size={13} /> 下載環境音
                    </Button>
                  </div>
                )}
                {canEdit && (
                  <Hint style={{ marginTop: 6 }}>
                    環境音與旁白是各自獨立的兩軌，交付包裡也分開放（06_環境音），剪輯時可以各自調音量。
                  </Hint>
                )}
              </div>
            )}

            {/* 版本：歷來每一次生成，可切回、可當底圖、可抄提示詞 */}
            {tab === "versions" && (
              <div role="tabpanel" id={`studio-panel-versions-${sceneId}`} aria-labelledby={`studio-tab-versions-${sceneId}`}>
                {adoptedDirection.length > 0 && (
                  <Hint role="status">
                    已採用這個方向，並把這一鏡的鏡頭語言同步成產生它的那一組：{adoptedDirection.join("・")}。
                    不想要的話，到上方欄位改回來即可。
                  </Hint>
                )}
                {latestBatch && (
                  <div className="scene-variant-status" role="status" aria-live="polite">
                    <div className="scene-variant-status__head">
                      <strong>{latestBatch.settled ? "這一批已結算" : "方向生成中"}</strong>
                      <Meta as="div">
                        成功 {latestBatch.successes.length}/{latestBatch.requested}
                        {latestBatch.failed.length > 0 ? `・失敗 ${latestBatch.failed.length}` : ""}
                        {latestBatch.generating.length > 0 ? `・生成中 ${latestBatch.generating.length}` : ""}
                        {latestBatch.awaitingApproval.length > 0 ? `・等待成本核准 ${latestBatch.awaitingApproval.length}` : ""}
                        {latestBatch.actualPoints > 0 ? `・淨花費 ${latestBatch.actualPoints} 點` : ""}
                      </Meta>
                    </div>
                    {/* 逐個方向各自的狀態——整批只講一個「失敗」會讓成功的那兩個方向看起來也沒了 */}
                    <ul className="scene-variant-slots">
                      {latestBatch.versions.map((version) => (
                        <li key={version.generationId ?? version.assetId} data-state={version.state}>
                          <strong>{version.creative?.directionLabel ?? "維持現況"}</strong>
                          <Pill status={VERSION_STATE[version.state].cls}>{VERSION_STATE[version.state].label}</Pill>
                          {version.state === "failed" && version.error && <Meta as="span">{version.error}</Meta>}
                          {version.assetId && <Meta as="span">V{version.index}</Meta>}
                        </li>
                      ))}
                      {launchErrors.map((row, index) => (
                        <li key={`launch-${index}`} data-state="failed">
                          <strong>{row.directionLabel}</strong>
                          <Pill status="failed">沒送出</Pill>
                          <Meta as="span">{row.error}</Meta>
                        </li>
                      ))}
                    </ul>
                    {latestBatch.missing > 0 && launchErrors.length === 0 && (
                      <Hint>
                        這一批有 {latestBatch.missing} 個方向沒有送出成功（未扣點）。原因只在送出當下顯示過，
                        重新整理後看不到；再按一次「產生方向」會補送同一批，不重複計費。
                      </Hint>
                    )}
                    {latestBatch.settled && latestBatch.successes.length < 2 && (
                      <Hint>成功候選不足 2 個，無法自動並排；成功版本仍保留，已扣點的失敗工作依既有政策退點。</Hint>
                    )}
                  </div>
                )}
                {visualVersions.filter((version) => version.assetUrl).length >= 2 && (
                  <div className="scene-version-compare-bar">
                    <div>
                      <strong>視覺比較</strong>
                      <Meta as="div">
                        勾選 2–3 版並排。採用會換掉這一鏡的現用畫面；若那一版是某個方向跑出來的，
                        會一併把鏡頭語言同步過來（同步了什麼會列出來）。已通過審核的鏡會退回「需要修改」。
                      </Meta>
                    </div>
                    <Button
                      size="sm"
                      variant="tonal"
                      type="button"
                      disabled={compareVersions.length < 2}
                      onClick={() => setCompareOpen(true)}
                    >
                      <Icon name="LayoutGrid" size={13} /> 比較 {compareVersions.length || ""}
                    </Button>
                  </div>
                )}
                {compareOpen && compareVersions.length >= 2 && (
                  <div className="scene-compare-scrim" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setCompareOpen(false); }}>
                    <section ref={compareRef} className="scene-compare-surface" role="dialog" aria-modal="true" aria-label={`第 ${sceneNumber} 鏡版本比較`}>
                      <header>
                        <div>
                          <Meta as="div">COMPARE / ADOPT</Meta>
                          <h3>第 {sceneNumber} 鏡・比較這幾個方向</h3>
                        </div>
                        <div className="scene-compare-modes" role="tablist" aria-label="比較方式">
                          <button type="button" role="tab" aria-selected={compareMode === "grid"} className={compareMode === "grid" ? "is-active" : undefined} onClick={() => setCompareMode("grid")}>並排</button>
                          <button type="button" role="tab" aria-selected={compareMode === "ab"} className={compareMode === "ab" ? "is-active" : undefined} onClick={() => setCompareMode("ab")}>快速切換</button>
                        </div>
                        {/* 手機沒有 hover、也常按不到右上角：關閉鍵放在 header 尾端並保證 44px */}
                        <Button size="sm" variant="ghost" type="button" aria-label="關閉版本比較" onClick={() => setCompareOpen(false)}><Icon name="X" size={16} /></Button>
                      </header>

                      {compareMode === "ab" && (
                        <div className="scene-compare-ab">
                          {/*
                            A/B 快速切換：同一個位置換圖，眼睛不必在兩張之間掃描——
                            細微的光線／構圖差異只有在同位置切換時才看得出來。
                            一次只掛一個媒體元素，影片也不會全部同時載入。
                          */}
                          <div className="scene-compare-ab__stage">
                            {abVersion && (abVersion.assetKind === "video" ? (
                              <AssetVideo key={abVersion.assetId} src={abVersion.assetUrl!} controls preload="metadata" fallbackLabel="版本影片" />
                            ) : (
                              <AssetImg key={abVersion.assetId} src={abVersion.assetUrl!} alt={`畫面第 ${abVersion.index} 版`} fallbackLabel="版本圖片" />
                            ))}
                          </div>
                          <div className="scene-compare-ab__switch" role="tablist" aria-label="切換要看哪一版">
                            {compareVersions.map((version, index) => (
                              <button
                                key={version.assetId}
                                type="button"
                                role="tab"
                                aria-selected={abIndex === index}
                                className={abIndex === index ? "is-active" : undefined}
                                onClick={() => setAbIndex(index)}
                              >
                                <strong>V{version.index}</strong>
                                <span>{version.creative?.directionLabel ?? (version.isCurrent ? "現用" : "候選")}</span>
                              </button>
                            ))}
                          </div>
                          {abVersion && (
                            <div className="scene-compare-ab__meta">
                              {abVersion.isCurrent && <Pill status="done">CURRENT</Pill>}
                              {abVersion.creative && <Pill status="queued">{abVersion.creative.directionLabel}</Pill>}
                              {abVersion.parentIndex && <Meta as="span">從 V{abVersion.parentIndex} 延伸</Meta>}
                              {abVersion.canSetCurrent && canEdit && (
                                <Button variant="primary" size="sm" disabled={setCurrent.isPending} onClick={() => setCurrentVersion("visual", abVersion.assetId!)}>
                                  <Icon name="Check" size={13} /> 採用 V{abVersion.index}
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {compareMode === "grid" && (
                        <div className="scene-compare-grid">
                          {compareVersions.map((version) => (
                            <article key={version.assetId} className={version.isCurrent ? "is-current" : undefined}>
                              {version.assetKind === "video" ? (
                                // 刻意不 autoPlay：三個影片同時播放在手機上會直接把記憶體吃掉，
                                // 而且沒有人能同時看三段影片。preload="none" 讓使用者按了才載。
                                <AssetVideo src={version.assetUrl!} controls preload="none" fallbackLabel="版本影片" />
                              ) : (
                                <AssetImg src={version.assetUrl!} alt={`畫面第 ${version.index} 版`} loading="lazy" fallbackLabel="版本圖片" />
                              )}
                              <div className="scene-compare-card__meta">
                                <div className="scene-compare-card__title">
                                  <strong>V{version.index}</strong>
                                  {version.isCurrent && <Pill status="done">CURRENT</Pill>}
                                  {!version.isCurrent && <Pill status={VERSION_STATE[version.state].cls}>{VERSION_STATE[version.state].label}</Pill>}
                                </div>
                                {/* 方向標籤：使用者比較的是「哪個做法」，不是「第幾次生成」 */}
                                {version.creative && <strong className="scene-compare-card__direction">{version.creative.directionLabel}</strong>}
                                <Meta>
                                  {version.modelId ? getModel(version.modelId)?.label ?? version.modelId : "外部帶入"}
                                  {version.points > 0 ? `・${version.points} 點` : ""}
                                  {version.parentIndex ? `・從 V${version.parentIndex} 延伸` : ""}
                                </Meta>
                                {version.creative?.keep?.length ? <Meta>保持：{version.creative.keep.map((family) => CREATIVE_KEEP_LABEL[family as CreativeKeepFamily] ?? family).join("、")}</Meta> : null}
                                {version.prompt && <p>{version.prompt}</p>}
                                <div className="scene-compare-card__actions">
                                  {version.canSetCurrent && canEdit && (
                                    <Button variant="primary" size="sm" disabled={setCurrent.isPending} onClick={() => setCurrentVersion("visual", version.assetId!)}>
                                      <Icon name="Check" size={13} /> 採用 V{version.index}
                                    </Button>
                                  )}
                                  {canEdit && version.assetId && (
                                    // 方向選擇器在「重畫這格」分頁；跳到「修正這張」等於把使用者
                                    // 丟到一個沒有方向 UI 的地方，還把他剛選的版本忘掉。
                                    <Button size="sm" variant="ghost" onClick={() => { setCompareOpen(false); setVariantParentAssetId(version.assetId!); setTab("regen"); }}>
                                      <Icon name="LayoutGrid" size={13} /> 從這版換方向
                                    </Button>
                                  )}
                                  {version.canRefineFrom && canEdit && <Button size="sm" variant="ghost" onClick={() => { setCompareOpen(false); useVersionAsBase(version); }}><Icon name="Palette" size={13} /> 以這版修正</Button>}
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                      <Hint>採用後其他候選仍保留在版本歷史；重新整理會從 `scenes.assetId` 讀回同一個現用版本。若這一版是某個方向跑出來的，採用時會一併把該方向的鏡頭語言同步回這一鏡。</Hint>
                    </section>
                  </div>
                )}
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
                  // 外層沿用 .scene-studio__versions 當唯一的捲動容器（三段共用一條捲軸），
                  // 段落自己再開一個 ul：版次是分軌編的，同一份清單混排會出現三個「第 1 版」。
                  <div className="scene-studio__versions">
                    {versionSections.map((section) => (
                      <section key={section.role} aria-label={`${section.label}版本`}>
                        <Meta as="div" style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
                          <Icon name={section.icon} size={12} /> {section.label}・共 {section.items.length} 版
                        </Meta>
                        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                          {section.items.map((v) => (
                            <li key={v.generationId ?? v.assetId} className={`scene-studio__version${v.isCurrent ? " is-current" : ""}`}>
                              {v.assetUrl && v.assetKind !== "audio" ? (
                                <button
                                  type="button"
                                  className="scene-studio__vthumb"
                                  title="在左側看這一版"
                                  aria-label={`預覽${section.label}第 ${v.index} 版`}
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
                                  {/* 沒有縮圖時用該軌的圖示代表它是哪一軌（音訊本來就沒有畫面可看） */}
                                  <Icon name={v.state === "generating" ? "Loader" : section.icon} className={v.state === "generating" ? "spin" : undefined} size={16} />
                                </div>
                              )}
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  <b style={{ fontSize: "var(--fs-13)" }}>{section.label}第 {v.index} 版</b>
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
                                      <Button size="sm" disabled={setCurrent.isPending} onClick={() => setCurrentVersion(section.role, v.assetId!)}>
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
                                    {section.role === "visual" && v.assetId && v.assetUrl && (
                                      <label className="scene-version-compare-toggle">
                                        <input
                                          type="checkbox"
                                          checked={compareAssetIds.includes(v.assetId)}
                                          onChange={() => toggleCompare(v.assetId!)}
                                        />
                                        加入比較
                                      </label>
                                    )}
                                    {/* 討論綁「這一版」（refType=asset），不是綁整格——
                                        「V2 的人物眼神不對」與「Shot 08 有問題」不是同一件事。
                                        走既有的 discussInMessages 匯流排：引用卡、跳回原處、
                                        手機 sheet 交棒全部沿用，不開第二套留言。 */}
                                    {v.assetId && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        data-testid="discuss-version"
                                        onClick={() =>
                                          discussInMessages({
                                            refType: "asset",
                                            refId: v.assetId!,
                                            title: `第 ${sceneNumber} 鏡・${section.label}第 ${v.index} 版`,
                                          })
                                        }
                                      >
                                        <Icon name="MessageCircle" size={13} /> 討論這一版
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
                {data?.truncated && <Hint style={{ marginTop: 6 }}>版本很多，這裡只顯示最近 120 版。</Hint>}
              </div>
            )}

            {tab === "annotations" && (
              <div>
                <Meta as="div" style={{ marginBottom: 6 }}>
                  在畫面上點一下就能指出「這裡要改」。標注**釘在它被畫下的那一版**——
                  換版通常也換了構圖，讓標注自動浮到新版一定會標錯地方，比不指還糟。
                </Meta>
                {otherOpenCount > 0 && (
                  <Hint style={{ marginBottom: 8 }}>
                    另有 {otherOpenCount} 則未改好的標注在別的版本上（切到那一版才看得到圓點）。
                  </Hint>
                )}
                {pendingPoint && (
                  <div style={{ marginBottom: 8 }}>
                    <label className="field">
                      <span>這裡要改什麼？（可 @夥伴，他才收得到通知）</span>
                      <textarea
                        rows={3}
                        maxLength={2000}
                        autoFocus
                        value={annotationDraft}
                        onChange={(e) => setAnnotationDraft(e.target.value)}
                        placeholder="例：這盞路燈太亮，壓過主角的臉"
                      />
                    </label>
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!annotationDraft.trim() || postAnnotation.isPending || !stageVersion?.assetId}
                        onClick={() =>
                          postAnnotation.mutate({
                            projectId,
                            sceneId,
                            anchorAssetId: stageVersion!.assetId!,
                            ax: pendingPoint.ax,
                            ay: pendingPoint.ay,
                            // 影片標注帶時間碼（點擊當下的播放頭）；靜態圖為 undefined
                            tMs: pendingPoint.tMs,
                            body: annotationDraft.trim(),
                          })
                        }
                      >
                        <Icon name="Check" size={13} /> 送出標注
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setPendingPoint(null); setAnnotationDraft(""); }}>
                        取消
                      </Button>
                    </div>
                    {postAnnotation.error && <p className="error" role="alert">{postAnnotation.error.message}</p>}
                  </div>
                )}
                {annotationsQ.isLoading && <Skeleton style={{ height: 80, borderRadius: 8 }} role="status" aria-label="載入中" />}
                {!annotationsQ.isLoading && annotations.length === 0 && !pendingPoint && (
                  <EmptyState
                    icon={<Icon name="Highlighter" />}
                    title={<>這一格還沒有標注</>}
                    description={<>按舞台上的「標注」，然後在畫面上點你想改的地方。</>}
                  />
                )}
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {annotations.map((a) => {
                    const onStage = a.anchorAssetId === stageAssetId;
                    const dotIndex = stageDots.find((d) => d.id === a.id)?.index;
                    return (
                      <li
                        key={a.id}
                        className={`scene-studio__version${selectedAnnotationId === a.id ? " is-current" : ""}`}
                        style={{ opacity: a.resolvedAt ? 0.6 : 1 }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <b style={{ fontSize: "var(--fs-13)" }}>
                              {dotIndex ? `第 ${dotIndex} 則・` : ""}{a.userName}
                            </b>
                            {/* 影片時間碼：「00:18 · 韋澔」。點了就把舞台影片跳到那一刻——
                                「這裡人物切太快」的「這裡」終於指得回去。標注在別的版本時
                                先不給 seek（要先「看那一版」，否則會跳錯影片）。 */}
                            {a.tMs != null && (
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid="tms-seek"
                                disabled={!onStage}
                                title={onStage ? `跳到 ${formatTMs(a.tMs)}` : "標注在別的版本上——先「看那一版」"}
                                style={{ padding: "2px 8px", fontSize: "var(--fs-11)", fontVariantNumeric: "tabular-nums" }}
                                onClick={() => {
                                  seekStageTo(a.tMs!);
                                  setSelectedAnnotationId(a.id);
                                }}
                              >
                                <Icon name="Play" size={10} /> {formatTMs(a.tMs)}
                              </Button>
                            )}
                            {a.resolvedAt && <Pill status="done">已改好</Pill>}
                            {!onStage && <Meta>在別的版本上</Meta>}
                          </div>
                          <Meta as="div" style={{ whiteSpace: "pre-wrap" }}>{a.body}</Meta>
                          <Meta as="div">{relSeen(a.createdAt)}</Meta>
                          {canEdit && (
                            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                              {/* 任何組員都能收掉——「這件事我處理完了」不該是組長專屬 */}
                              <Button
                                size="sm"
                                variant={a.resolvedAt ? "ghost" : "tonal"}
                                disabled={resolveAnnotation.isPending}
                                onClick={() => resolveAnnotation.mutate({ messageId: a.id, resolved: !a.resolvedAt })}
                              >
                                <Icon name={a.resolvedAt ? "Undo2" : "Check"} size={13} />
                                {a.resolvedAt ? " 還是要改" : " 這版已改好"}
                              </Button>
                              {!onStage && a.anchorAssetId && (
                                <Button size="sm" variant="ghost" onClick={() => setPreviewAssetId(a.anchorAssetId)}>
                                  <Icon name="Image" size={13} /> 看那一版
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {resolveAnnotation.error && <p className="error" role="alert">{resolveAnnotation.error.message}</p>}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
