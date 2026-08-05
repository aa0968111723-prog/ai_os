/**
 * AI Director OS — 伺服器入口
 * 一個服務包三件事：健康檢查、tRPC API、（正式環境）React 靜態檔。
 * 原則：健康檢查不等 DB（healing-studio 的部署教訓）。
 */
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { unlink } from "node:fs/promises";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";
import { createContext } from "./trpc";
import { ensureSeed } from "./services/seed";
import { ensureSchema } from "./db/ensure";
import { syncCatalog } from "./services/catalog";
import { isMockMode } from "./services/fal";
import { resolveSession, type AuthState } from "./services/auth";
import { deviceTrustMisconfigured, resolveDeviceTrustMode } from "./services/deviceTrust";
import {
  buildUploadLineageMeta,
  looksLikeUuid,
  tryConsumeUploadGrant,
  releaseUploadGrant,
  resolveUploadRequestAuth,
  type UploadGrantRecord,
} from "./services/uploadGrants";
import { buildEdl, buildFcpxml, buildSrt, buildXmeml, exportProjectZip, exportZipName } from "./services/exporter";
import { resolutionForFormat } from "../shared/options";
import { exportJianyingDraftZip } from "./services/jianying";
import { renderMyDataHtml, summarizeWorldview, type MyDataProjectExport } from "./services/myDataExport";
import { handleMcp } from "./services/mcp";
import { isMcpEnabled } from "./services/mcpAuth";
import {
  handleV1ListDatabases,
  handleV1ListRows,
  handleV1AddRow,
  handleV1AddRowsBatch,
  handleCsvExport,
  handleDatabaseIcs,
} from "./services/restApi";
import {
  ensureStorageDirs, tmpDir, adoptTmpFile, adoptFeedbackShot, isFeedbackShotPath, absPathOf, checkDiskSpace, verifyAssetSig,
  isAllowedUploadMime, kindFromMime, resolveUploadMime, shouldForceAttachment, MAX_FILE_BYTES, STORAGE_ROOT, mimeFromPath,
  assessStoragePersistence, verifyVolumeIdentity,
} from "./services/storage";
import { setStorageDegraded } from "./services/storageHealth";
import { markBootDraining, markBootReady, isBootReady } from "./services/boot";
import { recordError, listErrors, errorCountSince } from "./services/errlog";
import { normalizeRequestId, withRequestContext } from "./services/requestContext";
import { sessionGate } from "./services/sessionPolicy";
import { attachRealtime } from "./services/realtime";
import { startWorkflowRunner } from "./services/workflowRunner";
import { startGenerationRunner, runnerHeartbeat } from "./services/generationRunner";
import { startAgentRunner } from "./services/agentRunner";
import { startGroupCampaignRunner, recoverInterruptedCampaigns, sweepStaleCampaigns } from "./services/groupCampaignRunner";
import { startExportRunner } from "./services/exportRunner";
import { startAssetMaintenanceRunner } from "./services/assetMaintenanceRunner";
import { startFeedbackAgent } from "./services/feedbackAgent";
import { db, schema } from "./db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { assertRateLimitConfiguration } from "./services/rateLimit";
import {
  backgroundTaskCount,
  beginShutdown,
  drainHttpServer,
  isShuttingDown,
  onShutdown,
  trackBackgroundTask,
} from "./services/shutdown";
import { readProcessRole, shouldRunWorkers } from "./services/processRole";
import { httpSurfaceForRole } from "./bootstrap/httpSurface";
import { evaluateRunnerReadiness } from "./bootstrap/runnerReadiness";
import compression from "compression";
import { agentPlannerModeSchema } from "../shared/agentPlanner";

const app = express();

/**
 * HTTP 壓縮。部署站實測**完全沒有 Content-Encoding**——首屏資產以未壓縮狀態傳輸：
 *   index.js 267KB、vendor-react 185KB、vendor-data 165KB、index.css 120KB
 *   合計約 737KB，gzip 後約 202KB（省 73%）。
 *
 * 必須掛在 express.static 之前，否則靜態檔會先被送出、壓縮中介層根本碰不到。
 *
 * SSE 端點要排除：壓縮會做緩衝，串流事件會卡在緩衝區裡直到湊滿一個 chunk 才送出，
 * AI 助手的「思考中／正在查…」逐筆推送就會變成一次全到，失去串流的意義。
 * 站內的 SSE 是 /api/assistant/ask（text/event-stream）。
 */
app.use(
  compression({
    filter: (req, res) => {
      const type = String(res.getHeader("Content-Type") ?? "");
      if (type.includes("text/event-stream")) return false;
      return compression.filter(req, res);
    },
  }),
);

const port = Number(process.env.PORT ?? 3000);
const isProd = process.env.NODE_ENV === "production";
// TD-07 / TD-07b：Web／Worker 邊界（預設 all；worker 仍 listen HTTP 但不掛 SPA）
const processRole = readProcessRole();
const httpSurface = httpSurfaceForRole(processRole);
// 啟動前 fail fast：不能等到第一個登入/MCP/AI 請求才發現 HMAC 金鑰缺失，也絕不退回記憶體限流。
assertRateLimitConfiguration();

// 部署平台的反向代理（Zeabur／Railway 等）在前面終止 TLS 並轉發，信任第一層 proxy 才能取到真實 client IP（速率限制/HSTS 正確）
app.set("trust proxy", 1);

// 安全標頭（#9）：nosniff、X-Frame-Options: DENY、HSTS、Referrer-Policy 由 helmet 預設提供；
// CSP 手動放行 SPA 與 fal 成品：React inline style 需 style 'unsafe-inline'；生成成品/截圖是
// https/blob/data 圖片一律放行；connectSrc 要含 https:/wss: 讓 tRPC 與即時協作 WS 連得上。
// mediaSrc 比照 imgSrc 放行 https（否則落回 defaultSrc 'self'）：逐鏡旁白試聽、TTS/影片成品在
// 落地 Volume 前是跨源 fal CDN 網址，未放行會被 CSP 擋住無法播放（cycle3 旁白試聽實測踩到）。
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        mediaSrc: ["'self'", "data:", "blob:", "https:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", "https:", "wss:"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        // 移除 helmet 預設的 upgrade-insecure-requests：本地/CI 走 http localhost 時它會
        // 把同源子資源強升為 https 而連不上，破壞既有 e2e；正式站由部署平台（Zeabur 等）提供 https。
        upgradeInsecureRequests: null,
      },
    },
    // 自家 /api/assets 圖片需被 SPA（開發時跨埠、正式時同源）載入，用 same-site 才不被 CORP 擋
    crossOriginResourcePolicy: { policy: "same-site" },
    hsts: { includeSubDomains: true },
    referrerPolicy: { policy: "no-referrer" },
    // X-Frame-Options: DENY（與 CSP frame-ancestors 'none' 一致；對不吃 CSP 的舊瀏覽器的縱深防禦，#74）
    frameguard: { action: "deny" },
  }),
);

// 每個 HTTP request 都有可跨 tRPC／服務層／錯誤記錄關聯的追蹤 ID。
// 不記 query/body/IP，避免把金鑰、搜尋字或個資帶進平台 log；只輸出 API 的方法、路徑、狀態與耗時。
app.use((req, res, next) => {
  const requestId = normalizeRequestId(req.headers["x-request-id"]);
  const startedAt = process.hrtime.bigint();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  res.once("finish", () => {
    if (!req.path.startsWith("/api/") || (req.path === "/api/health" && res.statusCode < 500)) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    process.stdout.write(`${JSON.stringify({
      level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      event: "http.request",
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    })}\n`);
  });
  withRequestContext(requestId, next);
});

app.use(express.json({ limit: "2mb" }));

// 建置追溯（QA 版本漂移）：部署時由建置流程注入（Dockerfile ARG→ENV），
// /api/health 露出非敏感的 build 資訊，讓正式環境可對應到唯一 Git commit。
// #268：Zeabur 可能注入 ZEABUR_GIT_COMMIT 而非 BUILD_SHA——程式側 fallback 避免 health 全 null
const BUILD_INFO = {
  sha: process.env.BUILD_SHA || process.env.ZEABUR_GIT_COMMIT || process.env.COMMIT_SHA || null,
  branch: process.env.BUILD_BRANCH || process.env.ZEABUR_GIT_BRANCH || null,
  builtAt: process.env.BUILD_TIME || process.env.ZEABUR_BUILD_TIME || null,
};

/** Express 非 tRPC 路由共用認證閘門；避免強制改密碼只擋住其中一種傳輸層。 */
function requireUsableSession(auth: AuthState | null, res: express.Response): auth is AuthState {
  const gate = sessionGate(auth);
  if (gate === "unauthenticated") {
    res.status(401).json({ error: "請先登入" });
    return false;
  }
  if (gate === "password-change-required") {
    res.status(403).json({ error: "管理員已重設你的密碼，請先完成密碼變更", code: "PASSWORD_CHANGE_REQUIRED" });
    return false;
  }
  return true;
}

// 健康檢查 — 純 HTTP，不碰 DB
app.get("/api/health", (_req, res) => {
  // 只回存活狀態＋建置版本（公開 repo 的 commit SHA 非敏感），不外洩生成模式等內部資訊（#26）
  res.json({ ok: true, time: new Date().toISOString(), build: BUILD_INFO });
});

// 就緒診斷 — 用瀏覽器打開就知道系統就緒了沒（給非工程背景的自我診斷頁）。
// QA-004：不能只看 DB——曾發生 ready 全綠但 storage 落到本機 fallback、runner 未啟動的假綠燈。
// 逐一分項回報：db／boot／storage 實際寫讀／generation runner 心跳／必要 provider 設定；
// 任一必要分項失敗即回 503。仍維持未認證可用：只回 ok/錯誤概述，不洩內部組態細節
//（mockMode、AUTH_MODE 等偵察面仍只在需開發者登入的 /api/selftest）。
app.get("/api/ready", async (_req, res) => {
  const components: Record<string, { ok: boolean; note: string }> = {};

  try {
    await db.execute(sql`select 1`);
    components.db = { ok: true, note: "connected（資料庫已接通）" };
  } catch (err) {
    console.error("[ready] DB 連線失敗：", err instanceof Error ? err.message : err);
    components.db = { ok: false, note: "error（資料庫未接通）——檢查部署平台 Variables 的 DATABASE_URL" };
  }

  const bootReady = isBootReady();
  components.boot = { ok: bootReady, note: bootReady ? "ready（初始化完成）" : "initializing（migration/schema 驗證或種子同步中；持續發生請查部署 log）" };

  // 儲存層：實際寫入＋讀回＋刪除探針，而不是只看目錄存在；
  // 正式環境落到本機 .data fallback（Volume 沒掛上）視為未就緒——重啟即遺失素材，不能算綠燈。
  try {
    const { saveBuffer, removeStoredFile } = await import("./services/storage");
    const probe = await saveBuffer(Buffer.from("ready-probe"), "text/plain");
    await removeStoredFile(probe.storagePath);
    const usingVolume = STORAGE_ROOT === "/data" || !!process.env.ASSET_DIR;
    if (isProd && !usingVolume) {
      components.storage = { ok: false, note: "fallback（正式環境未掛持久 Volume，素材重啟即遺失）——請掛 /data 或設 ASSET_DIR" };
    } else {
      components.storage = { ok: true, note: usingVolume ? "ok（持久 Volume 可寫讀）" : "ok（本機模式可寫讀）" };
    }
  } catch (err) {
    console.error("[ready] 儲存層探針失敗：", err instanceof Error ? err.message : err);
    components.storage = { ok: false, note: "error（儲存層無法寫入/讀取）" };
  }

  // 生成執行器心跳：worker／all 在 boot 完成後應已啟動且近 60 秒內有 tick；
  // web 不跑 Runner（TD-07），分項回 skipped 且不拖垮整體就緒。
  components.runner = evaluateRunnerReadiness(processRole, bootReady, runnerHeartbeat());

  // 必要 provider 設定：正式模式需要媒體生成金鑰（只回是否已設定，不洩其值/模式細節）
  components.provider = isMockMode() || process.env.FAL_KEY
    ? { ok: true, note: "ok（生成服務設定已就緒）" }
    : { ok: false, note: "missing（媒體生成金鑰未設定，生成會失敗）" };

  const ok = Object.values(components).every((c) => c.ok);
  // 頂層 db/boot 維持舊版字串形狀：e2e 用 scripts/wait-api-ready.sh 等 ok:true + boot 以 ready 開頭、
  // e2e-phase4 驗頂層 boot 鍵，文件也教管理員看這兩個欄位——分項細節在 components。
  // processRole：讓部署／探針區分 web 與 worker 實例的必要元件期望。
  // runners / resources：可觀測性（不參與 503 判定，避免 metrics 抖動拖垮就緒）。
  let runners: unknown = undefined;
  let resources: unknown = undefined;
  try {
    const { listRunnerSnapshots, processResourceSnapshot } = await import("./services/runnerMetrics");
    runners = listRunnerSnapshots().map((s) => ({
      name: s.name,
      started: s.started,
      lastTickAt: s.lastTickAt,
      lastTickAgeMs: s.lastTickAt == null ? null : Date.now() - s.lastTickAt,
      inflight: s.inflight,
      queueDepth: s.queueDepth,
      lastWork: s.lastWork,
      lastSkippedReason: s.lastSkippedReason,
    }));
    resources = processResourceSnapshot();
  } catch {
    /* metrics 模組不可用時不影響就緒 */
  }
  res.status(ok ? 200 : 503).json({
    ok,
    processRole,
    db: components.db.ok ? "connected（資料庫已接通）" : "error（資料庫未接通）",
    boot: bootReady ? "ready（初始化完成）" : "initializing（migration/schema 驗證或種子同步中；持續發生請查部署 log）",
    components,
    runners,
    resources,
    time: new Date().toISOString(),
  });
});

