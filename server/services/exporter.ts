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
import { and, asc, eq, isNull } from "drizzle-orm";
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

// 字幕可讀性上限：每塊約 18 個全形字，中文閱讀速度上限約 7 字/秒（過長旁白要切多塊）
const CUE_MAX_VISUAL = 18;

/** 視覺寬度：全形（中文）算 1，半形（ASCII）算 0.5，貼近「每塊 ~18 全形字」的觀感 */
function visualWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[\x00-\xff]/.test(ch) ? 0.5 : 1;
  return w;
}

/** 把過長、無標點可切的片段硬切成不超過上限的塊 */
function hardWrap(seg: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of seg) {
    const chW = /[\x00-\xff]/.test(ch) ? 0.5 : 1;
    if (cur && visualWidth(cur) + chW > CUE_MAX_VISUAL) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 把一幕旁白依標點（。！？，、；及換行）切成最小語意片段，再貪婪合併至每塊上限；
 * 單一片段超長（無標點可切）時硬切。回傳可讀的字幕文字塊陣列。
 */
function splitSegments(voiceover: string): string[] {
  const pieces: string[] = [];
  let buf = "";
  const flush = () => {
    const s = buf.trim();
    if (s) pieces.push(s);
    buf = "";
  };
  for (const ch of voiceover) {
    if (ch === "\n") {
      flush();
      continue;
    }
    buf += ch;
    if ("。！？，、；".includes(ch)) flush(); // 標點留在片尾作為斷句點
  }
  flush();

  const out: string[] = [];
  let cur = "";
  const push = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  for (const p of pieces) {
    if (visualWidth(p) > CUE_MAX_VISUAL) {
      push();
      for (const chunk of hardWrap(p)) out.push(chunk);
      continue;
    }
    if (cur && visualWidth(cur) + visualWidth(p) > CUE_MAX_VISUAL) push();
    cur += p;
  }
  push();
  return out;
}

/**
 * 把一幕旁白切成多個連號字幕塊，並在該幕時間預算 [startSec, endSec] 內
 * 依各段字數比例分配起訖時間碼（末段對齊 endSec，避免累進誤差溢出幕邊界）。
 * 空旁白回空陣列（該幕不產生字幕）。
 */
/** 每塊字幕最短顯示秒數：低於此會一閃而過、來不及讀。塊數過多時合併相鄰片段以達此下限 */
const MIN_CUE_SEC = 0.8;

/** 把片段平均併成最多 count 組（依片段數平均分桶，如 8→3 桶為 3/3/2），保證塊數不超過時間放得下的數量 */
function mergeToCount(segs: string[], count: number): string[] {
  if (count >= segs.length) return segs;
  const out: string[] = [];
  const base = Math.floor(segs.length / count);
  let extra = segs.length % count;
  let idx = 0;
  for (let b = 0; b < count; b++) {
    const take = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    out.push(segs.slice(idx, idx + take).join(""));
    idx += take;
  }
  return out;
}

function splitCue(voiceover: string, startSec: number, endSec: number): Array<{ start: number; end: number; text: string }> {
  const text = (voiceover ?? "").trim();
  if (!text) return [];
  let segments = splitSegments(text)
    .map((s) => s.replace(/[，、；]+$/, "").trim()) // 尾端非句末標點（逗/頓/分號）去掉更乾淨
    .filter((s) => s.length > 0);
  if (segments.length === 0) return [];
  // 每塊最少 MIN_CUE_SEC：把塊數上限壓到「這幕時間放得下」的數量，避免短幕多句時字幕一閃而過
  const span0 = Math.max(endSec - startSec, 0);
  const maxCues = Math.max(1, Math.floor(span0 / MIN_CUE_SEC));
  if (segments.length > maxCues) segments = mergeToCount(segments, maxCues);

  const totalChars = segments.reduce((n, s) => n + s.length, 0) || 1;
  const span = Math.max(endSec - startSec, 0);
  const cues: Array<{ start: number; end: number; text: string }> = [];
  let t = startSec;
  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    const end = isLast ? endSec : t + span * (segments[i].length / totalChars);
    cues.push({ start: t, end, text: segments[i] });
    t = end;
  }
  return cues;
}

