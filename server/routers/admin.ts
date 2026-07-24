import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../trpc";
import { db, schema } from "../db";
import { createInvite, attachExistingUser, hashPassword } from "../services/auth";
import { sendEmail, isEmailConfigured, type EmailStatus } from "../services/email";

/** 團隊管理權檢查：開發者或該團隊 admin */
function assertTeamAdmin(auth: { user: { isSuperAdmin: boolean }; adminTeamIds: string[] }, teamId: string): void {
  if (!auth.user.isSuperAdmin && !auth.adminTeamIds.includes(teamId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要該團隊的管理權限" });
  }
}

// 臨時密碼字元集：排除 0/o/1/l/i 等易混淆字元，用 LINE 傳或口頭唸都不會抄錯
const TEMP_PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
function generateTempPassword(): string {
  return Array.from(randomBytes(10), (b) => TEMP_PASSWORD_CHARS[b % TEMP_PASSWORD_CHARS.length]).join("");
}

/** 對外絕對網址：email 裡的連結不能是相對路徑。比照 projects.ts／fal.ts 的平台中立後備。 */
function absoluteBaseUrl(): string {
  const platformDomain = process.env.PUBLIC_DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN;
  const fallback = platformDomain ? `https://${platformDomain}` : "";
  return process.env.APP_URL?.replace(/\/$/, "") || fallback || `http://localhost:${process.env.PORT ?? 3000}`;
}

/** 最小 HTML 逸脫：團隊名／邀請人名來自 DB，放進 email HTML 前擋掉標籤注入。 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** 邀請信內容（純文字必備、HTML 選附）：連結 72 小時內有效。 */
export function buildInviteEmail(teamName: string, inviteUrl: string, inviterName: string): { subject: string; text: string; html: string } {
  const subject = `邀請你加入「${teamName}」`;
  const text = [
    `${inviterName} 邀請你加入 AI Director OS 的「${teamName}」團隊。`,
    "",
    "點這個連結完成加入（72 小時內有效）：",
    inviteUrl,
    "",
    "如果你不認識邀請人，請忽略這封信。",
  ].join("\n");
  const html =
    `<p>${escapeHtml(inviterName)} 邀請你加入 AI Director OS 的「${escapeHtml(teamName)}」團隊。</p>` +
    `<p>點下面的連結完成加入（72 小時內有效）：<br><a href="${escapeHtml(inviteUrl)}">${escapeHtml(inviteUrl)}</a></p>` +
    `<p style="color:#888;font-size:12px">如果你不認識邀請人，請忽略這封信。</p>`;
  return { subject, text, html };
}

export const adminRouter = router({
  /** 組織總覽：團隊 → 組 → 成員（只回傳有管理權的團隊） */
  overview: adminProcedure.query(async ({ ctx }) => {
    const teams = await db.select().from(schema.teams);
    const groups = await db.select().from(schema.groups);
    const teamMembers = await db.select().from(schema.teamMembers);
    const groupMembers = await db.select().from(schema.groupMembers);
    // isSuperAdmin 給前端隱藏「重設密碼」等注定被後端擋下的操作（權限判斷仍以後端為準）
    const users = await db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, isSuperAdmin: schema.users.isSuperAdmin })
      .from(schema.users);

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
    if (!ctx.auth.user.isSuperAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "只有開發者能建團隊" });
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

  /**
   * 建邀請 → 回傳連結；若 sendEmailInvite（預設 true）且信箱機制已設定，同時把連結寄到對方 email。
   * 連結一律回傳供複製（LINE 等其他管道後備）；email 只是額外送達方式，寄失敗不擋流程。
   */
  invite: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        teamId: z.string().uuid(),
        teamRole: z.enum(["admin", "member"]).default("member"),
        groupId: z.string().uuid().optional(),
        groupRole: z.enum(["leader", "member"]).default("member"),
        // 是否同時寄邀請信給對方；未設信箱機制時後端自動略過（回 skipped）
        sendEmailInvite: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertTeamAdmin(ctx.auth, input.teamId);
      const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, input.teamId));
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "團隊不存在" });
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
        return {
          inviteUrl: null,
          attached: true,
          message: `${existing.name} 已直接加入（此 email 已有帳號，沿用原密碼登入）`,
          expiresInHours: 0,
          emailStatus: null as EmailStatus | null,
          emailDetail: null as string | null,
        };
      }
      const { token } = await createInvite({ ...input, email, invitedBy: ctx.auth.user.id });
      // 回傳給前端複製的連結沿用原本規則（APP_URL 未設＝相對路徑，前端 toFullUrl 補上瀏覽當下的來源）。
      const base = process.env.APP_URL ?? "";
      const inviteUrl = `${base}/invite/${token}`;

      // 寄邀請信：只有勾了且信箱機制就緒才真的送；未設定＝優雅降級（skipped），流程照走、連結照回。
      // email 內的連結必須是絕對網址（收件端沒有「瀏覽當下的來源」可補），故用平台中立的 absoluteBaseUrl。
      let emailStatus: EmailStatus | null = null;
      let emailDetail: string | null = null;
      if (input.sendEmailInvite) {
        if (!isEmailConfigured()) {
          emailStatus = "skipped";
          emailDetail = "未設定信箱機制（RESEND_API_KEY／EMAIL_FROM），請改用下方連結傳給對方";
        } else {
          const emailUrl = `${absoluteBaseUrl()}/invite/${token}`;
          const { subject, text, html } = buildInviteEmail(team.name, emailUrl, ctx.auth.user.name);
          const result = await sendEmail({ to: email, subject, text, html });
          emailStatus = result.status;
          emailDetail = result.detail;
        }
      }

      return { inviteUrl, attached: false, message: null as string | null, expiresInHours: 72, emailStatus, emailDetail };
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

  /** 重設成員密碼：伺服器自產臨時密碼、砍掉全部 session 強制重登。臨時密碼只在這次回應出現、不落資料庫與 log */
  resetMemberPassword: adminProcedure.input(z.object({ userId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, input.userId));
    if (!ctx.auth.user.isSuperAdmin) {
      // 權限階梯：開發者可重設任何人；團隊管理員只能重設「自己管的團隊」裡的一般成員。
      // 所有拒絕情況（不存在/開發者/他團管理員/不在範圍）共用同一句訊息——
      // 不同文案會讓人拿任意 UUID 連打探出「這個 id 是不是開發者/管理員」，細分原因只進伺服器 log
      const deny = (reason: string): never => {
        console.warn(`[audit] resetMemberPassword 拒絕：caller=${ctx.auth.user.id} target=${input.userId} reason=${reason}`);
        throw new TRPCError({ code: "FORBIDDEN", message: "這位成員的密碼無法由你重設——請聯絡超級管理員" });
      };
      if (!target) deny("target 不存在");
      if (target.isSuperAdmin) deny("target 是開發者");
      const targetTeamRows = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, target.id));
      if (target.id !== ctx.auth.user.id && targetTeamRows.some((r) => r.role === "admin")) deny("target 是團隊管理員");
      // 管理範圍：目標直接在我管的團隊（team_members），或掛在該團隊任一組（group_members）
      let inScope = targetTeamRows.some((r) => ctx.auth.adminTeamIds.includes(r.teamId));
      if (!inScope) {
        const targetGroupRows = await db.select().from(schema.groupMembers).where(eq(schema.groupMembers.userId, target.id));
        if (targetGroupRows.length > 0) {
          const targetGroups = await db
            .select()
            .from(schema.groups)
            .where(inArray(schema.groups.id, targetGroupRows.map((r) => r.groupId)));
          inScope = targetGroups.some((g) => ctx.auth.adminTeamIds.includes(g.teamId));
        }
      }
      if (!inScope) deny("target 不在管理範圍");
    }
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這位成員" });
    // 稽核：誰在什麼時候重設了誰（臨時密碼本身不落 log）
    console.log(`[audit] resetMemberPassword：caller=${ctx.auth.user.id} target=${target.id}`);
    const tempPassword = generateTempPassword();
    // mustChangePassword：臨時密碼登入後前端強制改密碼，auth.changePassword 成功時清回 false
    await db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(tempPassword), mustChangePassword: true })
      .where(eq(schema.users.id, target.id));
    // 全 session 作廢：舊登入立刻失效，只有拿到臨時密碼的本人能重新登入
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, target.id));
    return { tempPassword };
  }),
});
