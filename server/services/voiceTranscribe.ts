/**
 * 語音留言逐字稿(留言第一梯隊):把 voiceStatus='pending' 的語音留言,用 fal 語音轉文字補上逐字稿。
 * 由 generationRunner 的節流掃描帶動(約每分鐘一次),與成品落地補抓同一個 tick——重佈/OOM 打斷後
 * 一開機就續轉,不靠使用者停在頁面。單筆:簽來源音檔網址→送 wizper→輪詢→回填 body。
 * 計費:與假生成同政策——mock 不扣點(billingBypassed);真模式扣 1 點(wizper 便宜),失敗退點。
 */
import { and, eq, inArray, lt } from "drizzle-orm";
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
const STALE_RUNNING_MS = 15 * 60 * 1000; // running 陳屍門檻：正常全程 <3 分，逾此即崩潰孤兒

export async function sweepVoiceTranscripts(limit = 5): Promise<number> {
  // 先回收陳屍 running（修 R2-ERR-002）：程序在 CAS pending→running＋扣點後、寫 done/failed 前崩潰，
  // 會留下永久 running（下方掃描只撈 pending 永不再碰）——該筆 1 點永久蒸發、逐字稿永久缺。
  // running 且訊息建立逾 15 分（正常全程 <3 分）＝崩潰孤兒：CAS running→failed 並退回已扣點（CAS 保證只退一次）。
  const staleCutoff = new Date(Date.now() - STALE_RUNNING_MS);
  const stale = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.voiceStatus, "running"), eq(schema.messages.refType, "asset"), lt(schema.messages.createdAt, staleCutoff)))
    .limit(limit);
  for (const m of stale) {
    if (inflight.has(m.id)) continue; // 本程序正在處理的不動
    const recovered = await db
      .update(schema.messages)
      .set({ voiceStatus: "failed", body: "🎙️ 語音訊息（逐字稿逾時未完成，點播放鍵聆聽）" })
      .where(and(eq(schema.messages.id, m.id), eq(schema.messages.voiceStatus, "running")))
      .returning({ id: schema.messages.id });
    if (recovered.length > 0 && !billingBypassed()) {
      const cost = getModel(STT_MODEL_ID)?.points ?? 1;
      await refund(m.userId, m.groupId, cost, "語音逐字稿逾時自動回收退回");
    }
  }

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
  // 崩潰安全的原子認領（CAS）：把 pending→running「先於扣點」落庫，且只有這一列還是 pending 才成立。
  // 沒這道 CAS 時，程序在扣點後、寫 done/failed 前崩潰，重啟後記憶體 inflight 已清空、該列仍是 pending，
  // 下一輪掃描會重撿並「再扣一次」，首次扣點永不退回（退點的 catch 因程序已死不執行）＝孤兒＋雙重扣款。
  // 認領成 running 後，掃描（只撈 pending）不再重撿，最壞情況收斂為「單次扣點＋停在 running」而非雙重扣款。
  const claimed = await db
    .update(schema.messages)
    .set({ voiceStatus: "running" })
    .where(and(eq(schema.messages.id, msg.id), eq(schema.messages.voiceStatus, "pending")))
    .returning({ id: schema.messages.id });
  if (claimed.length === 0) return false; // 已被別的 tick／別台實例認領（或狀態已變）——不重複處理、不扣點
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
  // 認領後該列為 running（額度不足時在認領後才標失敗），故 guard 需含 running；仍保留 pending 以防未認領路徑。
  await db
    .update(schema.messages)
    .set({ voiceStatus: "failed", body: "🎙️ 語音訊息（逐字稿失敗，點播放鍵聆聽）" })
    .where(and(eq(schema.messages.id, messageId), inArray(schema.messages.voiceStatus, ["pending", "running"])));
}
