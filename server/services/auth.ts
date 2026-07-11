/**
 * 認證核心：bcrypt 密碼、session cookie、邀請制、登入防爆破。
 * 設計依據：docs/auth-design.md（任務卡 #002）
 */
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Request, Response } from "express";
import { db, schema } from "../db";

const SESSION_DAYS = 30;
const COOKIE_NAME = "aidos_session";

/* ── 密碼 ── */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/* ── 登入防爆破：同帳號 15 分鐘 5 次 ── */
const attempts = new Map<string, { count: number; resetAt: number }>();
export function checkLoginRate(email: string): boolean {
  const now = Date.now();
  const entry = attempts.get(email);
  if (!entry || now > entry.resetAt) {
    attempts.set(email, { count: 1, resetAt: now + 15 * 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 5;
}
export function clearLoginRate(email: string): void {
  attempts.delete(email);
}

/* ── Session ── */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ tokenHash: sha256(token), userId, expiresAt });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function setSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

export function getSessionToken(req: Request): string | undefined {
  return parseCookies(req)[COOKIE_NAME];
}

/* ── 目前使用者＋成員關係（每請求重查 → 移出即失效） ── */
export interface AuthState {
  user: { id: string; name: string; email: string; isSuperAdmin: boolean };
  /** 可用組（含角色）：直接組員＋團隊管理展開＋超管展開全部 */
  groups: Array<{ groupId: string; groupName: string; teamId: string; teamName: string; role: "admin" | "leader" | "member" }>;
  /** 有團隊管理權的團隊 id */
  adminTeamIds: string[];
}

export async function loadAuthState(userId: string): Promise<AuthState | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || user.status !== "active") return null;

  const allTeams = await db.select().from(schema.teams);
  const allGroups = await db.select().from(schema.groups);
  const teamName = (id: string) => allTeams.find((t) => t.id === id)?.name ?? "";

  const teamRows = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId));
  const adminTeamIds = user.isSuperAdmin ? allTeams.map((t) => t.id) : teamRows.filter((r) => r.role === "admin").map((r) => r.teamId);

  const groupRows = await db.select().from(schema.groupMembers).where(eq(schema.groupMembers.userId, userId));
  const map = new Map<string, AuthState["groups"][number]>();

  // 直接組員身分
  for (const row of groupRows) {
    const group = allGroups.find((g) => g.id === row.groupId);
    if (!group) continue;
    map.set(group.id, { groupId: group.id, groupName: group.name, teamId: group.teamId, teamName: teamName(group.teamId), role: row.role });
  }
  // 團隊管理（含超管）→ 該團隊所有組以 admin 身分展開
  for (const group of allGroups) {
    if (adminTeamIds.includes(group.teamId)) {
      map.set(group.id, { groupId: group.id, groupName: group.name, teamId: group.teamId, teamName: teamName(group.teamId), role: "admin" });
    }
  }

  return {
    user: { id: user.id, name: user.name, email: user.email, isSuperAdmin: user.isSuperAdmin },
    groups: [...map.values()],
    adminTeamIds,
  };
}

export async function resolveSession(req: Request): Promise<AuthState | null> {
  const token = getSessionToken(req);
  if (!token) return null;
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())));
  if (!session) return null;
  return loadAuthState(session.userId);
}

/* ── 邀請 ── */
export async function createInvite(input: {
  email: string;
  teamId: string;
  teamRole: "admin" | "member";
  groupId?: string;
  groupRole: "leader" | "member";
  invitedBy: string;
}): Promise<{ token: string }> {
  const token = randomBytes(24).toString("hex");
  await db.insert(schema.invites).values({
    email: input.email.toLowerCase().trim(),
    teamId: input.teamId,
    teamRole: input.teamRole,
    groupId: input.groupId,
    groupRole: input.groupRole,
    token,
    invitedBy: input.invitedBy,
    expiresAt: new Date(Date.now() + 72 * 3_600_000), // 72 小時
  });
  return { token };
}

export async function acceptInvite(token: string, name: string, password: string): Promise<{ userId: string }> {
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.token, token), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())));
  if (!invite) throw new Error("邀請連結無效或已過期");

  // 同 email 已有帳號 → 附掛，不重複建
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email));
  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const [user] = await db
      .insert(schema.users)
      .values({ name, email: invite.email, passwordHash: await hashPassword(password) })
      .returning();
    userId = user.id;
  }

  const existingTeam = await db
    .select()
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, invite.teamId), eq(schema.teamMembers.userId, userId)));
  if (existingTeam.length === 0) {
    await db.insert(schema.teamMembers).values({ teamId: invite.teamId, userId, role: invite.teamRole });
  }
  if (invite.groupId) {
    const existingGroup = await db
      .select()
      .from(schema.groupMembers)
      .where(and(eq(schema.groupMembers.groupId, invite.groupId), eq(schema.groupMembers.userId, userId)));
    if (existingGroup.length === 0) {
      await db.insert(schema.groupMembers).values({ groupId: invite.groupId, userId, role: invite.groupRole });
    }
  }
  await db.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, invite.id));
  return { userId };
}
