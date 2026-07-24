/**
 * Web Push 跨裝置通知核心（手機＋電腦）：伺服器事件推到使用者「所有已連結裝置」，
 * 關頁、關瀏覽器也收得到——補齊既有頁內桌面通知（GenerationList/WorkflowCard/AgentCard/
 * MessagePanel）「分頁開著才有效」的缺口。呼叫端一律 fire-and-forget：推播失敗絕不擋主流程。
 *
 * 設計沿襲全站「未設定＝優雅降級、絕不炸」原則（比照 email.ts）：
 * - VAPID 金鑰：優先吃 VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY 環境變數；未設則開機首用時
 *   自動生成並存 DB（web_push_vapid 單列）——金鑰必須跨重啟穩定，換鑰＝所有既有訂閱作廢。
 * - 失效訂閱自清：推送回 404/410（裝置已解除訂閱/瀏覽器已回收）即刪列，不留殭屍裝置。
 */
import webpush from "web-push";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "../db";

/** 單一使用者可連結的裝置上限：超過即淘汰 lastSeenAt 最舊的列（防無限長訂閱列） */
export const MAX_DEVICES_PER_USER = 10;

/** 推送 payload（sw.js 依此顯示通知並在點擊時導頁） */
export interface PushPayload {
  title: string;
  body: string;
  /** 點通知後開啟的站內路徑（如 /p/xxx、/chat）；缺省開首頁 */
  url?: string;
  /** 同 tag 的通知會互相取代（如同一專案的待辦彙總），避免洗版 */
  tag?: string;
}

/** VAPID sub 主張（推送服務要求 mailto: 或 https:）；可用 VAPID_SUBJECT 覆寫 */
function vapidSubject(): string {
  const fromEnv = process.env.VAPID_SUBJECT?.trim();
  if (fromEnv) return fromEnv;
  // EMAIL_FROM 形如 "AI Director OS <noreply@example.com>"——抽出位址作 mailto
  const emailFrom = process.env.EMAIL_FROM?.trim();
  const m = emailFrom?.match(/<([^>]+)>/) ?? (emailFrom && /^\S+@\S+\.\S+$/.test(emailFrom) ? [emailFrom, emailFrom] : null);
  if (m?.[1]) return `mailto:${m[1]}`;
  return "mailto:admin@example.com";
}

let cachedKeys: { publicKey: string; privateKey: string } | null = null;

/**
 * 取得（或首次生成）VAPID 金鑰對。多實例併發開機安全：都生成 → insert onConflictDoNothing →
 * 一律以「重讀 DB 那列」為準，先到者贏、後到者棄用自己生成的那對。
 * DB 不可用時拋錯——呼叫端（router query／推送）自行降級。
 */
export async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (cachedKeys) return cachedKeys;
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) {
    cachedKeys = { publicKey: envPub, privateKey: envPriv };
    return cachedKeys;
  }
  const [existing] = await db.select().from(schema.webPushVapid).where(eq(schema.webPushVapid.key, "vapid"));
  if (existing) {
    cachedKeys = { publicKey: existing.publicKey, privateKey: existing.privateKey };
    return cachedKeys;
  }
  const generated = webpush.generateVAPIDKeys();
  await db
    .insert(schema.webPushVapid)
    .values({ key: "vapid", publicKey: generated.publicKey, privateKey: generated.privateKey })
    .onConflictDoNothing();
  const [row] = await db.select().from(schema.webPushVapid).where(eq(schema.webPushVapid.key, "vapid"));
  cachedKeys = row ? { publicKey: row.publicKey, privateKey: row.privateKey } : generated;
  return cachedKeys;
}

/**
 * 推播給多位使用者的「所有已連結裝置」。永不拋例外；回傳嘗試/成功數供測試通知顯示。
 * 404/410（訂閱已失效）→ 刪列自清；其他錯誤（推送服務抖動）→ 留列下次再試，僅記 log。
 */
export async function pushToUsers(userIds: string[], payload: PushPayload): Promise<{ attempted: number; delivered: number }> {
  const targets = [...new Set(userIds)].filter(Boolean);
  if (targets.length === 0) return { attempted: 0, delivered: 0 };
  try {
    const subs = await db
      .select()
      .from(schema.pushSubscriptions)
      .where(inArray(schema.pushSubscriptions.userId, targets));
    if (subs.length === 0) return { attempted: 0, delivered: 0 };
    const keys = await getVapidKeys();
    const body = JSON.stringify(payload satisfies PushPayload);
    let delivered = 0;
    // 逐裝置送（量小：人數 × 裝置數）；單裝置失敗不影響其他裝置
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 24 * 60 * 60, vapidDetails: { subject: vapidSubject(), publicKey: keys.publicKey, privateKey: keys.privateKey } },
          );
          delivered++;
        } catch (err) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            // 裝置已解除訂閱／瀏覽器回收了 endpoint——自清，設定頁不再列殭屍裝置
            await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id)).catch(() => {});
          } else if (status === 401 || status === 403) {
            // VAPID 不匹配（多半是換過金鑰的舊訂閱）：不刪列——裝置下次開 App 的例行同步會以新金鑰
            // 換訂並就地改寫這一列；一時的金鑰設錯若在這裡刪列會把可自癒的訂閱整批清光
            console.warn(`[push] 推送被拒（status=${status}，疑為舊金鑰訂閱）——待該裝置下次開 App 由例行同步換訂`);
          } else {
            console.warn(`[push] 推送失敗（保留訂閱下次再試）：status=${status ?? "?"}`, err instanceof Error ? err.message : err);
          }
        }
      }),
    );
    return { attempted: subs.length, delivered };
  } catch (err) {
    // DB 讀不到／金鑰取不到等：推播是附加訊號，靜默降級
    console.warn("[push] 推播略過：", err instanceof Error ? err.message : err);
    return { attempted: 0, delivered: 0 };
  }
}

