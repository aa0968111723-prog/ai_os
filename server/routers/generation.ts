import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { getModel, endpointOf, type ProjectFormat, type ModelEntry } from "../../shared/models";
import { worldviewSchema, type Worldview } from "../../shared/worldview";
import { falSubmit, falStatus, isMockMode } from "../services/fal";
import { reserveQuota, refund } from "../services/points";

/** 世界觀 → 提示詞注入(「懂我們」的核心:上下文自動帶入每次生成) */
function buildPrompt(userPrompt: string, worldview: Worldview): string {
  const parts: string[] = [];
  if (worldview.tones.length) parts.push(`調性:${worldview.tones.join("、")}`);
  if (worldview.styles.length) parts.push(`視覺風格:${worldview.styles.join("、")}`);
  if (worldview.message) parts.push(`核心訊息:${worldview.message}`);
  if (worldview.taboos.length) parts.push(`避免:${worldview.taboos.join(";")}`);
  return parts.length ? `${userPrompt}\n\n[專案背景] ${parts.join("|")}` : userPrompt;
}

/** 哪些類別注入世界觀(TTS 會唸出注入文字、轉錄/視覺/訓練/影片工具不適用 → 不注入) */
const INJECT_CATEGORIES = new Set(["text-to-image", "image-to-image", "text-to-video", "llm", "text-to-audio"]);

function effectivePrompt(model: ModelEntry, userPrompt: string, worldview: Worldview): string {
  return INJECT_CATEGORIES.has(model.category) ? buildPrompt(userPrompt, worldview) : userPrompt;
}

export const generationRouter = router({
  submit: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        modelId: z.string(),
        prompt: z.string().min(1, "請填提示詞"),
        /** 來源輸入(圖生圖底圖/音訊/影片/訓練 zip 的網址;素材庫或外部 URL) */
        sourceUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const model = getModel(input.modelId);
      if (!model) throw new TRPCError({ code: "BAD_REQUEST", message: "未知模型(不在註冊表)" });
      if (model.needs && !input.sourceUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `此模型需要來源:${model.sourceHint ?? model.needs}` });
      }

      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireGroup(ctx.auth, project.groupId); // 多組隔離

      const worldview = worldviewSchema.parse(project.worldview ?? {});
      const fullPrompt = effectivePrompt(model, input.prompt, worldview);
      const falInput = model.input(fullPrompt, project.format as ProjectFormat, input.sourceUrl);

      const [gen] = await db
        .insert(schema.generations)
        .values({
          projectId: project.id,
          groupId: project.groupId,
          userId: ctx.auth.user.id,
          modelId: model.id,
          kind: model.kind,
          prompt: input.prompt,
          sourceUrl: input.sourceUrl,
          params: falInput,
          pointsEst: model.points,
        })
        .returning();

      // 原子守門＋扣點（同一交易＋per-user 鎖，杜絕併發雙重扣款/繞過額度）
      const quotaError = await reserveQuota(ctx.auth.user.id, project.groupId, model.points, `生成 ${model.label}`, gen.id);
      if (quotaError) {
        await db.delete(schema.generations).where(eq(schema.generations.id, gen.id)); // 未扣點，移除待生成列
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: quotaError });
      }

      try {
        const { requestId } = await falSubmit(endpointOf(model), model.kind, falInput);
        const [updated] = await db
          .update(schema.generations)
          .set({ requestId, status: "running", updatedAt: new Date() })
          .where(eq(schema.generations.id, gen.id))
          .returning();
        return updated;
      } catch (err) {
        await refund(ctx.auth.user.id, project.groupId, model.points, "生成送出失敗退回", gen.id);
        console.error("[generation] submit 失敗:", err);
        await db
          .update(schema.generations)
          .set({ status: "failed", error: String(err), pointsRefunded: model.points, updatedAt: new Date() })
          .where(eq(schema.generations.id, gen.id));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "生成送出失敗,點數已退回,請重試" });
      }
    }),

  /** 輪詢狀態(開發模式主要路徑;正式站之後補 webhook+此輪詢當備援) */
  status: authedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, input.id));
    if (!gen) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, gen.groupId); // 多組隔離
    if (gen.status !== "queued" && gen.status !== "running") return gen;
    if (!gen.requestId) return gen;

    const model = getModel(gen.modelId);
    const endpoint = model ? endpointOf(model) : gen.modelId;
    const kind = (model?.kind ?? gen.kind) as "image" | "video" | "audio" | "text";

    const result = await falStatus(endpoint, kind, gen.requestId);
    if (result.status === "done" && (result.resultUrl || result.resultText)) {
      // Compare-and-set：只有把「仍在 queued/running」的列成功推進成 done 的那一次才算數，
      // 併發輪詢/重試不會重複入庫（舊版每次都 update+insert asset → 重複素材、重複計費）。
      const updatedRows = await db
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
      if (updatedRows.length === 0) {
        const [current] = await db.select().from(schema.generations).where(eq(schema.generations.id, gen.id));
        return current; // 別人已推進，直接回現況
      }
      const [updated] = updatedRows;
      // 媒體成品自動入素材庫(AI 生成標記);文字輸出留在生成紀錄
      if (result.resultUrl && (kind === "image" || kind === "video" || kind === "audio")) {
        await db.insert(schema.assets).values({
          projectId: gen.projectId,
          groupId: gen.groupId,
          kind,
          title: gen.prompt.slice(0, 40),
          url: result.resultUrl,
          isAiGenerated: true,
          meta: { generationId: gen.id, modelId: gen.modelId },
        });
      }
      return updated;
    }
    if (result.status === "failed") {
      // 同樣 compare-and-set：只有真正把列從 queued/running 轉成 failed 的那一次才退點，
      // 避免同一筆被多次輪詢重複退款（憑空長點數）。
      const updatedRows = await db
        .update(schema.generations)
        .set({ status: "failed", error: result.error ?? "未知錯誤", pointsRefunded: gen.pointsEst, updatedAt: new Date() })
        .where(and(eq(schema.generations.id, gen.id), inArray(schema.generations.status, ["queued", "running"])))
        .returning();
      if (updatedRows.length === 0) {
        const [current] = await db.select().from(schema.generations).where(eq(schema.generations.id, gen.id));
        return current;
      }
      await refund(gen.userId, gen.groupId, gen.pointsEst, "生成失敗退回", gen.id);
      return updatedRows[0];
    }
    return gen;
  }),

  listByProject: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    return db
      .select()
      .from(schema.generations)
      .where(eq(schema.generations.projectId, input.projectId))
      .orderBy(desc(schema.generations.createdAt))
      .limit(30);
  }),

  /** 系統資訊(假生成模式徽章用) */
  info: authedProcedure.query(() => ({ mockMode: isMockMode() })),
});
