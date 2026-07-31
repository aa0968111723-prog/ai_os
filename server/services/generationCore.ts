/**
 * 生成核心積木（自 routers/generation.ts 抽出，行為不變）：
 * - submitGenerationCore：世界觀/角色/場景注入 → 額度守門扣點 → fal 送出（失敗退點）。
 * - advanceGeneration：推進一筆生成的 fal 狀態並落 DB（done 入素材庫、failed 退點）。
 * 抽成服務層的原因：後端工作流執行器（workflowRunner）要在 tRPC 請求之外重用同一批
 * 防護（孤兒列刪除、CAS 推進、退點）——邏輯若複製兩份，防護遲早分岔。
 * 錯誤沿用 TRPCError：tRPC 端原樣拋出；伺服器內部呼叫端只讀 message（都是人話訊息）。
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { getModel, endpointOf, isNimModel, supportsNegativePrompt, CARD_ANCHOR_CATEGORIES, type ProjectFormat, type ModelEntry } from "../../shared/models";
import { SOURCE_INCOMPAT } from "../../shared/sourceIncompat";
import { resolveModel, estimatePointsFor } from "./modelResolve";
import {
  worldviewSchema,
  formatWorldviewVisualPositive,
  formatWorldviewForAi,
  type Worldview,
} from "../../shared/worldview";
import { falSubmit, falStatus, billingBypassed, isMockMode } from "./fal";
import { nimSubmit, nimStatus } from "./nvidia-nim";
import { failStaleGenerationTx, reserveQuota } from "./points";
import { persistRemote, removeStoredFile, signAssetUrl, type PersistResult } from "./storage";
import { buildCharacterAnchor, buildSceneAnchor } from "./cardAnchors";
import { groupLeaderIds, pushToUsers } from "./webPush";
import { recordError } from "./errlog";

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

/** 剛入庫、準備第一次落地的成品素材（persistGenerationResult 需要的最小欄位） */
interface FreshGeneratedAsset {
  id: string;
  projectId: string;
  title: string;
  createdAt: Date;
}

/**
 * 成品落地（背景）：fal 的 CDN 網址會過期，完成後盡快抓回 Volume 永久保存。
 * 失敗不影響主流程（外部網址短期內仍可用）——素材維持 landState="pending"，
 * 由 sweepUnlandedAssets 依退避時間補抓；originUrl 從入庫起就保留，落地成功也不抹除，
 * 所以就算 url 已被改寫成本地網址，補救來源永遠還在（舊版覆寫掉 url ＝ 主動關掉唯一的補救來源）。
 */
function persistGenerationResult(asset: FreshGeneratedAsset, generationId: string, remoteUrl: string): void {
  void (async () => {
    const persisted = await persistRemoteSafe(remoteUrl);
    if (!persisted.ok) {
      // 退場判斷（重試 or 放棄＋通知）統一交給同一套狀態機，不在兩處分岔
      await recordLandFailure(
        { id: asset.id, projectId: asset.projectId, title: asset.title, createdAt: asset.createdAt, attempts: 0, generationId },
        persisted,
      );
      return;
    }
    const landed = await commitLandedAsset(asset.id, generationId, persisted);
    if (!landed) return;
    console.log(`[storage] 成品已落地：asset=${asset.id}（${persisted.sizeBytes}B ${persisted.mime}）`);
  })().catch((err) => console.warn("[storage] 成品落地背景作業失敗：", err instanceof Error ? err.message : err));
}

/* ── 落地補抓狀態機（persistGenerationResult 與 sweepUnlandedAssets 共用同一套退場邏輯） ── */

/** 補抓退場的絕對年齡上限：fal CDN 網址壽命以小時計，成品誕生超過一天還沒落地，來源幾乎必死 */
const LAND_GIVEUP_AGE_MS = 24 * 60 * 60 * 1000;
/** 指數退避上限：再怎麼退也至少每 6 小時試一次，不會在來源死透前就把窗口睡過頭 */
const LAND_BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

