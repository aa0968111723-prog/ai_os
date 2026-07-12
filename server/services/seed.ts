/**
 * 種子資料（冪等）：超管帳號＋兩個團隊＋三個組（對應基金會現實）。
 * 超管密碼由 SEED_ADMIN_PASSWORD 指定；未設則自動產生並印在啟動 log（只印一次）。
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { hashPassword, verifyPassword } from "./auth";

/** 總管理員預設帳密(Bruce 指定;環境變數可覆蓋——上線穩定後請改用變數並更換密碼) */
export const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "aa0968111723@gmail.com";
export const SEED_ADMIN_PASSWORD_DEFAULT = process.env.SEED_ADMIN_PASSWORD ?? "aA@882992";

/**
 * 超管自救路徑：SEED_ADMIN_EMAIL＋SEED_ADMIN_PASSWORD 都有設時，即使資料庫已有資料，
 * 也保證這組帳密可登入且是超管——忘記密碼＝改環境變數→Redeploy，完全不用碰資料庫。
 */
async function ensureSeedAdmin(): Promise<void> {
  const password = SEED_ADMIN_PASSWORD_DEFAULT;
  if (!password) return;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, SEED_ADMIN_EMAIL));
  if (!user) {
    await db.insert(schema.users).values({
      name: "Bruce（超管）",
      email: SEED_ADMIN_EMAIL,
      passwordHash: await hashPassword(password),
      isSuperAdmin: true,
    });
    console.log(`[seed] 已依環境變數補建超管帳號：${SEED_ADMIN_EMAIL}`);
    return;
  }
  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk || !user.isSuperAdmin || user.status !== "active") {
    await db
      .update(schema.users)
      .set({
        passwordHash: passwordOk ? user.passwordHash : await hashPassword(password),
        isSuperAdmin: true,
        status: "active",
      })
      .where(eq(schema.users.id, user.id));
    console.log(`[seed] 已把超管帳號對齊環境變數（密碼／權限重設）：${SEED_ADMIN_EMAIL}`);
  }
}

export async function ensureSeed(): Promise<void> {
  const existing = await db.select().from(schema.users).limit(1);
  if (existing.length > 0) return ensureSeedAdmin();

  const password = SEED_ADMIN_PASSWORD_DEFAULT || randomBytes(6).toString("hex");
  const [admin] = await db
    .insert(schema.users)
    .values({ name: "Bruce（超管）", email: SEED_ADMIN_EMAIL, passwordHash: await hashPassword(password), isSuperAdmin: true })
    .returning();

  const [hq] = await db.insert(schema.teams).values({ name: "總會小編團隊" }).returning();
  const [north] = await db.insert(schema.teams).values({ name: "北區工作組" }).returning();
  await db.insert(schema.groups).values([
    { teamId: north.id, name: "剪輯組" },
    { teamId: hq.id, name: "動畫組" },
    { teamId: hq.id, name: "短影音組" },
  ]);
  await db.insert(schema.teamMembers).values([
    { teamId: hq.id, userId: admin.id, role: "admin" },
    { teamId: north.id, userId: admin.id, role: "admin" },
  ]);

  console.log("──────────────────────────────────────────");
  console.log("[seed] 已建立：總會小編團隊（動畫組・短影音組）＋北區工作組（剪輯組）");
  console.log(`[seed] 超管登入 → email: ${SEED_ADMIN_EMAIL}  密碼: ${password}`);
  if (!process.env.SEED_ADMIN_PASSWORD) console.log("[seed] ↑ 使用內建預設帳密——上線穩定後請設 SEED_ADMIN_PASSWORD 環境變數更換");
  console.log("──────────────────────────────────────────");
}
