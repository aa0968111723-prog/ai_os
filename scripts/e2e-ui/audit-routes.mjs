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

// 根據 PR 165 計畫定義的必測基準裝置
const VIEWPORTS = [
  { name: "S-360", width: 360, height: 800 },
  { name: "S-390", width: 390, height: 844 },
  { name: "M-768", width: 768, height: 1024 },
  { name: "L-1280", width: 1280, height: 800 },
  { name: "XL-1440", width: 1440, height: 900 },
];

const TARGET_URL = process.env.TARGET_URL || "http://localhost:3000";
const OUT_DIR = process.env.OUT_DIR || "./docs/uiux-audit/screenshots";
const TEST_EMAIL = process.env.TEST_EMAIL || "test@example.com";
const TEST_PW = process.env.TEST_PW || "password";

async function run() {
  console.log(`開始執行全路由與多裝置尺寸巡覽... 目標網址: ${TARGET_URL}`);

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
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
    console.log("✅ 登入動作完成，開始巡覽路由與裝置尺寸...");
  } catch (err) {
    console.error("❌ 登入失敗，請確認網站狀態或選擇器是否正確:", err.message);
  }

  // 2. 實際進入每一個主要頁面，擷取內容並在每個裝置尺寸下截圖
  for (const route of ROUTES) {
    console.log(`\n正在訪問: ${route}`);
    try {
      await page.goto(`${TARGET_URL}${route}`, { waitUntil: "networkidle", timeout: 15000 });
      // 稍微等待非同步資料或動畫載入
      await page.waitForTimeout(1500);
      
      const safeName = route === "/" ? "home" : route.replace(/\//g, "-").replace(/^-/, "");

      // 擷取頁面的實際文字內容，供 AI 分析真實 DOM 狀態
      const pageText = await page.evaluate(() => document.body.innerText);
      const textPath = path.join(OUT_DIR, `route-${safeName}-content.txt`);
      fs.writeFileSync(textPath, `Route: ${route}\n\n${pageText}`);
      console.log(`    ✅ 頁面內容已擷取: ${textPath}`);

      // 針對該路由測試所有裝置尺寸
      for (const vp of VIEWPORTS) {
        console.log(`  - 測試斷點: ${vp.name} (${vp.width}x${vp.height})`);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        // 等待 RWD 重新渲染
        await page.waitForTimeout(500);
        
        const shotPath = path.join(OUT_DIR, `route-${safeName}-${vp.name}.png`);
        await page.screenshot({ path: shotPath, fullPage: true });
        console.log(`    ✅ 截圖已儲存: ${shotPath}`);
      }
    } catch (err) {
      console.error(`❌ 訪問 ${route} 失敗:`, err.message);
    }
  }

  await browser.close();
  console.log(`\n🎉 路由與多裝置尺寸巡覽截圖盤點完成！請至 ${OUT_DIR} 資料夾查看實際畫面與文字內容。`);
}

run().catch((err) => {
  console.error("執行失敗:", err);
  process.exit(1);
});
