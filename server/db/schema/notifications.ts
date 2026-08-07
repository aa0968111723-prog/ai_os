/**
 * 站內收件匣（notifications）。
 *
 * 這張表的存在理由只有一句：**推播是加速通道，收件匣才是真相。**
 *
 * 在此之前，「你被 @ 到了」只走 Web Push，而那條路上每一環都可能靜默丟掉訊息——
 * 沒訂閱裝置（services/webPush 直接 return {0,0}）、推送服務抖動（只印一行 warn，
 * 沒有任何佇列會再試）、裝置離線超過 TTL 24 小時（推送服務自行丟棄）。
 * 於是「被指出哪一格要改」這件事，對沒開通知的夥伴等同沒發生過。
 *
 * 改法是把順序倒過來：`services/notify.ts` 先 await 落列、再 fire-and-forget 推播。
 * 推播失敗只影響「多快知道」，不影響「會不會知道」。
 */
import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 收件人 */
  userId: uuid("user_id").notNull(),
  /**
   * 必填，而且刻意不可為 null——這是 audit_log 的教訓：那裡的 group_id 取自 rawInput，
   * 而 scenes 的 mutation input 只有 sceneId/projectId，一律寫成 NULL；查詢端對非開發者
   * 強制 `inArray(groupId, visibleGroupIds)`，NULL 永不命中，整批改動在操作紀錄裡看不見。
   */
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  sceneId: uuid("scene_id"),
  /**
   * 通知種類。純 text 欄、無 DB CHECK：新增一種不需要 migration
   * （沿用 messages.kind／voice_status 的既有慣例）。
   * 目前：annotation｜annotation_resolved｜mention｜reply｜generation_done
   *      ｜generation_pending_approval｜schedule_mention
   */
  kind: text("kind").notNull(),
  /** 觸發者（誰 @ 的、誰標注的）；系統事件為 null */
  actorId: uuid("actor_id"),
  refType: text("ref_type"),
  refId: uuid("ref_id"),
  messageId: uuid("message_id"),
  /** 寫入時就算好，收件匣列表不必回查十張表 */
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** 站內路徑；與推播 payload 的 url 是同一個字串——點鈴鐺與點推播落到同一個地方 */
  url: text("url").notNull(),
  /**
   * 冪等鍵（形狀照抄 agent_events 的 run/event 唯一鍵）。寫入一律 onConflictDoNothing。
   * **必須帶階段**：`mention:<messageId>:posted` 與 `mention:<messageId>:transcribed`
   * 是兩件事——語音留言的逐字稿回填時要補一則通知，粒度取太粗會被自己的冪等吃掉。
   */
  eventKey: text("event_key").notNull(),
  /**
   * 推播結果，回寫用：pending｜delivered｜no_device｜failed｜error。
   * 分得出 no_device（這個人沒有任何裝置）與 error（DB 讀不到／VAPID 取不到）是刻意的——
   * 這是第一次讓「某則 @ 從來沒送達」在系統裡看得出來，而不是只在 log 裡閃過。
   */
  pushState: text("push_state").notNull().default("pending"),
  /**
   * 已讀水位是 **per-row**，而且只在使用者真的點了那一則才推進。
   * 刻意不做 MessagePanel 那種「一進頁就把整個專案推平」——那會讓徽章在人看到之前歸零。
   *
   * 與標注的 `messages.resolved_at` 是兩個欄位、兩個生命週期：一則純 @ 留言永遠不會被
   * resolve，若收件匣拿 resolved_at is null 當篩選條件，鈴鐺就永遠不會歸零。
   */
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  eventKeyUq: uniqueIndex("notifications_event_key_uq").on(t.userId, t.eventKey),
  // 未讀計數是每次開頁都要算的東西，不該掃全表；partial index 納入 schema 單一真相，
  // 才不會與 migration 對不上而被 drift gate 判成漂移（比照 generations_active_idx）。
  userUnreadIdx: index("notifications_user_unread_idx")
    .on(t.userId, t.createdAt)
    .where(sql`${t.readAt} is null`),
  userCreatedIdx: index("notifications_user_created_idx").on(t.userId, t.createdAt),
}));
