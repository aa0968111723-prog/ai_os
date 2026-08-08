/**
 * 站內通知的唯一入口。
 *
 * **順序就是契約：先 await 落列，再 fire-and-forget 推播。**
 *
 * 這一行決定了整個收件匣有沒有意義。反過來寫（先推播、成功了才落列）等於把「會不會知道」
 * 綁在推送服務的可用性上；而現況更糟——根本沒有落列這一步，`pushToUsers` 是純粹的
 * fire-and-forget，沒訂閱裝置就直接 return {0,0}，非 404/410 的失敗只印一行 warn 而
 * 沒有任何佇列會再試，裝置離線超過 TTL 24 小時推送服務自行丟棄。
 * 真正會走完「連結裝置 → 允許通知（iOS 還要先加主畫面）」的通常只有組長本人。
 *
 * 落列之後，推播降級成**加速通道**：它只影響「多快知道」，不影響「會不會知道」。
 */
import { and, count, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { pushToUsers } from "./webPush";

export type NotificationKind =
  | "annotation"
  | "annotation_resolved"
  | "mention"
  | "reply"
  | "generation_done"
  | "generation_pending_approval"
  | "schedule_mention"
  // 協作生命週期（留言→任務→完成→回頭解決；見 taskCore 的 provenance 鏈）
  | "task_assigned"
  | "task_completed"
  | "approval"
  | "decision"
  | "assistant_attention";

export interface NotifyInput {
  /** 收件人（會自動去重、去空值；呼叫端不必先過濾） */
  userIds: string[];
  groupId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** 站內路徑；推播 payload 用同一個字串 */
  url: string;
  /**
   * 冪等鍵的「事件」部分（實際唯一鍵是 user_id + event_key）。
   * **一定要帶階段**：`mention:<messageId>:posted` 與 `mention:<messageId>:transcribed`
   * 是兩件事——語音留言的逐字稿回填時要補一則通知，粒度取太粗會被自己的冪等吃掉。
   */
  eventKey: string;
  actorId?: string | null;
  projectId?: string | null;
  sceneId?: string | null;
  refType?: string | null;
  refId?: string | null;
  messageId?: string | null;
  /** 同 tag 的推播會互相取代（避免同一件事洗版）；缺省用 eventKey */
  pushTag?: string;
}

/** 推播結果 → push_state。分得出「這個人沒有裝置」與「系統故障」是這張表的重點之一 */
function pushStateOf(r: { attempted: number; delivered: number; error?: true }): string {
  if (r.error) return "error";
  if (r.attempted === 0) return "no_device";
  return r.delivered === 0 ? "failed" : "delivered";
}

/**
 * 落一批通知並推播。**永不拋例外**——通知是附加訊號，不該讓主流程（送出留言、標注、
 * 核准生成）因為收件匣寫失敗而整個失敗。寫不進去時只留 log。
 */
export async function notify(input: NotifyInput): Promise<void> {
  const targets = [...new Set(input.userIds)].filter(Boolean);
  if (targets.length === 0) return;
  try {
    const rows = await db
      .insert(schema.notifications)
      .values(targets.map((userId) => ({
        userId,
        groupId: input.groupId,
        projectId: input.projectId ?? null,
        sceneId: input.sceneId ?? null,
        kind: input.kind,
        actorId: input.actorId ?? null,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        messageId: input.messageId ?? null,
        title: input.title,
        body: input.body,
        url: input.url,
        eventKey: input.eventKey,
      })))
      // 重試、雙寫、補通知都不該在鈴鐺上長出第二筆
      .onConflictDoNothing()
      .returning({ id: schema.notifications.id, userId: schema.notifications.userId });

    // **逐人推，不能一次推一批**：pushToUsers 回傳的 attempted 是「跨所有收件人的訂閱列數」，
    // 不是人數。一則 @ 了三個人、只有組長有裝置時回 {attempted:1, delivered:1}——
    // 拿這個彙總值回寫，另外兩個沒裝置的人會被記成 delivered，於是「從來沒送達」這件事
    // 在系統裡再一次看不見，而那正是這張表要解決的問題。
    for (const row of rows) {
      void pushToUsers([row.userId], {
        title: input.title,
        body: input.body,
        url: input.url,
        tag: input.pushTag ?? input.eventKey,
      })
        .then((r) => db
          .update(schema.notifications)
          .set({ pushState: pushStateOf(r) })
          .where(eq(schema.notifications.id, row.id)))
        .catch((err) => console.warn("[notify] 推播結果回寫失敗：", err instanceof Error ? err.message : err));
    }
  } catch (err) {
    console.warn("[notify] 通知落列失敗（主流程不受影響）：", err instanceof Error ? err.message : err);
  }
}

/**
 * 未讀數。放在 service 層而不是只留在 router，是因為首屏聚合（sessionBoot）要用它——
 * 讓 bootstrap 走同一支查詢，鈴鐺的數字不會因為「首屏算一套、鈴鐺自己再算一套」而對不上。
 */
export async function notificationUnreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return row?.n ?? 0;
}
