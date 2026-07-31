/**
 * Integrations domain schema（Google 日曆、外部整合、Web Push）
 */
import { pgTable, uuid, text, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/* ── Web Push 跨裝置通知（push_*）與外部整合 ────────────────────────── */

/**
 * Google 日曆直連同步（OAuth）：每人一條連線。系統在對方 Google 帳戶建立一本專屬日曆
 * （calendar.app.created 最小權限——只能管理自建日曆，碰不到使用者原有日曆），
 * 之後排程的增刪改自動推送，不再需要手動匯出/匯入 .ics。
 * refresh token 以 AES-256-GCM 加密落庫（金鑰見 services/googleCalendar.ts）。
 */
export const googleCalendarConnections = pgTable("google_calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 一人一條連線（重新連結＝覆蓋） */
  userId: uuid("user_id").notNull().unique(),
  /** 連結的 Google 帳號 email（自 id_token 取得，僅供 UI 顯示辨識） */
  googleEmail: text("google_email"),
  /** AES-256-GCM 加密後的 refresh token（iv:tag:cipher，hex） */
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  /** 系統在對方帳戶建立的專屬日曆 id（首次同步時建立） */
  calendarId: text("calendar_id"),
  /** error＝授權失效（例如使用者在 Google 端撤銷），UI 引導重新連結 */
  status: text("status", { enum: ["active", "error"] }).notNull().default("active"),
  lastError: text("last_error"),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * 個人整合連接（每個使用者自己連自己的外部服務）：
 * - google-drive＝Google 雲端硬碟 OAuth（scope 僅 drive.readonly，secretEnc＝refresh token）；
 * - notion＝個人 Notion integration token（使用者在 notion.so/my-integrations 自建）；
 * - api＝外部資料庫/API 連接（Airtable/Supabase/自建服務，secretEnc＝認證標頭值）。
 * secretEnc 一律 AES-256-GCM 加密（iv:tag:cipher hex，金鑰見 services/integrations.ts——與 DB 分離，
 * DB 外洩不可解密）；憑證原文永不回傳前端（meta 只存 email/workspace/末四碼等顯示用資訊）。
 * google-drive/notion 一人一條（name=""）；api 可多條具名連線。新表由正式 migration 建立。
 */
export const userIntegrations = pgTable("user_integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  kind: text("kind", { enum: ["google-drive", "notion", "api"] }).notNull(),
  /** api 連接的顯示名稱（如「總會 Airtable」）；google-drive/notion 固定空字串 */
  name: text("name").notNull().default(""),
  /** AES-256-GCM 加密後的憑證（refresh token／integration token／API 金鑰） */
  secretEnc: text("secret_enc").notNull(),
  /** api 連接的基底網址：抓取時固定同主機，憑證不會被送去別的主機 */
  baseUrl: text("base_url"),
  /** api 連接的認證標頭名（預設 Authorization；值即 secretEnc 解密原文） */
  authHeader: text("auth_header"),
  /** 顯示用中繼資料（非敏感）：google email／notion workspace／金鑰末四碼 */
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  /** error＝授權失效或解密失敗（金鑰輪替），UI 引導重新連結 */
  status: text("status", { enum: ["active", "error"] }).notNull().default("active"),
  lastError: text("last_error"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userKindNameIdx: uniqueIndex("user_integrations_user_kind_name_idx").on(t.userId, t.kind, t.name),
  userIdx: index("user_integrations_user_idx").on(t.userId),
}));

/**
 * 外部帳號連結（#224 PR1）：使用者把「自己的」創作平台帳號接上來，AI 就在該帳號內動作
 * （目前只有 adobe：修圖／剪輯）。與 user_integrations 的差別是這裡存的是 OAuth 雙 token：
 * access token 有效期短、需要用 refresh token 續期，故 expires_at 與兩份密文都要落庫
 * （user_integrations 只存單一長期憑證，塞進去會讓兩種語意混在同一張表）。
 * 兩份 token 皆 AES-256-GCM 加密（iv:tag:cipher hex，金鑰由 services/integrations 的同一顆種子
 * 分域派生 adobe-token:），原文永不回傳前端；meta 只放 email/帳號 id 等顯示用資訊。
 * mode 記下這條連結是 mock 還是 real 模式建立的——切換模式後舊連結不可沿用（憑證語意不同）。
 * 一人一個 provider 一條連結（重新連結＝覆蓋）。新表由正式 migration 建立。
 */
export const externalAccounts = pgTable("external_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  provider: text("provider", { enum: ["adobe"] }).notNull(),
  /** 連結的外部帳號 email（自 userinfo 取得，僅供 UI 顯示辨識） */
  accountEmail: text("account_email"),
  /** 外部帳號的穩定 id（Adobe 為 IMS user id）——email 可變，稽核對照用這個 */
  accountId: text("account_id"),
  /** 加密後的 access token（短效，過期前自動以 refresh token 換新） */
  accessTokenEnc: text("access_token_enc"),
  /** 加密後的 refresh token（長效；沒有它就只能重新走一次授權） */
  refreshTokenEnc: text("refresh_token_enc"),
  /** access token 到期時刻（提前 5 分鐘視為過期，避免臨界點打到 401） */
  expiresAt: timestamp("expires_at"),
  /** 實際取得的授權範圍（空白分隔）——Adobe 可能只給部分，UI 據此顯示可用能力 */
  scope: text("scope"),
  mode: text("mode", { enum: ["mock", "real"] }).notNull().default("mock"),
  /** error＝授權失效或解密失敗（金鑰輪替），UI 引導重新連結 */
  status: text("status", { enum: ["active", "error"] }).notNull().default("active"),
  lastError: text("last_error"),
  lastUsedAt: timestamp("last_used_at"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userProviderIdx: uniqueIndex("external_accounts_user_provider_idx").on(t.userId, t.provider),
}));

