import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable } from "../services/projectAcl";
import {
  createAiTraceSession,
  getAiTraceSession,
  listAiTraceSessions,
  recordAiTraceEventSafely,
  sanitizeAiTracePayload,
  updateAiTraceSession,
} from "../services/aiTrace";
import { completeText } from "../services/llmProvider";
import { aiOperationPreviewSchema } from "../../shared/aiTrace";
import { parseAiQualityReview } from "../services/aiQualityReview";

async function requireEditor(auth: Parameters<typeof assertProjectEditable>[0], projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  await assertProjectEditable(auth, project);
  return project;
}

export const aiTraceRouter = router({
  listByProject: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ ctx, input }) => {
      await requireEditor(ctx.auth, input.projectId);
      return listAiTraceSessions(input.projectId, ctx.auth.user.id, input.limit);
    }),

  get: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireEditor(ctx.auth, input.projectId);
      const trace = await getAiTraceSession(input.projectId, input.sessionId, ctx.auth.user.id);
      if (!trace) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆 AI 運作紀錄" });
      return trace;
    }),

  review: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), preview: aiOperationPreviewSchema }))
    .mutation(async ({ ctx, input }) => {
      const project = await requireEditor(ctx.auth, input.projectId);
      const trace = await createAiTraceSession({
        groupId: project.groupId,
        projectId: project.id,
        userId: ctx.auth.user.id,
        mode: "quality_review",
        title: `品質檢查：${input.preview.title}`,
        summary: "NIM 優先、fal 均衡備援；站內 0 點",
      });
      const safePreview = sanitizeAiTracePayload(input.preview).payload;
      const prompt = `請檢查下列 AI 應用層請求是否可能造成不準確、不一致、缺少上下文或提示衝突。
只檢查提供的資料，不要猜測模型私密思維，也不要輸出 chain-of-thought。
只回傳 JSON：
{"summary":"簡短結論","warnings":[{"code":"英文代碼","severity":"info|warning","title":"標題","detail":"具體原因","suggestion":"可操作改善"}],"suggestedPrompt":"可選的改寫正向提示","suggestedNegativePrompt":"可選的負向提示","contextUsed":["實際檢查欄位"]}
最多 8 個 warnings；新警告只供提醒，不代表阻止執行。

待檢查資料：
${JSON.stringify(safePreview)}`;
      await recordAiTraceEventSafely({ sessionId: trace.id, eventType: "provider_request", summary: "送出品質檢查", payload: { prompt, mode: "auto" } });
      try {
        const startedAt = Date.now();
        const completion = await completeText({ prompt, mode: "auto", temperature: 0.1, maxTokens: 2_500 });
        await recordAiTraceEventSafely({ sessionId: trace.id, eventType: "provider_response", summary: "收到品質檢查結果", latencyMs: Date.now() - startedAt, payload: completion });
        const parsed = parseAiQualityReview(completion.text);
        const review = parsed.review;
        await recordAiTraceEventSafely({ sessionId: trace.id, eventType: "completed", summary: review.summary, payload: { review, parseMode: parsed.parseMode } });
        await updateAiTraceSession(trace.id, { status: "completed", provider: completion.provider, model: completion.model }).catch(() => undefined);
        return {
          review,
          provider: completion.provider,
          model: completion.model,
          usage: completion.usage,
          fellBackToPaid: completion.fellBack ?? false,
          parseMode: parsed.parseMode,
          traceSessionId: trace.id,
        };
      } catch (error) {
        await recordAiTraceEventSafely({ sessionId: trace.id, eventType: "failed", summary: "品質檢查失敗", payload: { error: error instanceof Error ? error.message : String(error) } });
        await updateAiTraceSession(trace.id, { status: "failed" }).catch(() => undefined);
        throw error;
      }
    }),
});
