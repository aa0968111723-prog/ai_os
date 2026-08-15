/**
 * 生成核心積木（自 routers/generation.ts 抽出，行為不變）：
 * - submitGenerationCore：世界觀/角色/場景注入 → 額度守門扣點 → fal 送出（失敗退點）。
 * - advanceGeneration：推進一筆生成的 fal 狀態並落 DB（done 入素材庫、failed 退點）。
 * 抽成服務層的原因：後端工作流執行器（workflowRunner）要在 tRPC 請求之外重用同一批
 * 防護（孤兒列刪除、CAS 推進、退點）——邏輯若複製兩份，防護遲早分岔。
 * 錯誤沿用 TRPCError：tRPC 端原樣拋出；伺服器內部呼叫端只讀 message（都是人話訊息）。
 */
import { and, eq, inArray, isNull, like, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { getModel, endpointOf, isNimModel, isGeminiModel, generationProviderOf, supportsNegativePrompt, supportsSeed, CARD_ANCHOR_CATEGORIES, WORLDVIEW_INJECT_CATEGORIES, type ProjectFormat, type ModelEntry } from "../../shared/models";
import { SOURCE_INCOMPAT } from "../../shared/sourceIncompat";
import { measurePromptBudget } from "./promptTokens";
import type { PromptBudgetReport } from "../../shared/promptBudget";
import { getModelContract } from "./modelContractStore";
import { storeGenerationSourceMeta, splitGenerationSourceMeta, type GenerationAblationMeta, type GenerationBenchMeta, type GenerationCreativeMeta } from "../../shared/generationSourceMeta";
import { resolveModel, estimatePointsFor } from "./modelResolve";
import {
  worldviewSchema,
  formatWorldviewVisualPositive,
  formatWorldviewVisualNegative,
  formatWorldviewInjectedPrompt,
  formatWorldviewForAi,
  CARD_ANCHOR_MARKERS,
  type Worldview,
} from "../../shared/worldview";
import { falSubmit, falStatus, billingBypassed, isMockMode } from "./fal";
import { nimSubmit, nimStatus } from "./nvidia-nim";
import { geminiSubmit, geminiStatus } from "./gemini";
import { parseStoredResultUrl } from "./storage";
import { failStaleGenerationTx, reserveQuota } from "./points";
import { resolveByokFalKey, byokFalOpts } from "./byokBilling";
import { persistRemote, signAssetUrl } from "./storage";
import { formatCharacterAnchor, formatPropAnchor, formatSceneAnchor, resolveCarriedPropIds } from "./cardAnchors";
import { mergePropIdsWithCarried } from "../../shared/propOwnership";
import { MAX_GENERATE_PROPS } from "../../shared/cardLimits";
import type { ContinuitySnapshot, ContinuityShotDirection } from "../../shared/continuity";
import {
  applyContinuityReferences,
  analyzeContinuitySnapshot,
  buildContinuitySnapshot,
  emptyContinuitySnapshot,
  resolveContinuityReferenceUrls,
  type ContinuityReferenceResult,
  type ContinuityCoverage,
} from "./continuity";
import { groupLeaderIds, pushToUsers } from "./webPush";
import { publishToProject } from "./realtime";
import {
  findAiTraceSessionBySource,
  recordAiTraceEventSafely,
  updateAiTraceSession,
} from "./aiTrace";

export type GenerationRow = typeof schema.generations.$inferSelect;

/**
 * 正式模式不可當「圖／影／音 編輯模型」來源的佔位網址：
 * /api/mock-asset/* 是 e2e 假生成用的 1×1 圖或舊域名殘留，fal image-edit 抓到會 422。
 * 只在 !isMockMode 擋下——e2e 假生成本身仍靠 mock 佔位走完流程。
 */
export function isUnusableRealModeSourceUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return /\/api\/mock-asset\//i.test(url);
}

/** 把供應商原始錯誤轉成使用者可行動的說明（存進 generations.error／推播）。 */
export function humanizeGenerationError(raw: string | undefined | null): string {
  const msg = (raw ?? "").trim() || "未知錯誤";
  if (/aborted due to timeout|TimeoutError|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(msg)) {
    return "AI 模型回應逾時——上游服務忙碌或網路不穩，點數已退回，請稍後重試";
  }
  if (/fal result 422/i.test(msg)) {
    // 若 fal.ts 已附提示就原樣用；否則補上常見原因
    return msg.includes("來源圖")
      ? msg
      : `${msg}——常見原因：來源圖網址無法被生成服務抓取。請改用素材庫中真實可開啟的圖片，勿用測試佔位圖`;
  }
  return msg;
}

/**
 * 成品落地（背景）：fal 的 CDN 網址會過期，完成後盡快抓回 Volume 永久保存。
 * 失敗不影響主流程（外部網址短期內仍可用），之後輪詢會再看到未落地素材可重試。
 */
function persistGenerationResult(assetId: string, generationId: string, remoteUrl: string): void {
  void (async () => {
    const persisted = await persistRemote(remoteUrl);
    if (!persisted) return;
    const localUrl = `/api/assets/${assetId}/file`;
    await db
      .update(schema.assets)
      .set({ storagePath: persisted.storagePath, mime: persisted.mime, sizeBytes: persisted.sizeBytes, url: localUrl })
      .where(eq(schema.assets.id, assetId));
    await db
      .update(schema.generations)
      .set({ resultUrl: localUrl, updatedAt: new Date() })
      .where(eq(schema.generations.id, generationId));
    console.log(`[storage] 成品已落地：asset=${assetId}（${persisted.sizeBytes}B ${persisted.mime}）`);
  })().catch((err) => console.warn("[storage] 成品落地背景作業失敗：", err instanceof Error ? err.message : err));
}

/** 注入結果：正向提示詞＋（視覺類別的）負向提示詞。 */
export interface PromptParts {
  positive: string;
  negative: string;
}

/**
 * 世界觀 → 提示詞注入(「懂我們」的核心:上下文自動帶入每次生成)。
 * visual＝formatWorldviewVisualPositive（tones/styles + 短 logline + message；**不含**觀眾／三幕／人物）。
 * LLM＝formatWorldviewForAi(..., "generation-llm")（themes、短進階觀眾／三幕／人物、taboos 正向）。
 * 禁忌詞（合規句）分流——這是深度優化的關鍵：
 *   - 視覺（圖/影）：走 negative_prompt（見 effectivePromptParts 的 negative）。擴散模型無法靠正向詞
 *     「避免」某物，塞正向反而可能被畫出、甚至把禁忌字當畫面文字渲染——故正向不再放禁忌詞。
 *   - LLM：維持正向文字指引（語言模型讀得懂「避免:…」）。
 *   - text-to-audio（配樂/音效）：兩邊都不放（合規句對音頻無意義，原本塞正向是雜訊）。
 */
function buildPositive(userPrompt: string, worldview: Worldview, visual: boolean, isLlm: boolean): string {
  const bg = visual
    ? formatWorldviewVisualPositive(worldview)
    : isLlm
      ? formatWorldviewForAi(worldview, "generation-llm")
      : "";
  return formatWorldviewInjectedPrompt(userPrompt, bg);
}

/**
 * 來源素材「明顯不相容」表：單一真相在 shared/sourceIncompat.ts
 * （前端 generationGates 同源匯入，避免 client/server 漂移）。
 */
const SOURCE_KIND_LABEL: Record<string, string> = { image: "圖片", video: "影片", audio: "音訊", doc: "文件", zip: "zip 壓縮包" };

/** 哪些類別注入世界觀(TTS 會唸出注入文字、轉錄/視覺/訓練/影片工具不適用 → 不注入) */
// 修 GEN-202：text-to-audio（配樂/音效）移出注入名單——世界觀的「核心訊息／避免禁忌」是敘事文字，
// 灌進配樂/音效提示詞只會污染輸出（與 speech-to-text/vision/training 同樣不注入）。
const INJECT_CATEGORIES = WORLDVIEW_INJECT_CATEGORIES;
/** 角色/場景錨點只注入「視覺」類別（畫面要一致）；LLM/TTS 不需要外觀。
 *  單一真相來源在 shared/models.ts 的 CARD_ANCHOR_CATEGORIES（QA-002：UI 依同一集合對使用者標示
 *  「此模型是否會用卡片」，前後端判斷不分岔）。 */
const CHARACTER_CATEGORIES = CARD_ANCHOR_CATEGORIES;

/**
 * 注入判斷的單一真相來源（export 供 MCP／工作流重用）：回正向＋負向兩段。
 * 非注入類別（轉錄/視覺/訓練/影片轉影片）原樣返回、無負向。
 */
export function effectivePromptParts(model: ModelEntry, userPrompt: string, worldview: Worldview): PromptParts {
  if (!INJECT_CATEGORIES.has(model.category)) return { positive: userPrompt, negative: "" };
  const visual = CHARACTER_CATEGORIES.has(model.category);
  const isLlm = model.category === "llm";
  const positive = buildPositive(userPrompt, worldview, visual, isLlm);
  // 視覺類別把禁忌詞收斂成負向提示詞（逐項 trim、去空）；非視覺（llm/audio）無負向
  const negative = visual ? formatWorldviewVisualNegative(worldview) : "";
  return { positive, negative };
}

/** 相容薄殼：只要正向的既有呼叫端（generation.ts re-export、services/mcp.ts）不必改 */
export function effectivePrompt(model: ModelEntry, userPrompt: string, worldview: Worldview): string {
  return effectivePromptParts(model, userPrompt, worldview).positive;
}

/** 角色定裝錨點：視覺類別才注入，並前綴到（世界觀已注入的）提示詞 */
export function withCharacterAnchor(model: ModelEntry, prompt: string, anchor: string): string {
  if (!anchor || !CHARACTER_CATEGORIES.has(model.category)) return prompt;
  return `${prompt}\n\n${CARD_ANCHOR_MARKERS[0]} ${anchor}`;
}