/** 排程項 ↔ Google 事件對應（每條連線一份），fingerprint 記上次推送內容摘要——沒變就跳過，省 API 配額 */
export const googleEventLinks = pgTable("google_event_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectionId: uuid("connection_id").notNull(),
  scheduleItemId: uuid("schedule_item_id").notNull(),
  googleEventId: text("google_event_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
}, (t) => ({
  connItemIdx: uniqueIndex("google_event_links_conn_item_idx").on(t.connectionId, t.scheduleItemId),
}));

/* ── Web Push 跨裝置通知 ────────────────────────── */

/**
 * Web Push 訂閱（手機＋電腦跨裝置通知）：每位使用者每個「瀏覽器裝置」一筆——
 * 使用者在通知設定啟用後，瀏覽器發的 PushSubscription（endpoint＋加密金鑰）存這裡，
 * 伺服器事件（審批/私訊/@提及/生成與代理完成）經 services/webPush 推到所有已連結裝置，
 * 關頁、關瀏覽器也收得到（相對於既有的頁內桌面通知只在分頁開著時有效）。
 * endpoint 唯一＝同裝置重複啟用是 upsert 不長重複列；推送回 404/410 即自動清掉失效列。
 * 新表由正式 migration 建立。
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  /** 推送服務給的裝置端點網址（capability URL，只有配對的 VAPID 私鑰能對它發推送） */
  endpoint: text("endpoint").notNull().unique(),
  /** 瀏覽器產生的訊息加密公鑰（P-256 ECDH）——推送內容端到端加密到該裝置 */
  p256dh: text("p256dh").notNull(),
  /** 瀏覽器產生的驗證密鑰 */
  auth: text("auth").notNull(),
  /** 裝置標籤（如「iPhone・Safari」「Windows・Chrome」）：前端從 UA 推導，設定頁列裝置清單用 */
  label: text("label"),
  /** 最後同步時刻：每次 App 載入時前端回報一次，供「清最舊裝置」與設定頁排序 */
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("push_subscriptions_user_idx").on(t.userId, t.lastSeenAt),
}));

/**
 * VAPID 金鑰對（單列 key='vapid'）：未設 VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY 環境變數時
 * 開機自動生成並存這裡——金鑰必須跨重啟穩定，否則所有既有訂閱全數失效。新表由正式 migration 建立。
 */
export const webPushVapid = pgTable("web_push_vapid", {
  key: text("key").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
