import { z } from "zod";
import { and, desc, eq, getTableColumns, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup, requireLeader } from "../trpc";
import { db, schema } from "../db";
import { falSubmit, isMockMode, billingBypassed } from "../services/fal";
import { failStaleGenerationTx, refund, reserveQuota } from "../services/points";
import { advanceGeneration, prepareGenerationRequest } from "../services/generationCore";
import { executeGenerationCommand } from "../services/generationCommand";
import { signAssetUrl } from "../services/storage";
import { resolveByokFalKey, byokFalOpts } from "../services/byokBilling";
import { GENERATION_SOURCE_META_KEY, splitGenerationSourceMeta, storeGenerationSourceMeta } from "../../shared/generationSourceMeta";
import { buildRetryGenerationInput, signedAssetId } from "../services/generationRetryInput";
import { shouldReplayIdempotentGeneration } from "../../shared/generationIdempotency";
import { scheduleReconcileAfterIndependentGenerate } from "../services/agentRunReconcile";
import { geminiSubmit } from "../services/gemini";
import { nimSubmit } from "../services/nvidia-nim";
import { assertProjectEditable } from "../services/projectAcl";
import { getModel, endpointOf, generationProviderOf, isGeminiModel, isNimModel, supportsSeed } from "../../shared/models";
import { buildAblationVariants } from "../../shared/ablation";
import type { PromptSectionKey } from "../../shared/promptSections";
import { MAX_GENERATE_CHARACTERS, MAX_GENERATE_PROPS, MAX_GENERATE_SCENE_PRESETS } from "../../shared/cardLimits";
import {
  DEFAULT_CLOUD_MOCK_MODEL_ID,
  submitCloudMockGeneration,
} from "../services/cloudInference/freeGeneration";

const publicHttpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", {
  message: "來源網址需以 https:// 開頭",
});

import { MAX_PROMPT_CHARS } from "./prompts";
import { creativePromptOverrideSchema } from "../../shared/aiTrace";
import { continuitySnapshotSchema } from "../../shared/continuity";
import { applyContinuityReferences, resolveContinuityReferenceUrls } from "../services/continuity";
import {
  createAiTraceSession,
  findAiTraceSessionBySource,
  recordAiTraceEventSafely,
  sanitizeAiTracePayload,
  updateAiTraceSession,
} from "../services/aiTrace";

// 注入判斷的單一來源已抽到 services/generationCore（工作流執行器共用）；
// 這裡 re-export 讓既有引用點（services/mcp.ts）不必改路徑
export { effectivePrompt, withCharacterAnchor, withSceneAnchor } from "../services/generationCore";

/** 陳屍清掃門檻：queued/running 停滯超過 30 分鐘視為孤兒（正常影片生成也遠短於此） */
const STALE_GENERATION_MS = 30 * 60 * 1000;
/** 硬性生命週期（與 generationRunner B12 同口徑）：createdAt 逾 6h 即使心跳仍在也回收 */
const HARD_LIFETIME_MS = 6 * 60 * 60 * 1000;

/**
 * 請求路徑清掃節流（per-project，行程記憶體）：generationRunner 已在背景每 ~60 秒全域掃一遍
 * （見 services/generationRunner sweepStale），這裡的 request-path 掃只是「無背景排程時」的備援，
 * 不必每次 listByProject／分頁首頁都掃——每位檢視者每 8 秒打一次 × 每次一輪過濾掃描＋逐列帳本 SUM，
 * 純屬浪費。節流到每專案至多 60 秒一次；門檻是 30 分鐘，60 秒節流對回收即時性毫無影響。
 */
const SWEEP_THROTTLE_MS = 60 * 1000;
const lastSweptAt = new Map<string, number>();

/**
 * 陳屍清掃：把 updatedAt 停滯逾門檻仍 queued/running 的生成標 failed 並退點。
 * 為什麼掛在 listByProject 開頭：背景 runner 會全域掃，request-path 是「無背景排程時」的備援——
 * 「扣點後、requestId 寫入前」程序被重佈/OOM 打斷的列永卡 queued 且 requestId=null，點數永久蒸發。
 * 兩種孤兒都在此（或背景 runner）收斂到終局並退點。
 */
async function sweepStaleGenerations(projectId: string): Promise<void> {
  // 節流：距上次掃這個專案不足 60 秒就跳過（背景 runner 仍會全域掃，安全）
  const now = Date.now();
  if (now - (lastSweptAt.get(projectId) ?? 0) < SWEEP_THROTTLE_MS) return;
  lastSweptAt.set(projectId, now);
  const cutoff = new Date(now - STALE_GENERATION_MS);
  const hardCutoff = new Date(now - HARD_LIFETIME_MS);
  const staleRows = await db
    .select()
    .from(schema.generations)
    .where(
      and(
        eq(schema.generations.projectId, projectId),
        inArray(schema.generations.status, ["queued", "running"]),
        or(
          lt(schema.generations.updatedAt, cutoff),
          lt(schema.generations.createdAt, hardCutoff),
        ),
      ),
    );
  for (const gen of staleRows) {
    const hardExpired = gen.createdAt.getTime() < hardCutoff.getTime();
    // 修 R6-MONEY-02：先讓 advanceGeneration 收斂——重佈後 fal 其實可能已完成，直接退點會把成品丟棄。
    try {
      await advanceGeneration(gen.id);
    } catch {
      /* fal 連不上等：交給下方陳屍收斂 */
    }
    // 原子＋冪等收斂：CAS→failed 與「依帳本淨額退點」同一交易（負淨額＝有扣過才退；0＝從未扣點不退，
    // 免對沒扣過的列憑空加點灌鬆總預算閘）。已被 advanceGeneration 推進成終局者，CAS 自動 no-op。細節見 points.ts。
    await failStaleGenerationTx(
      gen.id,
      hardExpired
        ? "生成超過最長時限（6 小時），系統自動回收"
        : "生成停滯逾 30 分鐘，系統自動回收",
      hardExpired ? "生成逾時自動回收退回" : "生成停滯自動回收退回",
    );
  }
}