/** 場景設定錨點（色板/光線）：同樣只注入視覺類別 */
export function withSceneAnchor(model: ModelEntry, prompt: string, anchor: string): string {
  if (!anchor || !CHARACTER_CATEGORIES.has(model.category)) return prompt;
  return `${prompt}\n\n${CARD_ANCHOR_MARKERS[1]} ${anchor}`;
}

/** 素材設定錨點（道具外觀・材質）：同樣只注入視覺類別 */
export function withPropAnchor(model: ModelEntry, prompt: string, anchor: string): string {
  if (!anchor || !CHARACTER_CATEGORIES.has(model.category)) return prompt;
  return `${prompt}\n\n${CARD_ANCHOR_MARKERS[2]} ${anchor}`;
}

export interface SubmitCoreInput {
  /** 冪等主鍵（工作流 runner 先把 id 佔位落庫再送出）：重送撞唯一鍵時直接回既有列，不會重複扣點 */
  id?: string;
  userId: string;
  projectId: string;
  modelId: string;
  prompt: string;
  /** 來源輸入(圖生圖底圖/音訊/影片/訓練 zip 的網址;外部 URL) */
  sourceUrl?: string;
  /** 素材庫來源(優先)：伺服器換成簽名短效網址,fal 才抓得到、外人不可偽造 */
  sourceAssetId?: string;
  /** 多來源模型的第二來源（例如對嘴模型的配音音訊）。 */
  secondarySourceUrl?: string;
  secondarySourceAssetId?: string;
  /** 選定的角色定裝卡：外觀錨點自動注入視覺生成,跨鏡一致 */
  characterIds?: string[];
  /** 選定的場景設定卡：色板/光線錨點注入,同場景光影一致 */
  scenePresetIds?: string[];
  /** 選定的素材設定卡：道具外觀/材質錨點注入,同一件道具跨鏡不變樣 */
  propIds?: string[];
  /** 這一鏡選用的造型（Story-first）：併進角色錨點成為「造型鎖定」，跟角色身份同一句、同一強度 */
  lookIds?: string[];
  /** 帳本理由前綴（預設「生成」；工作流帶「工作流生成」以便帳本可辨識來源） */
  reasonPrefix?: string;
  /** 綁定的分鏡格：草稿分鏡「就地生成」時帶入，完成後把成品回填該格（沒有＝不綁定，不影響既有呼叫） */
  sceneId?: string;
  /** 生成真實版本候選，但直到使用者 Adopt 前不移動 scene current pointer。 */
  preserveScenePointer?: boolean;
  /**
   * 這次生成實際用的鏡頭語言／表演／走位，凍進 continuity 快照。
   *
   * 兩個用途：(1) 改了鏡頭語言之後畫面要能被判定為過時（v1 只看卡片，看不到這件事）；
   * (2) 創作方向變體的「採用這個方向」——採用時把這份還原回 Shot，
   * 否則這一鏡的鏡頭語言會與它自己現在顯示的那張圖不一致。
   */
  shotDirection?: ContinuityShotDirection | null;
  /**
   * Creative Direction v4：這一筆是哪個方向、屬於哪一批、從哪一版延伸。
   * 只落在 params 的 source meta（送 provider 前會被 split 掉），不需要 migration，重試自動沿用。
   */
  creative?: GenerationCreativeMeta;
  /** Frozen packet this generation must stay bound to. */
  shotContextPacketId?: string;
  /**
   * §10：凍結 packet 的完整 payload（generationCommand 傳入）。
   * 有它才會啟用 role-aware reference mixer 與 identity adapter 套用；
   * 沒有它時走既有 continuitySnapshot 路徑，行為不變。
   */
  shotContextPacket?: import("../../shared/shotContextPacket").ShotContextPacketPayload;
  /**
   * 要回填分鏡的哪個角色："narration"＝旁白音檔（回填 narrationAssetId）、
   * "ambience"＝環境音（回填 ambienceAssetId）；不帶＝visual（回填 assetId）。
   */
  sceneRole?: "visual" | "narration" | "ambience";
  /**
   * Voice identity（closure §5）：TTS 生成綁定的聲線 canon。
   * 支援的模型把 voiceId 真正寫進 provider 參數；不支援＝structured warning，不假裝。
   */
  voiceIdentity?: import("../../shared/voiceRouting").VoiceIdentity;
  /** Sound World（closure §6）：ambience／music 生成依賴的聲音世界 canon（lineage 用） */
  soundWorldRef?: { canonId: string; versionId: string };
  /** 來源工作流執行 id：runner 帶入，生成列落庫後可回看「這筆是哪條工作流跑出來的」 */
  workflowRunId?: string;
  /** 來源 AI 代理執行 id：agentRunner 帶入，同上 */
  agentRunId?: string;
  /** 進階使用者明確覆寫最終創作 prompt；系統權限與 provider schema 仍不可覆寫。 */
  promptOverride?: { positive?: string; negative?: string };
  /**
   * 固定隨機噪聲。只有消融實測（影響力量測）會帶：基準與各變體共用同一顆 seed，
   * 輸出差異才歸因得到「被拿掉的那一段」而不是噪聲。
   * 只在 supportsSeed 名單內才真的送出——不猜未知欄位（猜錯是整包 400）。
   */
  seed?: number;
  /** 消融實測分組標記：落 params 內部欄位，送 provider 前會被移除 */
  ablation?: GenerationAblationMeta;
  /** 同題並跑（模型競技場）分組標記：同一次比較的每顆模型共用 runId */
  bench?: GenerationBenchMeta;
  /** 預設開啟：凍結設定卡版本，並在 provider 支援時附上多張參考圖。 */
  continuityMode?: boolean;
  /** 只供伺服器重試沿用資料庫快照；不得直接暴露成公開 API payload。 */
  continuitySnapshot?: ContinuitySnapshot | null;
  /** 可稽核 AI 運作 session；背景／web 呼叫建立後一路帶到 provider。 */
  traceSessionId?: string;
  /** 存取檢查掛點：tRPC 端帶 requireGroup（多組隔離；可再疊 2.3 專案級 ACL，故允許 async）；
   *  伺服器內部（runner）呼叫時已在建 run 時把過關,可省略。
   *  回傳角色（requireGroup 本來就回）供成本審核門檻判斷組員；回 void 的舊呼叫端不受影響（不觸發門檻）。 */
  assertAccess?: (project: typeof schema.projects.$inferSelect) => "admin" | "leader" | "member" | void | Promise<"admin" | "leader" | "member" | void>;
}

export interface PreparedGenerationRequest {
  project: typeof schema.projects.$inferSelect;
  model: ModelEntry;
  accessRole: "admin" | "leader" | "member" | void;
  estimatedPoints: number;
  sourceUrl?: string;
  secondarySourceUrl?: string;
  effectiveSourceAssetId?: string;
  usedCardReference: "character" | "scene" | "prop" | null;
  userPrompt: string;
  positivePrompt: string;
  negativePrompt: string;
  providerInput: Record<string, unknown>;
  anchors: { character: string; scene: string; prop: string };
  /** 實際注入／落庫的素材卡 id：明確勾選 ＋ 歸屬自動帶入（去重、截上限）。 */
  effectivePropIds: string[];
  /** 其中「因為勾了主人才被帶進來」的那幾張——供 UI 與軌跡說明「多帶了什麼」。 */
  carriedPropIds: string[];
  continuitySnapshot: ContinuitySnapshot | null;
  /**
   * 送出當下這一鏡的現用畫面（null＝當時沒有畫面／這筆生成不綁分鏡）。
   * 完成時用它比對「這期間有沒有人動過這一鏡」，避免晚到的結果蓋掉人剛選的版本。
   */
  scenePointerAtSubmit: string | null;
  continuityReferences: ContinuityReferenceResult;
  continuityCoverage: ContinuityCoverage;
  /** §10：role-aware reference mixer 的計畫與降級（null＝本次沒有 packet） */
  referenceMix: import("../../shared/referenceMixer").ReferenceMixPlan | null;
  /** closure §5：voice identity 是否真的寫進 provider 參數（false＝模型不支援，已記 warning） */
  voiceApplied: boolean;
  warnings: Array<{ code: string; severity: "info" | "warning"; title: string; detail: string; suggestion?: string }>;
  /** 提示詞 token 實測（見 services/promptTokens）；預覽與警告共用同一份量測 */
  promptBudget: PromptBudgetReport;
}

/**
 * 生成預覽與真正送出共用的唯一組裝器。此函式只讀資料、不建 generation、不扣點、不呼叫 provider。
 * 呼叫者不可把前端預覽 payload 原樣送回；真正送出一定再次從專案資料重建。
 */
