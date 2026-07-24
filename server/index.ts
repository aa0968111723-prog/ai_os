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
import { resolveSession } from "./services/auth";
import { buildEdl, buildFcpxml, buildSrt, exportProjectZip } from "./services/exporter";
import { handleMcp } from "./services/mcp";
import { handleV1ListDatabases, handleV1ListRows, handleV1AddRow, handleCsvExport, handleDatabaseIcs } from "./services/restApi";
import {
  ensureStorageDirs, tmpDir, adoptTmpFile, adoptFeedbackShot, isFeedbackShotPath, absPathOf, checkDiskSpace, verifyAssetSig,
  isAllowedUploadMime, kindFromMime, shouldForceAttachment, MAX_FILE_BYTES, STORAGE_ROOT,
} from "./services/storage";
import { markBootReady, isBootReady } from "./services/boot";
import { recordError, listErrors, errorCountSince } from "./services/errlog";
import { attachRealtime } from "./services/realtime";
import { startWorkflowRunner } from "./services/workflowRunner";
import { startGenerationRunner } from "./services/generationRunner";
import { startAgentRunner } from "./services/agentRunner";
import { startFeedbackAgent } from "./services/feedbackAgent";
import { db, schema } from "./db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const isProd = process.env.NODE_ENV === "production";

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
  }),
);

app.use(express.json({ limit: "2mb" }));

// 健康檢查 — 純 HTTP，不碰 DB
app.get("/api/health", (_req, res) => {
  // 只回存活狀態，不外洩生成模式等內部資訊（#26）
  res.json({ ok: true, time: new Date().toISOString() });
});

// 就緒診斷 — 用瀏覽器打開就知道資料庫接通了沒（給非工程背景的自我診斷頁）
app.get("/api/ready", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    // ★安全：本端點「未認證」即可存取（給非工程背景者自助診斷 DB 是否接通）。
    // 只回「資料庫/初始化」這種安全的存活訊號；生成模式（mockMode）與 AUTH_MODE=dev 後門是否誤留，
    // 屬內部組態偵察面，改到需開發者登入的 /api/selftest 呈現（見該端點「生成模式」「認證模式」兩項），
    // 不對匿名訪客外洩。
    res.json({
      ok: true,
      db: "connected（資料庫已接通）",
      boot: isBootReady() ? "ready（初始化完成）" : "initializing（建表/種子進行中，稍候自動完成）",
    });
  } catch (err) {
    console.error("[ready] DB 連線失敗：", err instanceof Error ? err.message : err);
    res.status(503).json({
      ok: false,
      db: "error（資料庫未接通）",
      hint: "到部署平台的服務 Variables 檢查 DATABASE_URL 是否正確指向 PostgreSQL（Zeabur：跨服務引用連線字串），改完重新部署",
    });
  }
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

// 交付素材包下載（zip；session cookie 驗證＋組隔離）。
// 可選 ?assetIds=id1,id2（逗號分隔）＝素材庫多選打包：媒體檔只打包這些素材，交付文件照常。
app.get("/api/export/:projectId", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!auth) return res.status(401).json({ error: "請先登入" });
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, req.params.projectId));
    if (!project) return res.status(404).json({ error: "找不到專案" });
    if (!auth.groups.some((g) => g.groupId === project.groupId)) return res.status(403).json({ error: "你不屬於這個組" });
    const assetIds = String(req.query.assetIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => UUID_RE.test(s));
    await exportProjectZip(project.id, res, assetIds.length > 0 ? assetIds : undefined);
  } catch (err) {
    console.error("[export]", err);
    recordError("export", err); // 進錯誤環形緩衝（selftest「近期錯誤」）
    if (!res.headersSent) res.status(500).json({ error: "打包失敗，請稍後再試（管理員可查伺服器記錄）" });
  }
});

