/**
 * 生成核心積木（自 routers/generation.ts 抽出，行為不變）：
 * - submitGenerationCore：世界觀/角色/場景注入 → 額度守門扣點 → fal 送出（失敗退點）。
 * - advanceGeneration：推進一筆生成的 fal 狀態並落 DB（done 入素材庫、failed 退點）。
 * 抽成服務層的原因：後端工作流執行器（workflowRunner）要在 tRPC 請求之外重用同一批
 * 防護（孤兒列刪除、CAS 推進、退點）——邏輯若複製兩份，防護遲早分岔。
 * 錯誤沿用 TRPCError：tRPC 端原樣拋出；伺服器內部呼叫端只讀 message（都是人話訊息）。
 */
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { getModel, endpointOf, isNimModel, estimatePoints, supportsNegativePrompt, CARD_ANCHOR_CATEGORIES, type ProjectFormat, type ModelEntry } from "../../shared/models";
import { worldviewSchema, bilingualChips, STYLE_EN, TONE_EN, type Worldview } from "../../shared/worldview";
import { falSubmit, falStatus, billingBypassed, isMockMode } from "./fal";
import { nimSubmit, nimStatus } from "./nvidia-nim";
import { reserveQuota, refund } from "./points";
import { persistRemote, signAssetUrl } from "./storage";
import { buildCharacterAnchor } from "../routers/characters";
import { groupLeaderIds, pushToUsers } from "./webPush";
import { buildSceneAnchor } from "../routers/scenePresets";

export type GenerationRow = typeof schema.generations.$inferSelect;

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
 * visual＝圖像/影片類別：調性與風格 chips 附英文錨點（英文語彙模型才吃得動畫風；LLM 維持純中文）。
 * 禁忌詞（合規句：不得宣稱療效、不影射真人…）的去向依類別分流——這是深度優化的關鍵：
 *   - 視覺（圖/影）：走 negative_prompt（見 effectivePromptParts 的 negative）。擴散模型無法靠正向詞
 *     「避免」某物，塞正向反而可能被畫出、甚至把禁忌字當畫面文字渲染——故正向不再放禁忌詞。
 *   - LLM：維持正向文字指引（語言模型讀得懂「避免:…」）。
 *   - text-to-audio（配樂/音效）：兩邊都不放（合規句對音頻無意義，原本塞正向是雜訊）。
 */
function buildPositive(userPrompt: string, worldview: Worldview, visual: boolean, isLlm: boolean): string {
  const parts: string[] = [];
  const tones = visual ? bilingualChips(worldview.tones, TONE_EN) : worldview.tones;
  const styles = visual ? bilingualChips(worldview.styles, STYLE_EN) : worldview.styles;
  if (tones.length) parts.push(`調性:${tones.join("、")}`);
  if (styles.length) parts.push(`視覺風格:${styles.join("、")}`);
  if (worldview.message) parts.push(`核心訊息:${worldview.message}`);
  // 禁忌詞只在 LLM 走正向（語言模型讀得懂）；視覺走 negative、audio 不放——見函式說明
  if (isLlm && worldview.taboos.length) parts.push(`避免:${worldview.taboos.join(";")}`);
  return parts.length ? `${userPrompt}\n\n[專案背景] ${parts.join("|")}` : userPrompt;
}

/**
 * 來源素材「明顯不相容」表（與前端來源下拉的過濾同一張表）：
 * 寬鬆原則——只擋確定會失敗的組合，doc/zip 等不確定的放行讓模型自行判斷。
 */
const SOURCE_INCOMPAT: Record<string, string[]> = {
  image: ["audio"],
  audio: ["image"], // 影片放行：Whisper/Scribe 類轉錄端點普遍接受影片容器（自動抽音軌）
  video: ["audio"],
};
const SOURCE_KIND_LABEL: Record<string, string> = { image: "圖片", video: "影片", audio: "音訊", doc: "文件", zip: "zip 壓縮包" };

/** 哪些類別注入世界觀(TTS 會唸出注入文字、轉錄/視覺/訓練/影片工具不適用 → 不注入) */
const INJECT_CATEGORIES = new Set(["text-to-image", "image-to-image", "text-to-video", "image-to-video", "llm", "text-to-audio"]);
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