export async function prepareGenerationRequest(input: SubmitCoreInput): Promise<PreparedGenerationRequest> {
  const model = resolveModel(input.modelId) ?? getModel(input.modelId);
  if (!model) throw new TRPCError({ code: "BAD_REQUEST", message: "未知模型(不在註冊表或即時目錄)" });
  // 自動帶入的物件也算「有卡片」：只掛在角色底下的紅傘也該能當來源圖（展開在下面，這裡先看勾選）
  const mayFillFromCards = model.needs === "image" && !!(input.characterIds?.length || input.scenePresetIds?.length || input.propIds?.length);
  if (model.needs && !input.sourceUrl && !input.sourceAssetId && !mayFillFromCards) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `此模型需要來源:${model.sourceHint ?? model.needs}` });
  }
  if (model.secondaryNeeds && !input.secondarySourceUrl && !input.secondarySourceAssetId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `此模型還需要第二來源:${model.secondarySourceHint ?? model.secondaryNeeds}` });
  }
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  const accessRole = await input.assertAccess?.(project);
  const { assertProjectAllows } = await import("./projectState");
  assertProjectAllows(project, "generate");

  /**
   * 歸屬自動帶入：勾了角色／場景卡，它們名下的素材卡一起進來——使用者不必記得
   * 「畫安倢就要順便勾紅傘」。在校驗與快照之前展開，這批 id 才會一路貫穿注入、
   * 快照、落庫與重試（重試帶 continuitySnapshot，直接沿用當初凍結的那批，不再展開）。
   */
  const carriedPropIds = input.continuitySnapshot
    ? []
    : await resolveCarriedPropIds(project.id, {
        characterIds: input.characterIds,
        scenePresetIds: input.scenePresetIds,
      });
  const effectivePropIds = input.continuitySnapshot
    ? input.propIds
    : mergePropIdsWithCarried(input.propIds ?? [], carriedPropIds, MAX_GENERATE_PROPS);

  await assertGenerationEntityIds(project.id, {
    // 伺服器重試已由原 generation 的 ACL 保護；即使卡片後來刪除，也要能用凍結內容重現。
    characterIds: input.continuitySnapshot ? undefined : input.characterIds,
    scenePresetIds: input.continuitySnapshot ? undefined : input.scenePresetIds,
    propIds: input.continuitySnapshot ? undefined : effectivePropIds,
    sourceAssetId: input.sourceAssetId,
    secondarySourceAssetId: input.secondarySourceAssetId,
  });

  const cardSnapshot = input.continuitySnapshot ?? await buildContinuitySnapshot(project.id, {
    characterIds: input.characterIds,
    scenePresetIds: input.scenePresetIds,
    propIds: effectivePropIds,
    lookIds: input.lookIds,
  }, input.continuityMode !== false);
  /*
   * 把這一鏡的鏡頭語言掛上快照。
   *
   * 沒有卡片時 buildContinuitySnapshot 回 null（正確：沒有卡片就沒有卡片漂移可言），
   * 但鏡頭語言漂移與有沒有卡片無關——純寫景的鏡照樣會因為改了鏡別而過時。
   * 所以這裡在必要時補一個「只有鏡頭語言」的空殼快照。
   * fingerprint 沿用原本的空 payload 算法，語意不變（那是卡片參考的指紋）。
   */
  const continuitySnapshot: ContinuitySnapshot | null = input.shotDirection
    ? { ...(cardSnapshot ?? emptyContinuitySnapshot(input.continuityMode !== false)), shotDirection: input.shotDirection }
    : cardSnapshot;

  /*
   * 送出當下這一鏡的現用畫面：完成時用它判斷「這期間有沒有人動過」。
   * 只有會回填指標的生成才需要（候選變體不動指標）。
   */
  let scenePointerAtSubmit: string | null = null;
  if (input.sceneId && !input.preserveScenePointer) {
    const [row] = await db
      .select({ assetId: schema.scenes.assetId })
      .from(schema.scenes)
      .where(eq(schema.scenes.id, input.sceneId));
    scenePointerAtSubmit = row?.assetId ?? null;
  }

  let effectiveSourceAssetId = input.sourceAssetId;
  let usedCardReference: "character" | "scene" | "prop" | null = null;
  if (mayFillFromCards && !input.sourceUrl && !effectiveSourceAssetId) {
    const candidates = [
      ...(continuitySnapshot?.characters ?? []).map((row) => ({ assetId: row.referenceAssetId, from: "character" as const })),
      ...(continuitySnapshot?.scenes ?? []).map((row) => ({ assetId: row.referenceAssetId, from: "scene" as const })),
      ...(continuitySnapshot?.props ?? []).map((row) => ({ assetId: row.referenceAssetId, from: "prop" as const })),
    ];
    const ref = candidates.find((candidate) => candidate.assetId);
    if (ref?.assetId) {
      effectiveSourceAssetId = ref.assetId;
      usedCardReference = ref.from;
    }
  }
  if (model.needs && !input.sourceUrl && !effectiveSourceAssetId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: mayFillFromCards
        ? "此模型需要來源圖——勾選的角色／場景／素材卡都還沒設參考圖，請先在卡片上「設參考圖」，或直接從素材庫挑一張來源"
        : `此模型需要來源:${model.sourceHint ?? model.needs}`,
    });
  }

  let sourceUrl = input.sourceUrl;
  if (effectiveSourceAssetId) {
    const [srcAsset] = await db.select().from(schema.assets)
      .where(and(eq(schema.assets.id, effectiveSourceAssetId), isNull(schema.assets.deletedAt)));
    if (!srcAsset) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: usedCardReference
          ? "卡片上的參考圖已被刪除（在回收桶裡）——請還原它，或替卡片重設一張參考圖"
          : "找不到來源素材（可能已在回收桶——先還原才能當來源）",
      });
    }
    if (srcAsset.groupId !== project.groupId) throw new TRPCError({ code: "FORBIDDEN", message: "來源素材不屬於此專案的組" });
    if (model.needs && (SOURCE_INCOMPAT[model.needs] ?? []).includes(srcAsset.kind)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `這個模型需要${SOURCE_KIND_LABEL[model.needs] ?? model.needs}來源，選到的素材是${SOURCE_KIND_LABEL[srcAsset.kind] ?? srcAsset.kind}——請換一個相容的素材`,
      });
    }
    sourceUrl = srcAsset.storagePath ? signAssetUrl(srcAsset.id) : srcAsset.url;
    if (!sourceUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "此素材沒有可用檔案" });
  }
  if (model.needs && sourceUrl && !isMockMode() && isUnusableRealModeSourceUrl(sourceUrl)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "來源圖是測試佔位圖（/api/mock-asset），正式生成無法使用——請改從素材庫選真實圖片，或貼上可公開抓取的圖片網址",
    });
  }

  let secondarySourceUrl = input.secondarySourceUrl;
  if (input.secondarySourceAssetId) {
    const [secondaryAsset] = await db.select().from(schema.assets)
      .where(and(eq(schema.assets.id, input.secondarySourceAssetId), isNull(schema.assets.deletedAt)));
    if (!secondaryAsset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到第二來源素材（可能已在回收桶）" });
    if (secondaryAsset.groupId !== project.groupId) throw new TRPCError({ code: "FORBIDDEN", message: "第二來源素材不屬於此專案的組" });
    if (model.secondaryNeeds && (SOURCE_INCOMPAT[model.secondaryNeeds] ?? []).includes(secondaryAsset.kind)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `第二來源需要${SOURCE_KIND_LABEL[model.secondaryNeeds] ?? model.secondaryNeeds}，選到的是${SOURCE_KIND_LABEL[secondaryAsset.kind] ?? secondaryAsset.kind}——請換一個相容素材`,
      });
    }
    secondarySourceUrl = secondaryAsset.storagePath ? signAssetUrl(secondaryAsset.id) : secondaryAsset.url;
    if (!secondarySourceUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "第二來源素材沒有可用檔案" });
  }
  if (model.secondaryNeeds && secondarySourceUrl && !isMockMode() && isUnusableRealModeSourceUrl(secondarySourceUrl)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "第二來源是測試佔位素材，正式生成無法使用——請上傳真實檔案" });
  }

  let worldview = worldviewSchema.parse(project.worldview ?? {});
  // closure §4：packet＝凍結意圖。有 packet 時，風格與負向約束以凍結值為準——
  // pinned Style Canon 的 styles／negative 才會真的流進 provider prompt，
  // 而不是「packet 記了一份、prompt 又臨時抓 live worldview」的兩套真相。
  if (input.shotContextPacket) {
    worldview = {
      ...worldview,
      styles: input.shotContextPacket.worldStyle,
      taboos: input.shotContextPacket.negativeConstraints,
    };
  }
  const character = continuitySnapshot
    ? formatCharacterAnchor(continuitySnapshot.characters, continuitySnapshot.characters.map((row) => row.id))
    : "";
  const scene = continuitySnapshot
    ? formatSceneAnchor(continuitySnapshot.scenes, continuitySnapshot.scenes.map((row) => row.id))
    : "";
  const prop = continuitySnapshot
    ? formatPropAnchor(continuitySnapshot.props, continuitySnapshot.props.map((row) => row.id))
    : "";
  const parts = effectivePromptParts(model, input.prompt, worldview);
  const autoPositive = withPropAnchor(model, withSceneAnchor(model, withCharacterAnchor(model, parts.positive, character), scene), prop);
  const positivePrompt = input.promptOverride?.positive?.trim() || autoPositive;
  const negativePrompt = input.promptOverride?.negative !== undefined ? input.promptOverride.negative.trim() : parts.negative;
  // Cost approval, quota reservation and persisted charge must all use the prompt actually sent.
  const { getUsdToTwd } = await import("./fxRate");
  const fx = await getUsdToTwd();
  const estimatedPoints = estimatePointsFor(model, {
    promptChars: positivePrompt.length,
    usdToTwdRate: fx.rate,
  });
  const providerInput = model.input(
    positivePrompt,
    project.format as ProjectFormat,
    sourceUrl,
    secondarySourceUrl,
  ) as Record<string, unknown>;
  if (negativePrompt && supportsNegativePrompt(model)) providerInput.negative_prompt = negativePrompt;
  if (input.seed != null && supportsSeed(model)) providerInput.seed = input.seed;
  const referenceUrls = continuitySnapshot?.locked
    ? await resolveContinuityReferenceUrls(continuitySnapshot, project.groupId, effectiveSourceAssetId)
    : [];
  const continuityReferences = applyContinuityReferences(providerInput, sourceUrl, referenceUrls);
  const continuityCoverage = analyzeContinuitySnapshot(continuitySnapshot);

  const warnings: PreparedGenerationRequest["warnings"] = [];

  // closure §5：voice identity → provider 參數。只有真的支援 voice 參數的模型會套用；
  // 不支援＝structured warning（誠實降級），提示詞不假裝已鎖定聲線。
  let voiceApplied = false;
  if (input.voiceIdentity && model.kind === "audio") {
    const { applyVoiceIdentity } = await import("../../shared/voiceRouting");
    voiceApplied = applyVoiceIdentity(model.id, providerInput, input.voiceIdentity);
    if (voiceApplied) {
      warnings.push({
        code: "voice_identity_applied",
        severity: "info",
        title: "已套用固定聲線",
        detail: "這段音訊使用專案綁定的聲線 identity 生成，跨鏡不會換聲。",
      });
    } else {
      warnings.push({
        code: "voice_identity_unsupported",
        severity: "warning",
        title: "此模型不支援指定聲線",
        detail: "已綁定聲線，但這個 TTS 模型沒有 voice/speaker 參數——本次使用模型預設聲音。",
        suggestion: "換支援聲線的模型（Kokoro／Qwen-TTS／VibeVoice），或接受預設聲音。",
      });
    }
  }

  // §10：packet 存在時啟用 role-aware reference mixer——依 身份→造型→場景→道具→風格
  // 重排參考順序、依模型真實能力截斷，降級全部明講（不得假稱一致性已鎖定）。
  let referenceMix: PreparedGenerationRequest["referenceMix"] = null;
  if (input.shotContextPacket?.references?.length) {
    const { capabilityForModel } = await import("../../shared/providerCapabilities");
    const { mixShotReferences } = await import("../../shared/referenceMixer");
    const capability = capabilityForModel(model);
    const activeAdapter = input.shotContextPacket.provider.activeAdapter ?? null;
    referenceMix = mixShotReferences({
      references: input.shotContextPacket.references,
      capability,
      primaryAssetId: effectiveSourceAssetId ?? null,
      characterCount: input.shotContextPacket.characters.length,
      activeAdapter,
    });
    const mixField = referenceMix.attachedField;
    if (
      mixField
      && referenceMix.orderedAssetIds.length
      && Array.isArray(providerInput[mixField])
    ) {
      const { resolveAssetReferenceUrlsById } = await import("./continuity");
      const resolved = await resolveAssetReferenceUrlsById(referenceMix.orderedAssetIds, project.groupId);
      // 誠實回報實際送出的內容：解析階段被過濾掉的素材（已刪除／跨組／非圖片）
      // 要出現在 dropped，計畫不能宣稱「已附上」它沒附上的東西。
      const resolvedIds = new Set(resolved.map((row) => row.assetId));
      const unresolved = referenceMix.orderedAssetIds.filter((id) => !resolvedIds.has(id));
      if (unresolved.length) {
        referenceMix = {
          ...referenceMix,
          orderedAssetIds: referenceMix.orderedAssetIds.filter((id) => resolvedIds.has(id)),
          dropped: [
            ...referenceMix.dropped,
            ...unresolved.map((assetId) => ({ assetId, role: "identity" as const, reason: "素材已不可用（刪除／非圖片／跨組）" })),
          ],
          consistencyMode: "degraded" as const,
        };
        warnings.push({
          code: "reference_mix_assets_unavailable",
          severity: "warning",
          title: "部分一致性參考已不可用",
          detail: `有 ${unresolved.length} 份參考素材無法送出（已刪除、非圖片或不在本組）。`,
        });
      }
      if (resolved.length) {
        providerInput[mixField] = [...new Set([
          ...(sourceUrl ? [sourceUrl] : []),
          ...resolved.map((row) => row.url),
        ])].slice(0, capability.maxReferenceImages);
      }
    }
    // Canon 訓練成果（identity adapter）：generationCommand 已在 needs gate 前把 adapter
    // 填進來源槽（lora 模型的來源＝LoRA 檔）；這裡負責誠實回報＋兜底空槽。
    // 使用者自帶 LoRA 蓋過 adapter 時「不」宣稱已套用一致性模型。
    if (activeAdapter && capability.identityAdapterSupport && Array.isArray(providerInput.loras)) {
      const loras = providerInput.loras as Array<{ path?: unknown }>;
      let adapterLoaded = loras.some((row) => typeof row?.path === "string" && row.path.includes(activeAdapter))
        || input.sourceUrl === activeAdapter;
      if (!adapterLoaded && (!loras.length || loras.every((row) => !row?.path))) {
        providerInput.loras = [{ path: activeAdapter, scale: 1 }];
        adapterLoaded = true;
      }
      if (adapterLoaded) {
        warnings.push({
          code: "identity_adapter_applied",
          severity: "info",
          title: "已套用角色一致性模型",
          detail: "這次生成使用 Team Canon 訓練出的角色 adapter 維持身份一致。",
        });
      } else {
        warnings.push({
          code: "identity_adapter_displaced",
          severity: "warning",
          title: "自帶 LoRA 取代了角色一致性模型",
          detail: "這次生成使用你指定的 LoRA，Team Canon 的角色 adapter 未套用。",
        });
      }
    }
    for (const downgrade of referenceMix.downgrades) {
      warnings.push({
        code: `reference_mix_${downgrade.code}`,
        severity: "warning",
        title: "一致性能力降級",
        detail: downgrade.message,
      });
    }
  }
  const selectedCards = (input.characterIds?.length ?? 0) + (input.scenePresetIds?.length ?? 0) + (effectivePropIds?.length ?? 0);
  if (selectedCards > 0 && !CARD_ANCHOR_CATEGORIES.has(model.category)) warnings.push({
    code: "cards_ignored",
    severity: "warning",
    title: "這個模型不會使用設定卡",
    detail: `已選 ${selectedCards} 張卡片，但 ${model.category} 不會注入角色、場景或素材錨點。`,
    suggestion: "改用支援視覺提示詞的圖像／影片模型，或取消無效卡片。",
  });
  if (selectedCards > 0 && CARD_ANCHOR_CATEGORIES.has(model.category) && !sourceUrl) warnings.push({
    code: "card_images_not_sent",
    severity: "warning",
    title: "卡片參考圖沒有直接送給模型",
    detail: "本次只有卡片文字錨點進入 prompt；模型沒有來源圖欄位或尚未選定來源圖。",
    suggestion: "角色身份一致性要求高時，改用需要來源圖的模型並選定裝參考圖。",
  });
  if (continuitySnapshot?.locked && continuityCoverage.totalCards > 0 && continuityCoverage.cardsWithReference === 0) warnings.push({
    code: "continuity_text_only",
    severity: "warning",
    title: "一致性已鎖定，但目前只有文字設定",
    detail: "設定版本會固定供跨鏡重試使用；卡片尚未綁定參考圖，因此模型只能依文字維持外觀。",
    suggestion: "替主要角色、常用場景與關鍵道具各綁一張清楚的參考圖。",
  });
  if (continuitySnapshot?.locked && continuityCoverage.cardsWithReference > 0 && continuityCoverage.coveragePercent < 100) warnings.push({
    code: "continuity_partial_references",
    severity: "warning",
    title: `一致性參考圖覆蓋 ${continuityCoverage.coveragePercent}%`,
    detail: `已選 ${continuityCoverage.totalCards} 張設定卡，只有 ${continuityCoverage.cardsWithReference} 張有參考圖；缺少：${continuityCoverage.missingReferences.map((row) => row.name).join("、")}。`,
    suggestion: "多鏡頭製作前先替缺少的主要角色、場景或道具補參考圖。",
  });
  if (continuityCoverage.duplicateNames.length > 0) warnings.push({
    code: "continuity_ambiguous_names",
    severity: "warning",
    title: "設定卡名稱可能讓模型混淆",
    detail: `同一次生成有重名設定：${continuityCoverage.duplicateNames.map((row) => row.name).join("、")}。`,
    suggestion: "替角色、場景與道具使用可區分的名稱，並在提示詞寫出完整名稱。",
  });
  if (continuitySnapshot?.locked && continuityReferences.available > 0 && !continuityReferences.supported) warnings.push({
    code: "multi_reference_unsupported",
    severity: "warning",
    title: "此模型不支援多張一致性參考圖",
    detail: `找到 ${continuityReferences.available} 張可用圖片，但 provider 沒有宣告 image_urls 欄位，系統未猜測未知欄位以避免請求失敗。`,
    suggestion: "改用支援多圖編輯的模型；本次仍會保留文字錨點與一致性快照。",
  });
  if (continuityReferences.truncated > 0) warnings.push({
    code: "continuity_references_capped",
    severity: "info",
    title: "參考圖已依優先順序取前 4 張",
    detail: `已送入 ${continuityReferences.attached} 張，另有 ${continuityReferences.truncated} 張未送，避免超過 provider 的保守輸入上限。`,
  });
  // 注意力預算：文字編碼器的窗口是硬上限，超出的字對模型等同不存在。
  // 這是**實測**（站內內建 CLIP 分詞器），不是估算——量不到的家族不報數字、也不下判斷。
  const promptBudget = measurePromptBudget(model.id, positivePrompt);
  if (promptBudget.overflows && promptBudget.totalTokens != null) {
    const cut = promptBudget.segments.filter((segment) => segment.status !== "inside" && segment.status !== "unmeasured");
    warnings.push({
      code: "prompt_exceeds_encoder_window",
      severity: "warning",
      title: "提示詞超過這個模型的文字窗口",
      detail: `${promptBudget.encoder.label} 內容實際只放得下 ${promptBudget.encoder.contentTokens} 個 token，本次實測 ${promptBudget.totalTokens} 個；超出的部分會被截掉，對模型等同不存在。`
        + (cut.length ? `本次被切到的段落：${cut.map((segment) => segment.key).join("、")}。` : ""),
      suggestion: "縮短提示詞或減少同時選入的設定卡，也可以改用窗口較長的模型。",
    });
  }
  // 詞表裡沒有的字＝模型讀到「有東西但不知道是什麼」。T5（FLUX.1 那條線）的詞表
  // 完全沒有中日韓字元，中文會整串塌成一個 <unk>——token 數看起來很小，但語意全丟。
  // 這是實測結果（server/services/t5Tokenizer 的測試鎖住詞表），不是推測。
  if (promptBudget.unknownTokens != null && promptBudget.unknownTokens > 0) {
    warnings.push({
      code: "prompt_unknown_to_encoder",
      severity: "warning",
      title: "這個模型的詞表讀不懂你的部分文字",
      detail: `${promptBudget.encoder.label} 的詞表裡沒有這些字，本次有 ${promptBudget.unknownTokens} 個位置變成未知符號；模型只知道「這裡有東西」，不知道是什麼。中文提示詞在這條線上尤其明顯。`,
      suggestion: "關鍵的外觀與場景描述改用英文，或改用中文效率好的模型（Qwen-Image、Kolors、Seedream 這類）。",
    });
  }
  if (negativePrompt && !supportsNegativePrompt(model)) warnings.push({
    code: "negative_prompt_unsupported",
    severity: "warning",
    title: "此模型不接收負向提示詞",
    detail: "專案禁忌已從正向 prompt 移除，但 provider schema 沒有 negative_prompt 欄位。",
  });
  // 契約健康（docs/model-audit/contracts/current.json，由 sync-model-contracts 維護）
  const contract = getModelContract(model.id);
  if (contract?.health === "openapi_404") {
    warnings.push({
      code: "model_contract_openapi_404",
      severity: "warning",
      title: "此模型端點 OpenAPI 回 404",
      detail: contract.healthNote,
      suggestion: "換已連通的同類模型，或等運維修正 endpoint slug。",
    });
  } else if (contract?.health === "live_fail") {
    warnings.push({
      code: "model_contract_live_fail",
      severity: "info",
      title: "此模型最近 live 探測失敗",
      detail: contract.healthNote,
      suggestion: "可改用 live_ok 或 verified 的備選模型。",
    });
  } else if (contract?.health === "live_timeout") {
    warnings.push({
      code: "model_contract_live_timeout",
      severity: "info",
      title: "此模型最近 live 曾逾時",
      detail: contract.healthNote,
      suggestion: "影片／音樂類可能仍成功但較慢；避免連續重送以免重複扣點。",
    });
  }
  if (input.promptOverride?.positive != null) warnings.push({
    code: "manual_override",
    severity: "info",
    title: "已啟用最終提示詞覆寫",
    detail: "本次將送出你覆寫的創作 prompt；自動世界觀與卡片文字不會再次疊加。",
  });

  return {
    project,
    model,
    accessRole,
    estimatedPoints,
    promptBudget,
    sourceUrl: sourceUrl ?? undefined,
    secondarySourceUrl: secondarySourceUrl ?? undefined,
    effectiveSourceAssetId,
    usedCardReference,
    userPrompt: input.prompt,
    positivePrompt,
    negativePrompt,
    providerInput,
    anchors: { character, scene, prop },
    effectivePropIds: effectivePropIds ?? [],
    carriedPropIds: (effectivePropIds ?? []).filter((id) => !(input.propIds ?? []).includes(id)),
    continuitySnapshot,
    scenePointerAtSubmit,
    continuityReferences,
    continuityCoverage,
    referenceMix,
    voiceApplied,
    warnings,
  };
}

