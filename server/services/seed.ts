/**
 * 種子資料（冪等）：超管帳號＋兩個團隊＋三個組（對應基金會現實）。
 * 超管密碼由 SEED_ADMIN_PASSWORD 指定；未設則自動產生並印在啟動 log（只印一次）。
 */
import { randomBytes } from "node:crypto";
import { db, schema } from "../db";
import { hashPassword } from "./auth";

export const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@aidirector.local";

export async function ensureSeed(): Promise<void> {
  const existing = await db.select().from(schema.users).limit(1);
  if (existing.length > 0) return;

  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(6).toString("hex");
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
  if (!process.env.SEED_ADMIN_PASSWORD) console.log("[seed] ↑ 密碼為隨機產生，只印這一次，請記下（或設 SEED_ADMIN_PASSWORD 固定）");
  console.log("──────────────────────────────────────────");
}