export const generationRouter = router({
  preview: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      modelId: z.string(),
      prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
      sourceUrl: publicHttpsUrl.optional(),
      sourceAssetId: z.string().uuid().optional(),
      secondarySourceUrl: publicHttpsUrl.optional(),
      secondarySourceAssetId: z.string().uuid().optional(),
      characterIds: z.array(z.string().uuid()).max(MAX_GENERATE_CHARACTERS).optional(),
      scenePresetIds: z.array(z.string().uuid()).max(MAX_GENERATE_SCENE_PRESETS).optional(),
      propIds: z.array(z.string().uuid()).max(MAX_GENERATE_PROPS).optional(),
      continuityMode: z.boolean().optional(),
      promptOverride: creativePromptOverrideSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const prepared = await prepareGenerationRequest({
        ...input,
        userId: ctx.auth.user.id,
        assertAccess: async (project) => {
          const role = requireGroup(ctx.auth, project.groupId);
          await assertProjectEditable(ctx.auth, project);
          return role;
        },
      });
      const safe = sanitizeAiTracePayload({
        positivePrompt: prepared.positivePrompt,
        negativePrompt: prepared.negativePrompt,
        providerInput: prepared.providerInput,
        sourceAssetId: prepared.effectiveSourceAssetId,
        usedCardReference: prepared.usedCardReference,
        continuity: prepared.continuitySnapshot ? {
          fingerprint: prepared.continuitySnapshot.fingerprint,
          locked: prepared.continuitySnapshot.locked,
          characters: prepared.continuitySnapshot.characters.length,
          scenes: prepared.continuitySnapshot.scenes.length,
          props: prepared.continuitySnapshot.props.length,
          references: prepared.continuityReferences,
        } : null,
      });
      return {
        mode: "generate" as const,
        title: "這次生成，AI 會怎麼理解",
        provider: generationProviderOf(prepared.model),
        model: prepared.model.label,
        modelId: prepared.model.id,
        endpoint: endpointOf(prepared.model),
        context: [
          { type: "worldview", label: "專案世界觀", included: prepared.positivePrompt !== prepared.userPrompt },
          { type: "character", label: `角色定裝 ${input.characterIds?.length ?? 0}`, included: !!prepared.anchors.character, chars: prepared.anchors.character.length },
          { type: "scene", label: `場景設定 ${input.scenePresetIds?.length ?? 0}`, included: !!prepared.anchors.scene, chars: prepared.anchors.scene.length },
          { type: "prop", label: `素材設定 ${input.propIds?.length ?? 0}`, included: !!prepared.anchors.prop, chars: prepared.anchors.prop.length },
          { type: "continuity", label: prepared.continuitySnapshot?.locked ? "一致性快照已鎖定" : "一致性快照未鎖定", included: !!prepared.continuitySnapshot?.locked, note: prepared.continuitySnapshot ? `版本 ${prepared.continuitySnapshot.fingerprint.slice(0, 8)}・參考圖 ${prepared.continuityReferences.attached}/${prepared.continuityReferences.available}` : undefined },
          {
            type: "source",
            label: prepared.sourceUrl ? "來源素材已送入" : "沒有來源素材",
            included: !!prepared.sourceUrl,
            note: prepared.usedCardReference === "continuity"
              ? "自動採用上一鏡已核准的結尾影格"
              : prepared.usedCardReference
                ? `自動採用 ${prepared.usedCardReference} 卡片參考圖`
                : undefined,
          },
        ],
        request: safe.payload,
        warnings: prepared.warnings,
        estimatedPoints: prepared.estimatedPoints,
        promptBudget: prepared.promptBudget,
        canOverrideCreativePrompt: true,
      };
    }),

  submit: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        modelId: z.string(),
        // 與 prompts.save 同口徑（MAX_PROMPT_CHARS）——生成成功的咒語必能自動入庫
        prompt: z.string().trim().min(1, "請填提示詞").max(MAX_PROMPT_CHARS, `提示詞過長（上限 ${MAX_PROMPT_CHARS} 字）`),
        /** 來源輸入(圖生圖底圖/音訊/影片/訓練 zip 的網址;外部 URL) */
        sourceUrl: publicHttpsUrl.optional(),
        /** 素材庫來源(優先)：伺服器換成簽名短效網址,fal 才抓得到、外人不可偽造 */
        sourceAssetId: z.string().uuid().optional(),
        secondarySourceUrl: publicHttpsUrl.optional(),
        secondarySourceAssetId: z.string().uuid().optional(),
        /** 選定的角色定裝卡：外觀錨點自動注入視覺生成,跨鏡一致 */
        characterIds: z.array(z.string().uuid()).max(MAX_GENERATE_CHARACTERS).optional(),
        /** 選定的場景設定卡：色板/光線錨點注入,同場景光影一致 */
        scenePresetIds: z.array(z.string().uuid()).max(MAX_GENERATE_SCENE_PRESETS).optional(),
        /** 選定的素材設定卡：道具外觀/材質錨點注入,同一件道具跨鏡不變樣 */
        propIds: z.array(z.string().uuid()).max(MAX_GENERATE_PROPS).optional(),
        continuityMode: z.boolean().optional(),
        /** 冪等鍵（client 產生的 UUID）：timeout 後重送同鍵回原生成列，不重複扣點 */
        clientRequestId: z.string().uuid().optional(),
        promptOverride: creativePromptOverrideSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 先做同一組組裝／硬守門，成功才建立永久 trace，避免壞輸入灌滿追蹤表。
      const prepared = await prepareGenerationRequest({
        ...input,
        userId: ctx.auth.user.id,
        assertAccess: async (project) => {
          const role = requireGroup(ctx.auth, project.groupId);
          await assertProjectEditable(ctx.auth, project);
          return role;
        },
      });
      const trace = await createAiTraceSession({
        groupId: prepared.project.groupId,
        projectId: prepared.project.id,
        userId: ctx.auth.user.id,
        mode: "generate",
        title: `生成：${input.prompt.trim().slice(0, 80)}`,
        provider: generationProviderOf(prepared.model),
        model: prepared.model.id,
      });
      try {
      // TD-02：人類直呼 tRPC 走 Command（政策＋狀態機＋ACL＋submitGenerationCore）
      const generation = await executeGenerationCommand({
        auth: ctx.auth,
        source: "web",
        id: input.clientRequestId,
        projectId: input.projectId,
        modelId: input.modelId,
        prompt: input.prompt,
        sourceUrl: input.sourceUrl,
        sourceAssetId: input.sourceAssetId,
        secondarySourceUrl: input.secondarySourceUrl,
        secondarySourceAssetId: input.secondarySourceAssetId,
        characterIds: input.characterIds,
        scenePresetIds: input.scenePresetIds,
        propIds: input.propIds,
        continuityMode: input.continuityMode,
        promptOverride: input.promptOverride,
        traceSessionId: trace.id,
      });
      // Live leftover: retry / MCP submit / generateInto already drop leftover
      // 0/N「待你過目」on land. Web generation.submit (the main 生成 button)
      // still returned success and left the HUD parked until the 30s poll.
      if (shouldReplayIdempotentGeneration(generation.status)) {
        scheduleReconcileAfterIndependentGenerate({
          projectId: generation.projectId,
          sceneId: generation.sceneId,
          generationId: generation.id,
        });
      }
      return { ...generation, traceSessionId: trace.id };
      } catch (error) {
        await updateAiTraceSession(trace.id, { status: "failed", summary: error instanceof Error ? error.message : "送出失敗" }).catch(() => undefined);
        throw error;
      }
    }),

  /**
   * 消融偵測（影響力實測）：同一組設定送出「完整版」＋「各拿掉一段」的變體。
   *
   * 為什麼要用實測：hosted API 不回傳 attention，拿不到「模型多看重這一段」的內部權重。
   * 拿不到內部權重時，量測影響力的標準做法就是消融——固定其他條件、只拿掉一段重跑，
   * 差得多＝這段真的在起作用；幾乎沒差＝它其實沒發揮。
   *
   * 誠實前提：兩次跑的隨機噪聲要一樣，差異才歸因得到被拿掉的那一段。
   * seed 只在 supportsSeed 名單內才送（不猜未知欄位）；固定不了的模型照跑，
   * 但回傳 seedPinned=false，UI 必須據此說明「差異裡混著噪聲，只能當參考」。
   *
   * 每一輪都是一次真的生成，會照常扣點——所以回傳值帶 runs 讓 UI 先講清楚總花費。
   */
  ablation: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      modelId: z.string(),
      prompt: z.string().trim().min(1, "請填提示詞").max(MAX_PROMPT_CHARS),
      sourceUrl: publicHttpsUrl.optional(),
      sourceAssetId: z.string().uuid().optional(),
      secondarySourceUrl: publicHttpsUrl.optional(),
      secondarySourceAssetId: z.string().uuid().optional(),
      characterIds: z.array(z.string().uuid()).max(MAX_GENERATE_CHARACTERS).optional(),
      scenePresetIds: z.array(z.string().uuid()).max(MAX_GENERATE_SCENE_PRESETS).optional(),
      propIds: z.array(z.string().uuid()).max(MAX_GENERATE_PROPS).optional(),
      continuityMode: z.boolean().optional(),
      /** 要拿掉哪幾段（各一輪） */
      sections: z.array(z.enum(["background", "character", "scene", "prop"])).min(1).max(4),
    }))
    .mutation(async ({ ctx, input }) => {
      const prepared = await prepareGenerationRequest({
        ...input,
        userId: ctx.auth.user.id,
        assertAccess: async (project) => {
          const role = requireGroup(ctx.auth, project.groupId);
          await assertProjectEditable(ctx.auth, project);
          return role;
        },
      });
      const wanted = new Set<PromptSectionKey>(input.sections);
      const variants = buildAblationVariants(prepared.positivePrompt).filter((variant) => wanted.has(variant.section));
      if (!variants.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "這次組裝裡沒有你選的段落，沒有東西可以拿掉" });
      }

      const runId = crypto.randomUUID();
      // seed 固定不了的模型照樣能跑，只是結論要降級成「參考」——由 UI 依 seedPinned 說明
      const seed = supportsSeed(prepared.model) ? Math.floor(Math.random() * 2_147_483_647) : undefined;
      // 基準也走 promptOverride：讓所有輪次經過完全相同的路徑，唯一差別就是被拿掉的那一段
      const plan = [
        { section: "baseline" as const, title: "完整版（基準）", prompt: prepared.positivePrompt },
        ...variants.map((variant) => ({ section: variant.section, title: `拿掉「${variant.title}」`, prompt: variant.prompt })),
      ];

      const runs: Array<{ id: string; section: string; title: string; status: string }> = [];
      const failed: Array<{ section: string; title: string; message: string }> = [];
      for (const step of plan) {
        try {
          const generation = await executeGenerationCommand({
            auth: ctx.auth,
            source: "web",
            projectId: input.projectId,
            modelId: input.modelId,
            prompt: input.prompt,
            sourceUrl: input.sourceUrl,
            sourceAssetId: input.sourceAssetId,
            secondarySourceUrl: input.secondarySourceUrl,
            secondarySourceAssetId: input.secondarySourceAssetId,
            characterIds: input.characterIds,
            scenePresetIds: input.scenePresetIds,
            propIds: input.propIds,
            continuityMode: input.continuityMode,
            promptOverride: { positive: step.prompt },
            seed,
            ablation: { runId, section: step.section, seed },
          });
          if (shouldReplayIdempotentGeneration(generation.status)) {
            scheduleReconcileAfterIndependentGenerate({
              projectId: generation.projectId,
              sceneId: generation.sceneId,
              generationId: generation.id,
            });
          }
          runs.push({ id: generation.id, section: step.section, title: step.title, status: generation.status });
        } catch (error) {
          // 點數不足／待核門檻等中途失敗：已送出的輪次仍要回報，否則使用者付了點卻看不到
          failed.push({ section: step.section, title: step.title, message: error instanceof Error ? error.message : "送出失敗" });
        }
      }
      if (!runs.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: failed[0]?.message ?? "消融實測沒有送出任何一輪" });
      }

      return {
        runId,
        seedPinned: seed != null,
        model: prepared.model.label,
        pointsPerRun: prepared.estimatedPoints,
        runs,
        failed,
      };
    }),

  /**
   * 消融實測的結果：把同一個 runId 的基準與各變體撈回來，供 UI 並排比對**實際成品**。
   *
   * 影響力量測的結論在圖上，不在文字裡——沒有並排的圖，前面那幾輪點數就白花了。
   * 分組標記存在 params 的內部欄位（送 provider 前會被移除），這裡用 jsonb 路徑撈。
   */
  ablationResult: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId); // 多組隔離：只看得到自己組的實測
      const rows = await db
        .select()
        .from(schema.generations)
        .where(and(
          eq(schema.generations.projectId, input.projectId),
          sql`${schema.generations.params}->'${sql.raw(GENERATION_SOURCE_META_KEY)}'->'ablation'->>'runId' = ${input.runId}`,
        ))
        .orderBy(schema.generations.createdAt);
      return rows.map((row) => {
        const { meta } = splitGenerationSourceMeta(row.params);
        return {
          id: row.id,
          section: meta.ablation?.section ?? "baseline",
          status: row.status,
          kind: row.kind,
          resultUrl: row.resultUrl,
          error: row.error,
        };
      });
    }),

  /**
   * 同題並跑（模型競技場）：同一個提示詞、同一組設定，一次送進 2–4 顆模型各跑一輪。
   *
   * 為什麼要有這支：目錄上的「特性／擅長」是文字宣稱，看不出這顆模型畫你的題材長什麼樣。
   * 唯一能回答「哪個適合我」的方法，就是拿自己的題目讓它們同場跑一次。
   *
   * 與消融實測互補：消融固定模型改提示詞（量測某段設定的影響力），
   * 這裡固定提示詞改模型（量測模型之間的差別）。兩者共用同一條送出路徑，
   * 所以點數、審核門檻、ACL、警告都與一般生成完全一致——不是繞過去的捷徑。
   *
   * 逐顆送出、逐顆記錄失敗：一顆模型缺來源素材或點數不足，不該讓其他幾顆也白跑。
   */
  bench: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      /** 要並跑的模型（2–4 顆；上限與指南頁的並排比較同口徑） */
      modelIds: z.array(z.string().min(1).max(300)).min(2).max(4),
      prompt: z.string().trim().min(1, "請填提示詞").max(MAX_PROMPT_CHARS),
      sourceUrl: publicHttpsUrl.optional(),
      sourceAssetId: z.string().uuid().optional(),
      secondarySourceUrl: publicHttpsUrl.optional(),
      secondarySourceAssetId: z.string().uuid().optional(),
      characterIds: z.array(z.string().uuid()).max(MAX_GENERATE_CHARACTERS).optional(),
      scenePresetIds: z.array(z.string().uuid()).max(MAX_GENERATE_SCENE_PRESETS).optional(),
      propIds: z.array(z.string().uuid()).max(MAX_GENERATE_PROPS).optional(),
      continuityMode: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const modelIds = [...new Set(input.modelIds)];
      if (modelIds.length < 2) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "同題並跑至少要兩顆不同的模型" });
      }
      const runId = crypto.randomUUID();
      const runs: Array<{ id: string; modelId: string; modelLabel: string; status: string; pointsEst: number }> = [];
      const failed: Array<{ modelId: string; modelLabel: string; message: string }> = [];
      for (const modelId of modelIds) {
        const label = getModel(modelId)?.label ?? modelId;
        try {
          const generation = await executeGenerationCommand({
            auth: ctx.auth,
            source: "web",
            projectId: input.projectId,
            modelId,
            prompt: input.prompt,
            sourceUrl: input.sourceUrl,
            sourceAssetId: input.sourceAssetId,
            secondarySourceUrl: input.secondarySourceUrl,
            secondarySourceAssetId: input.secondarySourceAssetId,
            characterIds: input.characterIds,
            scenePresetIds: input.scenePresetIds,
            propIds: input.propIds,
            continuityMode: input.continuityMode,
            bench: { runId },
          });
          if (shouldReplayIdempotentGeneration(generation.status)) {
            scheduleReconcileAfterIndependentGenerate({
              projectId: generation.projectId,
              sceneId: generation.sceneId,
              generationId: generation.id,
            });
          }
          runs.push({
            id: generation.id,
            modelId,
            modelLabel: label,
            status: generation.status,
            pointsEst: generation.pointsEst,
          });
        } catch (error) {
          // 一顆失敗不擋其他顆：使用者要看的是「跑得起來的那幾顆長什麼樣」
          failed.push({ modelId, modelLabel: label, message: error instanceof Error ? error.message : "送出失敗" });
        }
      }
      if (!runs.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: failed[0]?.message ?? "同題並跑沒有送出任何一顆模型" });
      }
      return {
        runId,
        prompt: input.prompt,
        runs,
        failed,
        pointsTotal: runs.reduce((sum, r) => sum + r.pointsEst, 0),
      };
    }),

  /**
   * 同題並跑的結果：把同一個 runId 的每顆模型撈回來並排。
   * 帶上耗時（送出→最後更新）——「哪個比較快」是選模型時最常被問、卻最少被量的事。
   */
  benchResult: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId); // 多組隔離：只看得到自己組的實測
      const rows = await db
        .select()
        .from(schema.generations)
        .where(and(
          eq(schema.generations.projectId, input.projectId),
          sql`${schema.generations.params}->'${sql.raw(GENERATION_SOURCE_META_KEY)}'->'bench'->>'runId' = ${input.runId}`,
        ))
        .orderBy(schema.generations.createdAt);
      return rows.map((row) => {
        const settled = row.status === "done" || row.status === "failed";
        return {
          id: row.id,
          modelId: row.modelId,
          modelLabel: getModel(row.modelId)?.label ?? row.modelId,
          status: row.status,
          kind: row.kind,
          resultUrl: row.resultUrl,
          resultText: row.resultText,
          error: row.error,
          points: row.pointsActual ?? row.pointsEst,
          /** 送出到落地的秒數（還在跑的先不給數字，免得看起來像已完成） */
          elapsedSeconds: settled
            ? Math.max(0, Math.round((row.updatedAt.getTime() - row.createdAt.getTime()) / 1000))
            : null,
        };
      });
    }),

  /**
   * 以相同設定重試（伺服器端完整版）：舊做法由前端拿 prompt/model/來源重組 submit，
   * 會默默丟失角色定裝/場景設定錨點與分鏡綁定——重試出的圖跨鏡就走樣、成品也不回填分鏡。
   * 這裡從失敗列原樣還原全部連結：characterIds/scenePresetIds/propIds/sceneId/sceneRole，
   * 素材庫來源從網址取回 assetId 重新簽名（過期網址原樣重送必敗），世界觀以「重試當下」重新注入。
   */
  retry: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.id));
    if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, gen.groupId); // 多組隔離
    if (gen.status !== "failed") throw new TRPCError({ code: "BAD_REQUEST", message: "只有失敗的生成可以重試" });
    // 素材庫來源存的是短效簽名網址——取回 assetId 走 sourceAssetId 讓核心重新簽名（順帶重過相容性守門）。
    // 嚴格 UUID 形（8-4-4-4-12）：外部網址可能剛好含 /api/assets/<36字>/file，寬鬆比對抓到
    // 非 UUID 會讓 pg 的 uuid cast 直接 500——非 UUID 一律走 sourceUrl 原樣透傳
    // 重試輸入的組法是單一真相（services/generationRetryInput）——MCP 的 retry_generation
    // 走同一支，兩邊不會再漂移（#725 P1-4：MCP 版曾少帶 sceneRole/preserveScenePointer/卡片）。
    const retried = await executeGenerationCommand({
      auth: ctx.auth,
      source: "web",
      ...buildRetryGenerationInput(gen),
      reasonPrefix: "重試生成",
    });
    // First generateInto throw never reaches reconcile. 重試 is a new job;
    // leftover 0/N「待你過目」must drop here, not wait for the 30s HUD poll.
    if (shouldReplayIdempotentGeneration(retried.status)) {
      scheduleReconcileAfterIndependentGenerate({
        projectId: retried.projectId,
        sceneId: retried.sceneId,
        generationId: retried.id,
      });
    }
    return retried;
  }),

  /**
   * 輪詢狀態：純讀 DB 現況，不在請求路徑同步打 fal。
   * 推進改由 generationRunner（每 ~6 秒）負責；請求路徑再呼叫 advanceGeneration
   * 會把頁面輪詢拖慢（每筆 status 都可能等 fal）。陳屍清掃仍走 list 節流備援 + runner 全域掃。
   */
  status: authedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.id));
    if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, gen.groupId); // 多組隔離
    return gen;
  }),

  /** Resolve the durable asset created by generationCore once a generation is done. */
  assetFor: authedProcedure.input(z.object({ generationId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.generationId));
    if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, gen.groupId);
    const [asset] = await db
      .select({ id: schema.assets.id, url: schema.assets.url, kind: schema.assets.kind, title: schema.assets.title })
      .from(schema.assets)
      .where(and(
        eq(schema.assets.groupId, gen.groupId),
        isNull(schema.assets.deletedAt),
        sql`${schema.assets.meta}->>'generationId' = ${gen.id}`,
      ))
      .orderBy(desc(schema.assets.createdAt))
      .limit(1);
    return asset ?? null;
  }),

  listByProject: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    // 陳屍清掃：清掃失敗只記警告不擋列表（回收屬順手行為，下次打開列表會再試）
    await sweepStaleGenerations(input.projectId).catch((err) =>
      console.warn("[generation] 陳屍清掃失敗：", err instanceof Error ? err.message : err),
    );
    return db
      .select()
      .from(schema.generations)
      .where(eq(schema.generations.projectId, input.projectId))
      .orderBy(desc(schema.generations.createdAt))
      .limit(30);
  }),

  /**
   * 分頁版列表：cursor keyset 分頁（createdAt desc, id desc）+ 可選 status/kind 篩選 + prompt 模糊搜尋。
   * 為什麼保留舊 listByProject：既有呼叫點（ProjectPage 引導步驟、WorkflowCard 失效、e2e）仍讀它，不動。
   * 陳屍清掃只在「首頁（無 cursor）」跑一次——與 listByProject 同一套退點邏輯，翻頁不重複掃（省事、且掃描屬順手行為）。
   */
  listByProjectPaged: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        /** keyset 游標：上一頁最後一列的 (createdAt ISO, id)；首頁不帶（觸發陳屍清掃） */
        // 修 IN-03：cursor.createdAt 限制為 timestamptz 文字形（pg ::text 產出「2026-07-24 14:15:46.217+00」，
        // 空格或 T 皆可、可帶微秒與時區）——否則壞游標（如 "abc"）會讓下方 ::timestamptz 轉型丟例外回 500。
        cursor: z
          .object({
            createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$/, "游標格式不正確"),
            id: z.string().uuid(),
          })
          .nullish(),
        /** awaiting_approval/rejected＝成本審核門檻（需求 2.1）的兩個新狀態 */
        status: z.enum(["queued", "running", "done", "failed", "awaiting_approval", "rejected"]).optional(),
        kind: z.enum(["image", "video", "audio", "text"]).optional(),
        search: z.string().optional(),
        /** 只看收藏（#20）：true 時只回 favorite=true 的列 */
        favoriteOnly: z.boolean().optional(),
        /** 按分鏡聚合回看（需求 #4）：只看綁定某一鏡的生成歷史 */
        sceneId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      // 陳屍清掃：只在首頁（無 cursor）跑，與 listByProject 完全相同的退點路徑（見 sweepStaleGenerations）。
      // 清掃失敗只記警告不擋列表（下次打開/翻回首頁會再試）。翻頁不掃避免每頁重複掃描。
      if (!input.cursor) {
        await sweepStaleGenerations(input.projectId).catch((err) =>
          console.warn("[generation] 陳屍清掃失敗：", err instanceof Error ? err.message : err),
        );
      }
      const pageSize = input.limit ?? 30;
      const conds: SQL[] = [eq(schema.generations.projectId, input.projectId)];
      if (input.status) conds.push(eq(schema.generations.status, input.status));
      if (input.kind) conds.push(eq(schema.generations.kind, input.kind));
      if (input.favoriteOnly) conds.push(eq(schema.generations.favorite, true));
      if (input.sceneId) conds.push(eq(schema.generations.sceneId, input.sceneId));
      const q = input.search?.trim();
      if (q) {
        // 轉義 LIKE 萬用字元，讓使用者輸入的 % _ \ 當字面比對（預設 ESCAPE '\'）
        const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`);
        conds.push(ilike(schema.generations.prompt, `%${escaped}%`));
      }
      if (input.cursor) {
        // 游標 createdAt 是帶「完整微秒精度」的 timestamptz 文字（見下方 select 的 ::text）。
        // 絕不可 new Date()——JS Date 只有毫秒精度，同毫秒不同微秒的列會被漏掉（工作流一次送多鏡即踩到，
        // 那是付費列→靜默消失在分頁/篩選歷史）。用 ::timestamptz 還原微秒再比對。
        const cAt = input.cursor.createdAt;
        const cId = input.cursor.id;
        // (createdAt, id) 嚴格小於游標 —— 對應 desc, desc 排序的「下一頁」
        conds.push(
          or(
            sql`${schema.generations.createdAt} < ${cAt}::timestamptz`,
            and(sql`${schema.generations.createdAt} = ${cAt}::timestamptz`, lt(schema.generations.id, cId)),
          )!,
        );
      }
      // 多取一列判斷是否還有下一頁。額外選 createdAt::text 當游標值＝保留微秒精度（JS Date 會截成毫秒）。
      const rows = await db
        .select({ ...getTableColumns(schema.generations), cursorAt: sql<string>`${schema.generations.createdAt}::text` })
        .from(schema.generations)
        .where(and(...conds))
        .orderBy(desc(schema.generations.createdAt), desc(schema.generations.id))
        .limit(pageSize + 1);
      let nextCursor: { createdAt: string; id: string } | null = null;
      if (rows.length > pageSize) {
        const last = rows[pageSize - 1];
        nextCursor = { createdAt: last.cursorAt, id: last.id };
        rows.splice(pageSize); // 丟掉多取的探測列
      }
      // 剝掉游標輔助欄位，items 維持原本 generation 形狀（前端不需要 cursorAt）
      const items = rows.map(({ cursorAt: _cursorAt, ...g }) => g);
      return { items, nextCursor };
    }),

  /**
   * 命名生成物（#20）：純 metadata，不動點數/狀態。
   * 授權與 status/其他憑 generationId 變更的 mutation 同一套：先撈該列拿 groupId，
   * 缺列 NOT_FOUND，再 requireGroup——沒驗組就憑 id 改別組資料＝跨組漏洞。
   * 不碰 updatedAt：那是陳屍清掃判「停滯」的時鐘，metadata 編輯不該重置它。
   */
  rename: authedProcedure
    .input(z.object({ generationId: z.string().uuid(), name: z.string().max(80) }))
    .mutation(async ({ ctx, input }) => {
      const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.generationId));
      if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, gen.groupId); // 多組隔離
      // 2.3：name 是全組共見的共用 metadata，檢視者不能改（與素材改名同口徑）
      await assertProjectEditable(ctx.auth, { id: gen.projectId, groupId: gen.groupId });
      const [updated] = await db
        .update(schema.generations)
        .set({ name: input.name })
        .where(eq(schema.generations.id, input.generationId))
        .returning();
      return updated;
    }),

  /** 收藏標記切換（#20）：授權同 rename（撈列拿 groupId→requireGroup），純 metadata。 */
  toggleFavorite: authedProcedure
    .input(z.object({ generationId: z.string().uuid(), favorite: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.generationId));
      if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, gen.groupId); // 多組隔離
      // 2.3：favorite 也是共用欄位（餵給列表的 favoriteOnly 篩選），檢視者不能改
      await assertProjectEditable(ctx.auth, { id: gen.projectId, groupId: gen.groupId });
      const [updated] = await db
        .update(schema.generations)
        .set({ favorite: input.favorite })
        .where(eq(schema.generations.id, input.generationId))
        .returning();
      return updated;
    }),

  /**
   * 提交者取消自己的超額待核（未扣點）：CAS awaiting_approval → rejected。
   * 組長駁回仍走 decideCost；24h 自動取消見 generationRunner.sweepExpiredAwaitingApproval。
   */
  cancelAwaiting: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.id));
      if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, gen.groupId);
      if (gen.userId !== ctx.auth.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只能取消自己送出的待核生成" });
      }
      if (gen.status !== "awaiting_approval") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "這筆生成已不在待核狀態" });
      }
      const [updated] = await db
        .update(schema.generations)
        .set({ status: "rejected", error: "提交者取消待核", updatedAt: new Date() })
        .where(and(eq(schema.generations.id, gen.id), eq(schema.generations.status, "awaiting_approval")))
        .returning();
      if (!updated) throw new TRPCError({ code: "BAD_REQUEST", message: "這筆生成已被其他人處理" });
      return updated;
    }),

  /**
   * 跨專案待辦彙總（UX 高嚴重度：首頁/頂欄完全不顯示待核，多專案組長必然漏核）：
   * 各專案的「生成待核准」（generations awaiting_approval）計數。
   * Launchpad 專案卡角標＋頂欄計數共用這一條查詢。
   */
  pendingSummary: authedProcedure.input(z.object({ groupId: z.string().uuid() })).query(async ({ ctx, input }) => {
    requireGroup(ctx.auth, input.groupId);
    // 排除封存專案：Launchpad 預設不列封存案，計入會讓頂欄出現「找不到入口的幽靈待辦」
    const rows = await db
      // oldest：最久沒人核的那一件是哪天送的——作業台「待我裁決」用它排「卡最久的排前面」
      .select({
        projectId: schema.generations.projectId,
        n: sql<number>`count(*)`,
        oldest: sql<string | null>`min(${schema.generations.createdAt})`,
      })
      .from(schema.generations)
      .innerJoin(schema.projects, eq(schema.generations.projectId, schema.projects.id))
      .where(
        and(
          eq(schema.generations.groupId, input.groupId),
          ne(schema.projects.status, "archived"),
          eq(schema.generations.status, "awaiting_approval"),
        ),
      )
      .groupBy(schema.generations.projectId);
    // min(timestamp) 依驅動設定可能回 Date 或字串，統一轉 Date（無效值當作沒有）
    const toDate = (v: unknown): Date | null => {
      if (v == null) return null;
      const d = v instanceof Date ? v : new Date(String(v));
      return Number.isNaN(d.getTime()) ? null : d;
    };
    // count 經 node-postgres 回來是字串，一律 Number()（比照 teamAssistant 的守則）
    const projects = rows.map((r) => ({
      projectId: r.projectId,
      awaitingGenerations: Number(r.n),
      oldestAwaitingGenerationAt: toDate(r.oldest),
    }));
    return {
      projects,
      totalAwaitingGenerations: projects.reduce((s, p) => s + p.awaitingGenerations, 0),
    };
  }),

  /**
   * 成本審核裁決（需求 2.1）：組長對 awaiting_approval 的生成核准或駁回。
   * 核准＝CAS 認領 → 扣點（mock 模式跳過，與 submit 同一原則）→ 送 fal（失敗退點標 failed）。
   * 駁回＝CAS 標 rejected（從未扣點，不需退點）。CAS 防兩位組長同時裁決造成雙扣/雙送。
   */
  decideCost: authedProcedure
    .input(z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]), reason: z.string().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.id));
      if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
      requireLeader(ctx.auth, gen.groupId); // 只有組長以上能裁決成本核准
      if (gen.status !== "awaiting_approval") throw new TRPCError({ code: "BAD_REQUEST", message: "這筆生成已處理過（或不在待核狀態）" });
      const model = getModel(gen.modelId);

      const postSystemMessage = async (body: string) => {
        await db
          .insert(schema.messages)
          .values({ groupId: gen.groupId, projectId: gen.projectId, userId: ctx.auth.user.id, kind: "system", body })
          .catch((err) => console.warn("[generation] 裁決系統訊息寫入失敗：", err instanceof Error ? err.message : err));
      };

      if (input.decision === "rejected") {
        const reason = input.reason?.trim();
        const [updated] = await db
          .update(schema.generations)
          .set({ status: "rejected", error: reason ? `組長駁回：${reason}` : "組長駁回", updatedAt: new Date() })
          .where(and(eq(schema.generations.id, gen.id), eq(schema.generations.status, "awaiting_approval")))
          .returning();
        if (!updated) throw new TRPCError({ code: "BAD_REQUEST", message: "這筆生成已被其他人處理" });
        const trace = await findAiTraceSessionBySource("generation", gen.id).catch(() => null);
        if (trace) {
          await recordAiTraceEventSafely({ sessionId: trace.id, eventType: "validation", summary: "成本審核已駁回", payload: { decision: "rejected", reason } });
          await recordAiTraceEventSafely({ sessionId: trace.id, eventType: "completed", summary: "本次生成於送出 provider 前結束", payload: { generationId: gen.id, status: "rejected" } });
          await updateAiTraceSession(trace.id, { status: "completed", summary: "成本審核已駁回，未送出 provider" }).catch(() => undefined);
        }
        await postSystemMessage(`⛔ 待核生成已駁回（${model?.label ?? gen.modelId}，${gen.pointsEst} 點）${reason ? `：${reason}` : ""}`);
        return updated;
      }

      // 封存／狀態機（R2-001 + TD-03）：封存專案不得再核准送出付費生成；paused 仍可核准在途待核。
      const [approveProject] = await db.select().from(schema.projects).where(eq(schema.projects.id, gen.projectId));
      if (!approveProject) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      const { assertProjectAllows } = await import("../services/projectState");
      assertProjectAllows(approveProject, "approve");

      // 核准：先 CAS 認領（awaiting_approval → queued），輸家直接得知已被處理。
      // createdAt 一併改為核准時刻（修 cross-period-approval-bypass-rate-quota）：週/日速率額度以
      // coalesce(generations.createdAt, costLedger.createdAt) 歸屬期間，若沿用送審週的 createdAt，
      // 「上週送審、本週核准」的扣點會永久歸屬上週、逃出本週速率桶 → 多筆各看空桶全放行、繞過週/日額度。
      // 把扣點歸屬期間對齊「實際扣點時刻」，守門檢查與扣點歸屬期間才一致。
      const [claimed] = await db
        .update(schema.generations)
        .set({ status: "queued", updatedAt: new Date(), createdAt: new Date() })
        .where(and(eq(schema.generations.id, gen.id), eq(schema.generations.status, "awaiting_approval")))
        .returning();
      if (!claimed) throw new TRPCError({ code: "BAD_REQUEST", message: "這筆生成已被其他人處理" });
      if (!model) {
        // 模型已從目錄移除（送審與核准間隔太久）：收斂到 failed，未扣點不退
        await db.update(schema.generations).set({ status: "failed", error: "模型已不在目錄，無法送出", updatedAt: new Date() }).where(eq(schema.generations.id, gen.id));
        throw new TRPCError({ code: "BAD_REQUEST", message: "此模型已不在目錄，無法核准送出" });
      }

      // Execution-rights revalidation（closure §3，P0）：packet 是凍結意圖，授權是活的——
      // 等待核准期間 Canon generationAllowed／reuseScope 被撤回、送出者被移出組、專案被封存，
      // 都必須在「扣點與呼叫 provider 之前」擋下。不 silent fallback：
      // 收斂到 failed（未扣點）＋把 blockers 全文寫進 error（audit 由 mutation 中介層照記）。
      {
        const { revalidateExecutionRights, formatExecutionRightsError } = await import("../services/executionRights");
        const rights = await revalidateExecutionRights({
          generation: { id: gen.id, projectId: gen.projectId, groupId: gen.groupId, userId: gen.userId, params: gen.params },
        });
        if (!rights.ok) {
          const message = formatExecutionRightsError(rights.blockers);
          const [blocked] = await db.update(schema.generations)
            .set({ status: "failed", error: message, updatedAt: new Date() })
            .where(eq(schema.generations.id, gen.id))
            .returning();
          const trace = await findAiTraceSessionBySource("generation", gen.id).catch(() => null);
          if (trace) {
            await recordAiTraceEventSafely({
              sessionId: trace.id,
              eventType: "validation",
              summary: "核准時重驗權限未通過，未送出 provider",
              payload: { decision: "blocked", blockers: rights.blockers },
            });
            await updateAiTraceSession(trace.id, { status: "completed", summary: "執行權限已失效，生成未送出" }).catch(() => undefined);
          }
          await postSystemMessage(`⛔ 待核生成無法執行（${model.label}）：${message}`);
          return { ...blocked, blockers: rights.blockers };
        }
      }

      // BYOK：核准當下再解析個人 key（與 submit 同口徑）；個人路徑不扣平台點
      const { userFalKey, usedUserKey } = await resolveByokFalKey(gen.userId, model, gen.params);

      // 扣「提交者本人」的額度（不是核准的組長）——與 submit 同一守門；mock 扣點行為同 generationCore（billingBypassed）
      if (!billingBypassed() && !usedUserKey) {
        let quotaError: string | null;
        try {
          quotaError = await reserveQuota(gen.userId, gen.groupId, gen.pointsEst, `核准生成 ${model.label}`, gen.id);
        } catch (err) {
          // 扣點基礎設施故障：退回待核狀態讓組長稍後重試，不留下已認領孤兒
          await db.update(schema.generations).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(schema.generations.id, gen.id));
          console.error("[generation] 核准扣點例外：", err instanceof Error ? err.message : err);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "系統忙碌，請稍後再核准一次（未扣點）" });
        }
        if (quotaError) {
          await db.update(schema.generations).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(schema.generations.id, gen.id));
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `提交者額度不足：${quotaError}` });
        }
      }

      // 重簽來源網址(修:送審當下對「素材庫來源」簽的網址 TTL 僅 1 小時,組長隔一小時以上才核准
      // 圖生圖/影音等需來源的生成,fal 抓來源時網址已過期→必失敗白繞一圈。核准送出前用新 TTL 重簽,
      // 並把 params 內任何等於舊簽名網址的值替換掉——model.input 把來源塞在模型專屬鍵,替換整串最穩)。
      const splitParams = splitGenerationSourceMeta(gen.params);
      let submitParams = splitParams.providerParams;
      let refreshedPrimaryUrl = gen.sourceUrl ?? undefined;
      let refreshedSecondaryUrl = splitParams.meta.secondarySourceUrl;
      if (gen.sourceUrl) {
        const m = gen.sourceUrl.match(/\/api\/assets\/([0-9a-f-]{36})\/file\?/i);
        if (m) {
          const fresh = signAssetUrl(m[1]);
          submitParams = JSON.parse(JSON.stringify(submitParams).split(gen.sourceUrl).join(fresh)) as Record<string, unknown>;
          refreshedPrimaryUrl = fresh;
          await db.update(schema.generations).set({ sourceUrl: fresh }).where(eq(schema.generations.id, gen.id));
        }
      }
      const secondaryAssetId = signedAssetId(refreshedSecondaryUrl);
      if (secondaryAssetId && refreshedSecondaryUrl) {
        const fresh = signAssetUrl(secondaryAssetId);
        submitParams = JSON.parse(JSON.stringify(submitParams).split(refreshedSecondaryUrl).join(fresh)) as Record<string, unknown>;
        refreshedSecondaryUrl = fresh;
      }
      const parsedContinuity = continuitySnapshotSchema.safeParse(gen.continuitySnapshot);
      if (parsedContinuity.success && parsedContinuity.data.locked) {
        const primaryAssetId = signedAssetId(refreshedPrimaryUrl);
        const freshReferences = await resolveContinuityReferenceUrls(
          parsedContinuity.data,
          gen.groupId,
          primaryAssetId,
        );
        applyContinuityReferences(submitParams, refreshedPrimaryUrl, freshReferences);
      }
      await db
        .update(schema.generations)
        .set({
          // 先攤平既有 meta 再覆寫這次真的變了的兩欄。
          // 這裡是全欄覆寫（不是 merge），只挑幾個欄位重建等於把其餘 meta 丟掉：
          // preserveScenePointer 掉了 → 核准後的變體完成時會靜默蓋掉這一鏡的現用畫面；
          // ablation/bench 的 runId 掉了 → 使用者付了點數的比較實測查不回來（runId 只存在 params 裡）。
          params: storeGenerationSourceMeta(submitParams, {
            ...splitParams.meta,
            secondarySourceUrl: refreshedSecondaryUrl,
            usedUserKey: usedUserKey || splitParams.meta.usedUserKey || undefined,
          }),
        })
        .where(eq(schema.generations.id, gen.id));

      try {
        // params 存的是送審當下注入完成的 fal 輸入(來源網址已於上方重簽)——核准即送出
        const trace = await findAiTraceSessionBySource("generation", gen.id).catch(() => null);
        if (trace) {
          await recordAiTraceEventSafely({ sessionId: trace.id, eventType: "validation", summary: "成本審核已核准", payload: { decision: "approved", approvedBy: ctx.auth.user.id } });
          await recordAiTraceEventSafely({ sessionId: trace.id, eventType: "provider_request", summary: `核准後送出 ${model.label}`, payload: { endpoint: endpointOf(model), input: submitParams } });
          await updateAiTraceSession(trace.id, { status: "running", summary: "已核准並送出 provider" }).catch(() => undefined);
        }
        const startedAt = Date.now();
        /*
         * 依 provider 分流（#725 P1-10）。
         *
         * 這裡原本寫死 falSubmit，但 advanceGeneration 是依 requestId 的 `nim_`／`gemini_`
         * 前綴決定去哪裡查狀態的。於是**任何超過成本門檻的 Gemini／NIM 生成，
         * 在組長核准之後必定失敗**——送去了 fal，而 fal 不認得這個 endpoint。
         * 與 generationCore 送出時的分流保持同一份判斷（isNimModel / isGeminiModel／mock 一律走假佇列）。
         */
        const { requestId } = isNimModel(model) && !isMockMode()
          ? nimSubmit(submitParams)
          : isGeminiModel(model) && !isMockMode()
            ? await geminiSubmit(model.kind, submitParams)
            : await falSubmit(
                endpointOf(model),
                model.kind,
                submitParams,
                byokFalOpts(userFalKey, usedUserKey),
              );
        if (trace) await recordAiTraceEventSafely({ sessionId: trace.id, eventType: "provider_response", summary: "Provider 已接受核准後的工作", latencyMs: Date.now() - startedAt, payload: { requestId, status: "running" } });
        const [updated] = await db
          .update(schema.generations)
          .set({ requestId, status: "running", updatedAt: new Date() })
          .where(eq(schema.generations.id, gen.id))
          .returning();
        const costLabel = usedUserKey ? "個人金鑰・0 點" : `${gen.pointsEst} 點`;
        await postSystemMessage(`✅ 待核生成已核准並送出（${model.label}，${costLabel}）`);
        return updated;
      } catch (err) {
        // 修 R5-MONEY-002：與扣點側對稱——假生成／BYOK 不扣點就不退點
        if (!billingBypassed() && !usedUserKey) {
          await refund(gen.userId, gen.groupId, gen.pointsEst, "核准送出失敗退回", gen.id);
        }
        console.error("[generation] 核准送出失敗:", err);
        await db
          .update(schema.generations)
          .set({
            status: "failed",
            error: String(err),
            pointsRefunded: usedUserKey || billingBypassed() ? 0 : gen.pointsEst,
            updatedAt: new Date(),
          })
          .where(eq(schema.generations.id, gen.id));
        const trace = await findAiTraceSessionBySource("generation", gen.id).catch(() => null);
        if (trace) {
          await recordAiTraceEventSafely({ sessionId: trace.id, eventType: "failed", summary: "核准後送出 provider 失敗", payload: { error: err instanceof Error ? err.message : String(err) } });
          await updateAiTraceSession(trace.id, { status: "failed", summary: "核准後送出失敗" }).catch(() => undefined);
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: usedUserKey || billingBypassed()
            ? "核准後送出失敗，請稍後重試"
            : "核准後送出失敗，點數已退回，請稍後重試",
        });
      }
    }),

  /** 系統資訊(假生成模式徽章用) */
  info: authedProcedure.query(() => ({ mockMode: isMockMode() })),

  /**
   * GPU-01：免費 CloudInference mock 圖片 PoC（beam_mock only）。
   * - 不走 fal、不扣點、不寫 generations 表；同步 submit + 輪詢至終態後直回結果。
   * - 需 CLOUD_INFERENCE_PROVIDER=beam_mock 或 E2E_MOCK=1；否則 PRECONDITION_FAILED。
   * - modelId 須 cloud-mock/ 前綴；每日免費額度見 freeGeneration（行程記憶體，非多副本）。
   */
  submitCloudMock: authedProcedure
    .input(
      z.object({
        prompt: z.string().trim().min(1, "請填提示詞").max(8000, "提示詞過長（上限 8000 字）"),
        /** 預設 cloud-mock/concept-image；僅接受 cloud-mock/ 前綴 */
        modelId: z.string().min(1).max(200).optional(),
        projectId: z.string().uuid().optional(),
        /** 冪等鍵：同 key 重送回同一 providerJobId（mock adapter 層） */
        clientRequestId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      submitCloudMockGeneration({
        userId: ctx.auth.user.id,
        prompt: input.prompt,
        modelId: input.modelId ?? DEFAULT_CLOUD_MOCK_MODEL_ID,
        projectId: input.projectId,
        idempotencyKey: input.clientRequestId,
      }),
    ),
});
