/**
 * 語音留言逐字稿(留言第一梯隊):把 voiceStatus='pending' 的語音留言,用 fal 語音轉文字補上逐字稿。
 * 由 generationRunner 的節流掃描帶動(約每分鐘一次),與成品落地補抓同一個 tick——重佈/OOM 打斷後
 * 一開機就續轉,不靠使用者停在頁面。單筆:簽來源音檔網址→送 wizper→輪詢→回填 body。
 * 計費:與假生成同政策——mock 不扣點(billingBypassed);真模式扣 1 點(wizper 便宜),失敗退點。
 */
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { signAssetUrl } from "./storage";
import { falSubmit, falStatus, billingBypassed } from "./fal";
import { getModel } from "../../shared/models";
import { reserveQuota, refund } from "./points";
import { resolveMentions } from "./mentions";
import { notify } from "./notify";
import { dmSnippet } from "./dmCore";

const STT_MODEL_ID = "fal-ai/wizper"; // 便宜快速、中文可用;逐字稿只求「看得懂/可搜尋」,非交付級
const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;
/** 逾時後保留 job 再開一輪輪詢的最長總時（含首次 120s）；逾此才真失敗退點 */
const MAX_JOB_WALL_MS = 10 * 60_000;

// 處理中認領（單容器部署，程序內 Set 即足夠，比照 generationRunner 的 inflight 防重）：
// 一筆轉錄可能耗時 >60s（輪詢逾時 120s），期間該列仍是 pending，下一個掃描 tick 會再撈到同一列，
// 若不認領就會被重複送 fal＋重複扣點。認領在 sweep 內「同步」加入（任何 await 之前），確保跨 tick 不交錯。
const inflight = new Set<string>();
/**
 * 已送出但本輪輪詢逾時的 fal requestId：列維持 running、不退點，
 * 下輪繼續 poll（供應商可能仍完成）。程序重啟後 Map 清空，交 15 分陳屍退點。
 */
const openJobs = new Map<
  string,
  { requestId: string; cost: number; endpoint: string; startedAt: number; userId: string; groupId: string }
>();

/**
 * 逐字稿回填後補算 @提及並通知。
 *
 * 語音留言送出的當下 body 是佔位字串（「🎙️ 語音訊息…」），裡面不可能有 @——
 * 真正的內容是這裡才長出來的。沒有這一段的話，「@阿明 這一鏡的鐘聲太大聲」用講的
 * 永遠不會通知阿明，而錄音正是產品為「長輩志工零打字」明確設計的入口。
 *
 * eventKey 帶 `:transcribed` 階段：與送出當下可能已發過的 `:posted` 是兩件事，
 * 粒度取太粗會被 notify 自己的 onConflictDoNothing 吃掉。
 */