// 佔位素材端點：專案免費佔位縮圖（projects.ts）與 e2e 測試假素材共用；離線可用，交付包也抓得到
const MOCK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNsm7ryPwAFmwJT2F3EYAAAAABJRU5ErkJggg==",
  "base64",
);
/** 0.5 秒靜音 WAV（8kHz/8-bit/mono）——假模式的音訊成品，瀏覽器可直接播放 */
function makeSilentWav(): Buffer {
  const sampleRate = 8000;
  const samples = sampleRate / 2;
  const data = Buffer.alloc(samples, 128); // 8-bit 無聲＝128
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate, 28); // byte rate
  header.writeUInt16LE(1, 32); // block align
  header.writeUInt16LE(8, 34); // bits
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
const MOCK_WAV = makeSilentWav();
app.get("/api/mock-asset/:kind", (req, res) => {
  // Test fixtures are not a production media API. Keeping this public in real
  // mode lets stale URLs look healthy and can hide broken Fal source inputs.
  if (!isMockMode()) return res.status(404).json({ error: "找不到測試素材" });
  res.setHeader("Cache-Control", "public, max-age=86400");
  if (req.params.kind === "audio") {
    res.setHeader("Content-Type", "audio/wav");
    return res.send(MOCK_WAV);
  }
  // 影片亦回傳圖片位元組（測試模式重點是流程可測；正式模式為真實 mp4）
  res.setHeader("Content-Type", "image/png");
  res.send(MOCK_PNG);
});

// 多選打包的 assetIds 逐一驗 UUID：非 UUID 一律剔除（防怪參數；剔光＝回全量打包）
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 讀檔案開頭數 bytes（上傳簽名嗅探用，QA-021）：不把整檔讀進記憶體 */
async function readFileHead(filePath: string, bytes = 16): Promise<Buffer> {
  const { open } = await import("node:fs/promises");
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

// 交付素材包下載（zip；session cookie 驗證＋組隔離）。
// 可選 ?assetIds=id1,id2（逗號分隔）＝素材庫多選打包：媒體檔只打包這些素材，交付文件照常。
// QA-005（防重複）：同專案＋同選項的匯出「同時」只允許一份在打包——長時間打包期間重複點擊/重開連結
// 會做出兩份一模一樣的 ZIP（白耗外部下載與頻寬），重複請求直接回 409 讓使用者等第一份完成。
const exportsInFlight = new Set<string>();
app.get("/api/export/:projectId", async (req, res) => {
  let flightKey: string | null = null;
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, req.params.projectId));
    if (!project) return res.status(404).json({ error: "找不到專案" });
    if (!auth.groups.some((g) => g.groupId === project.groupId)) return res.status(403).json({ error: "你不屬於這個組" });
    const assetIds = String(req.query.assetIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => UUID_RE.test(s));
    flightKey = `${project.id}|${[...assetIds].sort().join(",")}`;
    if (exportsInFlight.has(flightKey)) {
      flightKey = null; // 不是本請求持有的鎖，finally 不得誤釋放
      return res.status(409).json({ error: "這個專案的交付包正在打包中——請等第一份完成（大包可能需要數分鐘），不用重複點擊" });
    }
    exportsInFlight.add(flightKey);
    // 打包核心已與 Response 解耦（QA-005 job 化共用）：標頭在此設定、斷線轉成 AbortSignal
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(exportZipName(project.title))}`);
    const clientAbort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) clientAbort.abort();
    });
    await exportProjectZip(project.id, res, {
      assetIds: assetIds.length > 0 ? assetIds : undefined,
      signal: clientAbort.signal,
    });
  } catch (err) {
    console.error("[export]", err);
    recordError("export", err); // 進錯誤環形緩衝（selftest「近期錯誤」）
    if (!res.headersSent) {
      res.removeHeader("Content-Disposition"); // 別讓錯誤 JSON 被當成 .zip 存檔
      res.status(500).json({ error: "打包失敗，請稍後再試（管理員可查伺服器記錄）" });
    }
  } finally {
    if (flightKey) exportsInFlight.delete(flightKey);
  }
});

// 匯出 job 成品下載（QA-005）：job 完成後由此取檔——登入＋組隔離，檔案從 Volume sendFile（支援 Range）
app.get("/api/export/jobs/:jobId/download", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const [job] = await db.select().from(schema.exportJobs).where(eq(schema.exportJobs.id, req.params.jobId));
    if (!job) return res.status(404).json({ error: "找不到這個匯出工作" });
    if (!auth.groups.some((g) => g.groupId === job.groupId)) return res.status(403).json({ error: "你不屬於這個組" });
    if (job.status !== "done" || !job.storagePath) {
      return res.status(409).json({ error: `交付包尚未就緒（目前狀態：${job.status}）`, status: job.status });
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(job.zipName ?? "交付包.zip")}`);
    sendStoredFile(res, absPathOf(job.storagePath), {}, "交付包檔案遺失（可能是伺服器重啟前的舊檔，請重新打包）");
  } catch (err) {
    console.error("[export-job:download]", err);
    recordError("export-job:download", err);
    if (!res.headersSent) res.status(500).json({ error: "下載失敗，請稍後再試" });
  }
});

// 單檔時間軸/字幕下載（需求 #8）：?format=srt（剪映/CapCut/Premiere）｜fcpxml（Final Cut Pro/DaVinci Resolve/剪映專業版）
// ｜xmeml（Premiere 時間軸 .xml）｜edl（DaVinci Resolve 備援）。
// 登入＋組隔離比照上方交付包路由；分鏡取未軟刪、依 orderIndex 排序，時間碼依各鏡秒數累計。
// 單檔下載沒有隨附媒體檔，fcpxml/xmeml 產「骨架版」（gap/空軌佔位）；要「匯入即組好粗剪」請用交付包內的媒體連結版。
app.get("/api/export/:projectId/timeline", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, req.params.projectId));
    if (!project) return res.status(404).json({ error: "找不到專案" });
    if (!auth.groups.some((g) => g.groupId === project.groupId)) return res.status(403).json({ error: "你不屬於這個組" });
    const format = String(req.query.format ?? "");
    if (format !== "srt" && format !== "fcpxml" && format !== "edl" && format !== "xmeml") {
      return res.status(400).json({ error: "format 需為 srt、fcpxml、xmeml 或 edl" });
    }
    const scenes = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)))
      .orderBy(asc(schema.scenes.orderIndex));
    // 修 R3-STOR2-03：單檔時間軸也要依專案比例輸出序列尺寸（與交付 ZIP 同口徑）——否則 9:16/1:1 專案的
    // fcpxml/xmeml 序列一律 1920×1080 橫向。此端點的分鏡無 mediaPath（gap 骨架版），故只帶解析度、不帶 pathPrefix。
    const tlOpts = resolutionForFormat(project.format);
    const file =
      format === "srt"
        ? { name: "字幕.srt", mime: "text/plain; charset=utf-8", body: buildSrt(scenes) }
        : format === "fcpxml"
          ? { name: "時間軸.fcpxml", mime: "application/xml; charset=utf-8", body: buildFcpxml(scenes, project.title, tlOpts) }
          : format === "xmeml"
            ? { name: "Premiere時間軸.xml", mime: "application/xml; charset=utf-8", body: buildXmeml(scenes, project.title, tlOpts) }
            : { name: "剪輯表.edl", mime: "text/plain; charset=utf-8", body: buildEdl(scenes, project.title) };
    // res.attachment 以 RFC 5987（filename*=UTF-8''…）讓中文檔名下載安全；Content-Type 隨後覆寫為明確值
    res.attachment(file.name);
    res.setHeader("Content-Type", file.mime);
    res.send(file.body);
  } catch (err) {
    console.error("[export:timeline]", err);
    recordError("export:timeline", err);
    if (!res.headersSent) res.status(500).json({ error: "時間軸/字幕檔產生失敗，請稍後再試" });
  }
});

// 剪映/CapCut 草稿包下載（實驗性）：整個草稿資料夾（draft_content.json＋素材）打成 zip，
// 解壓到剪映草稿目錄後打開剪映即見排好的時間軸。登入＋組隔離比照交付包路由。
app.get("/api/export/:projectId/jianying", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, req.params.projectId));
    if (!project) return res.status(404).json({ error: "找不到專案" });
    if (!auth.groups.some((g) => g.groupId === project.groupId)) return res.status(403).json({ error: "你不屬於這個組" });
    await exportJianyingDraftZip(project.id, res);
  } catch (err) {
    console.error("[export:jianying]", err);
    recordError("export:jianying", err);
    if (!res.headersSent) {
      res.removeHeader("Content-Disposition"); // 別讓錯誤 JSON 被當成 .zip 存檔
      res.status(500).json({ error: "剪映草稿包產生失敗，請稍後再試（管理員可查伺服器記錄）" });
    }
  }
});

// ── 真實儲存層：上傳素材＋檔案服務（Volume /data） ──────────────

const upload = multer({
  storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, tmpDir()) }),
  // fileSize/files 之外再夾制 fields/parts/fieldSize：上傳路由只需 1 檔＋少數小文字欄（projectId/tableId/
  // title/name），不設上限時 multer 的 fields/parts 預設無界，攻擊者可用「數百萬個微小文字欄」的
  // multipart 請求在解析階段吃 CPU/記憶體（且發生在認證前）。給足正常用途又擋掉洪泛。
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 8, parts: 12, fieldSize: 100 * 1024 },
});

// ★安全：在 multer「把整個上傳主體寫進磁碟」之前先擋掉未登入請求。
// multer 是中介層、跑在路由處理器之前——若把 resolveSession 留到處理器內，未認證者仍能對每次請求
// 把 200MB 串進 Volume 暫存目錄（寫完才回 401），並行洪泛即可塞爆磁碟（單容器/單 Volume 部署下＝全站故障）。
// 這道前置閘門讓未帶有效 session／upload grant 的請求在讀取主體前就被拒。
// AUTH-03：cookie session **或** Authorization: Bearer aidup_…（單次 grant；token 不進 query string）。
// 已認證者處理器內仍會再 resolve 一次取完整 AuthState／grant（多一次輕量查詢，可接受）。
async function requireAuthBeforeUpload(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  try {
    const resolved = await resolveUploadRequestAuth(req);
    if (!requireUsableSession(resolved?.auth ?? null, res)) return;
    next();
  } catch (err) {
    recordError("upload:auth", err);
    res.status(500).json({ error: "驗證失敗，請稍後再試" });
  }
}