// 單檔時間軸/字幕下載（需求 #8）：?format=srt（剪映/CapCut/Premiere）｜fcpxml（Final Cut Pro/剪映專業版）｜edl（DaVinci Resolve）。
// 登入＋組隔離比照上方交付包路由；分鏡取未軟刪、依 orderIndex 排序，時間碼依各鏡秒數累計。
app.get("/api/export/:projectId/timeline", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!auth) return res.status(401).json({ error: "請先登入" });
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, req.params.projectId));
    if (!project) return res.status(404).json({ error: "找不到專案" });
    if (!auth.groups.some((g) => g.groupId === project.groupId)) return res.status(403).json({ error: "你不屬於這個組" });
    const format = String(req.query.format ?? "");
    if (format !== "srt" && format !== "fcpxml" && format !== "edl") {
      return res.status(400).json({ error: "format 需為 srt、fcpxml 或 edl" });
    }
    const scenes = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)))
      .orderBy(asc(schema.scenes.orderIndex));
    const file =
      format === "srt"
        ? { name: "字幕.srt", mime: "text/plain; charset=utf-8", body: buildSrt(scenes) }
        : format === "fcpxml"
          ? { name: "時間軸.fcpxml", mime: "application/xml; charset=utf-8", body: buildFcpxml(scenes, project.title) }
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
// 這道前置閘門讓未帶有效 session 的請求在讀取主體前就被拒（無 cookie 時 resolveSession 不查 DB，零成本）。
// 已認證者處理器內仍會再 resolveSession 一次取完整 AuthState（多一次帶索引的輕量查詢，可接受）。
async function requireAuthBeforeUpload(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  try {
    const auth = await resolveSession(req);
    if (!auth) { res.status(401).json({ error: "請先登入" }); return; }
    next();
  } catch (err) {
    recordError("upload:auth", err);
    res.status(500).json({ error: "驗證失敗，請稍後再試" });
  }
}

/** 上傳素材（multipart: file + projectId [+ title]）→ 入素材庫、回傳 asset */
app.post("/api/upload", requireAuthBeforeUpload, upload.single("file"), async (req, res) => {
  const cleanup = async () => { if (req.file) await unlink(req.file.path).catch(() => {}); };
  try {
    const auth = await resolveSession(req);
    if (!auth) { await cleanup(); return res.status(401).json({ error: "請先登入" }); }
    if (!req.file) return res.status(400).json({ error: "沒有收到檔案（欄位名要是 file）" });

    const projectId = String(req.body?.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
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
    const guard = await checkDiskSpace(req.file.size);
    if (guard) { await cleanup(); return res.status(507).json({ error: guard }); }

    // adoptTmpFile 已把暫存檔「移到」Volume 正式位置——之後若 DB 寫入失敗，
    // 要刪的是這個已落地的檔（storagePath），不是原暫存路徑（已不存在）；
    // 否則會在 Volume 留下沒有 DB 列指向的孤兒檔案，長期累積吃滿磁碟。
    const { storagePath, sizeBytes } = await adoptTmpFile(req.file.path, mime);
    try {
      const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8"); // multer 檔名編碼修正
      const title = String(req.body?.title ?? "").trim() || originalName || "上傳素材";
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
          meta: { originalName },
        })
        .returning();
      const [updated] = await db
        .update(schema.assets)
        .set({ url: `/api/assets/${asset.id}/file` })
        .where(eq(schema.assets.id, asset.id))
        .returning();
      res.json({ ok: true, asset: updated });
    } catch (dbErr) {
      const { removeStoredFile } = await import("./services/storage");
      await removeStoredFile(storagePath); // DB 失敗 → 清掉已落地的孤兒檔
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
app.get("/api/assets/:id/file", async (req, res) => {
  try {
    const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, req.params.id));
    if (!asset) return res.status(404).json({ error: "找不到素材" });

    const signed = verifyAssetSig(asset.id, req.query.exp as string | undefined, req.query.sig as string | undefined);
    if (!signed) {
      const auth = await resolveSession(req);
      if (!auth) return res.status(401).json({ error: "請先登入" });
      if (!auth.groups.some((g) => g.groupId === asset.groupId)) return res.status(403).json({ error: "你不屬於這個組" });
    }

    if (!asset.storagePath) {
      if (asset.url && /^https?:\/\//.test(asset.url)) return res.redirect(302, asset.url); // 尚未落地→轉外部網址
      return res.status(404).json({ error: "此素材沒有可用的檔案" });
    }
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const mime = asset.mime ?? "application/octet-stream";
    // 圖片/影音維持 inline（縮圖與播放需要）；doc/pdf/txt 與 SVG（可含腳本）強制下載，
    // 避免瀏覽器內嵌渲染帶來的 XSS/內容嗅探風險（#19）
    if (shouldForceAttachment(mime)) res.setHeader("Content-Disposition", "attachment");
    // sendFile 內建 Range 支援（影片/音訊拖進度條需要）
    res.sendFile(absPathOf(asset.storagePath), {
      headers: { "Content-Type": mime },
    });
  } catch (err) {
    console.error("[assets:file]", err);
    if (!res.headersSent) res.status(500).json({ error: "讀取素材失敗" });
  }
});

// ── 資料庫文件（AI 可讀檔案層）：上傳＋下載（權限走 databaseAcl，配額每人 5GB 可調） ──

/** 上傳文件到資料庫（multipart: file + tableId [+ name]）→ 抽純文字供 AI 讀、回傳檔案列 */
app.post("/api/databases/upload", requireAuthBeforeUpload, upload.single("file"), async (req, res) => {
  const cleanup = async () => { if (req.file) await unlink(req.file.path).catch(() => {}); };
  try {
    const auth = await resolveSession(req);
    if (!auth) { await cleanup(); return res.status(401).json({ error: "請先登入" }); }
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
    const guard = await checkDiskSpace(req.file.size);
    if (guard) { await cleanup(); return res.status(507).json({ error: guard }); }
    const { quotaGuardError, extractTextFromBuffer, MAX_EXTRACT_BYTES } = await import("./services/databaseFiles");
    const quotaErr = await quotaGuardError(auth.user.id, req.file.size);
    if (quotaErr) { await cleanup(); return res.status(507).json({ error: quotaErr }); }

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
      const [file] = await db.insert(schema.dataFiles).values({
        tableId: table.id, name, mime, sizeBytes, storagePath,
        textContent, uploadedBy: auth.user.id,
      }).returning();
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
      if (!auth) return res.status(401).json({ error: "請先登入" });
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
    res.sendFile(absPathOf(file.storagePath), { headers: { "Content-Type": file.mime } });
  } catch (err) {
    console.error("[databases:file]", err);
    if (!res.headersSent) res.status(500).json({ error: "讀取文件失敗" });
  }
});

// ── 資料下載區（需求 #11）：docs/README 白名單清單＋下載（登入即可，全站內部文件） ──
app.get("/api/downloads", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!auth) return res.status(401).json({ error: "請先登入" });
    const { DOWNLOAD_CATEGORIES, listDownloads } = await import("./services/downloads");
    res.json({ ok: true, categories: DOWNLOAD_CATEGORIES, items: await listDownloads() });
  } catch (err) {
    console.error("[downloads:list]", err);
    recordError("downloads:list", err);
    if (!res.headersSent) res.status(500).json({ error: "清單讀取失敗，請稍後再試" });
  }
});
app.get("/api/downloads/file", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!auth) return res.status(401).json({ error: "請先登入" });
    const { resolveDownload } = await import("./services/downloads");
    // 識別鍵必須整串等於白名單項（resolveDownload 內比對），不存在任何使用者輸入拼路徑的空間
    const hit = resolveDownload(String(req.query.name ?? ""));
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

