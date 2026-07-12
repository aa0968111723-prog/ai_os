/**
 * AI Director OS — 伺服器入口
 * 一個服務包三件事：健康檢查、tRPC API、（正式環境）React 靜態檔。
 * 原則：健康檢查不等 DB（healing-studio 的部署教訓）。
 */
import express from "express";
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
import { exportProjectZip } from "./services/exporter";
import { handleMcp } from "./services/mcp";
import {
  ensureStorageDirs, tmpDir, adoptTmpFile, absPathOf, checkDiskSpace, verifyAssetSig,
  isAllowedUploadMime, kindFromMime, MAX_FILE_BYTES, STORAGE_ROOT,
} from "./services/storage";
import { markBootReady, isBootReady } from "./services/boot";
import { db, schema } from "./db";
import { eq, sql } from "drizzle-orm";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const isProd = process.env.NODE_ENV === "production";

app.use(express.json({ limit: "2mb" }));

// 健康檢查 — 純 HTTP，不碰 DB
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mockMode: isMockMode(), time: new Date().toISOString() });
});

// 就緒診斷 — 用瀏覽器打開就知道資料庫接通了沒（給非工程背景的自我診斷頁）
app.get("/api/ready", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({
      ok: true,
      db: "connected（資料庫已接通）",
      boot: isBootReady() ? "ready（初始化完成）" : "initializing（建表/種子進行中，稍候自動完成）",
      mockMode: isMockMode(),
    });
  } catch (err) {
    console.error("[ready] DB 連線失敗：", err instanceof Error ? err.message : err);
    res.status(503).json({
      ok: false,
      db: "error（資料庫未接通）",
      hint: "到 Railway App 服務 Variables 檢查 DATABASE_URL 是否用 Add Reference 引用了 Postgres，改完按 Redeploy",
    });
  }
});

// 假生成素材端點（FAL 假模式用；離線可測，交付包也抓得到）
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
  // 影片亦回傳圖片位元組（假模式重點是流程可測；正式模式為真實 mp4）
  res.setHeader("Content-Type", "image/png");
  res.send(MOCK_PNG);
});

// 交付素材包下載（zip；session cookie 驗證＋組隔離）
app.get("/api/export/:projectId", async (req, res) => {
  try {
    const auth = await resolveSession(req);
    if (!auth) return res.status(401).json({ error: "請先登入" });
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, req.params.projectId));
    if (!project) return res.status(404).json({ error: "找不到專案" });
    if (!auth.groups.some((g) => g.groupId === project.groupId)) return res.status(403).json({ error: "你不屬於這個組" });
    await exportProjectZip(project.id, res);
  } catch (err) {
    console.error("[export]", err);
    if (!res.headersSent) res.status(500).json({ error: "打包失敗，請稍後再試（管理員可查伺服器記錄）" });
  }
});

// ── 真實儲存層：上傳素材＋檔案服務（Volume /data） ──────────────

const upload = multer({
  storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, tmpDir()) }),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

/** 上傳素材（multipart: file + projectId [+ title]）→ 入素材庫、回傳 asset */
app.post("/api/upload", upload.single("file"), async (req, res) => {
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

    let mime = req.file.mimetype.split(";")[0].trim().toLowerCase();
    // 瀏覽器對 .md/.txt 等常送 application/octet-stream——改用副檔名後備判斷
    if (mime === "application/octet-stream" || mime === "") {
      const { mimeFromPath } = await import("./services/storage");
      mime = mimeFromPath(req.file.originalname);
    }
    if (!isAllowedUploadMime(mime)) {
      await cleanup();
      return res.status(415).json({ error: `不支援的檔案格式（${mime}）——支援：圖片/影片/音訊/zip/文字/PDF` });
    }
    const guard = await checkDiskSpace(req.file.size);
    if (guard) { await cleanup(); return res.status(507).json({ error: guard }); }

    const { storagePath, sizeBytes } = await adoptTmpFile(req.file.path, mime);
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
  } catch (err) {
    await cleanup();
    console.error("[upload]", err);
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
    // sendFile 內建 Range 支援（影片/音訊拖進度條需要）
    res.sendFile(absPathOf(asset.storagePath), {
      headers: { "Content-Type": asset.mime ?? "application/octet-stream" },
    });
  } catch (err) {
    console.error("[assets:file]", err);
    if (!res.headersSent) res.status(500).json({ error: "讀取素材失敗" });
  }
});

// MCP 伺服器介面（設 MCP_API_KEY 啟用；供外部 AI 客戶端操作）
app.post("/api/mcp", handleMcp);

// 系統自檢（超管登入後用瀏覽器開，或管理頁按鈕）——部署後一鍵驗證所有子系統
app.get("/api/selftest", async (req, res) => {
  const auth = await resolveSession(req);
  if (!auth?.user.isSuperAdmin) return res.status(403).json({ error: "需要超管登入後使用" });
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
    if (n < 19) throw new Error(`只有 ${n} 張表(需 ≥19)——建表未完成`);
    return `${n} 張`;
  });
  await run("模型目錄", async () => {
    const rows = await db.select().from(schema.modelCatalog);
    if (rows.length < 70) throw new Error(`只有 ${rows.length} 條——啟動同步失敗?`);
    return `${rows.length} 條(11 類)`;
  });
  await run("點數設定可讀寫", async () => {
    const { getSettings } = await import("./services/points");
    const s = await getSettings();
    return `總預算 ${s.totalBudgetPoints ?? "不限"}／週 ${s.defaultWeeklyPoints ?? "不限"}`;
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
  await run("生成模式", async () =>
    isMockMode() ? "假生成(免費)——填 FAL_KEY 並移除 FAL_MOCK 切真實" : "真實模式(FAL_KEY 已設)",
  );
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
  const allOk = checks.every((c) => c.ok);
  res.status(allOk ? 200 : 500).json({ ok: allOk, mockMode: isMockMode(), checks, time: new Date().toISOString() });
});

// tRPC API
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

// 正式環境：服務打包後的前端
if (isProd) {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.join(dirname, "public");
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
}

app.listen(port, () => {
  console.log(`[server] AI Director OS 啟動於 :${port}（${isProd ? "production" : "development"}｜Fal ${isMockMode() ? "假生成模式" : "真實模式"}）`);
  try {
    ensureStorageDirs();
    console.log(`[server] 儲存層：${STORAGE_ROOT}${STORAGE_ROOT === "/data" ? "（Railway Volume）" : "（本機模式）"}`);
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
        console.log("[boot] ✓ 建表/目錄/種子完成，系統就緒");
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
