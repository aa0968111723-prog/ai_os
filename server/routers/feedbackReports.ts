import { z } from "zod";
import { and, or, eq, inArray, desc, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, adminProcedure, requireGroup, requireLeader } from "../trpc";
import { db, schema } from "../db";
import { FEEDBACK_CATEGORY_VALUES } from "../../shared/options";
import { isFeedbackShotPath } from "../services/storage";
import { runFeedbackAgentOnce } from "../services/feedbackAgent";
import { isEmailConfigured } from "../services/email";

/** 合法狀態（與 schema feedback_reports.status 一致）——過濾與更新共用 */
const STATUS_VALUES = ["open", "reviewing", "done"] as const;

/**
 * 元件級回饋後端（R23）：使用者點頁面元件 → 分類＋文字（＋可選截圖）即時回報。
 * submit＝任何登入者送出；listVisible＝作者本人／該組組長・管理員／超管看得到；
 * updateStatus＝只有審閱者（組長・管理員・超管）能改狀態，純作者不行。
 */
export const feedbackReportsRouter = router({
  submit: authedProcedure
    .input(
      z.object({
        category: z.enum(FEEDBACK_CATEGORY_VALUES),
        // 頁面代稱陣列（複選）；每項限長避免塞大字串
        pages: z.array(z.string().max(60)).max(10),
        // 被點元件的可讀標籤與定位路徑（頁面級回饋時前端不傳 → null）
        targetLabel: z.string().max(200).optional(),
        targetSelector: z.string().max(1000).optional(),
        // 點選當下的位置與視窗尺寸 {x,y,w,h,vw,vh}＋相對最近 [data-fb] 卡片的比例 {rx,ry,rw,rh}
        // （viewport 座標跨裝置不準，重播標記框以「targetSelector 卡片＋比例」優先）；
        // 只用來還原標記框——收斂成固定數字欄位，擋任意物件塞入
        targetRect: z
          .object({
            x: z.number(), y: z.number(), w: z.number(), h: z.number(), vw: z.number(), vh: z.number(),
            rx: z.number(), ry: z.number(), rw: z.number(), rh: z.number(),
          })
          .partial()
          .optional(),
        note: z.string().min(1, "請寫一句說明").max(2000),
        // 只收本服務 /api/feedback/screenshot 產生的 feedback/ 路徑；亂填一律拒絕（擋跨組偷讀）
        screenshotPath: z.string().max(500).refine((p) => isFeedbackShotPath(p), "非法截圖路徑").optional(),
        groupId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 指定組要驗證確實屬於該組（否則能把回饋掛到別組給該組組長看到）；未指定退回目前第一個組，無組成員則 null 仍可回報。
      const groupId = input.groupId
        ? (requireGroup(ctx.auth, input.groupId) && input.groupId)
        : (ctx.auth.groups[0]?.groupId ?? null);
      const [row] = await db
        .insert(schema.feedbackReports)
        .values({
          userId: ctx.auth.user.id,
          groupId,
          category: input.category,
          pages: input.pages,
          // undefined 在 drizzle 會被當「不設值」；未附的欄位明確寫 null
          targetLabel: input.targetLabel ?? null,
          targetSelector: input.targetSelector ?? null,
          targetRect: input.targetRect ?? null,
          note: input.note,
          screenshotPath: input.screenshotPath ?? null,
        })
        .returning({ id: schema.feedbackReports.id });
      return { id: row.id };
    }),

  /** 可見清單：作者本人／該組組長・管理員／超管；新到舊上限 200，附送者名與組名 */
  listVisible: authedProcedure
    .input(z.object({ status: z.enum(STATUS_VALUES).optional() }).optional())
    .query(async ({ ctx, input }) => {
      // 可見性：超管看全部；其餘為「自己送的」或「自己是組長/管理員的組」的回饋。
      let visibility: SQL | undefined;
      if (!ctx.auth.user.isSuperAdmin) {
        const reviewGroupIds = ctx.auth.groups.filter((g) => g.role !== "member").map((g) => g.groupId);
        const terms: SQL[] = [eq(schema.feedbackReports.userId, ctx.auth.user.id)];
        // 空陣列的 inArray 在部分方言會產生無效 SQL，只有真的有可審的組才加這條
        if (reviewGroupIds.length > 0) terms.push(inArray(schema.feedbackReports.groupId, reviewGroupIds));
        visibility = or(...terms);
      }
      const conditions: SQL[] = [];
      if (visibility) conditions.push(visibility);
      if (input?.status) conditions.push(eq(schema.feedbackReports.status, input.status));

      // leftJoin：groupId 可能為 null（無組回饋），join 不到時 groupName→「—」；查不到使用者名→「?」
      const rows = await db
        .select({
          report: schema.feedbackReports,
          userName: schema.users.name,
          groupName: schema.groups.name,
        })
        .from(schema.feedbackReports)
        .leftJoin(schema.users, eq(schema.users.id, schema.feedbackReports.userId))
        .leftJoin(schema.groups, eq(schema.groups.id, schema.feedbackReports.groupId))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(schema.feedbackReports.createdAt))
        .limit(200);

      return rows.map((r) => ({ ...r.report, userName: r.userName ?? "?", groupName: r.groupName ?? "—" }));
    }),

  /** 改狀態：只有審閱者（該組組長・管理員或超管）可改；純作者不能改自己回饋的狀態 */
  updateStatus: authedProcedure
    .input(z.object({ id: z.string().uuid(), status: z.enum(STATUS_VALUES) }))
    .mutation(async ({ ctx, input }) => {
      const [report] = await db.select().from(schema.feedbackReports).where(eq(schema.feedbackReports.id, input.id));
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則回饋" });
      if (!ctx.auth.user.isSuperAdmin) {
        // 無組回饋沒有組長可審，只有超管能處理；有組則需組長/管理員（requireLeader 會擋掉純組員與非本組者）
        if (!report.groupId) throw new TRPCError({ code: "FORBIDDEN", message: "只有系統管理員能處理這則回饋" });
        requireLeader(ctx.auth, report.groupId);
      }
      await db.update(schema.feedbackReports).set({ status: input.status }).where(eq(schema.feedbackReports.id, input.id));
      return { ok: true };
    }),

  /**
   * 回饋代理狀態（管理頁「回饋代理」卡用）：最近一次巡檢紀錄＋信箱機制是否就緒。
   * 需團隊管理權（adminProcedure）；每 3 天自動巡一次的排程在伺服器背景，這裡只讀狀態。
   */
  agentStatus: adminProcedure.query(async () => {
    const [lastRun] = await db
      .select()
      .from(schema.feedbackAgentRuns)
      .orderBy(desc(schema.feedbackAgentRuns.startedAt))
      .limit(1);
    return {
      // 排程固定每 3 天巡一次（見 services/feedbackAgent.ts）
      intervalDays: 3,
      emailConfigured: isEmailConfigured(),
      lastRun: lastRun ?? null,
    };
  }),

  /**
   * 立即巡檢一輪（超管手動觸發，不必等 3 天排程）：同步跑完回傳結果。
   * 併發時（排程正在跑）回 skipped；只有開發者可觸發，避免一般管理員狂點觸發 LLM 呼叫。
   */
  runAgentNow: adminProcedure.mutation(async ({ ctx }) => {
    if (!ctx.auth.user.isSuperAdmin) {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有開發者能手動觸發回饋代理巡檢" });
    }
    return runFeedbackAgentOnce({ trigger: "manual" });
  }),
});
