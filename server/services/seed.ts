/**
 * 種子資料（冪等）：超管帳號＋兩個團隊＋三個組（對應基金會現實）。
 * 超管密碼由 SEED_ADMIN_PASSWORD 指定；未設則自動產生並印在啟動 log（只印一次）。
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { hashPassword, verifyPassword } from "./auth";

/** 總管理員 email（環境變數可覆蓋）。密碼「不再」有硬編碼預設——見下方說明。 */
export const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "aa0968111723@gmail.com";
/**
 * 超管密碼一律來自環境變數 SEED_ADMIN_PASSWORD，原始碼不再內嵌任何密碼字串
 * （舊版把密碼 commit 進 repo，任何讀原始碼者都能登入，且每次部署會把 DB 密碼
 *  重設回那個公開字串——安全大洞，已移除）。
 */
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

/**
 * 超管自救路徑：僅在有設 SEED_ADMIN_PASSWORD 時啟用——保證該組帳密可登入且為超管
 * （忘記密碼＝設環境變數→Redeploy，不用碰資料庫）。未設環境變數時「不」動任何既有帳號，
 * 也絕不用公開字串重設密碼。
 */
async function ensureSeedAdmin(): Promise<void> {
  const password = SEED_ADMIN_PASSWORD;
  if (!password) return; // 未設密碼變數 → 不對既有超管做任何事（避免把密碼降級回公開值）
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

  // 首次啟動（空庫）：有設 SEED_ADMIN_PASSWORD 就用它，否則隨機產生並「只印一次」在啟動 log。
  const password = SEED_ADMIN_PASSWORD || randomBytes(9).toString("base64url");
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
  if (!process.env.SEED_ADMIN_PASSWORD) console.log("[seed] ↑ 此為隨機產生的一次性密碼（原始碼已無內建密碼）——請立刻記下，或設 SEED_ADMIN_PASSWORD 環境變數改用固定密碼");
  console.log("──────────────────────────────────────────");
}