// 組排程 .ics 匯出（需求 10）：登入＋組隔離；下載後匯入個人 Google/Apple 日曆（不做 OAuth 雙向同步）
app.get("/api/schedule/:groupId/calendar.ics", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!auth) return res.status(401).json({ error: "請先登入" });
    const groupId = req.params.groupId;
    if (!auth.groups.some((g) => g.groupId === groupId)) return res.status(403).json({ error: "你不屬於這個組" });
    const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
    if (!group) return res.status(404).json({ error: "找不到組" });
    const items = await db
      .select()
      .from(schema.scheduleItems)
      .where(eq(schema.scheduleItems.groupId, groupId))
      .orderBy(asc(schema.scheduleItems.startsAt))
      .limit(500);
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

// ── 個資自助匯出 v1（個資法「查詢／請求複本」權）：登入者一鍵下載「自己的」資料 JSON。
// 範圍嚴格限本人：帳號基本資料（絕不含 passwordHash）、所屬組、自己的生成紀錄／留言／回饋／筆記／排程。
// 帳號「刪除」仍需管理員操作（見維運手冊）——本端點只解決自助「攜出」，不做自助刪除。
app.get("/api/me/export", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!auth) return res.status(401).json({ error: "請先登入" });
    const uid = auth.user.id;
    // AuthState 沒帶 createdAt，補查一次 users（只取安全欄位，密碼雜湊絕不進 payload）
    const [me] = await db.select().from(schema.users).where(eq(schema.users.id, uid));
    const generations = await db
      .select({
        id: schema.generations.id,
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
      .limit(1000); // 新到舊；上限防單人海量生成把回應撐爆
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
        updatedAt: schema.notes.updatedAt,
      })
      .from(schema.notes)
      .where(eq(schema.notes.createdBy, uid))
      .orderBy(desc(schema.notes.updatedAt))
      .limit(200);
    const mySchedule = await db
      .select()
      .from(schema.scheduleItems)
      .where(eq(schema.scheduleItems.createdBy, uid))
      .orderBy(desc(schema.scheduleItems.createdAt))
      .limit(200);
    const payload = {
      exportedAt: new Date().toISOString(),
      user: { id: uid, name: auth.user.name, email: auth.user.email, createdAt: me?.createdAt ?? null },
      groups: auth.groups,
      generations,
      messages: myMessages,
      feedback: myFeedback,
      notes: myNotes,
      scheduleItems: mySchedule,
    };
    res.attachment("我的資料.json"); // RFC 5987 中文檔名下載安全
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("[me:export]", err);
    recordError("me:export", err);
    if (!res.headersSent) res.status(500).json({ error: "個資匯出失敗，請稍後再試" });
  }
});