/** pg 唯一鍵衝突（23505）：驅動可能把原始錯誤包在 cause，兩層 code 與訊息都檢查 */
export function isUniqueViolation(err: unknown): boolean {
  const codes = [(err as { code?: unknown } | null)?.code, (err as { cause?: { code?: unknown } } | null)?.cause?.code];
  if (codes.includes("23505")) return true;
  return err instanceof Error && err.message.includes("duplicate key");
}

/**
 * CA-01／KD-12：fail-closed 實體 ACL——角色／場景／來源素材必須屬於本 projectId，
 * 否則拒絕寫入 generation 列（不靜默 persist 外鍵 UUID）。空／未傳＝略過該欄。
 */
/**
 * 分鏡「現用畫面」回填的完整判定，**生產路徑與 *.pg.test.ts 共用同一份**。
 *
 * 回 null＝這一筆不該回填（候選變體、或根本沒綁分鏡）。
 * 回條件＝那一次 UPDATE 的原子 where：軟刪、已通過審核、人類優先指標三道一起判，
 * 多條件 update 天然原子，沒有先查再判的 TOCTOU 空隙。
 *
 * 為什麼要匯出：測試若自己抄一份 where，生產端的守衛被改壞了測試依然全綠——
 * 那正是這批 pg 測試當初要取代的 readFileSync+toContain 的盲點，只是換到高一層。
 * （實測抄出來的那份還漏了 narration/ambience 的例外，兩邊已經不一樣了。）
 */