async function notifyTranscribedMentions(msg: typeof schema.messages.$inferSelect, text: string): Promise<void> {
  try {
    if (!msg.projectId) return;
    const mentions = await resolveMentions(msg.groupId, undefined, text);
    const targets = (mentions ?? []).filter((id) => id !== msg.userId);
    if (!targets.length) return;
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, msg.projectId));
    const [speaker] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, msg.userId));
    await db.update(schema.messages).set({ mentions }).where(eq(schema.messages.id, msg.id));
    void notify({
      userIds: targets,
      groupId: msg.groupId,
      projectId: msg.projectId,
      kind: "mention",
      actorId: msg.userId,
      messageId: msg.id,
      title: `${speaker?.name ?? "夥伴"} 在「${project?.title ?? "專案"}」的語音留言提及你`,
      body: dmSnippet(text),
      url: `/p/${msg.projectId}?focus=messages&mid=${msg.id}`,
      eventKey: `mention:${msg.id}:transcribed`,
    });
  } catch (err) {
    // 逐字稿本身已經存好了，通知失敗不該讓整輪轉錄被判定成失敗而退點
    console.warn("[voice] 逐字稿 @提及通知略過：", err instanceof Error ? err.message : err);
  }
}

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
    try {
      // 原子＋冪等收斂（修 R6-MONEY-001）：CAS running→failed 與「依帳本淨額退點」包進同一交易——
      // 舊版先 commit failed 再另起交易退點，兩步之間當機會留下終局 failed 但退點列從未寫入（掃描只掃 running
      // 永不再碰）→ 已扣點永久蒸發。同交易後：全有或全無，中途當機整筆 rollback、列留 running 交下輪重試。
      // 退點金額＝該留言帳本淨額絕對值（never-charged 退 0），並對同 msg.id 冪等。
      await db.transaction(async (tx) => {
        const recovered = await tx
          .update(schema.messages)
          .set({ voiceStatus: "failed", body: "🎙️ 語音訊息（逐字稿逾時未完成，點播放鍵聆聽）" })
          .where(and(eq(schema.messages.id, m.id), eq(schema.messages.voiceStatus, "running")))
          .returning({ id: schema.messages.id });
        if (recovered.length === 0 || billingBypassed()) return;
        const [ledger] = await tx
          .select({ net: sql<number>`coalesce(sum(${schema.costLedger.delta}), 0)` })
          .from(schema.costLedger)
          .where(eq(schema.costLedger.generationId, m.id));
        const deducted = Math.max(0, -Number(ledger?.net ?? 0));
        if (deducted > 0) {
          const [existing] = await tx
            .select({ n: sql<number>`count(*)` })
            .from(schema.costLedger)
            .where(and(eq(schema.costLedger.generationId, m.id), gt(schema.costLedger.delta, 0)));
          if (Number(existing?.n ?? 0) === 0) {
            await tx.insert(schema.costLedger).values({
              userId: m.userId,
              groupId: m.groupId,
              delta: deducted,
              reason: "語音逐字稿逾時自動回收退回",
              generationId: m.id,
            });
          }
        }
      });
    } catch (err) {
      console.warn(`[voice] 陳屍回收略過（下輪再試）：msg=${m.id}`, err instanceof Error ? err.message : err);
    }
  }

  const rows = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.voiceStatus, "pending"), eq(schema.messages.refType, "asset")))
    .limit(limit);
  const model = getModel(STT_MODEL_ID);
  if (!model) return 0;

  // 續跑：本程序尚有 openJobs 的 running 列（先前輪詢逾時未退點）
  const resumeIds = [...openJobs.keys()].filter((id) => !inflight.has(id)).slice(0, limit);
  const resumeRows =
    resumeIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.messages)
          .where(
            and(
              inArray(schema.messages.id, resumeIds),
              eq(schema.messages.voiceStatus, "running"),
              eq(schema.messages.refType, "asset"),
            ),
          );

  // 只處理尚未被前一個 tick 認領的列；認領同步完成，避免重複扣點。
  const claimable = rows.filter((m) => !inflight.has(m.id));
  const work = [...resumeRows, ...claimable].slice(0, limit);
  if (work.length === 0) return 0;
  for (const m of work) inflight.add(m.id);

  const results = await Promise.allSettled(
    work.map((m) => transcribeOne(m).finally(() => inflight.delete(m.id))),
  );
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

async function pollUntilDone(
  endpoint: string,
  requestId: string,
  budgetMs: number,
): Promise<{ status: "done"; text: string } | { status: "failed"; error: string } | { status: "timeout" }> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const st = await falStatus(endpoint, "text", requestId);
    if (st.status === "done") {
      return { status: "done", text: (st.resultText ?? "").trim() || "（沒有聽出內容）" };
    }
    if (st.status === "failed") {
      return { status: "failed", error: st.error ?? "轉錄失敗" };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { status: "timeout" };
}

