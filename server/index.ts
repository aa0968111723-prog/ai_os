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
import { isMockMode } from "./services/fal";
import { resolveSession } from "./services/auth";
import { exportProjectZip } from "./services/exporter";
import { handleMcp } from "./services/mcp";
import { db, schema } from "./db";
import { eq } from "drizzle-orm";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const isProd = process.env.NODE_ENV === "production";

app.use(express.json({ limit: "2mb" }));

// 健康檢查 — 純 HTTP，不碰 DB
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mockMode: isMockMode(), time: new Date().toISOString() });
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
    if (!res.headersSent) res.status(500).json({ error: String(err) });
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
  // 種子資料背景跑，不擋啟動
  ensureSeed().catch((err) => console.warn("[seed] 略過（DB 未就緒？）", err?.message ?? err));
});