export function sceneBackfillWhere(gen: {
  sceneId: string | null;
  sceneRole: string | null;
  params: unknown;
}) {
  const meta = splitGenerationSourceMeta(gen.params).meta;
  if (!gen.sceneId || meta.preserveScenePointer === true) return null;
  const pointerGuard = gen.sceneRole === "narration" || gen.sceneRole === "ambience"
    ? undefined // 這一輪只保護主畫面軌；音軌沒有對應的送出基準
    : meta.scenePointerAtSubmit === undefined
      ? undefined // 舊資料沒有基準 ⇒ 維持既有行為
      : meta.scenePointerAtSubmit === ""
        ? isNull(schema.scenes.assetId)
        : eq(schema.scenes.assetId, meta.scenePointerAtSubmit);
  return and(
    eq(schema.scenes.id, gen.sceneId),
    isNull(schema.scenes.deletedAt),
    ne(schema.scenes.reviewStatus, "approved"),
    ...(pointerGuard ? [pointerGuard] : []),
  );
}

export async function assertGenerationEntityIds(
  projectId: string,
  opts: {
    characterIds?: string[];
    scenePresetIds?: string[];
    propIds?: string[];
    sourceAssetId?: string;
    secondarySourceAssetId?: string;
  },
): Promise<void> {
  if (opts.characterIds?.length) {
    const ids = [...new Set(opts.characterIds)];
    const rows = await db
      .select({ id: schema.characters.id })
      .from(schema.characters)
      .where(and(eq(schema.characters.projectId, projectId), inArray(schema.characters.id, ids)));
    if (rows.length !== ids.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "角色定裝卡不屬於本專案或不存在" });
    }
  }
  if (opts.scenePresetIds?.length) {
    const ids = [...new Set(opts.scenePresetIds)];
    const rows = await db
      .select({ id: schema.scenePresets.id })
      .from(schema.scenePresets)
      .where(and(eq(schema.scenePresets.projectId, projectId), inArray(schema.scenePresets.id, ids)));
    if (rows.length !== ids.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "場景設定卡不屬於本專案或不存在" });
    }
  }
  if (opts.propIds?.length) {
    const ids = [...new Set(opts.propIds)];
    const rows = await db
      .select({ id: schema.props.id })
      .from(schema.props)
      .where(and(eq(schema.props.projectId, projectId), inArray(schema.props.id, ids)));
    if (rows.length !== ids.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "素材設定卡不屬於本專案或不存在" });
    }
  }
  if (opts.sourceAssetId) {
    const [row] = await db
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.id, opts.sourceAssetId),
          eq(schema.assets.projectId, projectId),
          isNull(schema.assets.deletedAt),
        ),
      );
    if (!row) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "來源素材不屬於本專案或不存在（可能已在回收桶）",
      });
    }
  }
  if (opts.secondarySourceAssetId) {
    const [row] = await db
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.id, opts.secondarySourceAssetId),
          eq(schema.assets.projectId, projectId),
          isNull(schema.assets.deletedAt),
        ),
      );
    if (!row) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "第二來源素材不屬於本專案或不存在（可能已在回收桶）",
      });
    }
  }
}

