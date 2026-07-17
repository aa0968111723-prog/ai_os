/**
 * 語音留言逐字稿(留言第一梯隊):把 voiceStatus='pending' 的語音留言,用 fal 語音轉文字補上逐字稿。
 * 由 generationRunner 的節流掃描帶動(約每分鐘一次),與成品落地補抓同一個 tick——重佈/OOM 打斷後
 * 一開機就續轉,不靠使用者停在頁面。單筆:簽來源音檔網址→送 wizper→輪詢→回填 body。
 * 計費:與假生成同政策——mock 不扣點(billingBypassed);真模式扣 1 點(wizper 便宜),失敗退點。
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { signAssetUrl } from "./storage";
import { falSubmit, falStatus, billingBypassed } from "./fal";
import { getModel } from "../../shared/models";
import { reserveQuota, refund } from "./points";

const STT_MODEL_ID = "fal-ai/wizper"; // 便宜快速、中文可用;逐字稿只求「看得懂/可搜尋」,非交付級
const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

// 處理中認領（單容器部署，程序內 Set 即足夠，比照 generationRunner 的 inflight 防重）：
// 一筆轉錄可能耗時 >60s（輪詢逾時 120s），期間該列仍是 pending，下一個掃描 tick 會再撈到同一列，
// 若不認領就會被重複送 fal＋重複扣點。認領在 sweep 內「同步」加入（任何 await 之前），確保跨 tick 不交錯。
const inflight = new Set<string>();

/** 掃一批待轉錄的語音留言並補逐字稿;回傳完成筆數。失敗只標記 failed，不擋其他。 */
export async function sweepVoiceTranscripts(limit = 5): Promise<number> {
  const rows = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.voiceStatus, "pending"), eq(schema.messages.refType, "asset")))
    .limit(limit);
  if (rows.length === 0) return 0;
  const model = getModel(STT_MODEL_ID);
  if (!model) return 0;

  // 只處理尚未被前一個 tick 認領的列；認領同步完成，避免重複扣點。
  const claimable = rows.filter((m) => !inflight.has(m.id));
  if (claimable.length === 0) return 0;
  for (const m of claimable) inflight.add(m.id);

  const results = await Promise.allSettled(
    claimable.map((m) => transcribeOne(m).finally(() => inflight.delete(m.id))),
  );
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

async function transcribeOne(msg: typeof schema.messages.$inferSelect): Promise<boolean> {
  if (!msg.refId) return false;
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, msg.refId));
  if (!asset) {
    await markFailed(msg.id, "找不到語音檔");
    return false;
  }
  const model = getModel(STT_MODEL_ID)!;
  const cost = model.points ?? 1;
  // 扣點(mock 略過);扣不到（額度不足）就標失敗，語音仍可播放，只是沒逐字稿
  if (!billingBypassed()) {
    const quotaErr = await reserveQuota(msg.userId, msg.groupId, cost, "語音留言逐字稿");
    if (quotaErr) {
      await markFailed(msg.id, quotaErr);
      return false;
    }
  }
  try {
    const sourceUrl = signAssetUrl(asset.id, POLL_TIMEOUT_MS / 1000 + 60);
    // STT 模型的 input 只用 sourceUrl（format 對它無意義）；型別上仍需給一個合法 format 值
    const input = model.input("", "16:9", sourceUrl) as Record<string, unknown>;
    const { requestId } = await falSubmit(model.endpoint ?? model.id, "text", input);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const st = await falStatus(model.endpoint ?? model.id, "text", requestId);
      if (st.status === "done") {
        const text = (st.resultText ?? "").trim() || "（沒有聽出內容）";
        await db
          .update(schema.messages)
          .set({ body: text.slice(0, 2000), voiceStatus: "done" })
          .where(eq(schema.messages.id, msg.id));
        return true;
      }
      if (st.status === "failed") throw new Error(st.error ?? "轉錄失敗");
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error("轉錄逾時");
  } catch (err) {
    if (!billingBypassed()) await refund(msg.userId, msg.groupId, cost, "語音逐字稿失敗退回");
    await markFailed(msg.id, err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function markFailed(messageId: string, reason: string): Promise<void> {
  console.warn(`[voice] 逐字稿失敗（語音仍可播放）：msg=${messageId}`, reason);
  await db
    .update(schema.messages)
    .set({ voiceStatus: "failed", body: "🎙️ 語音訊息（逐字稿失敗，點播放鍵聆聽）" })
    .where(and(eq(schema.messages.id, messageId), inArray(schema.messages.voiceStatus, ["pending"])));
}