/**
 * 從分鏡的配音詞＋秒數組出 SRT 字幕：每幕依旁白長度切成多個連號可讀塊，
 * 各幕時間依序累計（每幕佔其設定秒數，最少 3 秒）。
 * 沒有配音詞的幕仍推進時間軸（保留其秒數的空檔），只有有詞的幕才產生字幕塊。
 * 回空字串代表整片都沒有配音詞（不放空字幕檔）。
 */
function buildSrt(scenes: Array<{ durationSec: number; voiceover: string | null }>): string {
  const blocks: string[] = [];
  let t = 0;
  let idx = 0;
  for (const sc of scenes) {
    const dur = sc.durationSec > 0 ? sc.durationSec : 3;
    const start = t;
    const end = t + dur;
    t = end;
    for (const cue of splitCue(sc.voiceover ?? "", start, end)) {
      idx += 1;
      blocks.push(`${idx}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}`);
    }
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
    // 已軟刪除（回收桶）的分鏡不進交付包
    .where(and(eq(schema.scenes.projectId, projectId), isNull(schema.scenes.deletedAt)))
    .orderBy(asc(schema.scenes.orderIndex));
  // ★ 金錢安全：已軟刪除（已付點數）的素材絕不入 ZIP——過濾 deletedAt。
  // 分鏡引用的素材若已軟刪除，下方 assets.find 找不到就跳過該鏡（不整包失敗）。
  const assets = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.projectId, projectId), isNull(schema.assets.deletedAt)));
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
    "| 鏡號 | 場次 | 秒數 | 類型 | 檔名 | 旁白音檔 | 進出點時間碼 | 提示詞 | 模型 |",
    "|---|---|---|---|---|---|---|---|---|",
  ];

  // 缺漏素材集中收集、待表格結束後再列——插在表格列中間會把 markdown 表格截斷
  const warnings: string[] = [];
  let videoIdx = 0;
  let imageIdx = 0;
  // 鏡頭表欄位：每幕實際寫入交付包的相對檔名（下方主迴圈成功入包後回填）＋依序累計的進/出點時間碼。
  // 時間碼與字幕同一套規則（每幕佔其設定秒數，最少 3 秒），組裝時間軸與分鏡順序一致即可對齊。
  const writtenNames: (string | null)[] = new Array(scenes.length).fill(null);
  // 逐鏡旁白音檔的實際相對檔名（成功入包後回填），供鏡頭表標明該鏡有無旁白配音。
  const narrationNames: (string | null)[] = new Array(scenes.length).fill(null);
  let tcAcc = 0;
  const times = scenes.map((sc) => {
    const dur = sc.durationSec > 0 ? sc.durationSec : 3;
    const inSec = tcAcc;
    tcAcc += dur;
    return { in: inSec, out: tcAcc };
  });
  // 序號動態補零：依總鏡數決定位數（至少 2 位），避免破百鏡在檔案總管字典序亂序。
  const sceneNumWidth = Math.max(2, String(scenes.length).length);
  for (const [i, scene] of scenes.entries()) {
    if (clientAbort.signal.aborted) return; // 斷線後別再抓剩餘素材白做工
    const asset = assets.find((a) => a.id === scene.assetId);
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
    const num = String(i + 1).padStart(sceneNumWidth, "0");
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
      writtenNames[i] = name; // 成功入包才回填鏡頭表的實際相對檔名
    } catch (err) {
      if (clientAbort.signal.aborted) return; // 斷線中止視為正常結束，不往外拋 500
      // append 之後的串流錯誤代表該 entry 半寫、zip 已不可修復——不能 continue 交付壞包，
      // 直接往外拋，由既有 archive error handler＋index.ts 的 catch 收尾。
      throw err;
    }
  }

  if (clientAbort.signal.aborted) return;

  // 02_旁白音檔：逐鏡旁白配音（scenes.narrationAssetId 指向的 asset）。與畫面素材各自獨立——
  // 一幕即使沒有畫面素材，只要有旁白就照樣輸出，檔名鏡號與畫面素材同一套動態補零，方便對齊字幕與畫面。
  // 取來源方式比照場景素材：已落地讀 Volume、否則抓外網，逐檔容錯（失敗只記警告、不毀整包）。
  for (const [i, scene] of scenes.entries()) {
    if (clientAbort.signal.aborted) return;
    if (!scene.narrationAssetId) continue;
    const narr = assets.find((a) => a.id === scene.narrationAssetId);
    if (!narr) continue;
    let source: Readable;
    try {
      if (narr.storagePath) {
        const abs = absPathOf(narr.storagePath);
        await stat(abs);
        source = createReadStream(abs);
      } else if (narr.url && /^https?:\/\//.test(narr.url)) {
        const fileRes = await proxyFetch(narr.url, {
          signal: AbortSignal.any([clientAbort.signal, AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS)]),
        });
        if (!fileRes.ok || !fileRes.body) {
          void fileRes.body?.cancel().catch(() => {});
          console.warn(`[export] 旁白下載失敗 ${narr.url}: HTTP ${fileRes.status}`);
          warnings.push(`「${scene.title}」旁白音檔下載失敗（HTTP ${fileRes.status}），未入包`);
          continue;
        }
        const len = Number(fileRes.headers.get("content-length") ?? 0);
        if (len > REMOTE_FILE_MAX_BYTES) {
          void fileRes.body.cancel().catch(() => {});
          console.warn(`[export] 旁白過大跳過 ${narr.url}: ${len} bytes`);
          warnings.push(`「${scene.title}」旁白音檔過大（${Math.round(len / 1048576)}MB，上限 200MB），未入包`);
          continue;
        }
        source = Readable.fromWeb(fileRes.body as unknown as import("node:stream/web").ReadableStream);
      } else {
        continue;
      }
    } catch (err) {
      if (clientAbort.signal.aborted) return;
      console.warn(`[export] 旁白讀取失敗 ${narr.storagePath ?? narr.url}:`, err instanceof Error ? err.message : err);
      warnings.push(`「${scene.title}」旁白音檔讀取失敗，未入包`);
      continue;
    }
    const num = String(i + 1).padStart(sceneNumWidth, "0");
    const ext = (narr.mime && extFromMime(narr.mime)) || ".mp3";
    const name = `02_旁白音檔/${num}_旁白${ext}`;
    try {
      await appendAndWait(archive, source, name, clientAbort.signal);
      narrationNames[i] = name; // 成功入包才回填鏡頭表
    } catch (err) {
      if (clientAbort.signal.aborted) return;
      throw err;
    }
  }

  if (clientAbort.signal.aborted) return;

  // 鏡頭表主體：每幕一列，補上實際寫入交付包的相對檔名（缺媒體標「（無素材）」）、旁白音檔檔名與累計進出點時間碼。
  for (const [i, scene] of scenes.entries()) {
    const asset = assets.find((a) => a.id === scene.assetId);
    const gen = asset ? generations.find((g) => g.id === (asset.meta as { generationId?: string })?.generationId) : undefined;
    const file = writtenNames[i] ?? "（無素材）";
    const narrationFile = narrationNames[i] ?? "（無）";
    const tc = `${srtTime(times[i].in)} → ${srtTime(times[i].out)}`;
    lines.push(
      `| ${i + 1} | ${scene.title} | ${scene.durationSec}s | ${asset?.kind ?? "—"} | ${file} | ${narrationFile} | ${tc} | ${gen?.prompt ?? "—"} | ${gen?.modelId ?? "—"} |`,
    );
  }

  // 00_鎖定原素材：固定素材模式的原音/開示/配樂——原封保留，剪輯時圍繞它組裝、不改動
  const lockedAssets = assets.filter((a) => a.locked);
  let lockedIdx = 0;
  // 序號動態補零：與場景素材同規則（至少 2 位），破百件也維持字典序。
  const lockedNumWidth = Math.max(2, String(lockedAssets.length).length);
  const kindDir: Record<string, string> = { audio: "音訊", video: "影片", image: "圖像", doc: "文件" };
  for (const asset of lockedAssets) {
    if (clientAbort.signal.aborted) return;
    let source: Readable;
    try {
      if (asset.storagePath) {
        const abs = absPathOf(asset.storagePath);
        await stat(abs);
        source = createReadStream(abs);
      } else if (asset.url && /^https?:\/\//.test(asset.url)) {
        const fileRes = await proxyFetch(asset.url, {
          signal: AbortSignal.any([clientAbort.signal, AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS)]),
        });
        if (!fileRes.ok || !fileRes.body) {
          void fileRes.body?.cancel().catch(() => {});
          warnings.push(`鎖定素材「${asset.title}」下載失敗（HTTP ${fileRes.status}），未入包`); // 與場景素材分支一致：非 OK 要記警告
          continue;
        }
        const len = Number(fileRes.headers.get("content-length") ?? 0);
        if (len > REMOTE_FILE_MAX_BYTES) {
          void fileRes.body.cancel().catch(() => {});
          warnings.push(`鎖定素材「${asset.title}」過大（${Math.round(len / 1048576)}MB，上限 200MB），未入包`); // 補上與場景素材一致的大小守門
          continue;
        }
        source = Readable.fromWeb(fileRes.body as unknown as import("node:stream/web").ReadableStream);
      } else {
        continue;
      }
    } catch (err) {
      if (clientAbort.signal.aborted) return;
      warnings.push(`鎖定素材「${asset.title}」讀取失敗，未入包`);
      continue;
    }
    lockedIdx += 1;
    const ext = (asset.mime && extFromMime(asset.mime)) || "";
    const num = String(lockedIdx).padStart(lockedNumWidth, "0");
    try {
      await appendAndWait(archive, source, `00_鎖定原素材/${kindDir[asset.kind] ?? "其他"}/${num}_${safeName(asset.title)}${ext}`, clientAbort.signal);
    } catch (err) {
      if (clientAbort.signal.aborted) return;
      throw err;
    }
  }
  if (lockedAssets.length) {
    lines.push("", `## 鎖定原素材（不可更動 · ${lockedIdx} 件）`, "> 師父原音／開示文字／配樂等固定素材，請原封使用、只在畫面層創作。");
  }

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

  const hasNarration = narrationNames.some((n) => n !== null);
  archive.append(
    `資料夾說明：${lockedAssets.length ? "00_鎖定原素材（不可更動的原音/開示/配樂，原封使用）／" : ""}01_視頻素材（依鏡號排序）／${hasNarration ? "02_旁白音檔（逐鏡旁白配音）／" : ""}03_圖像／${hasSubtitle ? "04_字幕（字幕.srt，可匯入剪映/Premiere/YouTube）／" : ""}05_文件（腳本與鏡頭表）。\n` +
      "媒體檔請直接匯入剪映或 Premiere 組裝。\n" +
      (hasNarration
        ? "02_旁白音檔＝逐鏡旁白配音，檔名鏡號對應字幕與畫面（同一套鏡號補零），在剪輯軟體裡把同鏡號的旁白音檔對齊該鏡畫面即可；05_文件的鏡頭表「旁白音檔」欄列出每鏡對應的檔名。\n"
        : "") +
      (hasSubtitle
        ? "字幕.srt 的時間碼依「分鏡規劃秒數」依序累計（每幕佔其設定秒數），組裝時間軸與分鏡順序一致即可對齊；若實際剪輯調整了各幕長度，請在剪輯軟體裡微調字幕時間。\n"
        : "（本片分鏡尚無配音詞，故未附字幕；用 AI 拆分鏡或在分鏡填配音詞後再打包即有字幕。）\n"),
    { name: "README.txt" },
  );

  try {
    await archive.finalize();
  } catch (err) {
    // abort() 之後 finalize 會以 ABORTED reject——斷線導致的中止是正常結束，不往外拋
    if (!clientAbort.signal.aborted) throw err;
  }
}
