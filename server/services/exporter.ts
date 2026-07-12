/**
 * 交付素材包（盲點掃描定案：不做雲端合成，交付媒體檔給剪映/Premiere 組裝）。
 * 業界標準編號資料夾：01_視頻素材／03_圖像／05_文件（有內容才建）；不含時間軸檔。
 */
import { ZipArchive } from "archiver";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { proxyFetch } from "./http";
import type { Response } from "express";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { worldviewSchema } from "../../shared/worldview";
import { absPathOf, extFromMime } from "./storage";

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "未命名";
}

/** 秒數 → SRT 時間碼 HH:MM:SS,mmm */
function srtTime(totalSec: number): string {
  const ms = Math.round(totalSec * 1000);
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${millis}`;
}

/**
 * 從分鏡的配音詞＋秒數組出 SRT 字幕（每幕一句、依序累計時間）。
 * 沒有配音詞的幕仍推進時間軸（保留其秒數的空檔），只有有詞的幕才產生字幕塊。
 * 回空字串代表整片都沒有配音詞（不放空字幕檔）。
 */
function buildSrt(scenes: Array<{ durationSec: number; voiceover: string | null }>): string {
  const blocks: string[] = [];
  let t = 0;
  let idx = 0;
  for (const sc of scenes) {
    const dur = sc.durationSec > 0 ? sc.durationSec : 3;
    const text = (sc.voiceover ?? "").trim();
    if (text) {
      idx += 1;
      blocks.push(`${idx}\n${srtTime(t)} --> ${srtTime(t + dur)}\n${text}`);
    }
    t += dur;
  }
  return blocks.join("\n\n");
}

// 遠端抓取守門：滴流/掛住的外部網址不能無限期卡住匯出；超大檔先用 Content-Length 擋下，不進串流
const REMOTE_FETCH_TIMEOUT_MS = 30_000;
const REMOTE_FILE_MAX_BYTES = 200 * 1024 * 1024;

/**
 * append 並等待該 entry 寫入下游完成——archiver 內部佇列不設上限，
 * 迴圈內連發 append 會同時持有所有已排入的來源，峰值記憶體≈整包大小；
 * 逐筆等待讓背壓生效，記憶體只留單一 entry 的串流緩衝。
 * 用戶端斷線（signal 中止）時 abort 後 'entry' 永不觸發，必須靠 abort 監聽讓 promise 收尾。
 */
function appendAndWait(archive: ZipArchive, source: Readable | Buffer, name: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const off = () => {
      archive.off("entry", onEntry);
      archive.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const fail = (err: unknown) => {
      off();
      // 釋放來源：本地檔關 fd、遠端串流中止下載，別讓半途的來源掛著
      if (source instanceof Readable) source.destroy();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const onEntry = (entry: { name: string }) => {
      if (entry.name === name) {
        off();
        resolve();
      }
    };
    const onError = (err: unknown) => fail(err);
    const onAbort = () => fail(new Error("下載已由用戶端取消"));
    if (signal.aborted) return onAbort();
    archive.on("entry", onEntry);
    archive.on("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    archive.append(source, { name });
  });
}

export async function exportProjectZip(projectId: string, res: Response): Promise<void> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new Error("找不到專案");

  const scenes = await db
    .select()
    .from(schema.scenes)
    .where(eq(schema.scenes.projectId, projectId))
    .orderBy(asc(schema.scenes.orderIndex));
  const assets = await db.select().from(schema.assets).where(eq(schema.assets.projectId, projectId));
  const generations = await db.select().from(schema.generations).where(eq(schema.generations.projectId, projectId));

  const worldview = worldviewSchema.parse(project.worldview ?? {});
  const zipName = `${safeName(project.title)}_交付包.zip`;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  // archiver 對錯誤是發 'error' 事件——未監聽會變 unhandled 'error' 直接讓 Node 程序崩潰。
  archive.on("error", (err) => {
    console.error("[export] 打包錯誤：", err instanceof Error ? err.message : err);
    if (!res.headersSent) res.status(500).end("打包失敗");
    else res.destroy();
  });
  // 用戶端中途取消下載時，停止打包、釋放資源，別再往斷掉的連線寫。
  // 必須用 archive.abort() 而非 destroy()：abort 才會殺掉內部佇列並收尾（_queue.kill + _shutdown），
  // destroy 只斷資料流，佇列滯留持有所有已排入來源、finalize 的 promise 永不 settle。
  // clientAbort 同時讓進行中的 proxyFetch / append 等待立即中止，不再白抓剩餘素材。
  const clientAbort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      clientAbort.abort();
      archive.abort();
    }
  });
  archive.pipe(res);

  // 05_文件／腳本與鏡頭表.md（一定有）
  const lines: string[] = [
    `# ${project.title} · 腳本與鏡頭表`,
    "",
    `- 格式：${project.format}（${project.platform}）`,
    `- 一句話故事：${worldview.logline || "—"}`,
    `- 關鍵訊息：${worldview.message || "—"}`,
    `- 調性：${worldview.tones.join("、") || "—"}`,
    `- 禁忌事項：${worldview.taboos.join("；") || "—"}`,
    "",
    "| 鏡號 | 場次 | 秒數 | 類型 | 提示詞 | 模型 |",
    "|---|---|---|---|---|---|",
  ];

  // 缺漏素材集中收集、待表格結束後再列——插在表格列中間會把 markdown 表格截斷
  const warnings: string[] = [];
  let videoIdx = 0;
  let imageIdx = 0;
  for (const [i, scene] of scenes.entries()) {
    if (clientAbort.signal.aborted) return; // 斷線後別再抓剩餘素材白做工
    const asset = assets.find((a) => a.id === scene.assetId);
    const gen = asset ? generations.find((g) => g.id === (asset.meta as { generationId?: string })?.generationId) : undefined;
    lines.push(
      `| ${i + 1} | ${scene.title} | ${scene.durationSec}s | ${asset?.kind ?? "—"} | ${gen?.prompt ?? "—"} | ${gen?.modelId ?? "—"} |`,
    );
    if (!asset) continue;
    // 來源一律以串流進 archive（不整檔進 RAM）；「取得來源」階段的失敗屬單檔容錯：跳過＋註記
    let source: Readable;
    try {
      // 已落地的素材直接讀 Volume（快、不吃外網、網址過期也不怕）；否則抓外部網址
      if (asset.storagePath) {
        const abs = absPathOf(asset.storagePath);
        await stat(abs); // 先確認檔案可讀：開檔失敗要走單檔跳過，而不是 append 後半寫 entry 毀掉整包
        source = createReadStream(abs);
      } else if (asset.url && /^https?:\/\//.test(asset.url)) {
        // 30 秒逾時涵蓋連線與串流階段；用戶端斷線也會中止進行中的抓取
        const fileRes = await proxyFetch(asset.url, {
          signal: AbortSignal.any([clientAbort.signal, AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS)]),
        });
        if (!fileRes.ok || !fileRes.body) {
          void fileRes.body?.cancel().catch(() => {}); // 不讀的 body 要取消，避免連線被佔住
          console.warn(`[export] 素材下載失敗 ${asset.url}: HTTP ${fileRes.status}`);
          warnings.push(`「${scene.title}」素材下載失敗（HTTP ${fileRes.status}），未入包`);
          continue;
        }
        const len = Number(fileRes.headers.get("content-length") ?? 0);
        if (len > REMOTE_FILE_MAX_BYTES) {
          void fileRes.body.cancel().catch(() => {});
          console.warn(`[export] 素材過大跳過 ${asset.url}: ${len} bytes`);
          warnings.push(`「${scene.title}」素材過大（${Math.round(len / 1048576)}MB，上限 200MB），未入包`);
          continue;
        }
        source = Readable.fromWeb(fileRes.body as unknown as import("node:stream/web").ReadableStream);
      } else {
        continue;
      }
    } catch (err) {
      if (clientAbort.signal.aborted) return; // 斷線引發的中止不是素材問題，直接收工
      console.warn(`[export] 素材讀取失敗 ${asset.storagePath ?? asset.url}:`, err instanceof Error ? err.message : err);
      warnings.push(`「${scene.title}」素材讀取失敗，未入包（可於系統內重新生成）`);
      continue;
    }
    const num = String(i + 1).padStart(2, "0");
    const extOf = (fallback: string) => (asset.mime && extFromMime(asset.mime)) || fallback;
    let name: string;
    if (asset.kind === "video") {
      videoIdx += 1;
      name = `01_視頻素材/${num}_${safeName(scene.title)}${extOf(".mp4")}`;
    } else if (asset.kind === "audio") {
      name = `02_音訊/${num}_${safeName(scene.title)}${extOf(".wav")}`;
    } else {
      imageIdx += 1;
      name = `03_圖像/${num}_${safeName(scene.title)}${extOf(".jpg")}`;
    }
    try {
      await appendAndWait(archive, source, name, clientAbort.signal);
    } catch (err) {
      if (clientAbort.signal.aborted) return; // 斷線中止視為正常結束，不往外拋 500
      // append 之後的串流錯誤代表該 entry 半寫、zip 已不可修復——不能 continue 交付壞包，
      // 直接往外拋，由既有 archive error handler＋index.ts 的 catch 收尾。
      throw err;
    }
  }

  if (clientAbort.signal.aborted) return;
  if (warnings.length) lines.push("", ...warnings.map((w) => `> ⚠ ${w}`));
  lines.push(
    "",
    `> 共 ${scenes.length} 鏡（影片 ${videoIdx}・圖像 ${imageIdx}${warnings.length ? `・缺漏 ${warnings.length}` : ""}）· 由 AI Director OS 產出 · ${new Date().toISOString().slice(0, 10)}`,
  );
  archive.append(lines.join("\n"), { name: "05_文件/腳本與鏡頭表.md" });

  // 04_字幕：從分鏡配音詞產生 SRT（有配音詞才放）——剪映/Premiere/YouTube 皆可直接匯入
  const srt = buildSrt(scenes);
  const hasSubtitle = srt.length > 0;
  if (hasSubtitle) archive.append(srt, { name: "04_字幕/字幕.srt" });

  archive.append(
    `資料夾說明：01_視頻素材（依鏡號排序）／03_圖像／${hasSubtitle ? "04_字幕（字幕.srt，可匯入剪映/Premiere/YouTube）／" : ""}05_文件（腳本與鏡頭表）。\n` +
      "媒體檔請直接匯入剪映或 Premiere 組裝。\n" +
      (hasSubtitle ? "" : "（本片分鏡尚無配音詞，故未附字幕；用 AI 拆分鏡或在分鏡填配音詞後再打包即有字幕。）\n"),
    { name: "README.txt" },
  );

  try {
    await archive.finalize();
  } catch (err) {
    // abort() 之後 finalize 會以 ABORTED reject——斷線導致的中止是正常結束，不往外拋
    if (!clientAbort.signal.aborted) throw err;
  }
}
