/**
 * AI Director OS — 伺服器入口
 * 一個服務包三件事：健康檢查、tRPC API、（正式環境）React 靜態檔。
 * 原則：健康檢查不等 DB（healing-studio 的部署教訓）。
 */
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
    res.json({ ok: true, db: "connected（資料庫已接通）", mockMode: isMockMode() });
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
    if (n < 17) throw new Error(`只有 ${n} 張表(需 ≥17)——建表未完成`);
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
    const { createInvite } = await import("./services/auth");
    const { token } = await createInvite({
      email: "selftest@example.com", teamId: "00000000-0000-0000-0000-000000000000",
      teamRole: "member", groupRole: "member", invitedBy: auth.user.id,
    });
    await db.delete(schema.invites).where(eq(schema.invites.token, token));
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
  if (isProd && process.env.AUTH_MODE === "dev") {
    console.warn("[server] ⚠⚠⚠ 正式環境偵測到 AUTH_MODE=dev（無認證後門）——已自動忽略不生效；請到 Variables 移除此變數。");
  }
  // 背景：等 DB → 自動建表 → 模型目錄同步 → 種子/超管自救，全程不擋啟動
  ensureSchema()
    .then(async (ready) => {
      if (!ready) return;
      await syncCatalog();
      await ensureSeed();
    })
    .catch((err) => console.warn("[boot] 建表/目錄/種子失敗（修好 DATABASE_URL 後 Redeploy 即可）：", err?.message ?? err));
});
