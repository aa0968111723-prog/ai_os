import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../trpc";
import { db, schema } from "../db";
import { createInvite, attachExistingUser } from "../services/auth";

/** 團隊管理權檢查：超管或該團隊 admin */
function assertTeamAdmin(auth: { user: { isSuperAdmin: boolean }; adminTeamIds: string[] }, teamId: string): void {
  if (!auth.user.isSuperAdmin && !auth.adminTeamIds.includes(teamId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要該團隊的管理權限" });
  }
}

export const adminRouter = router({
  /** 組織總覽：團隊 → 組 → 成員（只回傳有管理權的團隊） */
  overview: adminProcedure.query(async ({ ctx }) => {
    const teams = await db.select().from(schema.teams);
    const groups = await db.select().from(schema.groups);
    const teamMembers = await db.select().from(schema.teamMembers);
    const groupMembers = await db.select().from(schema.groupMembers);
    const users = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users);

    const visible = ctx.auth.user.isSuperAdmin ? teams : teams.filter((t) => ctx.auth.adminTeamIds.includes(t.id));
    const userOf = (id: string) => users.find((u) => u.id === id);

    return visible.map((team) => ({
      id: team.id,
      name: team.name,
      admins: teamMembers
        .filter((m) => m.teamId === team.id && m.role === "admin")
        .map((m) => userOf(m.userId))
        .filter(Boolean),
      groups: groups
        .filter((g) => g.teamId === team.id)
        .map((g) => ({
          id: g.id,
          name: g.name,
          members: groupMembers
            .filter((m) => m.groupId === g.id)
            .map((m) => ({ ...userOf(m.userId), role: m.role }))
            .filter((m) => m.id),
        })),
    }));
  }),

  createTeam: adminProcedure.input(z.object({ name: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    if (!ctx.auth.user.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "只有超管能建團隊" });
    const [team] = await db.insert(schema.teams).values({ name: input.name.trim() }).returning();
    return team;
  }),

  createGroup: adminProcedure
    .input(z.object({ teamId: z.string().uuid(), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      assertTeamAdmin(ctx.auth, input.teamId);
      const [group] = await db.insert(schema.groups).values({ teamId: input.teamId, name: input.name.trim() }).returning();
      return group;
    }),

  /** 建邀請 → 回傳連結（用 LINE 傳給夥伴即可，72 小時內有效） */
  invite: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        teamId: z.string().uuid(),
        teamRole: z.enum(["admin", "member"]).default("member"),
        groupId: z.string().uuid().optional(),
        groupRole: z.enum(["leader", "member"]).default("member"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertTeamAdmin(ctx.auth, input.teamId);
      if (input.groupId) {
        const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, input.groupId));
        if (!group || group.teamId !== input.teamId) throw new TRPCError({ code: "BAD_REQUEST", message: "組不屬於該團隊" });
      }
      const email = input.email.toLowerCase().trim();
      const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email));
      if (existing) {
        // 既有帳號：不發可兌換連結（那條路會被拿去免密碼接管帳號），改由管理員直接加入。
        if (existing.isSuperAdmin && !ctx.auth.user.isSuperAdmin) {
          throw new TRPCError({ code: "FORBIDDEN", message: "不能邀請系統管理員加入你的團隊" });
        }
        await attachExistingUser({
          userId: existing.id,
          teamId: input.teamId,
          teamRole: input.teamRole,
          groupId: input.groupId,
          groupRole: input.groupRole,
        });
        return { inviteUrl: null, attached: true, message: `${existing.name} 已直接加入（此 email 已有帳號，沿用原密碼登入）`, expiresInHours: 0 };
      }
      const { token } = await createInvite({ ...input, email, invitedBy: ctx.auth.user.id });
      const base = process.env.APP_URL ?? "";
      return { inviteUrl: `${base}/invite/${token}`, attached: false, message: null as string | null, expiresInHours: 72 };
    }),

  /** 變更組內角色（組長↔組員） */
  setGroupRole: adminProcedure
    .input(z.object({ groupId: z.string().uuid(), userId: z.string().uuid(), role: z.enum(["leader", "member"]) }))
    .mutation(async ({ ctx, input }) => {
      const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, input.groupId));
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      assertTeamAdmin(ctx.auth, group.teamId);
      await db
        .update(schema.groupMembers)
        .set({ role: input.role })
        .where(and(eq(schema.groupMembers.groupId, input.groupId), eq(schema.groupMembers.userId, input.userId)));
      return { ok: true };
    }),

  /** 移出組（成員被移出 → 下一請求立即失效；設計文件邊界情況） */
  removeFromGroup: adminProcedure
    .input(z.object({ groupId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, input.groupId));
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      assertTeamAdmin(ctx.auth, group.teamId);
      if (input.userId === ctx.auth.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "不能移除自己（最後管理員保底）" });
      await db
        .delete(schema.groupMembers)
        .where(and(eq(schema.groupMembers.groupId, input.groupId), eq(schema.groupMembers.userId, input.userId)));
      return { ok: true };
    }),
});
