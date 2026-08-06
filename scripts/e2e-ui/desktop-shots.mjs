/**
 * 桌機像素對比專用：只截 1280/1440 兩視寬（無 axe、無互動），
 * 供 base vs integration「同一顆 DB」的控制實驗——排除動態資料雜訊後，
 * 剩餘差異才可歸因於程式碼變更。
 * 用法：TARGET_URL=... OUT_DIR=... node scripts/e2e-ui/desktop-shots.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const ROUTES = ["/", "/login", "/dashboard", "/admin", "/options", "/logs", "/members",
  "/feedback", "/my-reports", "/models", "/help", "/mcp", "/integrations", "/downloads",
  "/planner", "/databases", "/chat"];
const VIEWPORTS = [
  { name: "L-1280", width: 1280, height: 800 },
  { name: "XL-1440", width: 1440, height: 900 },
];
const TARGET_URL = (process.env.TARGET_URL || "http://localhost:3231").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR || "./desktop-shots";
const EMAIL = process.env.TEST_EMAIL || "admin@aidirector.local";
const PW = process.env.TEST_PW || "test-admin-123";

fs.mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
  const page = await context.newPage();
  // 登入
  await page.goto(TARGET_URL + "/login", { waitUntil: "domcontentloaded" });
  await page.locator("#login-email").fill(EMAIL);
  await page.locator("#login-pw").fill(PW);
  await page.keyboard.press("Enter");
  await page.waitForSelector('header.topbar', { timeout: 20000 }).catch(() => {});
  for (const route of ROUTES) {
    try {
      await page.goto(TARGET_URL + route, { waitUntil: "networkidle", timeout: 25000 });
      await page.waitForTimeout(1200);
      const name = route === "/" ? "home" : route.replace(/\//g, "-").replace(/^-/, "");
      await page.screenshot({ path: path.join(OUT_DIR, `route-${name}-${vp.name}.png`), fullPage: true });
      process.stdout.write(`ok ${route} ${vp.name}\n`);
    } catch (e) {
      process.stdout.write(`FAIL ${route} ${vp.name} ${e.message?.slice(0, 80)}\n`);
    }
  }
  await context.close();
}
await browser.close();
