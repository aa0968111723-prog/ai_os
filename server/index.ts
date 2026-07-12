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

// 假生成素材端點（FAL 假模式用；1024×576 黏土色 PNG，離線可用）
const MOCK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNsm7ryPwAFmwJT2F3EYAAAAABJRU5ErkJggg==",
  "base64",
);
app.get("/api/mock-asset/:kind", (req, res) => {
  // 假模式重點是流程可測：影片亦回傳圖片位元組（正式模式為真實 mp4）
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
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
  // 背景：等 DB → 自動建表（繞過 drizzle-kit CLI 非 TTY 問題）→ 種子/超管自救，全程不擋啟動
  ensureSchema()
    .then((ready) => (ready ? ensureSeed() : undefined))
    .catch((err) => console.warn("[boot] 建表/種子失敗（修好 DATABASE_URL 後 Redeploy 即可）：", err?.message ?? err));
});
