import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../trpc";
import { db, schema } from "../db";
import { createInvite, attachExistingUser, hashPassword } from "../services/auth";
import { revokeAllUserMcpTokens } from "../services/mcpAuth";
import { sendEmail, isEmailConfigured, type EmailStatus } from "../services/email";
import { groupUsage } from "../services/points";
import { canRunCommand, resolveCommandLevel } from "../../shared/groupAgent";

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

/**
 * 資料庫清單附細節（groupDetail / teamDetail 共用）：列數、文件數、建立者名字。
 * 只給團隊管理員以上的「管理視角」用——個人（personal）範圍永不經過這裡（私人空間，開發者也看不到）。
 */
async function describeTables(tables: Array<typeof schema.dataTables.$inferSelect>) {
  if (tables.length === 0) return [];
  const tableIds = tables.map((t) => t.id);
  const creatorIds = [...new Set(tables.map((t) => t.createdBy))];
  const [rowCounts, fileCounts, creators] = await Promise.all([
    db
      .select({ tableId: schema.dataRows.tableId, n: sql<number>`count(*)` })
      .from(schema.dataRows)
      .where(inArray(schema.dataRows.tableId, tableIds))
      .groupBy(schema.dataRows.tableId),
    db
      .select({ tableId: schema.dataFiles.tableId, n: sql<number>`count(*)` })
      .from(schema.dataFiles)
      .where(inArray(schema.dataFiles.tableId, tableIds))
      .groupBy(schema.dataFiles.tableId),
    db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.id, creatorIds)),
  ]);
  const rowsBy = new Map(rowCounts.map((c) => [c.tableId, Number(c.n)]));
  const filesBy = new Map(fileCounts.map((c) => [c.tableId, Number(c.n)]));
  const nameBy = new Map(creators.map((u) => [u.id, u.name]));
  return tables.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    rowCount: rowsBy.get(t.id) ?? 0,
    fileCount: filesBy.get(t.id) ?? 0,
    fieldCount: Array.isArray(t.fields) ? (t.fields as unknown[]).length : 0,
    memberWritable: t.memberWritable,
    agentAccess: t.agentAccess,
    creatorName: nameBy.get(t.createdBy) ?? "（已離開的成員）",
    updatedAt: t.updatedAt,
  }));
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

  /**
   * 組詳情（團隊管理細節補齊）：這一組的組長組員完整資料（Email/點數/額度/派工/最近登入）、
   * 專案清單（含「專案負責人」）、以及這一組自己的資料庫（組範圍 data_tables）。
   * 權限：開發者或該組所屬團隊的管理員（與 overview 同一把尺）。
   */
  groupDetail: adminProcedure.input(z.object({ groupId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, input.groupId));
    if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個組" });
    assertTeamAdmin(ctx.auth, group.teamId);

    const memberRows = await db
      .select({
        userId: schema.groupMembers.userId,
        role: schema.groupMembers.role,
        weeklyOverride: schema.groupMembers.weeklyPointsOverride,
        budget: schema.groupMembers.budgetPoints,
        canDispatchAgent: schema.groupMembers.canDispatchAgent,
        agentCommandLevel: schema.groupMembers.agentCommandLevel,
        name: schema.users.name,
        email: schema.users.email,
        status: schema.users.status,
        isSuperAdmin: schema.users.isSuperAdmin,
      })
      .from(schema.groupMembers)
      .leftJoin(schema.users, eq(schema.users.id, schema.groupMembers.userId))
      .where(eq(schema.groupMembers.groupId, input.groupId));
    const userIds = memberRows.map((m) => m.userId);

    const [usage, logins, projectRows, tableRows] = await Promise.all([
      groupUsage(input.groupId), // 各成員本週/累計淨消耗（有帳本者；無帳本補 0）
      userIds.length
        ? db
            .select({ userId: schema.sessions.userId, lastLoginAt: sql<string | null>`max(${schema.sessions.createdAt})::text` })
            .from(schema.sessions)
            .where(inArray(schema.sessions.userId, userIds))
            .groupBy(schema.sessions.userId)
        : Promise.resolve([]),
      db
        .select({
          id: schema.projects.id,
          title: schema.projects.title,
          kind: schema.projects.kind,
          platform: schema.projects.platform,
          status: schema.projects.status,
          updatedAt: schema.projects.updatedAt,
          ownerId: schema.projects.ownerId,
          ownerName: schema.users.name,
        })
        .from(schema.projects)
        .leftJoin(schema.users, eq(schema.users.id, schema.projects.ownerId))
        .where(eq(schema.projects.groupId, input.groupId))
        .orderBy(desc(schema.projects.updatedAt)),
      db
        .select()
        .from(schema.dataTables)
        .where(and(eq(schema.dataTables.scope, "group"), eq(schema.dataTables.groupId, input.groupId), isNull(schema.dataTables.deletedAt)))
        .orderBy(desc(schema.dataTables.updatedAt)),
    ]);
    const usageBy = new Map(usage.map((u) => [u.userId, u]));
    const loginBy = new Map(logins.map((l) => [l.userId, l.lastLoginAt]));

    return {
      group: { id: group.id, name: group.name, createdAt: group.createdAt },
      // 組長排前、再組員，同角色按名字——「這一組誰帶、誰在裡面」一眼分明
      members: memberRows
        .map((m) => {
          // 指揮權等級要跟著回傳，設定 UI 的四級選單才選得到現值（只回布林的話，
          // supervise／command 在畫面上一律長得跟 dispatch 一樣，管理員永遠不知道自己給出了什麼）。
          // canDispatch 改由等級推導，與 quota.usage 同一條規則，兩支清單不會各報一個答案。
          const commandLevel = resolveCommandLevel(m.role, m);
          return {
            userId: m.userId,
            name: m.name ?? "?",
            email: m.email ?? "",
            role: m.role,
            isSuperAdmin: m.isSuperAdmin ?? false,
            disabled: m.status === "disabled",
            weekly: usageBy.get(m.userId)?.weekly ?? 0,
            total: usageBy.get(m.userId)?.total ?? 0,
            weeklyOverride: m.weeklyOverride ?? null, // null＝跟組
            budget: m.budget ?? null, // null＝不限（未分配個人預算）
            /** 組代理指揮權等級（組長以上恆為 command，不看欄位） */
            commandLevel,
            canDispatch: canRunCommand(commandLevel, "dispatch"),
            lastLoginAt: loginBy.get(m.userId) ?? null,
          };
        })
        .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name, "zh-Hant") : a.role === "leader" ? -1 : 1)),
      projects: projectRows.map((p) => ({
        id: p.id,
        title: p.title,
        kind: p.kind,
        platform: p.platform,
        status: p.status,
        updatedAt: p.updatedAt,
        owner: { userId: p.ownerId, name: p.ownerName }, // name null＝負責人帳號已不存在
      })),
      databases: await describeTables(tableRows),
    };
  }),

  /**
   * 團隊詳情（團隊管理細節補齊）：團隊層的成員清單（含「已入團但還沒進任何組」的人——
   * 舊版總覽只列管理員，這些人完全隱形）＋團隊範圍的資料庫。
   */
  teamDetail: adminProcedure.input(z.object({ teamId: z.string().uuid() })).query(async ({ ctx, input }) => {
    assertTeamAdmin(ctx.auth, input.teamId);
    const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, input.teamId));
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個團隊" });

    const [memberRows, teamGroups, tableRows] = await Promise.all([
      db
        .select({
          userId: schema.teamMembers.userId,
          role: schema.teamMembers.role,
          name: schema.users.name,
          email: schema.users.email,
          status: schema.users.status,
        })
        .from(schema.teamMembers)
        .leftJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
        .where(eq(schema.teamMembers.teamId, input.teamId)),
      db.select({ id: schema.groups.id }).from(schema.groups).where(eq(schema.groups.teamId, input.teamId)),
      db
        .select()
        .from(schema.dataTables)
        .where(and(eq(schema.dataTables.scope, "team"), eq(schema.dataTables.teamId, input.teamId), isNull(schema.dataTables.deletedAt)))
        .orderBy(desc(schema.dataTables.updatedAt)),
    ]);
    const groupIds = teamGroups.map((g) => g.id);
    const grouped = groupIds.length
      ? await db
          .select({ userId: schema.groupMembers.userId })
          .from(schema.groupMembers)
          .where(inArray(schema.groupMembers.groupId, groupIds))
      : [];
    const inAnyGroup = new Set(grouped.map((r) => r.userId));

    return {
      team: { id: team.id, name: team.name, createdAt: team.createdAt },
      members: memberRows.map((m) => ({
        userId: m.userId,
        name: m.name ?? "?",
        email: m.email ?? "",
        role: m.role, // admin＝團隊管理員
        disabled: m.status === "disabled",
        inAnyGroup: inAnyGroup.has(m.userId), // false＝已入團但未分組（總覽的隱形人）
      })),
      databases: await describeTables(tableRows),
    };
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

  /**
   * 寄測試信給自己：驗證信箱機制（RESEND_API_KEY／EMAIL_FROM）真的能寄出。
   * 管理員改完環境變數後按一下即可確認，不必再走一次邀請流程才發現金鑰壞掉。
   * 一律回 { status, detail }（人話），不拋例外——與 sendEmail 的優雅降級一致。
   */
  sendTestEmail: adminProcedure.mutation(async ({ ctx }) => {
    if (!isEmailConfigured()) {
      return { status: "skipped" as EmailStatus, detail: "尚未設定信箱機制（RESEND_API_KEY／EMAIL_FROM）——設定後再試" };
    }
    return sendEmail({
      to: ctx.auth.user.email,
      subject: "AI Director OS 測試信",
      text: [
        "這是一封測試信，用來確認系統的信箱機制運作正常。",
        "",
        "收到這封信＝設定成功，邀請信與回饋回覆信都能正常寄出。",
        `（由 ${ctx.auth.user.name} 在「團隊管理」頁觸發）`,
      ].join("\n"),
    });
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
      // 管理範圍（修 AUTH2-001 跨團隊接管）：不能只憑「目標在我管的某個團隊」就放行——跨團隊帳號
      // （同時在我管的 T1 與我管不到的 T2）會被舊版 some 放行；重設後伺服器把明文臨時密碼交給我，
      // 等於接管該帳號並取得 T2 的存取。改為 every：目標「全部」團隊/組籍都必須落在我管的團隊內，
      // 只要有一個落在我管不到的團隊/組就 deny（無團隊籍的帳號也不由團隊管理員重設，交給超級管理員）。
      const targetGroupRows = await db.select().from(schema.groupMembers).where(eq(schema.groupMembers.userId, target.id));
      const targetGroupTeamIds = targetGroupRows.length
        ? (
            await db.select().from(schema.groups).where(inArray(schema.groups.id, targetGroupRows.map((r) => r.groupId)))
          ).map((g) => g.teamId)
        : [];
      const targetTeamIds = [...new Set([...targetTeamRows.map((r) => r.teamId), ...targetGroupTeamIds])];
      const adminSet = new Set(ctx.auth.adminTeamIds);
      if (targetTeamIds.length === 0 || !targetTeamIds.every((tid) => adminSet.has(tid))) {
        deny("target 有超出管理範圍的團隊/組籍");
      }
    }
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這位成員" });
    // 稽核：誰在什麼時候重設了誰（臨時密碼本身不落 log）
    console.log(`[audit] resetMemberPassword：caller=${ctx.auth.user.id} target=${target.id}`);
    const tempPassword = generateTempPassword();
    // bcrypt 先在交易外計算；密碼、強制改密碼旗標、session 與 MCP token 必須同一交易輪替。
    // 任一步失敗即全部 rollback，避免留下舊 session/token 仍可用的混合狀態。
    const passwordHash = await hashPassword(tempPassword);
    const revokedTokens = await db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash, mustChangePassword: true })
        .where(eq(schema.users.id, target.id));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, target.id));
      return revokeAllUserMcpTokens(target.id, tx);
    });
    if (revokedTokens > 0) console.log(`[audit] resetMemberPassword 一併撤銷 ${revokedTokens} 把 MCP 金鑰：target=${target.id}`);
    return { tempPassword };
  }),
});