/** 上傳素材（multipart: file + projectId [+ title + lineage]）→ 入素材庫、回傳 asset */
app.post("/api/upload", requireAuthBeforeUpload, upload.single("file"), async (req, res) => {
  const cleanup = async () => { if (req.file) await unlink(req.file.path).catch(() => {}); };
  try {
    const resolved = await resolveUploadRequestAuth(req);
    const auth = resolved?.auth ?? null;
    const grant: UploadGrantRecord | null = resolved?.grant ?? null;
    if (!requireUsableSession(auth, res)) { await cleanup(); return; }
    if (!req.file) return res.status(400).json({ error: "沒有收到檔案（欄位名要是 file）" });

    const projectId = String(req.body?.projectId ?? "");
    // Grant 綁定單一專案：不可拿 project A 的 grant 寫入 project B
    if (grant && projectId && projectId !== grant.projectId) {
      await cleanup();
      return res.status(403).json({ error: "此上傳授權不適用於該專案" });
    }
    const effectiveProjectId = grant ? grant.projectId : projectId;
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, effectiveProjectId));
    if (!project) { await cleanup(); return res.status(404).json({ error: "找不到專案" }); }
    if (!auth.groups.some((g) => g.groupId === project.groupId)) {
      await cleanup(); return res.status(403).json({ error: "你不屬於這個組" });
    }
    // 2.3 專案級權限：檢視者不能上傳素材（內容寫入）
    try {
      const { assertProjectEditable } = await import("./services/projectAcl");
      await assertProjectEditable(auth, project);
    } catch {
      await cleanup();
      return res.status(403).json({ error: "你在此專案是「檢視者」（唯讀）——要上傳請組長調整專案權限" });
    }

    if (grant && req.file.size > grant.maxBytes) {
      await cleanup();
      return res.status(413).json({
        error: `檔案超過此上傳授權上限（${Math.round(grant.maxBytes / 1024 / 1024)}MB）`,
      });
    }

    let mime = req.file.mimetype.split(";")[0].trim().toLowerCase();
    // 瀏覽器對 .md/.txt 等常送 application/octet-stream——改用副檔名後備判斷
    if (mime === "application/octet-stream" || mime === "") {
      const { mimeFromPath } = await import("./services/storage");
      mime = mimeFromPath(req.file.originalname);
    }
    if (!isAllowedUploadMime(mime)) {
      await cleanup();
      return res.status(415).json({ error: `不支援的檔案格式（${mime}）——支援：圖片（含 HEIC）/影片/音訊/PDF/Office/文字/壓縮檔` });
    }
    // QA-021：不只信宣稱 MIME／副檔名——讀檔頭簽名驗證；內容其實是另一種支援格式時依內容校正
    const verdict = resolveUploadMime(mime, await readFileHead(req.file.path));
    if (!verdict) {
      await cleanup();
      return res.status(415).json({ error: "檔案內容與宣稱的格式不符（無法辨識檔案簽名）——請確認檔案未損壞、副檔名正確" });
    }
    if (verdict.corrected) console.warn(`[upload] MIME 依檔案內容校正：${mime} → ${verdict.mime}（${req.file.originalname}）`);
    mime = verdict.mime;
    const guard = await checkDiskSpace(req.file.size, true);
    if (guard) { await cleanup(); return res.status(507).json({ error: guard }); }

    // Lineage：body 優先，grant 補 source／handoff（桌面 companion 可能只帶 grant）
    const bodySource = String(req.body?.sourceAssetId ?? "").trim();
    const bodyHandoff = String(req.body?.desktopHandoffId ?? "").trim();
    const bodyEditor = String(req.body?.editorId ?? "").trim();
    let sourceAssetId =
      (bodySource && looksLikeUuid(bodySource) ? bodySource : null)
      ?? grant?.sourceAssetId
      ?? null;
    if (sourceAssetId) {
      // 回收桶素材不得當 lineage 來源（與生成來源同口徑）
      const [src] = await db
        .select()
        .from(schema.assets)
        .where(and(eq(schema.assets.id, sourceAssetId), isNull(schema.assets.deletedAt)));
      if (!src || src.projectId !== project.id) {
        await cleanup();
        return res.status(400).json({ error: "來源素材不在此專案（或已在回收桶），無法建立版本關聯" });
      }
    }
    const desktopHandoffId = bodyHandoff || grant?.handoffId || null;
    const editorId = bodyEditor || null;

    // CAS 佔用 grant：驗證通過後、落地前搶佔——並發第二請求拿不到，避免單次 token 多檔
    let grantClaimed = false;
    if (grant) {
      grantClaimed = await tryConsumeUploadGrant(grant.id);
      if (!grantClaimed) {
        await cleanup();
        return res.status(409).json({ error: "此上傳授權已使用或失效——請重新取得授權後再傳" });
      }
    }

    // adoptTmpFile 已把暫存檔「移到」Volume 正式位置——之後若 DB 寫入失敗，
    // 要刪的是這個已落地的檔（storagePath），不是原暫存路徑（已不存在）；
    // 否則會在 Volume 留下沒有 DB 列指向的孤兒檔案，長期累積吃滿磁碟。
    const { storagePath, sizeBytes } = await adoptTmpFile(req.file.path, mime);
    try {
      const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8"); // multer 檔名編碼修正
      const title = String(req.body?.title ?? "").trim() || originalName || "上傳素材";
      const meta = buildUploadLineageMeta({
        originalName,
        sourceAssetId,
        desktopHandoffId,
        editorId,
      });
      const [asset] = await db
        .insert(schema.assets)
        .values({
          projectId: project.id,
          groupId: project.groupId,
          kind: kindFromMime(mime),
          title: title.slice(0, 80),
          url: "", // 先佔位，下一行以 id 回填服務網址
          isAiGenerated: false,
          storagePath, mime, sizeBytes,
          uploadedBy: auth.user.id,
          meta,
        })
        .returning();
      const [updated] = await db
        .update(schema.assets)
        .set({ url: `/api/assets/${asset.id}/file` })
        .where(eq(schema.assets.id, asset.id))
        .returning();
      // 正式版本表：與 meta 雙寫；失敗不擋上傳回應（meta 已可追溯）
      if (sourceAssetId) {
        try {
          await db
            .insert(schema.assetRevisions)
            .values({
              assetId: asset.id,
              sourceAssetId,
              projectId: project.id,
              groupId: project.groupId,
              desktopHandoffId: desktopHandoffId || null,
              editorId: editorId || null,
              createdBy: auth.user.id,
            })
            .onConflictDoNothing();
        } catch (revErr) {
          console.warn("[upload] asset_revisions insert skipped:", revErr);
        }
      }
      res.json({ ok: true, asset: updated });
    } catch (dbErr) {
      const { removeStoredFile } = await import("./services/storage");
      await removeStoredFile(storagePath); // DB 失敗 → 清掉已落地的孤兒檔
      // 釋放 grant 允許同一 token 重試（並發第二請求已在 CAS 被擋）
      if (grantClaimed && grant) await releaseUploadGrant(grant.id).catch(() => {});
      throw dbErr;
    }
  } catch (err) {
    await cleanup(); // req.file 若尚未 adopt（前段驗證失敗）才有東西可清
    console.error("[upload]", err);
    recordError("upload", err);
    if (!res.headersSent) res.status(500).json({ error: "上傳失敗，請稍後再試" });
  }
});
// multer 錯誤（如超過大小上限）轉成友善中文訊息
app.use("/api/upload", (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? `檔案太大（上限 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）` : `上傳失敗：${err.code}`;
    return res.status(413).json({ error: msg });
  }
  next(err);
});

/** 素材檔案服務：登入＋組隔離；或帶簽名（給 fal 抓來源輸入用，短效） */
/**
 * 送出落地檔；若實體檔案遺失（ENOENT——例如舊素材存在非持久磁碟、伺服器重新部署後不見）回乾淨的 404，
 * 不讓 res.sendFile 的 ENOENT 冒泡到全域 500。「檔案不見」不是伺服器故障，且回 500 會讓前端／瀏覽器
 * 誤以為「稍後再試」而一直重打同一張破圖。（self-healing：舊素材遺失時優雅降級，不再整批噴 500）
 */
function sendStoredFile(
  res: express.Response,
  absPath: string,
  options: Parameters<express.Response["sendFile"]>[1] = {},
  notFoundMsg = "檔案遺失（可能是伺服器重啟前的舊檔，已無法取得）",
): void {
  res.sendFile(absPath, options, (err) => {
    if (!err || res.headersSent) return; // 成功（err 為空）或已開始送內容：不改狀態碼
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      res.status(404).json({ error: notFoundMsg });
    } else {
      console.error("[sendStoredFile]", err);
      res.status(500).json({ error: "讀取檔案失敗" });
    }
  });
}

app.get("/api/assets/:id/file", async (req, res) => {
  try {
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, req.params.id));
    if (!asset) return res.status(404).json({ error: "找不到素材" });
    // 軟刪除（回收桶）素材不再可下載：與匯出流程（exporter 一律 isNull(deletedAt)）同口徑。
    // 否則已回收的素材仍能被知道 id 的同組成員（或在途簽名網址）抓取，屬保留策略洩漏。
    if (asset.deletedAt) return res.status(404).json({ error: "找不到素材" });

    const signed = verifyAssetSig(asset.id, req.query.exp as string | undefined, req.query.sig as string | undefined);
    if (!signed) {
      const auth = await resolveSession(req);
      if (!requireUsableSession(auth, res)) return;
      if (!auth.groups.some((g) => g.groupId === asset.groupId)) return res.status(403).json({ error: "你不屬於這個組" });
    }

    if (!asset.storagePath) {
      if (asset.url && /^https?:\/\//.test(asset.url)) return res.redirect(302, asset.url); // 尚未落地→轉外部網址
      return res.status(404).json({ error: "此素材沒有可用的檔案" });
    }
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // ?variant=thumb：背景維護補產的 360px JPEG（meta.thumbPath）；無則回原檔
    const wantThumb = String(req.query.variant ?? "") === "thumb";
    if (wantThumb) {
      const thumbPath = (asset.meta as { thumbPath?: string } | null)?.thumbPath;
      if (thumbPath) {
        sendStoredFile(
          res,
          absPathOf(thumbPath),
          { headers: { "Content-Type": "image/jpeg" } },
          "縮圖遺失",
        );
        return;
      }
    }
    const mime = asset.mime ?? "application/octet-stream";
    // 圖片/影音維持 inline（縮圖與播放需要）；doc/pdf/txt 與 SVG（可含腳本）強制下載，
    // 避免瀏覽器內嵌渲染帶來的 XSS/內容嗅探風險（#19）
    if (shouldForceAttachment(mime)) res.setHeader("Content-Disposition", "attachment");
    // sendFile 內建 Range 支援（影片/音訊拖進度條需要）
    sendStoredFile(res, absPathOf(asset.storagePath), { headers: { "Content-Type": mime } }, "素材檔案遺失（可能是伺服器重啟前的舊素材，已無法取得）");
  } catch (err) {
    console.error("[assets:file]", err);
    if (!res.headersSent) res.status(500).json({ error: "讀取素材失敗" });
  }
});

// ── 私訊附件（圖／影片／檔案）：上傳＋下載。隔離＝只有收發雙方看得到（非組隔離，見 dmAttachments） ──

/** 上傳私訊附件（multipart: file + peerId）→ 落地＋建 dm_attachments 列（未綁定），回傳附件供 dm.send 帶上 */
app.post("/api/dm/upload", requireAuthBeforeUpload, upload.single("file"), async (req, res) => {
  const cleanup = async () => { if (req.file) await unlink(req.file.path).catch(() => {}); };
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) { await cleanup(); return; }
    if (!req.file) return res.status(400).json({ error: "沒有收到檔案（欄位名要是 file）" });

    // 對象界：只能傳附件給「可私訊對象」（同組夥伴或開發者）——與 dm.send 同一守衛，避免對外偷傳
    const peerId = String(req.body?.peerId ?? "");
    try {
      const { assertDmPeer } = await import("./services/dmCore");
      await assertDmPeer(auth, peerId);
    } catch {
      await cleanup();
      return res.status(404).json({ error: "找不到這位夥伴（只能私訊同組夥伴或開發者）" });
    }

    let mime = req.file.mimetype.split(";")[0].trim().toLowerCase();
    if (mime === "application/octet-stream" || mime === "") {
      const { mimeFromPath } = await import("./services/storage");
      mime = mimeFromPath(req.file.originalname);
    }
    if (!isAllowedUploadMime(mime)) {
      await cleanup();
      return res.status(415).json({ error: `不支援的檔案格式（${mime}）——支援：圖片（含 HEIC）/影片/音訊/PDF/Office/文字/壓縮檔` });
    }
    // 與 /api/upload 同一套檔頭簽名驗證：不只信宣稱 MIME／副檔名
    const verdict = resolveUploadMime(mime, await readFileHead(req.file.path));
    if (!verdict) {
      await cleanup();
      return res.status(415).json({ error: "檔案內容與宣稱的格式不符（無法辨識檔案簽名）——請確認檔案未損壞、副檔名正確" });
    }
    mime = verdict.mime;
    const guard = await checkDiskSpace(req.file.size, true);
    if (guard) { await cleanup(); return res.status(507).json({ error: guard }); }

    const { storagePath, sizeBytes } = await adoptTmpFile(req.file.path, mime);
    try {
      const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
      const title = (String(req.body?.title ?? "").trim() || originalName || "附件").slice(0, 80);
      const [att] = await db
        .insert(schema.dmAttachments)
        .values({ ownerId: auth.user.id, kind: kindFromMime(mime), title, storagePath, mime, sizeBytes })
        .returning();
      res.json({ ok: true, attachment: { id: att.id, kind: att.kind, title: att.title, mime: att.mime, sizeBytes: att.sizeBytes, url: `/api/dm/attachments/${att.id}/file` } });
    } catch (dbErr) {
      const { removeStoredFile } = await import("./services/storage");
      await removeStoredFile(storagePath);
      throw dbErr;
    }
  } catch (err) {
    await cleanup();
    console.error("[dm:upload]", err);
    recordError("dm:upload", err);
    if (!res.headersSent) res.status(500).json({ error: "上傳失敗，請稍後再試" });
  }
});
app.use("/api/dm/upload", (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? `檔案太大（上限 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）` : `上傳失敗：${err.code}`;
    return res.status(413).json({ error: msg });
  }
  next(err);
});

