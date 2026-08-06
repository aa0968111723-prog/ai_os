/**
 * PWA 離線驗收（任務第 7 節 A／驗收清單）：
 * 1. 載入站台、等 Service Worker controller 就位（precache 完成）
 * 2. context.setOffline(true) 後重新導航
 * 3. 斷言：仍有內容（offline.html 或快取殼），且不是瀏覽器錯誤頁
 * 用法：TARGET_URL=http://localhost:3231 node scripts/e2e-ui/offline-check.mjs
 */
import { chromium } from "playwright";

const TARGET_URL = (process.env.TARGET_URL || "http://localhost:3231").replace(/\/$/, "");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

await page.goto(TARGET_URL + "/", { waitUntil: "load", timeout: 30000 });
// 等 SW 註冊且真正 controlling（首次載入 activate 後才算數）
await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
      // clients.claim() 已在 SW activate 裡；保險逾時
      setTimeout(resolve, 8000);
    });
  }
  return reg.active?.state;
});
// 給 precache 一點時間收尾
await page.waitForTimeout(1500);

await context.setOffline(true);
const res = await page.goto(TARGET_URL + "/dashboard", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
const body = res ? await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? "") : "";
const hasContent = !!res && body.trim().length > 0;
const isOfflinePage = body.includes("離線") || body.includes("重新連線");
const hasAppShell = await page.locator("div.app").count().then((n) => n > 0).catch(() => false);

console.log(JSON.stringify({
  offlineNavigationServed: hasContent,
  offlineFallbackPage: isOfflinePage,
  appShellRendered: hasAppShell,
  bodyPreview: body.slice(0, 80),
}, null, 2));

await browser.close();
process.exit(hasContent ? 0 : 1);