// MCP 伺服器介面（設 MCP_API_KEY 啟用；供外部 AI 客戶端操作）
app.post("/api/mcp", handleMcp);

// 資料庫對外連接（本機腳本／手機 App／其他系統）：REST API v1 + CSV 匯出 + 行事曆訂閱。
// 認證＝個人 MCP 金鑰（x-api-key / ?key=）或 session cookie；授權沿用 databaseAcl。
app.get("/api/v1/databases", handleV1ListDatabases);
app.get("/api/v1/databases/:id/rows", handleV1ListRows);
app.post("/api/v1/databases/:id/rows", handleV1AddRow);
app.get("/api/databases/:id/rows.csv", handleCsvExport);
app.get("/api/databases/:id/calendar.ics", handleDatabaseIcs);

// 系統自檢（開發者登入後用瀏覽器開，或管理頁按鈕）——部署後一鍵驗證所有子系統
app.get("/api/selftest", async (req, res) => {
  const auth = await resolveSession(req);
  if (!auth?.user.isSuperAdmin) return res.status(403).json({ error: "需要開發者帳號登入後使用" });
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
    return `${rows.length} 條(12 類)`;
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
    const volume = STORAGE_ROOT === "/data" ? "Volume /data" : `本機 ${STORAGE_ROOT}`;
    return `${volume} 可讀寫`;
  });
  await run("近期錯誤", async () => {
    // 錯誤環形緩衝（services/errlog）：記憶體態、重啟歸零——外接 Sentry 前的最低限度觀測。
    // 過去 24 小時有任何 recordError 就亮紅，並列最近 3 筆讓管理員不用翻伺服器 log。
    const n = errorCountSince(24 * 60 * 60_000);
    if (n > 0) {
      const recent = listErrors()
        .slice(0, 3)
        .map((e) => `${e.at.slice(11, 16)} ${e.scope}: ${e.message.slice(0, 80)}`)
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
  if (!auth) return res.status(401).json({ error: "請先登入" });
  const projectId = String(req.body?.projectId ?? "");
  const message = String(req.body?.message ?? "").trim();
  if (!UUID_RE.test(projectId) || !message || message.length > 1000) {
    return res.status(400).json({ error: "參數不正確（需 projectId 與 1–1000 字的問題）" });
  }
  // SSE 標頭：關快取、關代理緩衝（Nginx X-Accel-Buffering），讓事件即時逐筆送達
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const sse = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  sse("open", { ok: true }); // 立刻開流，前端知道連上了（比等第一個 LLM 事件更即時）
  try {
    const { runAssistantAsk } = await import("./routers/assistant");
    const result = await runAssistantAsk(
      { projectId, message, userId: auth.user.id, isInGroup: (g) => auth.groups.some((x) => x.groupId === g) },
      (e) => sse("step", e),
    );
    sse("done", result);
  } catch (err) {
    // runAssistantAsk 內部錯誤多已轉成 fallback 回答；會拋出的是節流/權限/找不到專案等守門（TRPCError 帶人話 message）
    recordError("assistant:stream", err);
    sse("error", { message: err instanceof Error ? err.message : "AI 助手暫時沒回應，請稍後再試" });
  } finally {
    res.end();
  }
});

// ── 元件級回饋截圖（R23）：上傳（登入即可）＋依報告權限服務 ──
app.post("/api/feedback/screenshot", requireAuthBeforeUpload, upload.single("file"), async (req, res) => {
  const cleanup = async () => { if (req.file) await unlink(req.file.path).catch(() => {}); };
  try {
    const auth = await resolveSession(req);
    if (!auth) { await cleanup(); return res.status(401).json({ error: "請先登入" }); }
    if (!req.file) return res.status(400).json({ error: "沒有收到截圖" });
    const mime = (req.file.mimetype.split(";")[0] || "").trim().toLowerCase();
    if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") {
      await cleanup();
      return res.status(415).json({ error: "截圖格式需為 png/jpeg/webp" });
    }
    const guard = await checkDiskSpace(req.file.size);
    if (guard) { await cleanup(); return res.status(507).json({ error: guard }); }
    // 存進獨立 feedback/ 目錄（非 assets 池）：路徑前綴固定，submit/serve 才能白名單驗證杜絕跨組偷讀
    const { storagePath } = await adoptFeedbackShot(req.file.path, mime);
    res.json({ ok: true, path: storagePath });
  } catch (err) {
    await cleanup();
    recordError("feedback:screenshot", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "截圖上傳失敗" });
  }
});

