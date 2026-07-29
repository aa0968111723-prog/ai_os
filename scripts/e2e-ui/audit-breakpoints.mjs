import { chromium } from "playwright";
import fs from "fs";
import path from "path";

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

async function run() {
  console.log(`開始執行 UX-00 斷點截圖盤點... 目標網址: ${TARGET_URL}`);

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const vp of VIEWPORTS) {
    console.log(`正在測試斷點: ${vp.name} (${vp.width}x${vp.height})`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    
    try {
      await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: 30000 });
      // 稍微等待動畫或字體載入
      await page.waitForTimeout(1500);
      
      const shotPath = path.join(OUT_DIR, `login-${vp.name}.png`);
      await page.screenshot({ path: shotPath, fullPage: true });
      console.log(`✅ 截圖已儲存: ${shotPath}`);
    } catch (err) {
      console.error(`❌ 測試斷點 ${vp.name} 時發生錯誤:`, err.message);
    }
  }

  await browser.close();
  console.log("🎉 斷點截圖盤點完成！");
}

run().catch((err) => {
  console.error("執行失敗:", err);
  process.exit(1);
});
