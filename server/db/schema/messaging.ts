/**
 * Messaging domain schema（專案留言、私訊、反應、已讀）
 */
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id"),
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull().default("text"),
  body: text("body").notNull(),
  // 協作強化（留言 2.0）：回覆串／組長釘選／引用專案內作品（分鏡・素材・生成）／@提及
  replyToId: uuid("reply_to_id"),
  pinned: boolean("pinned").notNull().default(false),
  refType: text("ref_type", { enum: ["scene", "asset", "generation", "note", "schedule"] }),
  refId: uuid("ref_id"),
  mentions: jsonb("mentions").$type<string[]>(),
  // 留言第一梯隊：語音留言（kind='voice'，音檔存 ref asset，voiceStatus 轉錄狀態，body 收轉錄稿）
  // 與 @助手回覆（kind='assistant'，body 為 LLM 回答，userId 記觸發者）。
  // running＝已被某個 tick 認領並「已扣點、轉錄中」的原子狀態：崩潰後留在 running（非 pending），
  // 下一輪掃描只撈 pending 故不會重撿重扣（見 services/voiceTranscribe 的 CAS 認領）。純 text 欄、無 DB
  // CHECK 約束，新增列舉值不需遷移。
  voiceStatus: text("voice_status", { enum: ["pending", "running", "done", "failed"] }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("messages_project_idx").on(t.projectId, t.createdAt),
  voicePendingIdx: index("messages_voice_pending_idx").on(t.voiceStatus),
}));

/**
 * 站內私訊（通訊錄 1:1 聊天）：獨立於專案留言（messages 掛組/專案、組內可見），
 * 私訊只有收發雙方看得到——查詢一律以「本人是 sender 或 recipient」為界，管理員也不例外。
 * 可私訊對象＝同組夥伴（含團隊管理展開；開發者可與全站互訊），見 services/dmCore.ts。
 * 內容不落審計明文（trpc.ts 對 dm.send 脫敏 body），維持「私」的承諾。新表由正式 migration 建立。
 */
export const dmMessages = pgTable("dm_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  senderId: uuid("sender_id").notNull(),
  recipientId: uuid("recipient_id").notNull(),
  body: text("body").notNull(),
  // 私訊 2.0：kind 區分一般訊息與 AI 代理回覆（'assistant'——@助手 觸發，sender 記提問者、雙方可見）。
  kind: text("kind").notNull().default("text"),
  // 標注（跨組指標）：可把「專案／資料庫／排程／筆記」帶進私訊變成可點卡片。送出時以「發訊者本人權限」
  // 驗證可存取（dmCore.assertDmRef）；卡片只是指標，對方點擊時各目標頁再自行做存取守衛。
  refType: text("ref_type", { enum: ["project", "database", "schedule", "note"] }),
  refId: uuid("ref_id"),
  // 圖／影片／檔案附件：指向 dm_attachments（上傳時建立、送訊時綁定）。允許「只有附件、body 為空」。
  attachmentId: uuid("attachment_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // 對話串雙向查詢：sender 前綴查「我發給某人」、recipient 前綴查「某人發給我」＋未讀計數
  senderIdx: index("dm_messages_sender_idx").on(t.senderId, t.recipientId, t.createdAt),
  recipientIdx: index("dm_messages_recipient_idx").on(t.recipientId, t.senderId, t.createdAt),
}));

/**
 * 私訊附件（圖／影片／檔案）：獨立於專案素材（assets 掛組、組內可見）——私訊附件只有收發雙方看得到，
 * 檔案服務端點以「本人是上傳者，或本人是所屬訊息的收訊者」為界（見 index.ts /api/dm/attachments/:id/file）。
 * 上傳先建列（messageId 為 null＝尚未綁定），dm.send 帶 attachmentId 時才把 messageId 補上並驗擁有＋未用。
 * 落地檔走既有 storage（storagePath）。未送出的孤兒列（挑了檔又沒送）罕見且小，暫不自動清掃。
 */
export const dmAttachments = pgTable("dm_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 上傳者（＝送訊者）。綁定前只有本人讀得到；綁定後所屬訊息的對方也讀得到。 */
  ownerId: uuid("owner_id").notNull(),
  /** 綁定到的私訊（null＝上傳後尚未送出）。 */
  messageId: uuid("message_id"),
  kind: text("kind").notNull(), // image | video | audio | doc（沿用 storage.kindFromMime）
  title: text("title").notNull(),
  storagePath: text("storage_path").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  ownerIdx: index("dm_attachments_owner_idx").on(t.ownerId),
  messageIdx: index("dm_attachments_message_idx").on(t.messageId),
}));

/** 私訊已讀水位：每人對每位對話者一筆 lastReadAt，未讀數＝晚於水位的對方來訊數（dmCore upsert 維護） */
export const dmReads = pgTable("dm_reads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  peerId: uuid("peer_id").notNull(),
  lastReadAt: timestamp("last_read_at").defaultNow().notNull(),
}, (t) => ({
  userPeerIdx: index("dm_reads_user_peer_idx").on(t.userId, t.peerId),
  userPeerUq: uniqueIndex("dm_reads_user_peer_uq").on(t.userId, t.peerId),
}));

/** 留言表情回應：每人對每則每種表情最多一筆（再按一次＝收回），白名單見 messages router */
export const messageReactions = pgTable("message_reactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull(),
  userId: uuid("user_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  msgIdx: index("message_reactions_msg_idx").on(t.messageId),
  msgUserEmojiUq: uniqueIndex("message_reactions_msg_user_emoji_uq").on(t.messageId, t.userId, t.emoji),
}));

/** 留言已讀水位：每人每專案一筆 lastReadAt，未讀數＝晚於水位的他人留言數（router upsert 維護） */
export const messageReads = pgTable("message_reads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  projectId: uuid("project_id").notNull(),
  lastReadAt: timestamp("last_read_at").defaultNow().notNull(),
}, (t) => ({
  userProjectIdx: index("message_reads_user_project_idx").on(t.userId, t.projectId),
  userProjectUq: uniqueIndex("message_reads_user_project_uq").on(t.userId, t.projectId),
}));
