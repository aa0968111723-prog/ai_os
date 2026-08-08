/**
 * 決策（Decision Log）。
 *
 * 「不是所有留言都永久同等重要」——真正定案的內容（用暖色版本 B、Shot 03 改 6 秒）
 * 需要離開時間軸、被保存成可反覆引用的一句話。這裡是它的 CRUD：
 *  - 從留言／標注轉決策（sourceMessageId 記 provenance，並回寫 message.intent）
 *  - 指向具體內容物件（refType/refId：scene/asset/generation）
 *  - 撤銷是標記不是刪除——「曾經定過又推翻」本身就是要留下的紀錄
 *
 * ACL 與全站同一條慣例：載專案 → requireGroup → 寫入再 assertProjectEditable。
 */
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable, assertProjectNotArchived } from "../services/projectAcl";
import { publishToProject } from "../services/realtime";
import { DECISION_TITLE_MAX, MESSAGE_INTENTS } from "../../shared/collabIntent";

async function loadProjectChecked(auth: Parameters<typeof requireGroup>[0], projectId: string, forEdit: boolean) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  requireGroup(auth, project.groupId);
  if (forEdit) {
    await assertProjectEditable(auth, project);
    assertProjectNotArchived(project);
  }
  return project;
}

export const decisionsRouter = router({
  /** 專案決策清單（含已撤銷——劃線顯示，不是消失）。帶 decidedBy 的名字，一支查完。 */
  list: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await loadProjectChecked(ctx.auth, input.projectId, false);
      const rows = await db
        .select()
        .from(schema.decisions)
        .where(eq(schema.decisions.projectId, input.projectId))
        .orderBy(desc(schema.decisions.createdAt))
        .limit(100);
      const ids = [...new Set(rows.flatMap((r) => [r.decidedBy, r.revokedBy]).filter((v): v is string => Boolean(v)))];
      const users = ids.length
        ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, ids))
        : [];
      const nameOf = new Map(users.map((u) => [u.id, u.name]));
      return rows.map((r) => ({
        ...r,
        decidedByName: nameOf.get(r.decidedBy) ?? null,
        revokedByName: r.revokedBy ? nameOf.get(r.revokedBy) ?? null : null,
      }));
    }),

  /**
   * 定案。可從留言轉（sourceMessageId：驗同專案並回寫 intent='decision'——
   * provenance 是雙向的，決策指得回討論串，討論串也看得出「這句已成定案」），
   * 也可憑空建立（會議上口頭定的案不一定有留言）。
   */
  create: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      title: z.string().trim().min(1, "定案內容不能是空的").max(DECISION_TITLE_MAX),
      refType: z.enum(["scene", "asset", "generation", "note", "schedule"]).optional(),
      refId: z.string().uuid().optional(),
      sourceMessageId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProjectChecked(ctx.auth, input.projectId, true);
      // ref 兩欄同進同出：只給一半的指標指不到任何東西，之後每個讀取端都要多一個 if
      if ((input.refType == null) !== (input.refId == null)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "refType 與 refId 要一起給或都不給" });
      }
      if (input.sourceMessageId) {
        const [src] = await db
          .select({ id: schema.messages.id, projectId: schema.messages.projectId })
          .from(schema.messages)
          .where(eq(schema.messages.id, input.sourceMessageId));
        if (!src || src.projectId !== project.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "來源留言不在本專案" });
        }
      }
      const [row] = await db
        .insert(schema.decisions)
        .values({
          groupId: project.groupId,
          projectId: project.id,
          title: input.title,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          sourceMessageId: input.sourceMessageId ?? null,
          decidedBy: ctx.auth.user.id,
        })
        .returning();
      // 回寫來源留言的 intent：討論串上看得出「這句已成定案」
      if (input.sourceMessageId) {
        await db
          .update(schema.messages)
          .set({ intent: "decision" })
          .where(eq(schema.messages.id, input.sourceMessageId));
      }
      publishToProject(project.id, { kind: "annotation", id: input.refId ?? null }, "定了一個案");
      return row;
    }),

  /** 撤銷（標記，不刪列）。已撤銷再撤銷是 no-op，不報錯——重複點擊不該炸。 */
  revoke: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.decisions).where(eq(schema.decisions.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await loadProjectChecked(ctx.auth, row.projectId, true);
      if (row.revokedAt) return row;
      const [updated] = await db
        .update(schema.decisions)
        .set({ revokedAt: new Date(), revokedBy: ctx.auth.user.id })
        // 條件寫入吸收雙擊競態：兩個人同時撤銷只有一個會中，另一個拿回 no-op
        .where(and(eq(schema.decisions.id, input.id)))
        .returning();
      return updated ?? row;
    }),
});

/**
 * 留言 intent 的獨立設定（thread action「標成修改要求／阻塞」用；
 * 轉決策時由 decisions.create 自動回寫，不必走這支）。
 */
export const setMessageIntentInput = z.object({
  messageId: z.string().uuid(),
  intent: z.enum(MESSAGE_INTENTS).nullable(),
});