/**
 * 組長（含）以上的成員 id（審批/待核事件的收件人）；可排除觸發者本人（自己不用通知自己）。
 * 與 requireLeader 的裁決權對齊：組長列（group_members role='leader'）＋該組所屬團隊的管理員
 * （team_members role='admin'——auth 對他們合成 'admin' 角色，同樣有裁決權；沒有組長的組
 * 常態上正是由團隊管理員看著，漏掉他們＝待審事件推給空集合）。開發者（isSuperAdmin）刻意
 * 不列入：他們對全站每個組都有權，逐組推播只會洗版。
 */
export async function groupLeaderIds(groupId: string, excludeUserId?: string): Promise<string[]> {
  const [leaders, admins] = await Promise.all([
    db
      .select({ userId: schema.groupMembers.userId })
      .from(schema.groupMembers)
      .where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.role, "leader"))),
    db
      .select({ userId: schema.teamMembers.userId })
      .from(schema.teamMembers)
      .innerJoin(schema.groups, eq(schema.groups.teamId, schema.teamMembers.teamId))
      .where(and(eq(schema.groups.id, groupId), eq(schema.teamMembers.role, "admin"))),
  ]);
  return [...new Set([...leaders, ...admins].map((r) => r.userId))].filter((id) => id !== excludeUserId);
}

/**
 * 某人現在是否仍看得到這個組（組員 or 該團隊管理員 or 開發者）：
 * 推播「存好的 userId」（如裁決通知提交人）前用這個把關——被移出組的前成員
 * 不該再收到組內內容（退回理由等），與 App 內的可見界一致。
 */
export async function canAccessGroup(groupId: string, userId: string): Promise<boolean> {
  const [member] = await db
    .select({ id: schema.groupMembers.id })
    .from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, userId)))
    .limit(1);
  if (member) return true;
  const [admin] = await db
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .innerJoin(schema.groups, eq(schema.groups.teamId, schema.teamMembers.teamId))
    .where(and(eq(schema.groups.id, groupId), eq(schema.teamMembers.userId, userId), eq(schema.teamMembers.role, "admin")))
    .limit(1);
  if (admin) return true;
  const [su] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.isSuperAdmin, true)))
    .limit(1);
  return !!su;
}

/**
 * upsert 一筆裝置訂閱（同 endpoint 重複啟用＝更新不長列；換帳號登入同裝置＝訂閱歸新帳號），
 * 並淘汰該使用者 lastSeenAt 最舊、超出上限的裝置列。
 */
export async function saveSubscription(input: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  label?: string;
}): Promise<void> {
  await db
    .insert(schema.pushSubscriptions)
    .values({
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      label: input.label ?? null,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: { userId: input.userId, p256dh: input.p256dh, auth: input.auth, label: input.label ?? null, lastSeenAt: new Date() },
    });
  // 超額淘汰：保留 lastSeenAt 最新的 MAX_DEVICES_PER_USER 筆
  const keep = db
    .select({ id: schema.pushSubscriptions.id })
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, input.userId))
    .orderBy(sql`${schema.pushSubscriptions.lastSeenAt} desc`)
    .limit(MAX_DEVICES_PER_USER);
  await db
    .delete(schema.pushSubscriptions)
    .where(and(eq(schema.pushSubscriptions.userId, input.userId), notInArray(schema.pushSubscriptions.id, keep)));
}

/**
 * 例行同步（App 每次載入回報）：與 saveSubscription 的關鍵差別是「只更新、不新增」——
 * 使用者在設定頁移除過的裝置，不能因為那台裝置下次開 App 又被例行同步偷偷復活；
 * 重新連結必須回到設定頁明確按「啟用」（走 saveSubscription）。
 * oldEndpoint＝金鑰輪替後瀏覽器換發了新訂閱：把「舊 endpoint 那一列」就地改寫成新訂閱
 * （保留 label／建立時間），殭屍舊列因此自癒；舊列已被移除時同樣不復活。
 */
export async function syncSubscription(input: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  label?: string;
  oldEndpoint?: string;
}): Promise<void> {
  const updated = await db
    .update(schema.pushSubscriptions)
    .set({
      userId: input.userId, // 同裝置換帳號登入：訂閱歸屬跟著現在的使用者走（與 saveSubscription 同語意）
      p256dh: input.p256dh,
      auth: input.auth,
      ...(input.label ? { label: input.label } : {}),
      lastSeenAt: new Date(),
    })
    .where(eq(schema.pushSubscriptions.endpoint, input.endpoint))
    .returning({ id: schema.pushSubscriptions.id });
  if (updated.length || !input.oldEndpoint || input.oldEndpoint === input.endpoint) return;
  // 換訂路徑：新 endpoint 沒有列 → 找舊 endpoint 的列（限本人，不奪他人訂閱）就地改寫
  await db
    .update(schema.pushSubscriptions)
    .set({ endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, lastSeenAt: new Date() })
    .where(and(eq(schema.pushSubscriptions.endpoint, input.oldEndpoint), eq(schema.pushSubscriptions.userId, input.userId)));
}
