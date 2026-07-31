import { chromium } from "playwright";
const BASE = "http://localhost:3462";
const OUT = process.env.OUT_DIR;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(BASE + "/login");
await page.fill("#login-email", process.env.TEST_EMAIL);
await page.fill("#login-pw", process.env.TEST_PW);
await page.click("button[type=submit]");
await page.waitForSelector("header.topbar", { timeout: 20000 });
await page.goto(BASE + "/p/" + process.env.PROJ_ID);
await page.waitForTimeout(2500);

const doc = await page.evaluate(() => ({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth,
  stackW: Math.round(document.querySelector(".cols .stack")?.getBoundingClientRect().width ?? -1) }));
console.log("文件量測：", JSON.stringify(doc));

// 1) 頁首＋工作台模式卡
await page.screenshot({ path: OUT + "/m-workbench-top.png" });
// 2) 捲到 AI 創作中心（模式卡）
const hub = page.locator("#sec-ai-hub, .creation-mode-tabs").first();
if (await hub.count()) { await hub.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await page.screenshot({ path: OUT + "/m-mode-cards.png" }); }
// 3) 捲到世界觀 chips（訊息主軸/調性/視覺風格）
const wv = page.locator("#wv-themes").first();
if (await wv.count()) { await wv.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await page.screenshot({ path: OUT + "/m-worldview-chips.png" }); }
await browser.close();
