/**
 * 開發模式假身分（定案：登入系統最後做）。
 * 啟動時確保有一個預設組（剪輯組）與測試帳號（總管理），冪等。
 */
import { db, schema } from "../db";

export interface DevUser {
  id: string;
  name: string;
  role: "admin" | "leader" | "member";
  groupId: string;
}

let cached: DevUser | null = null;

export async function ensureSeed(): Promise<void> {
  const existingGroups = await db.select().from(schema.groups).limit(1);
  if (existingGroups.length > 0) return;
  const [group] = await db.insert(schema.groups).values({ name: "剪輯組" }).returning();
  const [user] = await db.insert(schema.profiles).values({ name: "測試帳號" }).returning();
  await db.insert(schema.groupMembers).values({ groupId: group.id, userId: user.id, role: "admin" });
  console.log("[seed] 建立預設組「剪輯組」與測試帳號");
}

export async function getDevUser(): Promise<DevUser> {
  if (cached) return cached;
  await ensureSeed();
  const [member] = await db.select().from(schema.groupMembers).limit(1);
  const [profile] = await db.select().from(schema.profiles).limit(1);
  cached = { id: profile.id, name: profile.name, role: member.role, groupId: member.groupId };
  return cached;
}