/** 送出生成（守護齊全：孤兒列刪除、原子守門扣點、fal 失敗退點＋標 failed） */
export async function submitGenerationCore(input: SubmitCoreInput): Promise<GenerationRow> {
  const prepared = await prepareGenerationRequest(input);
  const {
    project,
    model,
    accessRole,
    estimatedPoints: est,
    sourceUrl,
    secondarySourceUrl,
    providerInput: falInput,
    effectivePropIds,
  } = prepared;
  if (input.traceSessionId) {
    await recordAiTraceEventSafely({
      sessionId: input.traceSessionId,
      eventType: "prepared",
      summary: "已依專案現況組裝實際生成輸入",
      payload: {
        provider: generationProviderOf(model),
        model: model.id,
        endpoint: endpointOf(model),
        userPrompt: prepared.userPrompt,
        positivePrompt: prepared.positivePrompt,
        negativePrompt: prepared.negativePrompt,
        providerInput: prepared.providerInput,
        sourceAssetId: prepared.effectiveSourceAssetId,
        usedCardReference: prepared.usedCardReference,
        anchors: prepared.anchors,
        continuity: prepared.continuitySnapshot ? {
          fingerprint: prepared.continuitySnapshot.fingerprint,
          locked: prepared.continuitySnapshot.locked,
          characters: prepared.continuitySnapshot.characters.length,
          scenes: prepared.continuitySnapshot.scenes.length,
          props: prepared.continuitySnapshot.props.length,
          references: prepared.continuityReferences,
        } : null,
        warnings: prepared.warnings,
        estimatedPoints: prepared.estimatedPoints,
      },
    });
  }
  // BYOK Phase 2：個人 fal 金鑰（preferUserKey + active）→ 略過平台點數、用個人 key 送出。
  // NIM 永不走 fal 個人 key。
  const { userFalKey, usedUserKey } = await resolveByokFalKey(input.userId, model);
  const storedParams = storeGenerationSourceMeta(falInput, {
    secondarySourceUrl,
    ablation: input.ablation,
    bench: input.bench,
    usedUserKey: usedUserKey || undefined,
    preserveScenePointer: input.preserveScenePointer,
    creative: input.creative,
    shotContextPacketId: input.shotContextPacketId,
    // closure §5／§6：聲線與聲音世界的 canon 依賴落進 meta——lineage 與 targeted stale 的根據
    voice: input.voiceIdentity
      ? {
        canonId: input.voiceIdentity.canonId,
        versionId: input.voiceIdentity.versionId,
        voiceId: input.voiceIdentity.voiceId,
        applied: prepared.voiceApplied,
      }
      : undefined,
    soundWorld: input.soundWorldRef,
    // 只有「完成後真的會動指標」的生成才需要記基準；候選變體不動指標，記了也用不到。
    scenePointerAtSubmit: input.sceneId && !input.preserveScenePointer
      ? prepared.scenePointerAtSubmit ?? "" // 空字串＝送出時這一鏡沒有畫面（與「沒記錄」區分開）
      : undefined,
  });

  // 成本審核門檻（需求 2.1）：組員（member）單筆估點 ≥ 組門檻 → 先落一筆 awaiting_approval，
  // 不扣點、不送 fal，等組長在生成紀錄核准（generation.decideCost）才走扣點＋送出。
  // 所有可送出生成的路徑（手動、工作流、AI 代理）都必須帶入當下角色；組長/管理員不受限。
  // 個人金鑰路徑不佔平台點數 → 略過組長成本核准門檻。
  if (accessRole === "member" && !usedUserKey) {
    const [grp] = await db.select().from(schema.groups).where(eq(schema.groups.id, project.groupId));
    const threshold = grp?.approvalThresholdPoints;
    if (threshold != null && threshold > 0 && est >= threshold) {
      let gated: GenerationRow;
      try {
        [gated] = await db
          .insert(schema.generations)
          .values({
            id: input.id,
            projectId: project.id,
            groupId: project.groupId,
            userId: input.userId,
            modelId: model.id,
            kind: model.kind,
            prompt: input.prompt,
            sceneId: input.sceneId ?? null,
            sceneRole: input.sceneRole ?? null,
            characterIds: input.characterIds?.length ? input.characterIds : null,
            scenePresetIds: input.scenePresetIds?.length ? input.scenePresetIds : null,
            propIds: effectivePropIds.length ? effectivePropIds : null,
            continuitySnapshot: prepared.continuitySnapshot,
            workflowRunId: input.workflowRunId ?? null,
            agentRunId: input.agentRunId ?? null,
            sourceUrl,
            params: storedParams, // 供應商輸入＋內部第二來源 metadata；送 Fal 前會移除內部欄位
            pointsEst: est,
            status: "awaiting_approval",
          })
          .returning();
      } catch (err) {
        // 冪等重送撞唯一鍵：前次請求已建待核列——直接回既有列，不重複落列、不重發通知。
        // 範圍條件與下方一般路徑（submitGenerationCore 的 catch）必須一致：
        // 只用 id 查會把「碰巧撞到同一個 UUID 的別組待核生成」原封不動回給呼叫端。
        if (input.id && isUniqueViolation(err)) {
          const [existing] = await db
            .select()
            .from(schema.generations)
            .where(and(
              eq(schema.generations.id, input.id),
              eq(schema.generations.projectId, input.projectId),
              eq(schema.generations.groupId, project.groupId),
              input.sceneId ? eq(schema.generations.sceneId, input.sceneId) : isNull(schema.generations.sceneId),
            ));
          if (existing) return existing;
          throw new TRPCError({
            code: "CONFLICT",
            message: "這個送出編號已被另一筆生成使用，請重新整理後再送一次（未扣點）",
          });
        }
        throw err;
      }
      if (input.traceSessionId) {
        await updateAiTraceSession(input.traceSessionId, {
          status: "prepared",
          provider: generationProviderOf(model),
          model: model.id,
          sourceType: "generation",
          sourceId: gated.id,
          summary: "等待成本核准，尚未送出 provider",
        }).catch(() => undefined);
      }
      // 系統訊息通知組內；失敗不擋主流程
      await db
        .insert(schema.messages)
        .values({
          groupId: project.groupId,
          projectId: project.id,
          userId: input.userId,
          kind: "system",
          body: `⏳ 生成待核准：${model.label}（${est} 點 ≥ 門檻 ${threshold} 點）——請組長到生成紀錄核准或駁回`,
        })
        .catch((err) => console.warn("[generation] 待核系統訊息寫入失敗：", err instanceof Error ? err.message : err));
      // 跨裝置推播給組長們：待核是「組長不在線就卡住整條產線」的事件，推到手機讓人隨時能核
      void groupLeaderIds(project.groupId, input.userId)
        .then((ids) => pushToUsers(ids, {
          title: "生成待核准",
          body: `【${project.title}】${model.label}（${est} 點 ≥ 門檻 ${threshold} 點）——請到生成紀錄核准或駁回`,
          url: `/p/${project.id}?focus=generation-${gated.id}`,
          tag: `gen-approve-${project.id}`,
        }))
        .catch((err) => console.warn("[generation] 待核推播失敗：", err instanceof Error ? err.message : err));
      return gated;
    }
  }

  let gen: GenerationRow;
  try {
    [gen] = await db
      .insert(schema.generations)
      .values({
        id: input.id, // undefined 時走 schema 的隨機預設
        projectId: project.id,
        groupId: project.groupId,
        userId: input.userId,
        modelId: model.id,
        kind: model.kind,
        prompt: input.prompt,
        sceneId: input.sceneId ?? null, // 綁定分鏡格（沒有＝null，完成後不回填）
        sceneRole: input.sceneRole ?? null, // 回填角色（沒有＝null，視為 visual）
        characterIds: input.characterIds?.length ? input.characterIds : null, // 帶入的定裝卡——重試/再用可還原
        scenePresetIds: input.scenePresetIds?.length ? input.scenePresetIds : null,
        propIds: effectivePropIds.length ? effectivePropIds : null,
        continuitySnapshot: prepared.continuitySnapshot,
        workflowRunId: input.workflowRunId ?? null, // 來源工作流/代理（沒有＝手動生成）
        agentRunId: input.agentRunId ?? null,
        sourceUrl,
        params: storedParams,
        pointsEst: est,
      })
      .returning();
  } catch (err) {
    // 冪等重送撞唯一鍵＝前次程序死亡前已插入同 id：直接回既有列，不再走守門扣點
    // （該列若卡在 queued 沒送出 fal，由既有陳屍清掃退點對帳，這裡不重複處理）
    if (input.id && isUniqueViolation(err)) {
      // 冪等重播必須綁租戶＋同一個提交上下文再回列：只用 id 查會把「碰巧撞到同一個 UUID 的
      // 別組生成」原封不動回給呼叫端（prompt／params／點數全都在那一列裡）。
      // 同時綁 sceneId：同一個 SceneStudio 換鏡卻沿用同一把冪等鍵時，寧可讓它明確失敗，
      // 也不要把 A 鏡的生成當成 B 鏡的結果回去。
      const [existing] = await db
        .select()
        .from(schema.generations)
        .where(and(
          eq(schema.generations.id, input.id),
          eq(schema.generations.projectId, input.projectId),
          eq(schema.generations.groupId, project.groupId),
          input.sceneId ? eq(schema.generations.sceneId, input.sceneId) : isNull(schema.generations.sceneId),
        ));
      if (existing) return existing;
      throw new TRPCError({
        code: "CONFLICT",
        message: "這個送出編號已被另一筆生成使用，請重新整理後再送一次（未扣點）",
      });
    }
    throw err;
  }

  if (input.traceSessionId) {
    await updateAiTraceSession(input.traceSessionId, {
      status: "running",
      provider: generationProviderOf(model),
      model: model.id,
      sourceType: "generation",
      sourceId: gen.id,
      summary: "生成輸入已準備完成",
    }).catch(() => undefined);
  }

  // 原子守門＋扣點（同一交易＋per-user 鎖，杜絕併發雙重扣款/繞過額度）
  // reserveQuota「拋例外」（連線池耗盡/逾時/序列化失敗）時也要刪掉剛建的 queued 列，
  // 否則會留下「從未扣點」的孤兒，30 分鐘後被陳屍清掃憑空退點、灌鬆總預算閘。
  // e2e 測試模式（E2E_MOCK=1，僅供自動化測試）預設不扣點：測試不燒真實額度、也不被額度閘擋
  //（正式模式照常守門；MOCK_BILLING=1 時 mock 也走扣點——e2e 驗證額度守門用，見 billingBypassed）
  // BYOK：個人金鑰路徑不扣平台點數
  if (!billingBypassed() && !usedUserKey) {
    let quotaError: string | null;
    try {
      quotaError = await reserveQuota(input.userId, project.groupId, est, `${input.reasonPrefix ?? "生成"} ${model.label}`, gen.id);
    } catch (err) {
      await db.delete(schema.generations).where(eq(schema.generations.id, gen.id));
      console.error("[generation] reserveQuota 例外，已移除待生成列：", err instanceof Error ? err.message : err);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "系統忙碌，請稍後再試（未扣點）" });
    }
    if (quotaError) {
      await db.delete(schema.generations).where(eq(schema.generations.id, gen.id)); // 未扣點，移除待生成列
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: quotaError });
    }
  }

  try {
    // LLM 文字類分流走 NVIDIA NIM(媒體維持 fal);mock 模式一律交給 falSubmit 的假佇列——
    // 假生成/扣點行為與其他類別完全同口徑,不因供應商分流而多一套 mock
    if (input.traceSessionId) {
      await recordAiTraceEventSafely({
        sessionId: input.traceSessionId,
        eventType: "provider_request",
        summary: `送出 ${model.label}`,
        payload: { endpoint: endpointOf(model), input: falInput },
      });
    }
    const startedAt = Date.now();
    const { requestId } = isNimModel(model) && !isMockMode()
      ? nimSubmit(falInput)
      : isGeminiModel(model) && !isMockMode()
        ? await geminiSubmit(model.kind, falInput)
        : await falSubmit(endpointOf(model), model.kind, falInput, byokFalOpts(userFalKey, usedUserKey));
    if (input.traceSessionId) {
      await recordAiTraceEventSafely({
        sessionId: input.traceSessionId,
        eventType: "provider_response",
        summary: "Provider 已接受工作",
        payload: { requestId, status: "running" },
        latencyMs: Date.now() - startedAt,
      });
    }
    const [updated] = await db
      .update(schema.generations)
      .set({ requestId, status: "running", updatedAt: new Date() })
      .where(eq(schema.generations.id, gen.id))
      .returning();
    return updated;
  } catch (err) {
    console.error("[generation] submit 失敗:", err);
    // 以帳本實際淨扣款為準，同交易翻轉狀態與退款。這也涵蓋
    // billing-bypassed/mock 工作，避免「從未扣款卻退點」灌高餘額。
    const failed = await failStaleGenerationTx(
      gen.id,
      humanizeGenerationError(err instanceof Error ? err.message : String(err)),
      "生成送出失敗退回",
    );
    if (input.traceSessionId) {
      await recordAiTraceEventSafely({
        sessionId: input.traceSessionId,
        eventType: "failed",
        summary: "生成送出失敗",
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
      await updateAiTraceSession(input.traceSessionId, { status: "failed", summary: "生成送出失敗" }).catch(() => undefined);
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: failed.refunded > 0 ? "生成送出失敗，點數已退回，請重試" : "生成送出失敗，請重試",
    });
  }
}

