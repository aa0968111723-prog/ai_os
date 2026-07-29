import { chromium } from "playwright";
import fs from "fs";
import path from "path";

// 根據 AppRoutes.tsx 整理出的主要頁面路由
const ROUTES = [
  "/",
  "/admin",
  "/options",
  "/logs",
  "/members",
  "/feedback",
  "/my-reports",
  "/models",
  "/help",
  "/mcp",
  "/integrations",
  "/downloads",
  "/planner",
  "/databases",
  "/chat"
];

const TARGET_URL = process.env.TARGET_URL || "http://localhost:3000";
const OUT_DIR = process.env.OUT_DIR || "./e2e-ui-out/routes";
const TEST_EMAIL = process.env.TEST_EMAIL || "test@example.com";
const TEST_PW = process.env.TEST_PW || "password";

async function run() {
  console.log(`開始執行全路由巡覽... 目標網址: ${TARGET_URL}`);

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  // 預設使用 L-1280 桌面斷點進行巡覽
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // 1. 執行登入流程
  console.log(`嘗試使用帳號 ${TEST_EMAIL} 登入...`);
  try {
    await page.goto(TARGET_URL, { waitUntil: "networkidle" });
    // 填寫 Email 與密碼 (對應 LoginPage.tsx 的 input)
    await page.fill('input[type="text"], input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PW);
    await page.click('button[type="submit"]');
    
    // 等待登入完成並跳轉
    await page.waitForTimeout(3000);
    console.log("✅ 登入動作完成，開始巡覽路由...");
  } catch (err) {
    console.error("❌ 登入失敗，請確認網站狀態或選擇器是否正確:", err.message);
  }

  // 2. 實際進入每一個主要頁面並截圖
  for (const route of ROUTES) {
    console.log(`正在訪問: ${route}`);
    try {
      await page.goto(`${TARGET_URL}${route}`, { waitUntil: "networkidle", timeout: 15000 });
      // 稍微等待非同步資料或動畫載入
      await page.waitForTimeout(1500);
      
      const safeName = route === "/" ? "home" : route.replace(/\//g, "-").replace(/^-/, "");
      const shotPath = path.join(OUT_DIR, `route-${safeName}.png`);
      
      await page.screenshot({ path: shotPath, fullPage: true });
      console.log(`✅ 截圖已儲存: ${shotPath}`);
    } catch (err) {
      console.error(`❌ 訪問 ${route} 失敗:`, err.message);
    }
  }

  await browser.close();
  console.log("🎉 路由巡覽與截圖盤點完成！請至 e2e-ui-out/routes 資料夾查看實際畫面。");
}

run().catch((err) => {
  console.error("執行失敗:", err);
  process.exit(1);
});
