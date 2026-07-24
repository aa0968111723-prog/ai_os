/**
 * 種子資料（冪等）：開發者帳號＋兩個團隊＋三個組（對應基金會現實）。
 * 開發者密碼由 SEED_ADMIN_PASSWORD 指定；未設則自動產生一次性密碼（不印明文於 log）。
 * 既有開發者帳號的密碼永不被開機流程覆寫（UI 改過的密碼不會被 redeploy 還原）。
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { hashPassword } from "./auth";

/** 總管理員 email（環境變數可覆蓋）。密碼「不再」有硬編碼預設——見下方說明。 */
export const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "aa0968111723@gmail.com";
/**
 * 開發者密碼一律來自環境變數 SEED_ADMIN_PASSWORD，原始碼不再內嵌任何密碼字串
 * （舊版把密碼 commit 進 repo，任何讀原始碼者都能登入，且每次部署會把 DB 密碼
 *  重設回那個公開字串——安全大洞，已移除）。
 */
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

/**
 * 開機時確保開發者帳號存在且具權限——但「絕不」每輪還原密碼。
 * - 帳號不存在：用 SEED_ADMIN_PASSWORD（未設則隨機一次性密碼）建立。
 * - 帳號已存在：只補正 isSuperAdmin=true、status=active，「絕不」覆寫 passwordHash——
 *   開發者在 UI 改過的密碼不可被任何 redeploy 還原（舊版每輪把密碼對齊環境變數，等於
 *   任何能改環境變數者都能強制還原開發者密碼，且會抹掉使用者自訂密碼——已移除此行為）。
 */
async function ensureSeedAdmin(): Promise<void> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, SEED_ADMIN_EMAIL));
  if (!user) {
    // DB 已有其他使用者但無開發者：補建。密碼取環境變數，未設則隨機（不印明文，見下）。
    const password = SEED_ADMIN_PASSWORD || randomBytes(9).toString("base64url");
    await db.insert(schema.users).values({
      name: "Bruce（開發者）",
      email: SEED_ADMIN_EMAIL,
      passwordHash: await hashPassword(password),
      isSuperAdmin: true,
    });
    console.log(`[seed] 已補建開發者帳號：${SEED_ADMIN_EMAIL}（一次性密碼請洽安全通道取得，不印於 log）`);
    return;
  }
  // 已存在：只補正權限與狀態，永不動密碼
  if (!user.isSuperAdmin || user.status !== "active") {
    await db
      .update(schema.users)
      .set({ isSuperAdmin: true, status: "active" })
      .where(eq(schema.users.id, user.id));
    console.log(`[seed] 已補正開發者權限／狀態（未變更密碼）：${SEED_ADMIN_EMAIL}`);
  }
  // 一次性正名：舊種子把帳號名建成「Bruce（超管）」，改名後這個 DB 值不會被覆寫（seed 不動既有名稱），
  // 導致頂欄仍顯示「超管」。只在名稱仍是舊種子預設值時就地更名，使用者自訂過的名字不動。
  if (user.name === "Bruce（超管）") {
    await db.update(schema.users).set({ name: "Bruce（開發者）" }).where(eq(schema.users.id, user.id));
    console.log(`[seed] 已將開發者帳號顯示名稱由「Bruce（超管）」更名為「Bruce（開發者）」`);
  }
}

export async function ensureSeed(): Promise<void> {
  const existing = await db.select().from(schema.users).limit(1);
  if (existing.length > 0) return ensureSeedAdmin();

  // 首次啟動（空庫）：有設 SEED_ADMIN_PASSWORD 就用它，否則隨機產生並「只印一次」在啟動 log。
  const password = SEED_ADMIN_PASSWORD || randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(password); // bcrypt 較慢，放交易外縮短交易持鎖時間
  // 五段 insert 包成單一交易（全有或全無）：若只寫入 users 就中斷，下次啟動 existing.length>0
  // 會直接走 ensureSeedAdmin，團隊/組永遠不補建（invites.teamId 必填 → 開發者連邀請都發不出）。
  await db.transaction(async (tx) => {
    const [admin] = await tx
      .insert(schema.users)
      .values({ name: "Bruce（開發者）", email: SEED_ADMIN_EMAIL, passwordHash, isSuperAdmin: true })
      .returning();

    const [hq] = await tx.insert(schema.teams).values({ name: "總會小編團隊" }).returning();
    const [north] = await tx.insert(schema.teams).values({ name: "北區工作組" }).returning();
    await tx.insert(schema.groups).values([
      { teamId: north.id, name: "剪輯組" },
      { teamId: hq.id, name: "動畫組" },
      { teamId: hq.id, name: "短影音組" },
    ]);
    await tx.insert(schema.teamMembers).values([
      { teamId: hq.id, userId: admin.id, role: "admin" },
      { teamId: north.id, userId: admin.id, role: "admin" },
    ]);
  });

  console.log("──────────────────────────────────────────");
  console.log("[seed] 已建立：總會小編團隊（動畫組・短影音組）＋北區工作組（剪輯組）");
  console.log(`[seed] 開發者登入 email：${SEED_ADMIN_EMAIL}`);
  // 安全：密碼一律不印入 log（部署 log 常被多方存取）。
  if (process.env.SEED_ADMIN_PASSWORD) {
    console.log("[seed] 開發者密碼＝環境變數 SEED_ADMIN_PASSWORD 設定值（不印於 log）");
  } else {
    console.log("[seed] 已產生一次性隨機開發者密碼——請洽安全通道取得，並於首次登入後立即更改（不印於 log）");
  }
  console.log("──────────────────────────────────────────");
}