/** 私訊附件檔案服務：登入＋「本人是上傳者或所屬訊息的對方」才給——非組隔離，維持私訊「只有雙方看得到」 */
app.get("/api/dm/attachments/:id/file", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const [att] = await db.select().from(schema.dmAttachments).where(eq(schema.dmAttachments.id, req.params.id));
    if (!att) return res.status(404).json({ error: "找不到附件" });
    let allowed = att.ownerId === auth.user.id;
    if (!allowed && att.messageId) {
      const [msg] = await db.select({ senderId: schema.dmMessages.senderId, recipientId: schema.dmMessages.recipientId })
        .from(schema.dmMessages).where(eq(schema.dmMessages.id, att.messageId));
      allowed = !!msg && (msg.senderId === auth.user.id || msg.recipientId === auth.user.id);
    }
    if (!allowed) return res.status(403).json({ error: "沒有權限看這個附件" });

    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const mime = att.mime ?? "application/octet-stream";
    // 圖片/影音維持 inline（縮圖與播放需要）；doc/pdf/txt 與 SVG 強制下載，擋內嵌渲染的 XSS/嗅探
    if (shouldForceAttachment(mime)) res.setHeader("Content-Disposition", "attachment");
    sendStoredFile(res, absPathOf(att.storagePath), { headers: { "Content-Type": mime } }, "附件檔案遺失（可能是伺服器重啟前的舊檔）");
  } catch (err) {
    console.error("[dm:attachment:file]", err);
    if (!res.headersSent) res.status(500).json({ error: "讀取附件失敗" });
  }
});

// ── 資料庫文件（AI 可讀檔案層）：上傳＋下載（權限走 databaseAcl，配額每人 5GB 可調） ──

/** 上傳文件到資料庫（multipart: file + tableId [+ name]）→ 抽純文字供 AI 讀、回傳檔案列 */
app.post("/api/databases/upload", requireAuthBeforeUpload, upload.single("file"), async (req, res) => {
  const cleanup = async () => { if (req.file) await unlink(req.file.path).catch(() => {}); };
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) { await cleanup(); return; }
    if (!req.file) return res.status(400).json({ error: "沒有收到檔案（欄位名要是 file）" });

    const tableId = String(req.body?.tableId ?? "");
    const [table] = await db.select().from(schema.dataTables)
      .where(and(eq(schema.dataTables.id, tableId), isNull(schema.dataTables.deletedAt)));
    const { resolveTableAccess } = await import("./services/databaseAcl");
    const access = table ? resolveTableAccess(auth, table) : null;
    if (!table || !access?.canRead) { await cleanup(); return res.status(404).json({ error: "找不到這個資料庫" }); }
    if (!access.canWriteRows) { await cleanup(); return res.status(403).json({ error: "這個資料庫目前只開放管理者寫入" }); }

    let mime = req.file.mimetype.split(";")[0].trim().toLowerCase();
    if (mime === "application/octet-stream" || mime === "") {
      const { mimeFromPath } = await import("./services/storage");
      mime = mimeFromPath(req.file.originalname);
    }
    if (!isAllowedUploadMime(mime)) {
      await cleanup();
      return res.status(415).json({ error: `不支援的檔案格式（${mime}）——支援：圖片（含 HEIC）/影片/音訊/PDF/Word/Excel/PowerPoint/文字/字幕/壓縮檔等常見格式` });
    }
    // QA-021：與 /api/upload 同一套檔頭簽名驗證——資料庫文件層同樣不能只信宣稱 MIME
    const verdict = resolveUploadMime(mime, await readFileHead(req.file.path));
    if (!verdict) {
      await cleanup();
      return res.status(415).json({ error: "檔案內容與宣稱的格式不符（無法辨識檔案簽名）——請確認檔案未損壞、副檔名正確" });
    }
    if (verdict.corrected) console.warn(`[databases:upload] MIME 依檔案內容校正：${mime} → ${verdict.mime}（${req.file.originalname}）`);
    mime = verdict.mime;
    const guard = await checkDiskSpace(req.file.size, true);
    if (guard) { await cleanup(); return res.status(507).json({ error: guard }); }
    const { insertDataFileUnderQuota, extractTextFromBuffer, MAX_EXTRACT_BYTES } = await import("./services/databaseFiles");

    const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const name = (String(req.body?.name ?? "").trim() || originalName || "上傳文件").slice(0, 120);
    // 先在暫存路徑抽文字（adopt 之後就要用正式路徑；小檔直接讀進記憶體）
    let textContent: string | null = null;
    if (req.file.size <= MAX_EXTRACT_BYTES) {
      const { readFile } = await import("node:fs/promises");
      const buf = await readFile(req.file.path);
      textContent = await extractTextFromBuffer(mime, name, buf);
    }
    const { storagePath, sizeBytes } = await adoptTmpFile(req.file.path, mime);
    try {
      // B9：配額 check+insert 同交易＋per-user 鎖，防併發超額
      const inserted = await insertDataFileUnderQuota(auth.user.id, sizeBytes, {
        tableId: table.id, name, mime, sizeBytes, storagePath,
        textContent, uploadedBy: auth.user.id,
      });
      if (!inserted.ok) {
        const { removeStoredFile } = await import("./services/storage");
        await removeStoredFile(storagePath).catch(() => {});
        return res.status(507).json({ error: inserted.error });
      }
      const file = inserted.row;
      // REST 上傳繞過 tRPC 的 mutation 審計中介層——比照 recordMcpAudit 自行落一筆（fire-and-forget）
      void (async () => {
        const { sanitizeAuditInput } = await import("./services/audit");
        await db.insert(schema.auditLog).values({
          actorId: auth.user.id,
          action: "databases.uploadFile",
          groupId: table.groupId,
          input: sanitizeAuditInput({ tableId: table.id, name, mime, sizeBytes }) as Record<string, unknown>,
          ok: true,
        });
      })().catch((e) => console.warn("[databases:upload] 審計寫入失敗（不影響主流程）：", e instanceof Error ? e.message : e));
      res.json({ ok: true, file: { id: file.id, name: file.name, readableChars: textContent?.length ?? 0 } });
    } catch (dbErr) {
      const { removeStoredFile } = await import("./services/storage");
      await removeStoredFile(storagePath); // DB 失敗 → 清掉已落地的孤兒檔
      throw dbErr;
    }
  } catch (err) {
    await cleanup();
    console.error("[databases:upload]", err);
    recordError("databases:upload", err);
    if (!res.headersSent) res.status(500).json({ error: "上傳失敗，請稍後再試" });
  }
});
app.use("/api/databases/upload", (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? `檔案太大（上限 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）` : `上傳失敗：${err.code}`;
    return res.status(413).json({ error: msg });
  }
  next(err);
});