async function transcribeOne(msg: typeof schema.messages.$inferSelect): Promise<boolean> {
  if (!msg.refId) return false;
  const model = getModel(STT_MODEL_ID)!;
  const cost = model.points ?? 1;
  const endpoint = model.endpoint ?? model.id;

  // 續跑既有 fal job：不重扣點、不重送
  const open = openJobs.get(msg.id);
  if (open && msg.voiceStatus === "running") {
    const elapsed = Date.now() - open.startedAt;
    if (elapsed > MAX_JOB_WALL_MS) {
      openJobs.delete(msg.id);
      if (!billingBypassed()) {
        await refund(open.userId, open.groupId, open.cost, "語音逐字稿失敗退回", msg.id);
      }
      await markFailed(msg.id, "轉錄逾時");
      return false;
    }
    const remaining = Math.max(POLL_INTERVAL_MS, MAX_JOB_WALL_MS - elapsed);
    const polled = await pollUntilDone(open.endpoint, open.requestId, Math.min(POLL_TIMEOUT_MS, remaining));
    if (polled.status === "done") {
      openJobs.delete(msg.id);
      await db
        .update(schema.messages)
        .set({ body: polled.text.slice(0, 2000), voiceStatus: "done" })
        .where(eq(schema.messages.id, msg.id));
      // 逐字稿是這一刻才長出來的——送出當下的 body 只是佔位字串，@提及要到現在才解析得出來
      await notifyTranscribedMentions(msg, polled.text.slice(0, 2000));
      return true;
    }
    if (polled.status === "failed") {
      openJobs.delete(msg.id);
      if (!billingBypassed()) {
        await refund(open.userId, open.groupId, open.cost, "語音逐字稿失敗退回", msg.id);
      }
      await markFailed(msg.id, polled.error);
      return false;
    }
    // 仍 timeout：保留 openJobs、維持 running，下輪再試
    console.warn(`[voice] 轉錄仍在進行，下輪續輪詢：msg=${msg.id}`);
    return false;
  }

  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, msg.refId));
  if (!asset) {
    await markFailed(msg.id, "找不到語音檔");
    return false;
  }
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
    // 扣點以 msg.id 當帳本關聯鍵（修 R5-MONEY-001）：讓失敗退點/陳屍回收能依實際淨額退、且冪等。
    // reserveQuota 例外（連線池耗盡/序列化失敗/逾時）在此攔下並標失敗、不退點（從未扣過）——
    // 否則例外會冒泡被 allSettled 吞掉，留下「running 但無扣點列」的孤兒，之後被陳屍回收盲退。
    let quotaErr: string | null;
    try {
      quotaErr = await reserveQuota(msg.userId, msg.groupId, cost, "語音留言逐字稿", msg.id);
    } catch (err) {
      console.warn("[voice] 扣點例外（標失敗不退點）：", err instanceof Error ? err.message : err);
      await markFailed(msg.id, "扣點暫時失敗，稍後重試");
      return false;
    }
    if (quotaErr) {
      await markFailed(msg.id, quotaErr);
      return false;
    }
  }
  try {
    const sourceUrl = signAssetUrl(asset.id, MAX_JOB_WALL_MS / 1000 + 60);
    // STT 模型的 input 只用 sourceUrl（format 對它無意義）；型別上仍需給一個合法 format 值
    const input = model.input("", "16:9", sourceUrl) as Record<string, unknown>;
    const { requestId } = await falSubmit(endpoint, "text", input);
    openJobs.set(msg.id, {
      requestId,
      cost,
      endpoint,
      startedAt: Date.now(),
      userId: msg.userId,
      groupId: msg.groupId,
    });
    const polled = await pollUntilDone(endpoint, requestId, POLL_TIMEOUT_MS);
    if (polled.status === "done") {
      openJobs.delete(msg.id);
      await db
        .update(schema.messages)
        .set({ body: polled.text.slice(0, 2000), voiceStatus: "done" })
        .where(eq(schema.messages.id, msg.id));
      // 逐字稿是這一刻才長出來的——送出當下的 body 只是佔位字串，@提及要到現在才解析得出來
      await notifyTranscribedMentions(msg, polled.text.slice(0, 2000));
      return true;
    }
    if (polled.status === "failed") {
      openJobs.delete(msg.id);
      throw new Error(polled.error);
    }
    // 本輪逾時：不退點、不標 failed——供應商可能仍在跑，下 tick 續 poll
    console.warn(`[voice] 本輪輪詢逾時，保留 job 下輪續跑：msg=${msg.id}`);
    return false;
  } catch (err) {
    openJobs.delete(msg.id);
    if (!billingBypassed()) await refund(msg.userId, msg.groupId, cost, "語音逐字稿失敗退回", msg.id); // 帶 msg.id：冪等、與陳屍回收不重複退
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