/**
 * 推進一筆生成的 fal 狀態並落 DB（tRPC status 與工作流執行器共用）：
 * done → CAS 推進＋成品入素材庫＋背景落地；failed → CAS 推進＋退點；其餘原樣返回。
 */
export async function advanceGeneration(genId: string): Promise<GenerationRow> {
  const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, genId));
  if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
  if (gen.status !== "queued" && gen.status !== "running") return gen;
  if (!gen.requestId) return gen;

  const model = resolveModel(gen.modelId) ?? getModel(gen.modelId);
  const endpoint = model ? endpointOf(model) : gen.modelId;
  const kind = (model?.kind ?? gen.kind) as "image" | "video" | "audio" | "text";

  // BYOK：送出時用了個人 key，status 查詢必須同一把；金鑰已移除 → fail（當初沒扣平台點）。
  const { userFalKey: statusUserKey, usedUserKey: statusUsedUserKey } = await resolveByokFalKey(
    gen.userId,
    model,
    gen.params,
  );
  if (
    statusUsedUserKey &&
    !statusUserKey &&
    !gen.requestId.startsWith("nim_") &&
    !gen.requestId.startsWith("gemini_") &&
    !gen.requestId.startsWith("mock_")
  ) {
    const failed = await failStaleGenerationTx(
      gen.id,
      "個人 fal API Key 已移除或失效，無法查詢生成狀態（未使用平台點數，無需退點）",
      "個人金鑰失效",
    );
    if (!failed.updated) {
      const [current] = await db.select().from(schema.generations).where(eq(schema.generations.id, gen.id));
      return current ?? gen;
    }
    const [updated] = await db.select().from(schema.generations).where(eq(schema.generations.id, gen.id));
    return updated ?? gen;
  }

  // 依 requestId 前綴分流:nim_=NVIDIA NIM 記憶體佇列;mock_/其餘=fal(mock 前綴由 falStatus 自行處理)。
  // 用前綴而非模型註冊表判斷——部署切換期間在途的舊 any-llm 生成仍能沿 fal 佇列收尾。
  const result = gen.requestId.startsWith("nim_")
    ? nimStatus(gen.requestId)
    : gen.requestId.startsWith("gemini_")
      ? geminiStatus(gen.requestId)
      : await falStatus(endpoint, kind, gen.requestId, byokFalOpts(statusUserKey, statusUsedUserKey));
  // 供應商回 done 卻無任何輸出：不得永久卡 queued/running 持有預扣點（先前會 fall-through 到 return gen）
  if (result.status === "done" && !(result.resultUrl || result.resultText)) {
    const emptyFailed = await failStaleGenerationTx(
      gen.id,
      "生成服務回報完成，但沒有可用的成品（無圖／影／音／文字）",
      "生成無輸出退回",
    );
    if (!emptyFailed.updated) {
      const [current] = await db.select().from(schema.generations).where(eq(schema.generations.id, gen.id));
      return current ?? gen;
    }
    const [updated] = await db.select().from(schema.generations).where(eq(schema.generations.id, gen.id));
    if (!updated) return gen;
    void pushToUsers([gen.userId], {
      title: "生成失敗",
      body: `${model?.label ?? gen.modelId}：沒有可用的成品${emptyFailed.refunded > 0 ? "（點數已退回）" : ""}`,
      url: `/p/${gen.projectId}?focus=generation-${gen.id}`,
      tag: `gen-failed-${gen.id}`,
    }).catch((err) => console.warn("[generation] 空輸出失敗推播失敗：", err instanceof Error ? err.message : err));
    return updated;
  }
  if (result.status === "done" && (result.resultUrl || result.resultText)) {
    // Compare-and-set：只有把「仍在 queued/running」的列成功推進成 done 的那一次才算數，
    // 併發輪詢/重試不會重複入庫（舊版每次都 update+insert asset → 重複素材、重複計費）。
    // 關鍵（QA-014）：done 翻轉與「成品入素材庫＋分鏡回填」同一交易——舊版先 commit done 再
    // 另 insert asset，中間 DB 抖動會留下「done 但沒有素材」且 CAS 已過、永不補建。
    // 包進同交易後全有或全無：asset 寫入失敗整筆 rollback，列留在 queued/running，下次輪詢重試。
    const mediaUrl = result.resultUrl && (kind === "image" || kind === "video" || kind === "audio") ? result.resultUrl : null;
    const mediaKind = kind === "image" || kind === "video" || kind === "audio" ? kind : null;
    const usedUserKeyDone = splitGenerationSourceMeta(gen.params).meta.usedUserKey === true;
    const advanced = await db.transaction(async (tx) => {
      const rows = await tx
        .update(schema.generations)
        .set({
          status: "done",
          resultUrl: result.resultUrl,
          resultText: result.resultText,
          // BYOK：個人金鑰路徑實際平台花費為 0
          pointsActual: usedUserKeyDone ? 0 : gen.pointsEst,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.generations.id, gen.id), inArray(schema.generations.status, ["queued", "running"])))
        .returning();
      if (rows.length === 0) return { updated: null, assetId: null as string | null, pointerMoved: false };
      let assetId: string | null = null;
      /** 這一筆有沒有真的移動分鏡的現用指標——決定完成廣播要說「畫面已更新」還是「已存為候選」 */
      let pointerMoved = false;
      // 媒體成品自動入素材庫(AI 生成標記);文字輸出留在生成紀錄。
      if (mediaUrl && mediaKind) {
        const stored = parseStoredResultUrl(mediaUrl);
        const [asset] = await tx
          .insert(schema.assets)
          .values({
            projectId: gen.projectId,
            groupId: gen.groupId,
            kind: mediaKind,
            title: gen.prompt.slice(0, 40),
            url: stored ? "pending" : mediaUrl,
            storagePath: stored?.storagePath ?? null,
            mime: stored?.mime ?? null,
            sizeBytes: stored?.sizeBytes ?? null,
            landState: stored ? "landed" : undefined,
            isAiGenerated: true,
            meta: { generationId: gen.id, modelId: gen.modelId },
          })
          .returning();
        assetId = asset.id;
        if (stored) {
          const localUrl = `/api/assets/${asset.id}/file`;
          await tx.update(schema.assets).set({ url: localUrl }).where(eq(schema.assets.id, asset.id));
          await tx
            .update(schema.generations)
            .set({ resultUrl: localUrl, updatedAt: new Date() })
            .where(eq(schema.generations.id, gen.id));
        }
        // 綁定分鏡的就地生成：把成品回填該分鏡格（拆分鏡草稿→出圖 一條線）。
        // 冪等：CAS 已保證此段每筆只跑一次；同交易失敗一起 rollback。
        const backfillWhere = sceneBackfillWhere(gen);
        if (gen.sceneId && backfillWhere) {
          // 角色感知回填：narration→旁白音檔、ambience→環境音；其餘（visual/null）→主畫面欄位。
          // 軟刪／回收桶分鏡不回填，避免還原後突然出現意外綁定
          const patch =
            gen.sceneRole === "narration"
              ? { narrationAssetId: asset.id }
              : gen.sceneRole === "ambience"
                ? { ambienceAssetId: asset.id }
                : { assetId: asset.id };
          /*
           * 人類優先（v4）＋ §17 已通過審核：兩道守衛都在 sceneBackfillWhere 裡，
           * 與 *.pg.test.ts 共用同一份，不在這裡再抄一次。
           *
           * 人類優先：生成從送出到 provider 回來可能要好幾分鐘，這期間人可能已經
           * 採用了別的版本。舊行為是照樣覆寫——使用者剛選好的畫面被一個他早就忘記的
           * 舊工作蓋掉，而且沒有任何提示。條件不滿足時：生成照樣完成、素材照樣入庫、
           * 版本清單照樣看得到這一版（它就是一個候選），只是指標不動。
           *
           * §17：已通過審核的鏡不自動換掉現用版本，否則「已通過」等於沒有意義。
           */
          const moved = await tx
            .update(schema.scenes)
            .set(patch)
            .where(backfillWhere)
            .returning({ id: schema.scenes.id });
          // 守衛擋下來時（人已經採用了別版／這一鏡已通過審核）指標沒有動。
          // 這件事必須往上傳：下面的全房廣播寫的是「畫面已更新」，
          // 若照樣送出，等於對每一位協作者謊報畫面換了。
          pointerMoved = moved.length > 0;
        }
      }
      return { updated: rows[0], assetId, pointerMoved };
    });
    if (!advanced.updated) {
      const [current] = await db.select().from(schema.generations).where(eq(schema.generations.id, gen.id));
      return current ?? gen; // 別人已推進，直接回現況（列必存在,回退舊快照僅是型別防禦）
    }
    // 成品落地：全房即時看到那一格換了畫面。
    // 沒有這一段的話，「組長按下生成、把畫面留給組員看」時組員端毫無訊號——
    // 這條路徑不經 tRPC，客戶端的 mutation 快取訂閱看不到它，只能等 10/20/45 秒的輪詢追上。
    if (gen.projectId && gen.sceneId) {
      /*
       * 訊息要跟著「指標到底有沒有動」走。人類優先守衛擋下回填時（有人已經採用了
       * 別的版本，或這一鏡已通過審核），畫面其實沒有變；照樣廣播「畫面已更新」
       * 會讓每一位協作者以為自己看到的是新版，反而把剛採用的人推去重看一次。
       * 候選仍然入庫、版本清單仍然看得到，所以這裡講的是實話而不是失敗。
       */
      publishToProject(
        gen.projectId,
        { kind: "scene", id: gen.sceneId },
        advanced.pointerMoved ? "生成完成，畫面已更新" : "生成完成，已存為候選版本（現用畫面未變）",
      );
    }
    if (
      (gen.modelId.startsWith("fal-ai/") || gen.modelId.startsWith("openrouter/router#"))
      && !gen.requestId.startsWith("mock_")
      && !gen.requestId.startsWith("nim_")
    ) {
      // A real, parseable result (Fal queue / OpenRouter LLM) is durable
      // certification evidence. Keep generation completion successful even if
      // catalog maintenance is temporarily unavailable.
      const { certifySuccessfulModel } = await import("./modelCertification");
      await certifySuccessfulModel(gen.modelId).catch((err) =>
        console.warn(
          "[generation] 模型認證寫回失敗：",
          err instanceof Error ? err.message : err,
        ),
      );
    }
    // 背景落地到 Volume（fal 網址會過期,永久保存靠這步;失敗沿用外部網址不擋流程）——
    // 網路 IO 不進交易，commit 後才啟動；失敗由 sweepUnlandedAssets 定期補抓。
    if (advanced.assetId && mediaUrl && !parseStoredResultUrl(mediaUrl)) {
      persistGenerationResult(advanced.assetId, gen.id, mediaUrl);
    }
    const trace = await findAiTraceSessionBySource("generation", gen.id).catch(() => null);
    if (trace) {
      await recordAiTraceEventSafely({
        sessionId: trace.id,
        eventType: "provider_response",
        summary: "Provider 回傳生成結果",
        payload: result.rawResponse ?? {
          status: result.status,
          resultUrl: result.resultUrl,
          resultText: result.resultText,
          usage: result.usage,
        },
      });
      await recordAiTraceEventSafely({
        sessionId: trace.id,
        eventType: "completed",
        summary: "生成完成並寫入系統",
        payload: { generationId: gen.id, assetId: advanced.assetId, usage: result.usage },
      });
      await updateAiTraceSession(trace.id, { status: "completed", summary: "生成完成" }).catch(() => undefined);
    }
    // 跨裝置推播給發起人（CAS 保證同筆只推一次）；tag 以專案聚合——工作流連跑多鏡時
    // 後到的覆蓋先到的，手機不被逐筆洗版（頁內 GenerationList 已有逐筆彙總通知）
    void pushToUsers([gen.userId], {
      title: "生成完成",
      body: `${model?.label ?? gen.modelId}：${gen.prompt.slice(0, 60)}`,
      // 深連結：直達生成紀錄該筆（ProjectPage focus=generation-* 會開抽屜捲動高亮）
      url: `/p/${gen.projectId}?focus=generation-${gen.id}`,
      tag: `gen-${gen.projectId}`,
    }).catch((err) => console.warn("[generation] 完成推播失敗：", err instanceof Error ? err.message : err));
    return advanced.updated;
  }
  if (result.status === "failed") {
    // 同樣 compare-and-set：只有真正把列從 queued/running 轉成 failed 的那一次才退點，
    // 避免同一筆被多次輪詢重複退款（憑空長點數）。
    // 關鍵：狀態翻轉與退點帳本列「同一交易」——舊版先 commit failed(pointsRefunded=est) 再另寫退點列，
    // 中間當機/重部署會留下 terminal failed 列（pointsRefunded 記謊）而退點列從未寫入、且無 sweep 會再碰
    // terminal 列 → 使用者點數永久蒸發。包進同交易後：全有或全無，中途當機整筆 rollback，
    // 列留在 queued/running 交由 30 分 sweep 依帳本淨額安全收尾。
    const failed = await failStaleGenerationTx(
      gen.id,
      humanizeGenerationError(result.error),
      "生成失敗退回",
    );
    if (!failed.updated) {
      const [current] = await db.select().from(schema.generations).where(eq(schema.generations.id, gen.id));
      return current ?? gen;
    }
    const [updated] = await db.select().from(schema.generations).where(eq(schema.generations.id, gen.id));
    if (!updated) return gen;
    // 失敗推播（CAS 保證同筆只推一次）：tag 獨立不與「生成完成」互蓋——失敗訊號不能被後到的成功淹掉
    const failMsg = humanizeGenerationError(result.error);
    const trace = await findAiTraceSessionBySource("generation", gen.id).catch(() => null);
    if (trace) {
      await recordAiTraceEventSafely({
        sessionId: trace.id,
        eventType: "failed",
        summary: "Provider 生成失敗",
        payload: result.rawResponse ?? { status: result.status, error: result.error, usage: result.usage },
      });
      await updateAiTraceSession(trace.id, { status: "failed", summary: failMsg }).catch(() => undefined);
    }
    void pushToUsers([gen.userId], {
      title: "生成失敗",
      body: `${model?.label ?? gen.modelId}：${failMsg}${failed.refunded > 0 ? "（點數已退回）" : ""}`,
      url: `/p/${gen.projectId}?focus=generation-${gen.id}`,
      tag: `gen-failed-${gen.id}`,
    }).catch((err) => console.warn("[generation] 失敗推播失敗：", err instanceof Error ? err.message : err));
    return updated;
  }
  return gen;
}