/** 放棄前最多嘗試幾次（含第一次背景落地）；可用 ASSET_LAND_MAX_ATTEMPTS 覆寫，預設 8 */
function landMaxAttempts(): number {
  const n = Number(process.env.ASSET_LAND_MAX_ATTEMPTS ?? 8);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 8;
}

/**
 * persistRemote 契約上已把所有失敗收斂成結構化結果、不拋錯；這裡再兜一層防禦——
 * 萬一底層有漏網例外（怪 runtime 錯誤等），單筆爆炸也只當成一次可重試的 io 失敗，
 * 不能讓補抓佇列整輪中斷。
 */
async function persistRemoteSafe(url: string): Promise<PersistResult> {
  try {
    return await persistRemote(url);
  } catch (err) {
    return { ok: false, reason: "io", retryable: true, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** 落地失敗登記所需的最小素材脈絡（背景落地與補抓佇列兩個入口共用同一結構） */
interface LandFailureCtx {
  id: string;
  projectId: string;
  title: string;
  createdAt: Date;
  /** 這次失敗「之前」DB 已記的嘗試次數（land_attempts）；本函式會 +1 落庫 */
  attempts: number;
  generationId?: string | null;
  uploadedBy?: string | null;
}

/** 推播對象：AI 成品找發起生成的人；查不到（或手動上傳）退回上傳者。都沒有回 null＝只記 log。 */
async function resolveLandOwner(ctx: LandFailureCtx): Promise<string | null> {
  try {
    if (ctx.generationId) {
      const [gen] = await db
        .select({ userId: schema.generations.userId })
        .from(schema.generations)
        .where(eq(schema.generations.id, ctx.generationId));
      if (gen?.userId) return gen.userId;
    }
  } catch (err) {
    console.warn("[storage] 落地失敗通知：查詢素材擁有者失敗（改用上傳者）：", err instanceof Error ? err.message : err);
  }
  return ctx.uploadedBy ?? null;
}

/**
 * 落地失敗登記：可重試的排指數退避，救不回的直接退場＋通知擁有者。
 * 「退場」是這個狀態機的核心修正——舊版對 404/410 也無限重試，死列佔滿補抓名額後，
 * 真正救得回來的新成品反而永遠輪不到；而且沒有任何人被告知成品其實沒有備份。
 */
async function recordLandFailure(ctx: LandFailureCtx, failure: Extract<PersistResult, { ok: false }>): Promise<void> {
  const attempts = ctx.attempts + 1;
  const now = new Date();
  const tooOld = now.getTime() - new Date(ctx.createdAt).getTime() > LAND_GIVEUP_AGE_MS;
  const permanent = !failure.retryable || attempts >= landMaxAttempts() || tooOld;
  if (!permanent) {
    // 指數退避：2^attempts 分鐘、上限 6 小時。剛失敗的列往後排，把名額讓給還沒試過的
    const backoffMs = Math.min(2 ** attempts * 60_000, LAND_BACKOFF_CAP_MS);
    await db
      .update(schema.assets)
      .set({
        landAttempts: attempts,
        landLastError: failure.detail,
        landLastTriedAt: now,
        landNextTryAt: new Date(now.getTime() + backoffMs),
        landClaimedAt: null, // 釋放認領：本輪已有結論，下輪依 landNextTryAt 決定何時再試
      })
      .where(eq(schema.assets.id, ctx.id));
    return;
  }
  // 永久失敗：too-large 是結構性限制（管理員調高 ASSET_MAX_MB 之前重試無意義）→ skipped；
  // 其餘（來源 404/410、次數/年齡耗盡）→ failed。兩者都清掉 landNextTryAt＝正式出隊，
  // 死列從此不再佔補抓名額。
  const finalState = failure.reason === "too-large" ? ("skipped" as const) : ("failed" as const);
  await db
    .update(schema.assets)
    .set({
      landState: finalState,
      landAttempts: attempts,
      landLastError: failure.detail,
      landLastTriedAt: now,
      landNextTryAt: null,
      landClaimedAt: null,
    })
    .where(eq(schema.assets.id, ctx.id));
  recordError("asset:land-failed", `asset=${ctx.id}「${ctx.title}」落地放棄（${failure.reason}）：${failure.detail}`);
  // 這不是可以安靜吞掉的失敗：成品沒有永久備份、外部網址隨時過期。推播給擁有者搶最後的下載窗口。
  const ownerId = await resolveLandOwner(ctx);
  if (!ownerId) {
    console.warn(`[storage] 落地放棄但找不到可通知的擁有者：asset=${ctx.id}`);
    return;
  }
  const body =
    failure.reason === "too-large"
      ? `「${ctx.title}」超過單檔大小上限，系統無法自動備份。這支成品沒有永久備份，外部網址即將失效，請立刻自行下載一份保存；並請管理員調高 ASSET_MAX_MB 上限，之後的大檔成品才能自動備份。`
      : `「${ctx.title}」自動備份多次失敗，系統已停止重試。這支成品沒有永久備份，外部網址即將失效，請立刻自行下載一份保存。`;
  await pushToUsers([ownerId], {
    title: "素材沒有備份，請立刻下載",
    body,
    url: `/p/${ctx.projectId}`,
    tag: `asset-land-failed-${ctx.id}`,
  }).catch((err) => console.warn("[storage] 落地放棄推播失敗：", err instanceof Error ? err.message : err));
}

/**
 * 落地成功寫回（條件式 update）：只有「storage_path 仍為空」的那一次寫入算數。
 * 背景落地與補抓佇列可能同時抓同一筆（認領斷頭回收、重佈疊代都會發生），誰先 commit 誰贏；
 * 輸的那邊必須把自己剛下載的檔刪掉，否則 Volume 會累積無人引用的孤兒檔。
 * 注意：只改 url、不動 originUrl——原始外部網址是日後對帳補救的唯一線索（見 schema 註解）。
 */
async function commitLandedAsset(
  assetId: string,
  generationId: string | null,
  persisted: Extract<PersistResult, { ok: true }>,
): Promise<boolean> {
  const localUrl = `/api/assets/${assetId}/file`;
  const won = await db
    .update(schema.assets)
    .set({
      storagePath: persisted.storagePath,
      mime: persisted.mime,
      sizeBytes: persisted.sizeBytes,
      sha256: persisted.sha256,
      url: localUrl,
      landState: "landed",
      landNextTryAt: null,
      landClaimedAt: null,
      landLastError: null,
    })
    .where(and(eq(schema.assets.id, assetId), isNull(schema.assets.storagePath)))
    .returning({ id: schema.assets.id });
  if (won.length === 0) {
    // 另一輪已先落地：自己這份是重複下載的孤兒檔，立刻清掉
    await removeStoredFile(persisted.storagePath);
    return false;
  }
  // 順帶把來源生成的 resultUrl 指向落地後的自有網址（與舊版 persistGenerationResult 同口徑）
  if (generationId) {
    await db
      .update(schema.generations)
      .set({ resultUrl: localUrl, updatedAt: new Date() })
      .where(eq(schema.generations.id, generationId));
  }
  return true;
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
  return bg ? `${userPrompt}\n\n[專案背景] ${bg}` : userPrompt;
}

/**
 * 來源素材「明顯不相容」表：單一真相在 shared/sourceIncompat.ts
 * （前端 generationGates 同源匯入，避免 client/server 漂移）。
 */
const SOURCE_KIND_LABEL: Record<string, string> = { image: "圖片", video: "影片", audio: "音訊", doc: "文件", zip: "zip 壓縮包" };

/** 哪些類別注入世界觀(TTS 會唸出注入文字、轉錄/視覺/訓練/影片工具不適用 → 不注入) */
// 修 GEN-202：text-to-audio（配樂/音效）移出注入名單——世界觀的「核心訊息／避免禁忌」是敘事文字，
// 灌進配樂/音效提示詞只會污染輸出（與 speech-to-text/vision/training 同樣不注入）。
const INJECT_CATEGORIES = new Set(["text-to-image", "image-to-image", "text-to-video", "image-to-video", "llm"]);
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
  const negative = visual ? worldview.taboos.map((t) => t.trim()).filter(Boolean).join(", ") : "";
  return { positive, negative };
}

/** 相容薄殼：只要正向的既有呼叫端（generation.ts re-export、services/mcp.ts）不必改 */
export function effectivePrompt(model: ModelEntry, userPrompt: string, worldview: Worldview): string {
  return effectivePromptParts(model, userPrompt, worldview).positive;
}

/** 角色定裝錨點：視覺類別才注入，並前綴到（世界觀已注入的）提示詞 */
export function withCharacterAnchor(model: ModelEntry, prompt: string, anchor: string): string {
  if (!anchor || !CHARACTER_CATEGORIES.has(model.category)) return prompt;
  return `${prompt}\n\n[角色定裝] ${anchor}`;
}

/** 場景設定錨點（色板/光線）：同樣只注入視覺類別 */
export function withSceneAnchor(model: ModelEntry, prompt: string, anchor: string): string {
  if (!anchor || !CHARACTER_CATEGORIES.has(model.category)) return prompt;
  return `${prompt}\n\n[場景設定] ${anchor}`;
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
  /** 選定的角色定裝卡：外觀錨點自動注入視覺生成,跨鏡一致 */
  characterIds?: string[];
  /** 選定的場景設定卡：色板/光線錨點注入,同場景光影一致 */
  scenePresetIds?: string[];
  /** 帳本理由前綴（預設「生成」；工作流帶「工作流生成」以便帳本可辨識來源） */
  reasonPrefix?: string;
  /** 綁定的分鏡格：草稿分鏡「就地生成」時帶入，完成後把成品回填該格（沒有＝不綁定，不影響既有呼叫） */
  sceneId?: string;
  /** 要回填分鏡的哪個角色："narration"＝旁白音檔（回填 narrationAssetId）；不帶＝visual（回填 assetId） */
  sceneRole?: "visual" | "narration";
  /** 來源工作流執行 id：runner 帶入，生成列落庫後可回看「這筆是哪條工作流跑出來的」 */
  workflowRunId?: string;
  /** 來源 AI 代理執行 id：agentRunner 帶入，同上 */
  agentRunId?: string;
  /** 存取檢查掛點：tRPC 端帶 requireGroup（多組隔離；可再疊 2.3 專案級 ACL，故允許 async）；
   *  伺服器內部（runner）呼叫時已在建 run 時把過關,可省略。
   *  回傳角色（requireGroup 本來就回）供成本審核門檻判斷組員；回 void 的舊呼叫端不受影響（不觸發門檻）。 */
  assertAccess?: (project: typeof schema.projects.$inferSelect) => "admin" | "leader" | "member" | void | Promise<"admin" | "leader" | "member" | void>;
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
export async function assertGenerationEntityIds(
  projectId: string,
  opts: {
    characterIds?: string[];
    scenePresetIds?: string[];
    sourceAssetId?: string;
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
}

/** 送出生成（守護齊全：孤兒列刪除、原子守門扣點、fal 失敗退點＋標 failed） */
export async function submitGenerationCore(input: SubmitCoreInput): Promise<GenerationRow> {
  const model = resolveModel(input.modelId) ?? getModel(input.modelId);
  if (!model) throw new TRPCError({ code: "BAD_REQUEST", message: "未知模型(不在註冊表或即時目錄)" });
  if (model.needs && !input.sourceUrl && !input.sourceAssetId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `此模型需要來源:${model.sourceHint ?? model.needs}` });
  }

  // 逐次估點：按字計費的 TTS 依實際朗讀文字長度算真實成本；其餘＝扁平 model.points（行為不變）。
  // 一次算好貫穿下面所有站（審核門檻／pointsEst／扣點／送出失敗退點），確保三者永遠一致。
  // TTS 不注入世界觀（見 effectivePrompt），故 input.prompt 即送 fal 的計費文字。
  const est = estimatePointsFor(model, { promptChars: input.prompt.length });

  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  const accessRole = await input.assertAccess?.(project); // 多組隔離（可含專案級 ACL）；回傳角色供成本審核門檻用
  // 封存／暫停專案凍結生成（TD-03 狀態機）：拿舊 projectId 對已封存專案會照樣扣點（滲透實測）。
  // 與 scheduleCore／agentCore／Command 同口徑。
  const { assertProjectAllows } = await import("./projectState");
  assertProjectAllows(project, "generate");

  // CA-01／KD-12：專案歸屬 fail-closed——在簽名／建列／扣點之前擋下外鍵 UUID
  await assertGenerationEntityIds(project.id, {
    characterIds: input.characterIds,
    scenePresetIds: input.scenePresetIds,
    sourceAssetId: input.sourceAssetId,
  });

  // 素材庫來源 → 簽名網址（同組檢查；本地檔或外部網址都可）
  let sourceUrl = input.sourceUrl;
  if (input.sourceAssetId) {
    // 回收桶素材不得當付費生成來源：素材庫挑選 UI 已濾 deletedAt，但 stale 畫面／直呼 tRPC
    // 可帶入已軟刪的 id——不擋的話會扣點且讓「已刪」內容回流到新成品
    const [srcAsset] = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.id, input.sourceAssetId), isNull(schema.assets.deletedAt)));
    if (!srcAsset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到來源素材（可能已在回收桶——先還原才能當來源）" });
    if (srcAsset.groupId !== project.groupId) throw new TRPCError({ code: "FORBIDDEN", message: "來源素材不屬於此專案的組" });
    // 明顯不相容的來源直接擋下，省一次白白失敗的生成
    if (model.needs && (SOURCE_INCOMPAT[model.needs] ?? []).includes(srcAsset.kind)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `這個模型需要${SOURCE_KIND_LABEL[model.needs] ?? model.needs}來源，選到的素材是${SOURCE_KIND_LABEL[srcAsset.kind] ?? srcAsset.kind}——請換一個相容的素材`,
      });
    }
    sourceUrl = srcAsset.storagePath ? signAssetUrl(srcAsset.id) : srcAsset.url;
    if (!sourceUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "此素材沒有可用檔案" });
  }

  // 正式模式：擋下 mock 佔位來源（線上曾出現 sourceUrl=…/api/mock-asset/image → fal 422）
  if (model.needs && sourceUrl && !isMockMode() && isUnusableRealModeSourceUrl(sourceUrl)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "來源圖是測試佔位圖（/api/mock-asset），正式生成無法使用——請改從素材庫選真實圖片，或貼上可公開抓取的圖片網址",
    });
  }

  const worldview = worldviewSchema.parse(project.worldview ?? {});
  // 世界觀 → 角色定裝 → 場景設定，依序疊加注入（都只撈本專案，且只注入視覺類別）
  // 角色／場景查詢互不相依，並行省一趟 DB RTT
  const [charAnchor, sceneAnchor] = await Promise.all([
    input.characterIds?.length ? buildCharacterAnchor(project.id, input.characterIds) : Promise.resolve(""),
    input.scenePresetIds?.length ? buildSceneAnchor(project.id, input.scenePresetIds) : Promise.resolve(""),
  ]);
  const promptParts = effectivePromptParts(model, input.prompt, worldview);
  const fullPrompt = withSceneAnchor(
    model,
    withCharacterAnchor(model, promptParts.positive, charAnchor),
    sceneAnchor,
  );
  const falInput = model.input(fullPrompt, project.format as ProjectFormat, sourceUrl) as Record<string, unknown>;
  // 禁忌詞負向注入（深度優化）：視覺類別的禁忌詞走 negative_prompt，且只送給 schema 明確支援的模型
  // （見 supportsNegativePrompt）——存進 params 後，核准重送（decideCost）原樣沿用，不必另改。
  if (promptParts.negative && supportsNegativePrompt(model)) {
    falInput.negative_prompt = promptParts.negative;
  }

  // 成本審核門檻（需求 2.1）：組員（member）單筆估點 ≥ 組門檻 → 先落一筆 awaiting_approval，
  // 不扣點、不送 fal，等組長在生成紀錄核准（generation.decideCost）才走扣點＋送出。
  // 所有可送出生成的路徑（手動、工作流、AI 代理）都必須帶入當下角色；組長/管理員不受限。
  if (accessRole === "member") {
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
            workflowRunId: input.workflowRunId ?? null,
            agentRunId: input.agentRunId ?? null,
            sourceUrl,
            params: falInput, // 注入完成的 fal 輸入原樣保存——核准時直接送出，不重組（世界觀/卡片以送審當下為準）
            pointsEst: est,
            status: "awaiting_approval",
          })
          .returning();
      } catch (err) {
        // 冪等重送撞唯一鍵：前次請求已建待核列——直接回既有列，不重複落列、不重發通知
        if (input.id && isUniqueViolation(err)) {
          const [existing] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.id));
          if (existing) return existing;
        }
        throw err;
      }
      // 系統訊息通知組內（比照審批三態機）；失敗不擋主流程
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
        workflowRunId: input.workflowRunId ?? null, // 來源工作流/代理（沒有＝手動生成）
        agentRunId: input.agentRunId ?? null,
        sourceUrl,
        params: falInput,
        pointsEst: est,
      })
      .returning();
  } catch (err) {
    // 冪等重送撞唯一鍵＝前次程序死亡前已插入同 id：直接回既有列，不再走守門扣點
    // （該列若卡在 queued 沒送出 fal，由既有陳屍清掃退點對帳，這裡不重複處理）
    if (input.id && isUniqueViolation(err)) {
      const [existing] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.id));
      if (existing) return existing;
    }
    throw err;
  }

  // 原子守門＋扣點（同一交易＋per-user 鎖，杜絕併發雙重扣款/繞過額度）
  // reserveQuota「拋例外」（連線池耗盡/逾時/序列化失敗）時也要刪掉剛建的 queued 列，
  // 否則會留下「從未扣點」的孤兒，30 分鐘後被陳屍清掃憑空退點、灌鬆總預算閘。
  // e2e 測試模式（E2E_MOCK=1，僅供自動化測試）預設不扣點：測試不燒真實額度、也不被額度閘擋
  //（正式模式照常守門；MOCK_BILLING=1 時 mock 也走扣點——e2e 驗證額度守門用，見 billingBypassed）
  if (!billingBypassed()) {
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
    const { requestId } = isNimModel(model) && !isMockMode()
      ? nimSubmit(falInput)
      : await falSubmit(endpointOf(model), model.kind, falInput);
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

  // 依 requestId 前綴分流:nim_=NVIDIA NIM 記憶體佇列;mock_/其餘=fal(mock 前綴由 falStatus 自行處理)。
  // 用前綴而非模型註冊表判斷——部署切換期間在途的舊 any-llm 生成仍能沿 fal 佇列收尾。
  const result = gen.requestId.startsWith("nim_") ? nimStatus(gen.requestId) : await falStatus(endpoint, kind, gen.requestId);
  if (result.status === "done" && (result.resultUrl || result.resultText)) {
    // Compare-and-set：只有把「仍在 queued/running」的列成功推進成 done 的那一次才算數，
    // 併發輪詢/重試不會重複入庫（舊版每次都 update+insert asset → 重複素材、重複計費）。
    // 關鍵（QA-014）：done 翻轉與「成品入素材庫＋分鏡回填」同一交易——舊版先 commit done 再
    // 另 insert asset，中間 DB 抖動會留下「done 但沒有素材」且 CAS 已過、永不補建。
    // 包進同交易後全有或全無：asset 寫入失敗整筆 rollback，列留在 queued/running，下次輪詢重試。
    const mediaUrl = result.resultUrl && (kind === "image" || kind === "video" || kind === "audio") ? result.resultUrl : null;
    const mediaKind = kind === "image" || kind === "video" || kind === "audio" ? kind : null;
    const advanced = await db.transaction(async (tx) => {
      const rows = await tx
        .update(schema.generations)
        .set({
          status: "done",
          resultUrl: result.resultUrl,
          resultText: result.resultText,
          pointsActual: gen.pointsEst,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.generations.id, gen.id), inArray(schema.generations.status, ["queued", "running"])))
        .returning();
      if (rows.length === 0) return { updated: null, asset: null as FreshGeneratedAsset | null };
      let newAsset: FreshGeneratedAsset | null = null;
      // 媒體成品自動入素材庫(AI 生成標記);文字輸出留在生成紀錄。
      if (mediaUrl && mediaKind) {
        const [asset] = await tx
          .insert(schema.assets)
          .values({
            projectId: gen.projectId,
            groupId: gen.groupId,
            kind: mediaKind,
            title: gen.prompt.slice(0, 40),
            url: mediaUrl,
            // 外部來源原始網址：落地成功也不抹除。fal CDN 網址雖會過期，但「還沒過期前」它是
            // 唯一能把成品抓回來的來源——舊版落地時直接把 url 覆寫掉，等於主動關掉補救來源。
            originUrl: mediaUrl,
            // 先記 pending：落地是 commit 後才啟動的背景 IO，這一刻還沒有 Volume 檔。
            // landNextTryAt 給「現在」，背景落地若失敗，補抓佇列下一輪就能立刻接手。
            landState: "pending",
            landNextTryAt: new Date(),
            isAiGenerated: true,
            meta: { generationId: gen.id, modelId: gen.modelId },
          })
          .returning();
        newAsset = { id: asset.id, projectId: asset.projectId, title: asset.title, createdAt: asset.createdAt };
        // 綁定分鏡的就地生成：把成品回填該分鏡格（拆分鏡草稿→出圖 一條線）。
        // 冪等：CAS 已保證此段每筆只跑一次；同交易失敗一起 rollback。
        if (gen.sceneId) {
          // 角色感知回填：narration→旁白音檔欄位；其餘（visual/null）→主畫面欄位。
          const patch = gen.sceneRole === "narration" ? { narrationAssetId: asset.id } : { assetId: asset.id };
          await tx.update(schema.scenes).set(patch).where(eq(schema.scenes.id, gen.sceneId));
        }
      }
      return { updated: rows[0], asset: newAsset };
    });
    if (!advanced.updated) {
      const [current] = await db.select().from(schema.generations).where(eq(schema.generations.id, gen.id));
      return current ?? gen; // 別人已推進，直接回現況（列必存在,回退舊快照僅是型別防禦）
    }
    if (
      gen.modelId.startsWith("fal-ai/")
      && !gen.requestId.startsWith("mock_")
      && !gen.requestId.startsWith("nim_")
    ) {
      // A real, parseable Fal result is durable certification evidence. Keep
      // generation completion successful even if catalog maintenance is
      // temporarily unavailable.
      const { certifySuccessfulFalModel } = await import("./modelCertification");
      await certifySuccessfulFalModel(gen.modelId).catch((err) =>
        console.warn(
          "[generation] Fal 模型認證寫回失敗：",
          err instanceof Error ? err.message : err,
        ),
      );
    }
    // 背景落地到 Volume（fal 網址會過期,永久保存靠這步;失敗沿用外部網址不擋流程）——
    // 網路 IO 不進交易，commit 後才啟動；失敗由 sweepUnlandedAssets 依退避時間補抓。
    if (advanced.asset && mediaUrl) persistGenerationResult(advanced.asset, gen.id, mediaUrl);
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
 * 落地補抓佇列：把 land_state='pending' 且到了 land_next_try_at 的素材抓回 Volume 永久保存，
 * 由 generationRunner 的 sweep tick 定期呼叫。重寫修掉稽核確認的三個結構缺陷：
 * (1) 舊版無 ORDER BY 且固定 LIMIT 20——只要累積 20 筆「永遠抓不回來」的死列（fal 網址已過期），
 *     佇列就永久卡死，新成品再也輪不到補抓。現在以 land_next_try_at 排序＋失敗退場（recordLandFailure）。
 * (2) 無認領機制——前一輪還沒跑完、下一輪又撈到同一批，重複下載且可能留孤兒檔。
 *     現在用 FOR UPDATE SKIP LOCKED 一句 SQL 認領＋land_claimed_at 十分鐘斷頭回收。
 * (3) e2e 假素材的 mock 佔位網址永久佔名額——現在直接標 skipped 正式出隊。
 * 修 R6-LIFE-01（刻意沿用）：回收桶（deletedAt 非空）素材也要落地——「生成後未落地→丟回收桶→
 * fal 短效網址過期→還原」的素材會變永久死連結，回收桶「可救回」的承諾就落空了。未落地時素材唯一
 * 來源就是外部網址，還原時必須有 Volume 檔可用，所以下面的認領條件刻意不濾 deleted_at。
 */
export async function sweepUnlandedAssets(limit = 20): Promise<number> {
  // 認領（單一 SQL）：SKIP LOCKED 讓多實例／重疊輪次各拿各的、不搶同一筆；
  // land_claimed_at 逾 10 分鐘視為前一個 worker 斷頭（當掉/重佈），開放重新認領。
  const claimed = (await db.execute(sql`
    with claimable as (
      select id from assets
       where land_state = 'pending'
         and (land_next_try_at is null or land_next_try_at <= now())
         and (land_claimed_at is null or land_claimed_at < now() - interval '10 minutes')
       order by land_next_try_at asc nulls first, created_at asc
       limit ${limit}
         for update skip locked
    )
    update assets a
       set land_claimed_at = now()
      from claimable
     where a.id = claimable.id
     returning a.id, a.project_id as "projectId", a.title, a.url,
               a.origin_url as "originUrl", a.meta, a.land_attempts as "landAttempts",
               a.uploaded_by as "uploadedBy", a.created_at as "createdAt"
  `)) as unknown as {
    rows: Array<{
      id: string;
      projectId: string;
      title: string;
      url: string;
      originUrl: string | null;
      meta: unknown;
      landAttempts: number;
      uploadedBy: string | null;
      createdAt: Date | string;
    }>;
  };
  let landed = 0;
  for (const asset of claimed.rows ?? []) {
    try {
      // 來源優先用 originUrl（落地成功也不抹除的原始外部網址）；舊資料沒補 originUrl 才退回 url
      const source = (asset.originUrl ?? "").trim() || asset.url;
      // e2e 假素材的 /api/mock-asset/* 佔位網址（或根本不是可抓取的外部網址）：標 skipped 出隊。
      // 舊版只 continue 不改狀態，這批假素材每輪都佔滿 LIMIT 名額——是佇列被塞爆的直接原因。
      if (source.includes("/api/mock-asset/") || !/^https?:\/\//i.test(source)) {
        await db
          .update(schema.assets)
          .set({ landState: "skipped", landNextTryAt: null, landClaimedAt: null })
          .where(eq(schema.assets.id, asset.id));
        continue;
      }
      const generationId = (asset.meta as { generationId?: string } | null)?.generationId ?? null;
      const persisted = await persistRemoteSafe(source);
      if (!persisted.ok) {
        await recordLandFailure(
          {
            id: asset.id,
            projectId: asset.projectId,
            title: asset.title,
            createdAt: new Date(asset.createdAt),
            attempts: asset.landAttempts,
            generationId,
            uploadedBy: asset.uploadedBy,
          },
          persisted,
        );
        continue;
      }
      if (await commitLandedAsset(asset.id, generationId, persisted)) {
        landed += 1;
        console.log(`[storage] 落地補抓成功：asset=${asset.id}（${persisted.sizeBytes}B ${persisted.mime}）`);
      }
    } catch (err) {
      // 單筆意外（DB 抖動等）不擋整輪；認領 10 分鐘後自動斷頭回收，下輪可重試
      console.warn(`[storage] 落地補抓單筆失敗（認領逾時後自動回收重試）：asset=${asset.id}`, err instanceof Error ? err.message : err);
    }
  }
  return landed;
}
