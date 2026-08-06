import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup, requireLeader } from "../trpc";
import { db, schema } from "../db";
import { OPTION_TYPES, PLATFORM_FORMATS, type OptionType, type GroupOption } from "../../shared/options";
import { ensureGroupOptions, getGroupOptions } from "../services/optionsStore";
import { isUniqueViolation } from "../services/generationCore";

const optionTypeSchema = z.enum(OPTION_TYPES as [OptionType, ...OptionType[]]);

/** DB 列 → 前後端共用的 GroupOption 投影（不外洩 groupId/createdBy 等內部欄位） */
function projectOption(row: typeof schema.groupOptions.$inferSelect): GroupOption {
  return {
    id: row.id,
    type: row.type,
    value: row.value,
    label: row.label,
    format: row.format,
    sortOrder: row.sortOrder,
    active: row.active,
  };
}

/** worldview 三類（value 直接等於 label，注入生成用） */
function isWorldview(type: OptionType): boolean {
  return type === "tone" || type === "theme" || type === "style";
}

export const optionsRouter = router({
  /** 讀某組全部選項（該組成員即可讀）；先 lazy-seed 再回，預設只回啟用中的 */
  byGroup: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), includeInactive: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      await ensureGroupOptions(input.groupId);
      const rows = await getGroupOptions(input.groupId);
      const visible = input.includeInactive ? rows : rows.filter((r) => r.active);
      return visible.map(projectOption);
    }),

  /** 新增或更新選項（組長以上）；新增時 server 自產 value，更新時 value 不變只改 label/format */
  upsert: authedProcedure
    .input(
      z.object({
        groupId: z.string().uuid(),
        id: z.string().uuid().optional(),
        type: optionTypeSchema,
        label: z.string().min(1, "請填名稱").max(60),
        format: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireLeader(ctx.auth, input.groupId);

      // 只有 platform 帶畫面比例；若有帶就必須是模型支援的比例之一（生成台才對得上）
      if (input.format !== undefined && !(PLATFORM_FORMATS as string[]).includes(input.format)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `畫面比例只能是：${PLATFORM_FORMATS.join("／")}` });
      }
      const label = input.label.trim();

      // ── 更新既有 ──
      if (input.id) {
        const [existing] = await db.select().from(schema.groupOptions).where(eq(schema.groupOptions.id, input.id));
        if (!existing || existing.groupId !== input.groupId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個選項" });
        }
        // worldview 類 value===label，改名等於改 value——擋同組同類型撞名
        if (isWorldview(existing.type)) {
          const siblings = await getGroupOptions(input.groupId, existing.type);
          if (siblings.some((s) => s.id !== existing.id && s.value === label)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "已經有同名的選項了" });
          }
        }
        try {
          const [updated] = await db
            .update(schema.groupOptions)
            .set({
              label,
              // value 不變；worldview 類 value 與 label 綁定，改名時同步
              value: isWorldview(existing.type) ? label : existing.value,
              // 僅 platform 有 format；更新時未帶 format 就保留原值
              format: existing.type === "platform" ? input.format ?? existing.format : existing.format,
            })
            .where(eq(schema.groupOptions.id, input.id))
            .returning();
          return projectOption(updated);
        } catch (err) {
          // 修 R3-OPT-01：改名撞到 (group_id,type,value) 唯一索引時轉人話，與新增分支同句，不再回原始 500
          if (isUniqueViolation(err)) throw new TRPCError({ code: "BAD_REQUEST", message: "已經有同名的選項了" });
          throw err;
        }
      }

      // ── 新增 ──
      // platform 新增一定要指定畫面比例（生成時要帶入）；其餘類型一律無 format
      let format: string | null = null;
      if (input.type === "platform") {
        if (!input.format) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇畫面比例（例如 16:9／9:16／1:1）" });
        }
        format = input.format;
      }
      const siblings = await getGroupOptions(input.groupId, input.type);
      let value: string;
      if (isWorldview(input.type)) {
        // worldview 類 value=label，擋同組同類型撞名
        if (siblings.some((s) => s.value === label)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "已經有同名的選項了" });
        }
        value = label;
      } else {
        // kind/platform 用穩定亂數 id，避免與既有 value 衝突
        value = "custom-" + Math.random().toString(36).slice(2, 8);
      }
      const maxSort = siblings.reduce((m, s) => Math.max(m, s.sortOrder), -1);
      try {
        const [created] = await db
          .insert(schema.groupOptions)
          .values({
            groupId: input.groupId,
            type: input.type,
            value,
            label,
            format,
            sortOrder: maxSort + 1,
            createdBy: ctx.auth.user.id,
          })
          .returning();
        return projectOption(created);
      } catch (err) {
        // 上方 siblings.some() 只擋得住循序請求——雙擊/兩位組長同時新增同名時彼此看不到對方,
        // 由 ensure.ts 建的 (group_id,type,value) 唯一索引兜底,23505 轉人話（與循序撞名同一句）
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "已經有同名的選項了" });
        }
        throw err;
      }
    }),

  /** 停用／啟用（軟隱藏，既有專案已存的值仍可顯示） */
  setActive: authedProcedure
    .input(z.object({ id: z.string().uuid(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [opt] = await db.select().from(schema.groupOptions).where(eq(schema.groupOptions.id, input.id));
      if (!opt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個選項" });
      requireLeader(ctx.auth, opt.groupId);
      await db.update(schema.groupOptions).set({ active: input.active }).where(eq(schema.groupOptions.id, input.id));
      return { ok: true as const };
    }),

  /** 硬刪（永久移除） */
  remove: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [opt] = await db.select().from(schema.groupOptions).where(eq(schema.groupOptions.id, input.id));
      if (!opt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個選項" });
      requireLeader(ctx.auth, opt.groupId);
      await db.delete(schema.groupOptions).where(eq(schema.groupOptions.id, input.id));
      return { ok: true as const };
    }),

  /** 重新排序（拖曳後把該組該類型的順序寫回） */
  reorder: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), type: optionTypeSchema, orderedIds: z.array(z.string().uuid()).max(200) }))
    .mutation(async ({ ctx, input }) => {
      requireLeader(ctx.auth, input.groupId);
      // 逐筆寫 sortOrder 包在單一交易：半途失敗整批回滾，避免只寫了一半→sortOrder 重複／跳號的錯亂排序。
      // 限定 groupId+type，避免跨組或跨類型被竄改。
      await db.transaction(async (tx) => {
        for (let i = 0; i < input.orderedIds.length; i++) {
          await tx
            .update(schema.groupOptions)
            .set({ sortOrder: i })
            .where(
              and(
                eq(schema.groupOptions.id, input.orderedIds[i]),
                eq(schema.groupOptions.groupId, input.groupId),
                eq(schema.groupOptions.type, input.type),
              ),
            );
        }
      });
      return { ok: true as const };
    }),
});