/**
 * 把一筆素材排回補抓佇列（對帳發現「資料庫說有檔、磁碟上卻沒有」時呼叫）。
 *
 * 關鍵是要把 storagePath 清掉並把 url 指回外部來源：檔案既然不在了，那個本地路徑
 * 就是一個謊——留著它，素材頁會繼續給使用者一個永遠 404 的連結，sweepUnlandedAssets
 * 也永遠撈不到這一列（它只找 storagePath 為空的）。清掉之後這筆就回到「只剩外部網址」
 * 的狀態，既有的 sweep tick 會自然把它重新抓回來。
 *
 * 沒有可再抓一次的來源時（手動上傳、來源不是 http）標成 structural_fail 而不是 pending——
 * 抓不回來的列留在佇列裡只會把佇列塞滿、讓真的救得回的那些排不進來。
 */
export async function enqueueLanding(assetId: string): Promise<boolean> {
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).limit(1);
  if (!asset) return false;
  const source = asset.originUrl ?? (asset.url.startsWith("http") ? asset.url : null);
  if (!source || !asset.isAiGenerated) {
    await db
      .update(schema.assets)
      .set({ landState: "structural_fail", landLastError: "沒有可重新抓取的外部來源", landLastTriedAt: new Date() })
      .where(eq(schema.assets.id, assetId));
    return false;
  }
  await db
    .update(schema.assets)
    .set({
      storagePath: null,
      url: source,
      originUrl: source,
      landState: "pending",
      landNextTryAt: new Date(),
      landClaimedAt: null,
    })
    .where(eq(schema.assets.id, assetId));
  return true;
}

/**
 * 落地補抓（修：persistGenerationResult 是「射後不理」的背景作業，一次網路抖動失敗後，
 * 素材的 url 就永久停在 fal CDN 外部網址、storagePath 為空——fal CDN 網址是短效的，
 * 過期後成品變永久死連結且無源可重抓，是慢性資料流失）。
 * 這裡掃「AI 生成、未落地（storagePath 空）、url 仍是外部 http」的素材重試 persistRemote，
 * 由 generationRunner 的 sweep tick 定期呼叫。冪等：已落地的（storagePath 非空）撈不到；
 * 假模式的 /api/mock-asset/* 佔位網址略過（不需落地、也避免 e2e 期間改動 mock 素材）。
 */
export async function sweepUnlandedAssets(limit = 20): Promise<number> {
  const rows = await db
    .select()
    .from(schema.assets)
    // 修 R6-LIFE-01：回收桶（deletedAt 非空）素材也要落地——原本 isNull(deletedAt) 濾條會讓「生成後未落地→
    // 丟回收桶→fal 短效網址過期→還原」的素材變永久死連結，回收桶「可救回」承諾落空。未落地時素材唯一來源就是
    // 外部 url，還原時必須有 Volume 檔可用。落地本身冪等（已落地的 storagePath 非空撈不到），對回收桶素材無副作用。
    .where(and(
      eq(schema.assets.isAiGenerated, true),
      isNull(schema.assets.storagePath),
      like(schema.assets.url, "http%"),
    ))
    .limit(limit);
  let landed = 0;
  for (const asset of rows) {
    if (asset.url.includes("/api/mock-asset/")) continue; // 假模式佔位圖不落地
    try {
      const persisted = await persistRemote(asset.url);
      if (!persisted) continue; // fal 網址已死/抓取失敗 → 下輪再試（或已無源，無害，不擋）
      const localUrl = `/api/assets/${asset.id}/file`;
      await db
        .update(schema.assets)
        .set({ storagePath: persisted.storagePath, mime: persisted.mime, sizeBytes: persisted.sizeBytes, url: localUrl })
        .where(eq(schema.assets.id, asset.id));
      // 順帶把來源生成的 resultUrl 也指向落地後的自有網址（與 persistGenerationResult 同口徑）
      const genId = (asset.meta as { generationId?: string } | null)?.generationId;
      if (genId) {
        await db.update(schema.generations).set({ resultUrl: localUrl, updatedAt: new Date() }).where(eq(schema.generations.id, genId));
      }
      landed += 1;
      console.log(`[storage] 落地補抓成功：asset=${asset.id}（${persisted.sizeBytes}B ${persisted.mime}）`);
    } catch (err) {
      console.warn(`[storage] 落地補抓略過（下輪再試）：asset=${asset.id}`, err instanceof Error ? err.message : err);
    }
  }
  return landed;
}