/** 送出生成（守護齊全：孤兒列刪除、原子守門扣點、fal 失敗退點＋標 failed） */
export async function submitGenerationCore(input: SubmitCoreInput): Promise<GenerationRow> {
  const model = getModel(input.modelId);
  if (!model) throw new TRPCError({ code: "BAD_REQUEST", message: "未知模型(不在註冊表)" });
  if (model.needs && !input.sourceUrl && !input.sourceAssetId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `此模型需要來源:${model.sourceHint ?? model.needs}` });
  }

  // 逐次估點：按字計費的 TTS 依實際朗讀文字長度算真實成本；其餘＝扁平 model.points（行為不變）。
  // 一次算好貫穿下面所有站（審核門檻／pointsEst／扣點／送出失敗退點），確保三者永遠一致。
  // TTS 不注入世界觀（見 effectivePrompt），故 input.prompt 即送 fal 的計費文字。
  const est = estimatePoints(model, { promptChars: input.prompt.length });

  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  const accessRole = await input.assertAccess?.(project); // 多組隔離（可含專案級 ACL）；回傳角色供成本審核門檻用

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

  const worldview = worldviewSchema.parse(project.worldview ?? {});
  // 世界觀 → 角色定裝 → 場景設定，依序疊加注入（都只撈本專案，且只注入視覺類別）
  const charAnchor = input.characterIds?.length ? await buildCharacterAnchor(project.id, input.characterIds) : "";
  const sceneAnchor = input.scenePresetIds?.length ? await buildSceneAnchor(project.id, input.scenePresetIds) : "";
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
  // 只對「有帶 assertAccess 且角色是 member」的路徑生效：組長/管理員自送不受限；
  // 工作流 runner（無 assertAccess）沿用啟動時的守門，不在單步重複攔（v1 範圍，見 PR 說明）。
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
          body: `${model.label}（${est} 點 ≥ 門檻 ${threshold} 點）——請到生成紀錄核准或駁回`,
          url: `/p/${project.id}`,
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
    await refund(input.userId, project.groupId, est, "生成送出失敗退回", gen.id);
    console.error("[generation] submit 失敗:", err);
    await db
      .update(schema.generations)
      .set({ status: "failed", error: String(err), pointsRefunded: est, updatedAt: new Date() })
      .where(eq(schema.generations.id, gen.id));
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "生成送出失敗,點數已退回,請重試" });
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

  const model = getModel(gen.modelId);
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
      if (rows.length === 0) return { updated: null, assetId: null as string | null };
      let assetId: string | null = null;
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
            isAiGenerated: true,
            meta: { generationId: gen.id, modelId: gen.modelId },
          })
          .returning();
        assetId = asset.id;
        // 綁定分鏡的就地生成：把成品回填該分鏡格（拆分鏡草稿→出圖 一條線）。
        // 冪等：CAS 已保證此段每筆只跑一次；同交易失敗一起 rollback。
        if (gen.sceneId) {
          // 角色感知回填：narration→旁白音檔欄位；其餘（visual/null）→主畫面欄位。
          const patch = gen.sceneRole === "narration" ? { narrationAssetId: asset.id } : { assetId: asset.id };
          await tx.update(schema.scenes).set(patch).where(eq(schema.scenes.id, gen.sceneId));
        }
      }
      return { updated: rows[0], assetId };
    });
    if (!advanced.updated) {
      const [current] = await db.select().from(schema.generations).where(eq(schema.generations.id, gen.id));
      return current ?? gen; // 別人已推進，直接回現況（列必存在,回退舊快照僅是型別防禦）
    }
    // 背景落地到 Volume（fal 網址會過期,永久保存靠這步;失敗沿用外部網址不擋流程）——
    // 網路 IO 不進交易，commit 後才啟動；失敗由 sweepUnlandedAssets 定期補抓。
    if (advanced.assetId && mediaUrl) persistGenerationResult(advanced.assetId, gen.id, mediaUrl);
    // 跨裝置推播給發起人（CAS 保證同筆只推一次）；tag 以專案聚合——工作流連跑多鏡時
    // 後到的覆蓋先到的，手機不被逐筆洗版（頁內 GenerationList 已有逐筆彙總通知）
    void pushToUsers([gen.userId], {
      title: "生成完成",
      body: `${model?.label ?? gen.modelId}：${gen.prompt.slice(0, 60)}`,
      url: `/p/${gen.projectId}`,
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
    const updatedRows = await db.transaction(async (tx) => {
      const rows = await tx
        .update(schema.generations)
        .set({ status: "failed", error: result.error ?? "未知錯誤", pointsRefunded: gen.pointsEst, updatedAt: new Date() })
        .where(and(eq(schema.generations.id, gen.id), inArray(schema.generations.status, ["queued", "running"])))
        .returning();
      if (rows.length > 0 && gen.pointsEst > 0) {
        await tx.insert(schema.costLedger).values({
          userId: gen.userId,
          groupId: gen.groupId,
          delta: gen.pointsEst,
          reason: "生成失敗退回",
          generationId: gen.id,
        });
      }
      return rows;
    });
    if (updatedRows.length === 0) {
      const [current] = await db.select().from(schema.generations).where(eq(schema.generations.id, gen.id));
      return current ?? gen;
    }
    // 失敗推播（CAS 保證同筆只推一次）：tag 獨立不與「生成完成」互蓋——失敗訊號不能被後到的成功淹掉
    void pushToUsers([gen.userId], {
      title: "生成失敗",
      body: `${model?.label ?? gen.modelId}：${result.error ?? "未知錯誤"}${gen.pointsEst > 0 ? "（點數已退回）" : ""}`,
      url: `/p/${gen.projectId}`,
      tag: `gen-failed-${gen.id}`,
    }).catch((err) => console.warn("[generation] 失敗推播失敗：", err instanceof Error ? err.message : err));
    return updatedRows[0];
  }
  return gen;
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
    .where(and(
      eq(schema.assets.isAiGenerated, true),
      isNull(schema.assets.storagePath),
      isNull(schema.assets.deletedAt),
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