app.get("/api/feedback/:id/shot", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!auth) return res.status(401).json({ error: "請先登入" });
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
    res.sendFile(absPathOf(report.screenshotPath), { headers: { "Content-Type": "image/png" } });
  } catch (err) {
    console.error("[feedback:shot]", err);
    recordError("feedback:shot", err);
    if (!res.headersSent) res.status(500).json({ error: "讀取截圖失敗" });
  }
});

// 正式環境：服務打包後的前端
if (isProd) {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.join(dirname, "public");
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
}

// 回饋截圖孤兒清理排程（#6）：DB 就緒後啟動，開機延遲數分鐘先跑一次，其後每 6 小時一次。
// 清理實作由儲存層提供；此處以動態 import 取用並全程容錯——函式缺席或執行失敗都靜默略過，
// 背景維護工作絕不外拋、不影響服務啟動或既有流程。
function scheduleFeedbackSweep(): void {
  const runSweep = async (): Promise<void> => {
    try {
      const { sweepFeedbackShots } = await import("./services/storage");
      await sweepFeedbackShots();
    } catch (err) {
      console.warn("[sweep] 回饋截圖孤兒清理略過：", err instanceof Error ? err.message : err);
    }
  };
  setTimeout(() => void runSweep(), 3 * 60_000); // 開機後 3 分鐘先跑一次
  setInterval(() => void runSweep(), 6 * 60 * 60_000); // 其後每 6 小時
}

const httpServer = app.listen(port, () => {
  const falMode = isMockMode() ? "E2E 測試模式（僅供自動化測試）" : process.env.FAL_KEY ? "正式模式" : "正式模式（⚠ FAL_KEY 未設定，媒體生成會失敗）";
  console.log(`[server] AI Director OS 啟動於 :${port}（${isProd ? "production" : "development"}｜Fal ${falMode}）`);
  try {
    ensureStorageDirs();
    console.log(`[server] 儲存層：${STORAGE_ROOT}${STORAGE_ROOT === "/data" ? "（持久 Volume）" : "（本機模式）"}`);
  } catch (err) {
    console.warn("[server] 儲存目錄建立失敗（上傳/落地將不可用）：", err instanceof Error ? err.message : err);
  }
  if (isProd && process.env.AUTH_MODE === "dev") {
    console.warn("[server] ⚠⚠⚠ 正式環境偵測到 AUTH_MODE=dev（無認證後門）——已自動忽略不生效；請到 Variables 移除此變數。");
  }
  // 背景初始化：失敗「不放棄」，每 60 秒自動重試到成功（健康檢查不等 DB 的原則不變）
  // ——修掉「DB 冷啟動超過 30 秒就永久卡死、看似健康實際全壞」的舊行為。
  let bootTries = 0;
  const bootstrap = async (): Promise<void> => {
    try {
      if (await ensureSchema()) {
        await syncCatalog();
        await ensureSeed();
        markBootReady();
        // DB 就緒後才啟動背景執行器（每數秒讀 workflow_runs/generations，建表前啟動只會空轉報錯）
        startWorkflowRunner();
        startGenerationRunner(); // A：單張生成也改由伺服器背景推進，關頁不再卡「生成中」
        startAgentRunner(); // AI 代理：核准後的計畫由伺服器背景逐步執行
        scheduleFeedbackSweep(); // 背景孤兒清理排程（#6）
        startFeedbackAgent(); // 回饋代理：每 3 天分診未處理回饋、排修復、寄信回覆回報者
        console.log("[boot] ✓ 建表/目錄/種子完成，系統就緒（工作流＋單張生成執行器已啟動）");
        return;
      }
    } catch (err) {
      console.warn("[boot] 建表/目錄/種子失敗：", err instanceof Error ? err.message : err);
    }
    bootTries += 1;
    console.warn(`[boot] 初始化未完成，60 秒後自動重試（第 ${bootTries} 次）——瀏覽器開 /api/ready 可診斷`);
    setTimeout(() => { void bootstrap(); }, 60_000);
  };
  void bootstrap();
});

// 即時協作（presence/游標/編輯指示/變更同步）：WS 升級掛在同一個 http server 上
attachRealtime(httpServer);