/** 資料庫文件下載：登入＋資料庫讀取權（databaseAcl）；或帶 dbfile 簽名（給 fal 視覺模型抓圖，短效）；非影音一律 attachment */
app.get("/api/databases/files/:id/file", async (req, res) => {
  try {
    const { verifyDbFileSig } = await import("./services/storage");
    const signed = verifyDbFileSig(req.params.id, req.query.exp as string | undefined, req.query.sig as string | undefined);
    if (!signed) {
      const auth = await resolveSession(req);
      if (!requireUsableSession(auth, res)) return;
      const [fileRow] = await db.select().from(schema.dataFiles).where(eq(schema.dataFiles.id, req.params.id));
      if (!fileRow) return res.status(404).json({ error: "找不到這份文件" });
      const [tableRow] = await db.select().from(schema.dataTables)
        .where(and(eq(schema.dataTables.id, fileRow.tableId), isNull(schema.dataTables.deletedAt)));
      const { resolveTableAccess } = await import("./services/databaseAcl");
      if (!tableRow || !resolveTableAccess(auth, tableRow).canRead) return res.status(404).json({ error: "找不到這份文件" });
    }
    const [file] = await db.select().from(schema.dataFiles).where(eq(schema.dataFiles.id, req.params.id));
    if (!file) return res.status(404).json({ error: "找不到這份文件" });
    if (!file.storagePath) {
      // 純文字匯入（Notion/網頁）沒有原檔——給文字本體當下載內容
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}.txt`);
      return res.send(file.textContent ?? "");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (shouldForceAttachment(file.mime)) res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    sendStoredFile(res, absPathOf(file.storagePath), { headers: { "Content-Type": file.mime } }, "文件檔案遺失（可能是伺服器重啟前的舊檔）");
  } catch (err) {
    console.error("[databases:file]", err);
    if (!res.headersSent) res.status(500).json({ error: "讀取文件失敗" });
  }
});

// ── 資料下載區（需求 #11）：docs/README 白名單清單＋下載（登入即可，全站內部文件） ──
app.get("/api/downloads", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const { DOWNLOAD_CATEGORIES, listDownloads } = await import("./services/downloads");
    // 受限（內部工程/維運/安全/部署）文件只給組長以上：開發者、團隊管理員、或任一組的組長/管理員身分
    const privileged = auth.user.isSuperAdmin || auth.groups.some((g) => g.role !== "member");
    res.json({ ok: true, categories: DOWNLOAD_CATEGORIES, items: await listDownloads(privileged) });
  } catch (err) {
    console.error("[downloads:list]", err);
    recordError("downloads:list", err);
    if (!res.headersSent) res.status(500).json({ error: "清單讀取失敗，請稍後再試" });
  }
});
app.get("/api/downloads/file", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const { resolveDownload } = await import("./services/downloads");
    // 識別鍵必須整串等於白名單項（resolveDownload 內比對），不存在任何使用者輸入拼路徑的空間。
    // 受限文件（restricted）另要求組長以上——一般組員即使知道識別鍵也拿不到（後端硬擋，非只前端隱藏）。
    const privileged = auth.user.isSuperAdmin || auth.groups.some((g) => g.role !== "member");
    const hit = resolveDownload(String(req.query.name ?? ""), privileged);
    if (!hit) return res.status(404).json({ error: "找不到這份文件" });
    res.setHeader("X-Content-Type-Options", "nosniff");
    // res.download＝attachment 下載（含中文檔名的 RFC 5987 編碼）；檔案缺席走 err 分支回 404
    res.download(hit.absPath, hit.filename, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "文件暫時無法下載" });
    });
  } catch (err) {
    console.error("[downloads:file]", err);
    recordError("downloads:file", err);
    if (!res.headersSent) res.status(500).json({ error: "下載失敗，請稍後再試" });
  }
});

// ── Google 日曆直連同步（OAuth 授權碼流程）──瀏覽器重導，走 Express；API 見 routers/googleCalendar ──
app.get("/api/google/oauth/start", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const { isGoogleCalendarConfigured, buildAuthUrl } = await import("./services/googleCalendar");
    if (!isGoogleCalendarConfigured()) return res.status(503).json({ error: "站方尚未設定 Google 日曆整合（GOOGLE_CLIENT_ID/SECRET）" });
    res.redirect(buildAuthUrl(auth.user.id));
  } catch (err) {
    console.error("[gcal:oauth:start]", err);
    recordError("gcal:oauth:start", err);
    if (!res.headersSent) res.status(500).json({ error: "啟動授權失敗，請稍後再試" });
  }
});
app.get("/api/google/oauth/callback", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const { verifyState, exchangeCode, saveConnection } = await import("./services/googleCalendar");
    // state 驗簽＋比對登入者：防 CSRF、也防把授權綁到別人帳上
    const state = verifyState(String(req.query.state ?? ""));
    if (!state || state.userId !== auth.user.id) return res.redirect("/planner?gcal=state_mismatch");
    if (req.query.error) return res.redirect("/planner?gcal=denied"); // 使用者在 Google 畫面按了取消
    const code = String(req.query.code ?? "");
    if (!code) return res.redirect("/planner?gcal=denied");
    const { refreshToken, email } = await exchangeCode(code);
    await saveConnection(auth.user.id, refreshToken, email); // 落庫即觸發首輪同步
    res.redirect("/planner?gcal=connected");
  } catch (err) {
    console.error("[gcal:oauth:callback]", err);
    recordError("gcal:oauth:callback", err);
    if (!res.headersSent) res.redirect("/planner?gcal=failed");
  }
});

// ── 個人整合連接：Google 雲端硬碟 OAuth（drive.readonly）──瀏覽器重導，走 Express；API 見 routers/integrations ──
app.get("/api/integrations/google-drive/start", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const { isGoogleDriveConfigured, buildDriveAuthUrl } = await import("./services/integrations");
    if (!isGoogleDriveConfigured()) return res.status(503).json({ error: "站方尚未設定 Google 整合（GOOGLE_CLIENT_ID/SECRET）" });
    res.redirect(buildDriveAuthUrl(auth.user.id));
  } catch (err) {
    console.error("[integrations:gdrive:start]", err);
    recordError("integrations:gdrive:start", err);
    if (!res.headersSent) res.status(500).json({ error: "啟動授權失敗，請稍後再試" });
  }
});
app.get("/api/integrations/google-drive/callback", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const { verifyIntegrationState, exchangeDriveCode, saveGoogleDrive } = await import("./services/integrations");
    // state 驗簽＋比對登入者：防 CSRF、也防把授權綁到別人帳上
    const state = verifyIntegrationState(String(req.query.state ?? ""));
    if (!state || state.userId !== auth.user.id) return res.redirect("/integrations?gdrive=state_mismatch");
    if (req.query.error) return res.redirect("/integrations?gdrive=denied"); // 使用者在 Google 畫面按了取消
    const code = String(req.query.code ?? "");
    if (!code) return res.redirect("/integrations?gdrive=denied");
    const { refreshToken, email } = await exchangeDriveCode(code);
    await saveGoogleDrive(auth.user.id, refreshToken, email);
    // Express callback 繞過 tRPC 審計中介層——比照 MCP/上傳端點手動補記（fire-and-forget）
    const { recordAudit } = await import("./services/audit");
    recordAudit(auth, "integrations.googleDriveConnect", { email }, { ok: true });
    res.redirect("/integrations?gdrive=connected");
  } catch (err) {
    console.error("[integrations:gdrive:callback]", err);
    recordError("integrations:gdrive:callback", err);
    if (!res.headersSent) res.redirect("/integrations?gdrive=failed");
  }
});

// ── Adobe 帳號連結（#224 PR2）──瀏覽器重導，走 Express；API 見 routers/adobe ──
// mock 模式下 /start 直接導回自家 callback（不出網），讓連結／撤銷／狀態在沒有 Adobe 憑證時也能完整驗證。
app.get("/api/integrations/adobe/start", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const { isAdobeConfigured, buildAdobeAuthUrl } = await import("./services/adobe/oauth");
    if (!isAdobeConfigured()) return res.status(503).json({ error: "站方尚未設定 Adobe 整合（ADOBE_CLIENT_ID/SECRET）" });
    res.redirect(buildAdobeAuthUrl(auth.user.id));
  } catch (err) {
    console.error("[integrations:adobe:start]", err);
    recordError("integrations:adobe:start", err);
    if (!res.headersSent) res.status(500).json({ error: "啟動授權失敗，請稍後再試" });
  }
});
app.get("/api/integrations/adobe/callback", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const { verifyAdobeState } = await import("./services/adobe/oauth");
    // state 驗簽＋比對登入者：防 CSRF、也防把授權綁到別人帳上
    const state = verifyAdobeState(String(req.query.state ?? ""));
    if (!state || state.userId !== auth.user.id) return res.redirect("/integrations?adobe=state_mismatch");
    if (req.query.error) return res.redirect("/integrations?adobe=denied"); // 使用者在 Adobe 畫面按了取消
    const code = String(req.query.code ?? "");
    if (!code) return res.redirect("/integrations?adobe=denied");
    const { completeAdobeConnection } = await import("./services/adobe");
    const { email } = await completeAdobeConnection(auth.user.id, code);
    // Express callback 繞過 tRPC 審計中介層——比照 Google 雲端 callback 手動補記（fire-and-forget）
    const { recordAudit } = await import("./services/audit");
    recordAudit(auth, "adobe.connect", { email }, { ok: true });
    res.redirect("/integrations?adobe=connected");
  } catch (err) {
    console.error("[integrations:adobe:callback]", err);
    recordError("integrations:adobe:callback", err);
    if (!res.headersSent) res.redirect("/integrations?adobe=failed");
  }
});

// 組排程 .ics 匯出（需求 10 保留為後備）：登入＋組隔離；沒連結 Google 的人仍可手動匯入
app.get("/api/schedule/:groupId/calendar.ics", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const groupId = req.params.groupId;
    if (!auth.groups.some((g) => g.groupId === groupId)) return res.status(403).json({ error: "你不屬於這個組" });
    const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
    if (!group) return res.status(404).json({ error: "找不到組" });
    // QA-017：行事曆訂閱是「全量」用途——上限拉高到 2000（一組行程遠低於此；防炸僅防極端）
    const items = await db
      .select()
      .from(schema.scheduleItems)
      .where(eq(schema.scheduleItems.groupId, groupId))
      .orderBy(asc(schema.scheduleItems.startsAt))
      .limit(2000);
    const { buildIcs } = await import("./routers/schedule");
    res.attachment("組排程.ics"); // RFC 5987 中文檔名
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.send(buildIcs(group.name, items));
  } catch (err) {
    console.error("[schedule:ics]", err);
    recordError("schedule:ics", err);
    if (!res.headersSent) res.status(500).json({ error: "匯出失敗，請稍後再試" });
  }
});

// ── 個資自助匯出 v1（個資法「查詢／請求複本」權）：登入者一鍵下載「自己的」資料。
// 預設交付「創作者看得懂」的可讀 HTML；?format=json 仍提供原始 JSON。
// 範圍：帳號、組別、相關專案（世界觀摘要／分鏡／知識／角色／場景／我上傳素材）、
// 生成／留言／回饋／筆記／排程。絕不含 passwordHash、他人私訊。
// 帳號「刪除」仍需管理員操作——本端點只解決自助「攜出」。
app.get("/api/me/export", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const uid = auth.user.id;
    const groupNameById = new Map(auth.groups.map((g) => [g.groupId, g.groupName]));

    const [me] = await db.select().from(schema.users).where(eq(schema.users.id, uid));

    // ── 專案範圍：擁有者 ∪ 專案權限列 ∪ 曾在該專案生成 ──
    const ownedProjects = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.ownerId, uid))
      .orderBy(desc(schema.projects.updatedAt))
      .limit(200);
    const membershipRows = await db
      .select({
        projectId: schema.projectMembers.projectId,
        role: schema.projectMembers.role,
      })
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.userId, uid));
    const memberProjectIds = membershipRows.map((r) => r.projectId);
    const memberRoleByProject = new Map(membershipRows.map((r) => [r.projectId, r.role as "editor" | "viewer"]));

    const contributedIds = await db
      .selectDistinct({ projectId: schema.generations.projectId })
      .from(schema.generations)
      .where(eq(schema.generations.userId, uid))
      .limit(300);

    const projectIdSet = new Set<string>([
      ...ownedProjects.map((p) => p.id),
      ...memberProjectIds,
      ...contributedIds.map((r) => r.projectId),
    ]);

    // 補撈「權限列／貢獻」但非 owner 的專案列
    const needFetch = [...projectIdSet].filter((id) => !ownedProjects.some((p) => p.id === id));
    const extraProjects =
      needFetch.length > 0
        ? await db
            .select()
            .from(schema.projects)
            .where(inArray(schema.projects.id, needFetch.slice(0, 200)))
        : [];
    const allProjectRows = [...ownedProjects, ...extraProjects];
    // 去重（owner 與 member 可能重疊）
    const projectById = new Map(allProjectRows.map((p) => [p.id, p]));
    const projectIds = [...projectById.keys()].slice(0, 200);

    const titleByProjectId = new Map(
      [...projectById.values()].map((p) => [p.id, p.title] as const),
    );

    // 批次統計（避免 N+1）
    const toCountMap = (rows: Array<{ projectId: string; n: number }>) =>
      new Map(rows.map((r) => [r.projectId, r.n]));

    const emptyCounts = () => new Map<string, number>();
    const [sceneCounts, knowledgeCounts, characterCounts, presetCounts, propCounts, assetCounts, myGenCounts] =
      projectIds.length === 0
        ? [emptyCounts(), emptyCounts(), emptyCounts(), emptyCounts(), emptyCounts(), emptyCounts(), emptyCounts()]
        : await Promise.all([
            db
              .select({ projectId: schema.scenes.projectId, n: sql<number>`count(*)::int` })
              .from(schema.scenes)
              .where(and(inArray(schema.scenes.projectId, projectIds), isNull(schema.scenes.deletedAt)))
              .groupBy(schema.scenes.projectId)
              .then(toCountMap),
            db
              .select({ projectId: schema.knowledge.projectId, n: sql<number>`count(*)::int` })
              .from(schema.knowledge)
              .where(and(inArray(schema.knowledge.projectId, projectIds), isNull(schema.knowledge.deletedAt)))
              .groupBy(schema.knowledge.projectId)
              .then(toCountMap),
            db
              .select({ projectId: schema.characters.projectId, n: sql<number>`count(*)::int` })
              .from(schema.characters)
              .where(inArray(schema.characters.projectId, projectIds))
              .groupBy(schema.characters.projectId)
              .then(toCountMap),
            db
              .select({ projectId: schema.scenePresets.projectId, n: sql<number>`count(*)::int` })
              .from(schema.scenePresets)
              .where(inArray(schema.scenePresets.projectId, projectIds))
              .groupBy(schema.scenePresets.projectId)
              .then(toCountMap),
            db
              .select({ projectId: schema.props.projectId, n: sql<number>`count(*)::int` })
              .from(schema.props)
              .where(inArray(schema.props.projectId, projectIds))
              .groupBy(schema.props.projectId)
              .then(toCountMap),
            db
              .select({ projectId: schema.assets.projectId, n: sql<number>`count(*)::int` })
              .from(schema.assets)
              .where(and(inArray(schema.assets.projectId, projectIds), isNull(schema.assets.deletedAt)))
              .groupBy(schema.assets.projectId)
              .then(toCountMap),
            db
              .select({ projectId: schema.generations.projectId, n: sql<number>`count(*)::int` })
              .from(schema.generations)
              .where(and(eq(schema.generations.userId, uid), inArray(schema.generations.projectId, projectIds)))
              .groupBy(schema.generations.projectId)
              .then(toCountMap),
          ]);

    const scenesByProject = new Map<string, MyDataProjectExport["scenes"]>();
    const knowledgeByProject = new Map<string, MyDataProjectExport["knowledge"]>();
    const charactersByProject = new Map<string, MyDataProjectExport["characters"]>();
    const presetsByProject = new Map<string, MyDataProjectExport["scenePresets"]>();
    const propsByProject = new Map<string, MyDataProjectExport["props"]>();
    const myAssetsByProject = new Map<string, MyDataProjectExport["myAssets"]>();

    if (projectIds.length > 0) {
      const [sceneRows, knowledgeRows, characterRows, presetRows, propRows, myAssetRows] = await Promise.all([
        db
          .select({
            projectId: schema.scenes.projectId,
            orderIndex: schema.scenes.orderIndex,
            title: schema.scenes.title,
            status: schema.scenes.status,
            durationSec: schema.scenes.durationSec,
            prompt: schema.scenes.prompt,
            voiceover: schema.scenes.voiceover,
          })
          .from(schema.scenes)
          .where(and(inArray(schema.scenes.projectId, projectIds), isNull(schema.scenes.deletedAt)))
          .orderBy(asc(schema.scenes.orderIndex))
          .limit(2000),
        db
          .select({
            projectId: schema.knowledge.projectId,
            title: schema.knowledge.title,
            kind: schema.knowledge.kind,
            pinned: schema.knowledge.pinned,
          })
          .from(schema.knowledge)
          .where(and(inArray(schema.knowledge.projectId, projectIds), isNull(schema.knowledge.deletedAt)))
          .orderBy(desc(schema.knowledge.pinned), desc(schema.knowledge.createdAt))
          .limit(1000),
        db
          .select({
            projectId: schema.characters.projectId,
            name: schema.characters.name,
          })
          .from(schema.characters)
          .where(inArray(schema.characters.projectId, projectIds))
          .limit(500),
        db
          .select({
            projectId: schema.scenePresets.projectId,
            name: schema.scenePresets.name,
          })
          .from(schema.scenePresets)
          .where(inArray(schema.scenePresets.projectId, projectIds))
          .limit(500),
        db
          .select({
            projectId: schema.props.projectId,
            name: schema.props.name,
          })
          .from(schema.props)
          .where(inArray(schema.props.projectId, projectIds))
          .limit(500),
        db
          .select({
            projectId: schema.assets.projectId,
            title: schema.assets.title,
            kind: schema.assets.kind,
            createdAt: schema.assets.createdAt,
          })
          .from(schema.assets)
          .where(
            and(
              eq(schema.assets.uploadedBy, uid),
              inArray(schema.assets.projectId, projectIds),
              isNull(schema.assets.deletedAt),
            ),
          )
          .orderBy(desc(schema.assets.createdAt))
          .limit(500),
      ]);

      const pushCap = <T>(map: Map<string, T[]>, projectId: string, item: T, cap: number) => {
        const list = map.get(projectId) ?? [];
        if (list.length < cap) {
          list.push(item);
          map.set(projectId, list);
        }
      };
      for (const s of sceneRows) {
        pushCap(scenesByProject, s.projectId, {
          orderIndex: s.orderIndex,
          title: s.title,
          status: s.status,
          durationSec: s.durationSec,
          prompt: s.prompt,
          voiceover: s.voiceover,
        }, 80);
      }
      for (const k of knowledgeRows) {
        pushCap(knowledgeByProject, k.projectId, { title: k.title, kind: k.kind, pinned: k.pinned }, 40);
      }
      for (const c of characterRows) {
        pushCap(charactersByProject, c.projectId, { name: c.name }, 30);
      }
      for (const c of presetRows) {
        pushCap(presetsByProject, c.projectId, { name: c.name }, 30);
      }
      for (const c of propRows) {
        pushCap(propsByProject, c.projectId, { name: c.name }, 30);
      }
      for (const a of myAssetRows) {
        pushCap(myAssetsByProject, a.projectId, {
          title: a.title,
          kind: a.kind,
          createdAt: a.createdAt,
        }, 40);
      }
    }

    const ownedSet = new Set(ownedProjects.map((p) => p.id));
    const memberSet = new Set(memberProjectIds);
    const projectsExport: MyDataProjectExport[] = [...projectById.values()]
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
      .map((p) => {
        let relation: MyDataProjectExport["relation"] = "contributor";
        if (ownedSet.has(p.id)) relation = "owner";
        else if (memberSet.has(p.id)) relation = "member";
        const myProjectRole: MyDataProjectExport["myProjectRole"] = ownedSet.has(p.id)
          ? "owner"
          : memberRoleByProject.get(p.id) ?? null;
        return {
          id: p.id,
          title: p.title,
          kind: p.kind,
          platform: p.platform,
          format: p.format,
          status: p.status,
          groupId: p.groupId,
          groupName: groupNameById.get(p.groupId) ?? p.groupId,
          relation,
          myProjectRole,
          worldview: summarizeWorldview(p.worldview),
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          counts: {
            scenes: sceneCounts.get(p.id) ?? 0,
            knowledge: knowledgeCounts.get(p.id) ?? 0,
            characters: characterCounts.get(p.id) ?? 0,
            scenePresets: presetCounts.get(p.id) ?? 0,
            props: propCounts.get(p.id) ?? 0,
            assets: assetCounts.get(p.id) ?? 0,
            myGenerations: myGenCounts.get(p.id) ?? 0,
          },
          scenes: scenesByProject.get(p.id) ?? [],
          knowledge: knowledgeByProject.get(p.id) ?? [],
          characters: charactersByProject.get(p.id) ?? [],
          scenePresets: presetsByProject.get(p.id) ?? [],
          props: propsByProject.get(p.id) ?? [],
          myAssets: myAssetsByProject.get(p.id) ?? [],
        };
      });

    const generations = await db
      .select({
        id: schema.generations.id,
        projectId: schema.generations.projectId,
        modelId: schema.generations.modelId,
        kind: schema.generations.kind,
        prompt: schema.generations.prompt,
        status: schema.generations.status,
        pointsEst: schema.generations.pointsEst,
        pointsActual: schema.generations.pointsActual,
        createdAt: schema.generations.createdAt,
      })
      .from(schema.generations)
      .where(eq(schema.generations.userId, uid))
      .orderBy(desc(schema.generations.createdAt))
      .limit(1000);
    const myMessages = await db
      .select({
        id: schema.messages.id,
        projectId: schema.messages.projectId,
        body: schema.messages.body,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(eq(schema.messages.userId, uid))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1000);
    const myFeedback = await db
      .select()
      .from(schema.feedback)
      .where(eq(schema.feedback.userId, uid))
      .orderBy(desc(schema.feedback.createdAt))
      .limit(200);
    const myNotes = await db
      .select({
        id: schema.notes.id,
        title: schema.notes.title,
        content: schema.notes.content,
        projectId: schema.notes.projectId,
        updatedAt: schema.notes.updatedAt,
      })
      .from(schema.notes)
      .where(eq(schema.notes.createdBy, uid))
      .orderBy(desc(schema.notes.updatedAt))
      .limit(200);
    const mySchedule = await db
      .select({
        id: schema.scheduleItems.id,
        title: schema.scheduleItems.title,
        startsAt: schema.scheduleItems.startsAt,
        endsAt: schema.scheduleItems.endsAt,
        note: schema.scheduleItems.note,
        projectId: schema.scheduleItems.projectId,
        createdAt: schema.scheduleItems.createdAt,
      })
      .from(schema.scheduleItems)
      .where(eq(schema.scheduleItems.createdBy, uid))
      .orderBy(desc(schema.scheduleItems.createdAt))
      .limit(200);

    const withProjectTitle = <T extends { projectId?: string | null }>(rows: T[]) =>
      rows.map((r) => ({
        ...r,
        projectTitle: r.projectId ? titleByProjectId.get(r.projectId) ?? null : null,
      }));

    const payload = {
      exportedAt: new Date().toISOString(),
      user: { id: uid, name: auth.user.name, email: auth.user.email, createdAt: me?.createdAt ?? null },
      groups: auth.groups,
      projects: projectsExport,
      generations: withProjectTitle(generations),
      messages: withProjectTitle(myMessages),
      feedback: myFeedback,
      notes: withProjectTitle(myNotes),
      scheduleItems: withProjectTitle(mySchedule),
    };
    if (req.query.format === "json") {
      res.attachment("我的資料.json");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.send(JSON.stringify(payload, null, 2));
    } else {
      res.attachment("我的資料.html");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(renderMyDataHtml(payload));
    }
  } catch (err) {
    console.error("[me:export]", err);
    recordError("me:export", err);
    if (!res.headersSent) res.status(500).json({ error: "個資匯出失敗，請稍後再試" });
  }
});

// ── MCP transport 合約（QA-012）────────────────────────────────────────────
// Origin 政策：無 Origin（伺服器對伺服器，如 Claude Desktop/SDK）放行；同源放行；
// 其餘只允許白名單（MCP_ALLOWED_ORIGINS，逗號分隔）。瀏覽器跨源挾帶金鑰／DNS rebinding 明確 403。
const MCP_ALLOWED_ORIGINS = new Set(
  (process.env.MCP_ALLOWED_ORIGINS ?? "https://claude.ai,https://claude.com")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
function mcpOriginAllowed(req: express.Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    if (new URL(origin).host === req.headers.host) return true; // 同源
  } catch {
    return false; // Origin 不是合法 URL：一律拒絕
  }
  return MCP_ALLOWED_ORIGINS.has(origin);
}
/** 白名單內的跨源請求反射其 Origin（絕不用 wildcard 搭配 credential 類 header） */
function setMcpCors(req: express.Request, res: express.Response): void {
  const origin = req.headers.origin;
  if (!origin || !mcpOriginAllowed(req)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
}
app.options("/api/mcp", (req, res) => {
  if (!mcpOriginAllowed(req)) return res.status(403).json({ error: "此來源（Origin）不在 MCP 允許清單——管理員可設 MCP_ALLOWED_ORIGINS" });
  setMcpCors(req, res);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-api-key, mcp-protocol-version, accept");
  res.setHeader("Access-Control-Max-Age", "600");
  res.status(204).end();
});
// MCP 伺服器介面（正式環境由個人金鑰啟用；舊共用金鑰另需明確 ALLOW_LEGACY_MCP_ADMIN_KEY=1）
app.post("/api/mcp", (req, res, next) => {
  if (!mcpOriginAllowed(req)) return res.status(403).json({ error: "此來源（Origin）不在 MCP 允許清單——管理員可設 MCP_ALLOWED_ORIGINS" });
  setMcpCors(req, res);
  next();
}, handleMcp);
// 其他方法（GET/PUT/DELETE…）：本伺服器不提供 SSE stream。
// 未啟用時回 404（與 POST handleMcp 同口徑「不對外張揚端點存在」，修 get-mcp-advertises-when-disabled）；
// 已啟用才回 405 + Allow，不再落到 SPA catch-all 回 HTML 200 讓 SDK／監控誤判成功。
app.all("/api/mcp", async (_req, res) => {
  if (!(await isMcpEnabled())) {
    return void res.status(404).json({ error: "MCP 未啟用（請在「怎麼用」頁建立個人連線金鑰）" });
  }
  res.setHeader("Allow", "POST, OPTIONS");
  res.status(405).json({ error: "MCP 端點僅接受 JSON-RPC POST（不提供 GET/SSE）", allow: ["POST", "OPTIONS"] });
});

// 資料庫對外連接（本機腳本／手機 App／其他系統）：REST API v1 + CSV 匯出 + 行事曆訂閱。
// 認證＝個人 MCP 金鑰（x-api-key / ?key=）或 session cookie；授權沿用 databaseAcl。
app.get("/api/v1/databases", handleV1ListDatabases);
app.get("/api/v1/databases/:id/rows", handleV1ListRows);
app.post("/api/v1/databases/:id/rows", handleV1AddRow);
app.post("/api/v1/databases/:id/rows/batch", handleV1AddRowsBatch);
app.get("/api/databases/:id/rows.csv", handleCsvExport);
app.get("/api/databases/:id/calendar.ics", handleDatabaseIcs);

// 素材全站備份（UI：團隊管理「立即下載素材備份」；排程：Bearer ADMIN_BACKUP_TOKEN）
// 串流 tar.gz（內含 assets/），並寫 backup_runs → system.storageStatus.lastBackupAt
app.get("/api/admin/backup/assets.tar.gz", async (req, res) => {
  try {
    const { authorizeAssetBackup, streamAssetsTarGz } = await import("./services/assetBackup");
    const gate = await authorizeAssetBackup(req);
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.error });
      return;
    }
    await streamAssetsTarGz(res, gate.triggeredBy);
  } catch (err) {
    console.error("[backup:assets]", err);
    recordError("backup:assets", err);
    if (!res.headersSent) res.status(500).json({ error: "素材備份失敗" });
  }
});

// 系統自檢（開發者登入後用瀏覽器開，或管理頁按鈕）——部署後一鍵驗證所有子系統
app.get("/api/selftest", async (req, res) => {
  const auth = await resolveSession(req);
  if (!requireUsableSession(auth, res)) return;
  if (!auth.user.isSuperAdmin) return res.status(403).json({ error: "需要開發者帳號登入後使用" });
  const checks: Array<{ name: string; ok: boolean; note: string }> = [];
  const run = async (name: string, fn: () => Promise<string>) => {
    try {
      checks.push({ name, ok: true, note: await fn() });
    } catch (err) {
      checks.push({ name, ok: false, note: err instanceof Error ? err.message : String(err) });
    }
  };
  await run("資料庫連線", async () => {
    await db.execute(sql`select 1`);
    return "connected";
  });
  await run("資料表齊全", async () => {
    const result = (await db.execute(
      sql`select count(*)::int as n from information_schema.tables where table_schema='public'`,
    )) as unknown as { rows: Array<{ n: number }> };
    const n = result.rows?.[0]?.n ?? 0;
    if (n < 24) throw new Error(`只有 ${n} 張表(需 ≥24)——建表未完成`);
    return `${n} 張`;
  });
  await run("模型目錄", async () => {
    const rows = await db.select().from(schema.modelCatalog);
    if (rows.length < 70) throw new Error(`只有 ${rows.length} 條——啟動同步失敗?`);
    const falRows = rows.filter((row) => row.id.startsWith("fal-ai/") || row.endpoint.startsWith("fal-ai/"));
    const unverified = falRows.filter((row) => !row.verified);
    if (unverified.length > 0) {
      // 「尚未做付費真實生成」是目錄驗證進度，不是服務故障。
      // 保留數量與樣本供管理員追蹤，但不可讓 readiness/selftest 變成 500，
      // 否則 E2E 及正式環境會在模型仍可正常服務時被監控誤判離線。
      return `${rows.length} 條（Fal 已認證 ${falRows.length - unverified.length}／未認證 ${unverified.length}` +
        `；待驗例如 ${unverified.slice(0, 3).map((row) => row.id).join("、")}）`;
    }
    return `${rows.length} 條（Fal ${falRows.length} 條全部已有正式成功結果認證）`;
  });
  await run("點數設定可讀寫", async () => {
    const { getSettings } = await import("./services/points");
    const s = await getSettings();
    return `總預算 ${s.totalBudgetPoints ?? "不限"}／週 ${s.defaultWeeklyPoints ?? "不限"}／日 ${s.defaultDailyPoints ?? "不限"}`;
  });
  await run("邀請機制", async () => {
    const { createInvite, sha256 } = await import("./services/auth");
    const { token } = await createInvite({
      email: "selftest@example.com", teamId: "00000000-0000-0000-0000-000000000000",
      teamRole: "member", groupRole: "member", invitedBy: auth.user.id,
    });
    // DB 存的是 token 雜湊（#45），刪除時要先雜湊原文
    await db.delete(schema.invites).where(eq(schema.invites.token, sha256(token)));
    return "建立/銷毀 OK";
  });
  await run("生成模式", async () => {
    if (isMockMode()) return "E2E 測試模式(E2E_MOCK=1,僅供自動化測試——正式部署請移除)";
    if (!process.env.FAL_KEY) throw new Error("正式模式但 FAL_KEY 未設定——媒體生成會失敗,請到部署平台 Variables 填入金鑰");
    return "正式模式(FAL_KEY 已設)";
  });
  await run("儲存/交付(zip 引擎)", async () => {
    const { ZipArchive } = await import("archiver");
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.append("selftest", { name: "selftest.txt" });
    await archive.finalize();
    return "archiver OK";
  });
  await run("儲存層(Volume)", async () => {
    const { saveBuffer, removeStoredFile } = await import("./services/storage");
    const guard = await checkDiskSpace(1024);
    if (guard) throw new Error(guard);
    const probe = await saveBuffer(Buffer.from("selftest"), "text/plain");
    await removeStoredFile(probe.storagePath);
    // 持久性判定：掛 Volume 到 /data 或明設 ASSET_DIR 才算持久；否則落在容器本地磁碟，重新部署即遺失舊素材。
    // 正式環境用非持久磁碟＝定時炸彈（重啟後圖/旁白/成片全 404），自檢直接亮紅並給可執行修法。
    const persistent = !!process.env.ASSET_DIR || STORAGE_ROOT === "/data";
    if (!persistent && process.env.NODE_ENV === "production") {
      throw new Error(`素材存在容器本地磁碟（${STORAGE_ROOT}）非持久——重新部署會遺失所有舊素材（圖/旁白/成片）。請到 Zeabur 掛載 Volume 到 /data，或設環境變數 ASSET_DIR 指向持久磁碟`);
    }
    const volume = STORAGE_ROOT === "/data" ? "Volume /data" : process.env.ASSET_DIR ? `ASSET_DIR ${STORAGE_ROOT}` : `本機 ${STORAGE_ROOT}（非持久，僅供開發）`;
    return `${volume} 可讀寫`;
  });
  await run("近期錯誤", async () => {
    // 錯誤環形緩衝（services/errlog）：記憶體態、重啟歸零——外接 Sentry 前的最低限度觀測。
    // 過去 24 小時有任何 recordError 就亮紅，並列最近 3 筆讓管理員不用翻伺服器 log。
    const n = errorCountSince(24 * 60 * 60_000);
    if (n > 0) {
      const recent = listErrors()
        .slice(0, 3)
        .map((e) => `${e.at.slice(11, 16)} ${e.scope}${e.requestId ? ` [${e.requestId}]` : ""}: ${e.message.slice(0, 80)}`)
        .join("；");
      throw new Error(`24 小時內 ${n} 筆——${recent}`);
    }
    return "無";
  });
  await run("認證模式", async () => {
    // AUTH_MODE=dev 後門警示：正式環境雖會自動忽略（見 trpc.ts createContext 安全鎖），
    // 但誤留著等於「哪天有人把 NODE_ENV 弄錯就全站無認證」——自檢頁常駐提醒。
    if (process.env.AUTH_MODE === "dev") {
      throw new Error("⚠ AUTH_MODE=dev 已設定（正式環境會自動忽略，但請確認不是誤留）");
    }
    return "正常（登入制）";
  });
  await run("裝置綁定登入", async () => {
    // 設 enforce 但信箱機制沒就緒＝保證把所有人鎖在門外（陌生裝置要驗證碼，
    // 但驗證碼永遠寄不出去），包含超管、無後門。resolveDeviceTrustMode 已自動降級成
    // monitor，這裡把「你設的」與「實際生效的」落差亮出來，否則會靜默不生效。
    const { resolveDeviceTrustMode, deviceTrustMisconfigured } = await import("./services/deviceTrust");
    const { isEmailConfigured } = await import("./services/email");
    const effective = resolveDeviceTrustMode();
    if (deviceTrustMisconfigured()) {
      throw new Error(
        "⚠ DEVICE_TRUST_MODE=enforce 但信箱機制未設定（缺 RESEND_API_KEY／EMAIL_FROM）——" +
        "已自動降級為 monitor（只記錄不擋），否則陌生裝置將永遠收不到驗證碼而全員鎖死。" +
        "請先設定信箱機制並用管理頁「寄測試信給自己」確認寄得出去，再切回 enforce",
      );
    }
    const label = effective === "off"
      ? "未啟用（off）"
      : effective === "monitor"
        ? "暖身中（monitor：記錄並自動信任新裝置，不阻擋）"
        : "強制（enforce：陌生裝置需信箱驗證碼）";
    return `${label}｜信箱機制${isEmailConfigured() ? "已就緒" : "未設定"}`;
  });
  const allOk = checks.every((c) => c.ok);
  res.status(allOk ? 200 : 500).json({ ok: allOk, mockMode: isMockMode(), checks, time: new Date().toISOString() });
});

// tRPC API
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

// AI 專案助手「思考過程」串流（SSE）：與 tRPC assistant.ask 共用 runAssistantAsk 核心，
// 差別是逐步把「思考中／正在查什麼／查到什麼」推給前端即時呈現，最後 done 帶最終回答＋可執行動作。
// 前端串流失敗會自動退回 tRPC ask（見 ProjectAssistant），故此路由是加分體驗、非關鍵路徑。
app.post("/api/assistant/ask", async (req, res) => {
  const auth = await resolveSession(req);
  if (!requireUsableSession(auth, res)) return;
  const projectId = String(req.body?.projectId ?? "");
  const message = String(req.body?.message ?? "").trim();
  const nonce = typeof req.body?.nonce === "string" ? req.body.nonce.slice(0, 64) : undefined;
  // 模型檔位：非法值一律忽略而非報錯——寧可用免費的 NIM 回答，也不要因為偏好壞掉就不給答案。
  const parsedMode = agentPlannerModeSchema.safeParse(req.body?.mode);
  const mode = parsedMode.success ? parsedMode.data : undefined;
  // 工作台勾選的知識篇（最多 20）；非法 id 略過
  const rawKids = Array.isArray(req.body?.knowledgeIds) ? req.body.knowledgeIds : [];
  const knowledgeIds = rawKids
    .filter((x: unknown): x is string => typeof x === "string" && UUID_RE.test(x))
    .slice(0, 20);
  if (!UUID_RE.test(projectId) || !message || message.length > 1000) {
    return res.status(400).json({ error: "參數不正確（需 projectId 與 1–1000 字的問題）" });
  }
  // SSE 標頭：關快取、關代理緩衝（Nginx X-Accel-Buffering），讓事件即時逐筆送達
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // 用戶端斷線（切分頁/導航離開/送下一題）→ 中止在途 LLM 呼叫並提早跳出工具迴圈，比照 exporter 下載路由的 clientAbort，
  // 不再對死連線白燒 NIM 免費額度。closed 旗標同時守住 sse()/res.end() 不對已關閉/已結束的回應寫入（防 EPIPE/write-after-end）。
  const clientAbort = new AbortController();
  let closed = false;
  res.on("close", () => { closed = true; if (!res.writableEnded) clientAbort.abort(); });
  // 斷線後由 stream 非同步 emit 的 'error'（EPIPE/ERR_STREAM_DESTROYED）在此吸收成記錄，不讓它上升為未捕捉例外
  res.on("error", (e) => recordError("assistant:stream", e));

  const sse = (event: string, data: unknown) => {
    if (closed || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  // 心跳：相鄰事件間最壞可達一次 LLM 呼叫（~60s）全靜默，每 15 秒送一則 SSE 註解行（前端天然忽略）撐過代理 idle 逾時
  const heartbeat = setInterval(() => { if (!closed && !res.writableEnded) res.write(": ping\n\n"); }, 15_000);

  sse("open", { ok: true }); // 立刻開流，前端知道連上了（比等第一個 LLM 事件更即時）
  try {
    const { runAssistantAsk } = await import("./routers/assistant");
    const result = await runAssistantAsk(
      {
        projectId,
        message,
        auth,
        signal: clientAbort.signal,
        dedupeKey: nonce,
        mode,
        knowledgeIds: knowledgeIds.length ? knowledgeIds : undefined,
      },
      (e) => sse("step", e),
    );
    sse("done", result);
  } catch (err) {
    // runAssistantAsk 內部錯誤多已轉成 fallback 回答；會拋出的是節流/權限/找不到專案等守門（TRPCError 帶人話 message）。
    // 用戶端已斷線就別再記一筆噪音錯誤。
    if (!closed) {
      recordError("assistant:stream", err);
      sse("error", { message: err instanceof Error ? err.message : "AI 助手暫時沒回應，請稍後再試" });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

// ── 元件級回饋截圖（R23）：上傳（登入即可）＋依報告權限服務 ──
app.post("/api/feedback/screenshot", requireAuthBeforeUpload, upload.single("file"), async (req, res) => {
  const cleanup = async () => { if (req.file) await unlink(req.file.path).catch(() => {}); };
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) { await cleanup(); return; }
    if (!req.file) return res.status(400).json({ error: "沒有收到截圖" });
    const declared = (req.file.mimetype.split(";")[0] || "").trim().toLowerCase();
    if (declared !== "image/png" && declared !== "image/jpeg" && declared !== "image/webp") {
      await cleanup();
      return res.status(415).json({ error: "截圖格式需為 png/jpeg/webp" });
    }
    // 修 R3-UPLOAD-01：不只信宣稱 MIME——比照其他上傳路徑讀檔頭簽名驗證，內容非真實圖片一律 415。
    const verdict = resolveUploadMime(declared, await readFileHead(req.file.path));
    if (!verdict || !verdict.mime.startsWith("image/")) {
      await cleanup();
      return res.status(415).json({ error: "截圖內容與宣稱格式不符（無法辨識圖片簽名）" });
    }
    const mime = verdict.mime; // 用嗅探後的真實型別落地
    const guard = await checkDiskSpace(req.file.size, true);
    if (guard) { await cleanup(); return res.status(507).json({ error: guard }); }
    // 存進獨立 feedback/ 目錄（非 assets 池）：路徑前綴固定，submit/serve 才能白名單驗證杜絕跨組偷讀
    const { storagePath } = await adoptFeedbackShot(req.file.path, mime);
    res.json({ ok: true, path: storagePath });
  } catch (err) {
    await cleanup();
    recordError("feedback:screenshot", err); // 原始錯誤只進開發者可見的環形緩衝
    // 修 LOG3-002：回中性訊息，別把 err.message（含伺服器絕對路徑等內部細節）回給前端
    res.status(500).json({ error: "截圖上傳失敗，請稍後再試" });
  }
});

app.get("/api/feedback/:id/shot", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!requireUsableSession(auth, res)) return;
    const [report] = await db.select().from(schema.feedbackReports).where(eq(schema.feedbackReports.id, req.params.id));
    if (!report || !report.screenshotPath) return res.status(404).json({ error: "找不到截圖" });
    // 只服務 feedback/ 目錄下的截圖——擋掉「拿別池 asset 路徑當 screenshotPath 提交後偷讀」
    if (!isFeedbackShotPath(report.screenshotPath)) return res.status(404).json({ error: "找不到截圖" });
    // 作者本人、報告所屬組的組長/管理員、或開發者才看得到
    const canView =
      report.userId === auth.user.id ||
      auth.user.isSuperAdmin ||
      (report.groupId != null &&
        auth.groups.some((g) => g.groupId === report.groupId && (g.role === "leader" || g.role === "admin")));
    if (!canView) return res.status(403).json({ error: "沒有權限看這張截圖" });
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff"); // 截圖恆為圖片，維持 inline 但擋內容嗅探（#22）
    // 修 R3-STOR2-04：依實際副檔名給正確 Content-Type，別硬編 image/png——jpeg/webp 截圖配 nosniff 會破圖。
    // 合並並行 PR #105：沿用其 sendStoredFile（檔案遺失優雅處理），但 Content-Type 用動態嗅探（本修復）。
    const shotMime = mimeFromPath(report.screenshotPath);
    sendStoredFile(
      res,
      absPathOf(report.screenshotPath),
      { headers: { "Content-Type": shotMime.startsWith("image/") ? shotMime : "image/png" } },
      "截圖檔案遺失",
    );
  } catch (err) {
    console.error("[feedback:shot]", err);
    recordError("feedback:shot", err);
    if (!res.headersSent) res.status(500).json({ error: "讀取截圖失敗" });
  }
});

// 未知 /api/* 統一 JSON 404（QA-022）：必須放在所有 API 路由之後、SPA catch-all 之前——
// 否則正式環境未知 API 路徑會落到 index.html 回 HTML 200，讓監控與 SDK 誤判成功。
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: "找不到這個 API 路徑", path: req.path });
});

// 正式環境：服務打包後的前端（TD-07b：worker 僅健康檢查表面，不掛 SPA 靜態檔）
if (isProd && httpSurface.serveSpa) {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.join(dirname, "public");
  app.use((req, res, next) => {
    if (req.path === "/sw.js" || req.path === "/manifest.webmanifest") {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      if (req.path === "/sw.js") res.setHeader("Service-Worker-Allowed", "/");
    }
    next();
  });
  app.use(express.static(publicDir, {
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));
  app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
} else if (isProd && !httpSurface.serveSpa) {
  // worker-only：不回 index.html，明確 503 避免負載均衡把 UI 流量打到背景實例
  app.get("*", (_req, res) => {
    res.status(503).json({
      error: "此實例為 worker，僅提供健康檢查，不提供產品 UI",
      processRole,
    });
  });
}

// 統一 JSON 錯誤處理（QA-022）：body-parser 的 malformed JSON／過大請求不再回 Express 預設 HTML 錯誤頁。
// /api/mcp 依 JSON-RPC 慣例回 -32700 Parse error envelope；其他 /api/* 回 application/json 錯誤。
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const e = err as { type?: string; status?: number } | null;
  const isParse = e?.type === "entity.parse.failed" || (err instanceof SyntaxError && "body" in (err as object));
  const isTooLarge = e?.type === "entity.too.large";
  if (isParse || isTooLarge) {
    if (req.path === "/api/mcp") {
      return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: isTooLarge ? "Request entity too large" : "Parse error" } });
    }
    return res.status(isTooLarge ? 413 : 400).json({ error: isTooLarge ? "請求本文過大（上限 2MB）" : "JSON 格式不正確" });
  }
  if (res.headersSent) return next(err);
  if (req.path.startsWith("/api/")) {
    console.error("[api]", err);
    recordError("api:" + req.path, err);
    return res.status(500).json({
      error: "系統暫時無法處理，請稍後再試",
      requestId: res.locals.requestId as string | undefined,
    });
  }
  return next(err);
});

// 回饋截圖孤兒清理排程（#6）：DB 就緒後啟動，開機延遲數分鐘先跑一次，其後每 6 小時一次。
// 清理實作由儲存層提供；此處以動態 import 取用並全程容錯——函式缺席或執行失敗都靜默略過，
// 背景維護工作絕不外拋、不影響服務啟動或既有流程。
function scheduleFeedbackSweep(): void {
  const runSweep = async (): Promise<void> => {
    if (isShuttingDown()) return;
    try {
      const { sweepFeedbackShots } = await import("./services/storage");
      await sweepFeedbackShots();
    } catch (err) {
      console.warn("[sweep] 回饋截圖孤兒清理略過：", err instanceof Error ? err.message : err);
    }
  };
  const runTracked = () => {
    if (isShuttingDown()) return;
    void trackBackgroundTask(runSweep());
  };
  const firstRun = setTimeout(runTracked, 3 * 60_000); // 開機後 3 分鐘先跑一次
  const interval = setInterval(runTracked, 6 * 60 * 60_000); // 其後每 6 小時
  onShutdown(() => {
    clearTimeout(firstRun);
    clearInterval(interval);
  });
}

const httpServer = app.listen(port, () => {
  const falMode = isMockMode() ? "E2E 測試模式（僅供自動化測試）" : process.env.FAL_KEY ? "正式模式" : "正式模式（⚠ FAL_KEY 未設定，媒體生成會失敗）";
  console.log(`[server] AI Director OS 啟動於 :${port}（${isProd ? "production" : "development"}｜Fal ${falMode}）`);
  if (!httpSurface.serveSpa) {
    console.log(`[boot] PROCESS_ROLE=${processRole} — HTTP 僅健康檢查，不提供 SPA`);
  }
  try {
    ensureStorageDirs();
    console.log(`[server] 儲存層：${STORAGE_ROOT}${STORAGE_ROOT === "/data" ? "（持久 Volume）" : "（本機模式）"}`);
    // 素材保全：先判「這個路徑到底持不持久」（不是看目錄在不在——映像層裡本來就有 /data，
    // 那正是過去假綠燈的來源），再核對磁碟與資料庫兩側的卷指紋抓「換卷」。
    const persistence = assessStoragePersistence();
    if (!persistence.persistent) {
      setStorageDegraded("not-persistent", persistence.note);
      console.warn(`[server] ⚠ 儲存層不持久：${persistence.note}`);
    }
    // 卷指紋要讀資料庫，不能擋住 listen 回呼；失敗只記錄，下次開機再判。
    void verifyVolumeIdentity()
      .then((v) => {
        if (v.changed) console.warn(`[server] ⚠ 偵測到儲存磁碟更換（disk=${v.diskId} db=${v.dbId}）——舊素材可能已不在`);
      })
      .catch((err) => console.warn("[server] 儲存卷身分核對失敗（下次開機再試）：", err instanceof Error ? err.message : err));
  } catch (err) {
    console.warn("[server] 儲存目錄建立失敗（上傳/落地將不可用）：", err instanceof Error ? err.message : err);
  }
  if (isProd && process.env.AUTH_MODE === "dev") {
    console.warn("[server] ⚠⚠⚠ 正式環境偵測到 AUTH_MODE=dev（無認證後門）——已自動忽略不生效；請到 Variables 移除此變數。");
  }
  // 裝置綁定登入的生效模式（見 docs/device-trust-design.md）。
  // 設 enforce 卻沒有信箱機制＝陌生裝置永遠收不到驗證碼＝全員（含超管）鎖死且無後門，
  // 故 resolveDeviceTrustMode 會自動降級為 monitor；這裡把落差寫進開機 log，不必等人去點自檢頁。
  {
    const effective = resolveDeviceTrustMode();
    if (deviceTrustMisconfigured()) {
      console.warn(
        "[server] ⚠⚠⚠ DEVICE_TRUST_MODE=enforce 但信箱機制未設定（缺 RESEND_API_KEY／EMAIL_FROM）——" +
        "已自動降級為 monitor（只記錄不擋）。若照 enforce 執行，任何人換裝置都會收不到驗證碼而永久登不進來。",
      );
    } else if (effective !== "off") {
      console.log(`[server] 裝置綁定登入：${effective}`);
    }
  }
  // 背景初始化：失敗「不放棄」，每 60 秒自動重試到成功（健康檢查不等 DB 的原則不變）
  // ——修掉「DB 冷啟動超過 30 秒就永久卡死、看似健康實際全壞」的舊行為。
  let bootTries = 0;
  let bootRetryTimer: NodeJS.Timeout | undefined;
  onShutdown(() => {
    if (bootRetryTimer) clearTimeout(bootRetryTimer);
  });
  const bootstrap = async (): Promise<void> => {
    try {
      if (await ensureSchema()) {
        await syncCatalog();
        await ensureSeed();
        // 即時模型價＋新模型發現（無 FAL_KEY 時退回靜態）
        try {
          const { syncLiveModelCatalog } = await import("./services/modelLiveSync");
          const live = await syncLiveModelCatalog({ discoverPages: Number(process.env.LIVE_MODEL_DISCOVER_PAGES ?? 2) });
          console.log(
            `[boot] 模型即時目錄：靜態 ${live.staticUpserted}、即時價 ${live.priced}、新發現 ${live.discovered}` +
              (live.errors.length ? `（${live.errors[0]}）` : ""),
          );
          const everyMs = Number(process.env.LIVE_MODEL_SYNC_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
          if (everyMs > 0 && !isShuttingDown()) {
            const timer = setInterval(() => {
              if (isShuttingDown()) return;
              void syncLiveModelCatalog({ discoverPages: Number(process.env.LIVE_MODEL_DISCOVER_PAGES ?? 2) }).catch((err) =>
                console.warn("[modelLive] 週期同步失敗：", err instanceof Error ? err.message : err),
              );
            }, everyMs);
            timer.unref?.();
            onShutdown(() => clearInterval(timer));
          }
        } catch (err) {
          console.warn("[boot] 模型即時目錄同步略過：", err instanceof Error ? err.message : err);
        }
        if (isShuttingDown()) return;
        markBootReady();
        // TD-07：PROCESS_ROLE 分離 Web／Worker（web 不啟動 Runner；worker 仍與 all 同跑背景）
        // schema 驗證與種子同步後才啟動背景執行器，避免資料庫版本未就緒時空轉報錯。
        if (shouldRunWorkers(processRole)) {
          startWorkflowRunner();
          startGenerationRunner(); // A：單張生成也改由伺服器背景推進，關頁不再卡「生成中」
          startAgentRunner(); // AI 代理：核准後的計畫由伺服器背景逐步執行
          startGroupCampaignRunner(); // 組代理總指揮：跨專案調度計畫（派工／盯進度／授權內補救）
          // 走 trackBackgroundTask 與同區塊其他背景工作一致：關機時會被等完，不會在掃到一半被切斷。
          // 修復要排在陳屍掃描之前——先把中斷的步驟接回去，剩下的才是真的沒有進展。
          void trackBackgroundTask(
            recoverInterruptedCampaigns()
              .then(() => sweepStaleCampaigns())
              .catch((err) => console.warn("[groupAgent] 啟動修復／陳屍掃描失敗（下輪再試）：", err instanceof Error ? err.message : err)),
          );
          startExportRunner(); // 交付包匯出 job（QA-005）：背景打包＋進度＋過期清理
          startAssetMaintenanceRunner(); // 素材維護：落地強化／sha256／縮圖（有佇列才忙；BG_ASSET_MAINT=0 可關）
          scheduleFeedbackSweep(); // 背景孤兒清理排程（#6）
          startFeedbackAgent(); // 回饋代理：每 3 天分診未處理回饋、排修復、寄信回覆回報者
          const { startGoogleCalendarSweep } = await import("./services/googleCalendar");
          startGoogleCalendarSweep(); // Google 日曆同步：變更即推之外的週期對帳（未設 GOOGLE_CLIENT_ID 時為 no-op）
          console.log(`[boot] ✓ migration/schema 就緒；PROCESS_ROLE=${processRole}（背景執行器已啟動）`);
        } else {
          console.log(`[boot] ✓ migration/schema 就緒；PROCESS_ROLE=${processRole}（略過背景執行器）`);
        }
        return;
      }
    } catch (err) {
      console.warn("[boot] migration/schema 驗證、目錄或種子同步失敗：", err instanceof Error ? err.message : err);
    }
    if (isShuttingDown()) return;
    bootTries += 1;
    console.warn(`[boot] 初始化未完成，60 秒後自動重試（第 ${bootTries} 次）——瀏覽器開 /api/ready 可診斷`);
    bootRetryTimer = setTimeout(() => {
      if (isShuttingDown()) return;
      void trackBackgroundTask(bootstrap());
    }, 60_000);
  };
  void trackBackgroundTask(bootstrap());
});

// 即時協作（presence/游標/編輯指示/變更同步）：WS 升級掛在同一個 http server 上
attachRealtime(httpServer);

const SHUTDOWN_DEADLINE_MS = 25_000;
const handleShutdownSignal = (signal: NodeJS.Signals): void => {
  if (isShuttingDown()) {
    console.warn(`[shutdown] ${signal} received while already draining; duplicate signal ignored`);
    return;
  }

  // Readiness must turn red before listeners/timers begin their asynchronous
  // cleanup so the load balancer can remove this instance immediately.
  markBootDraining();
  if (!beginShutdown()) return;
  console.log(
    `[shutdown] ${signal} received; readiness disabled, HTTP/background drain started ` +
    `(tracked=${backgroundTaskCount()}, deadline=${SHUTDOWN_DEADLINE_MS}ms)`,
  );

  void drainHttpServer(httpServer, undefined, SHUTDOWN_DEADLINE_MS)
    .then((result) => {
      const code = result.forced || result.error ? 1 : 0;
      const status = result.forced ? "deadline exceeded; connections forced closed" : "drain complete";
      console.log(
        `[shutdown] ${status} in ${result.elapsedMs}ms` +
        (result.error ? `; server error=${result.error.message}` : ""),
      );
      // The pg pool and third-party SDKs may retain their own idle sockets.
      // All tracked work has settled here (or the hard deadline fired), so an
      // explicit exit is what makes the 25-second process bound enforceable.
      setImmediate(() => process.exit(code));
    })
    .catch((error) => {
      console.error("[shutdown] unexpected drain failure:", error instanceof Error ? error.message : error);
      httpServer.closeAllConnections?.();
      setImmediate(() => process.exit(1));
    });
};

process.on("SIGTERM", handleShutdownSignal);
process.on("SIGINT", handleShutdownSignal);
