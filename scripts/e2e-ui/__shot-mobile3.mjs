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
await page.waitForTimeout(1500);
// (a) 首頁：密度介紹橫幅
await page.screenshot({ path: OUT + "/m2-banner.png" });
// (b) 開帳號選單 → 底部抽屜＋密度雙選項
await page.click(".account-menu__trigger");
await page.waitForTimeout(600);
const sheet = await page.evaluate(() => {
  const m = document.querySelector(".account-menu__pop");
  if (!m) return { found: false };
  const r = m.getBoundingClientRect();
  const cs = getComputedStyle(m);
  return { found: true, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), pos: cs.position, radius: cs.borderTopLeftRadius, scrollable: m.scrollHeight > m.clientHeight, backdrop: !!document.querySelector(".account-menu__backdrop") && getComputedStyle(document.querySelector(".account-menu__backdrop")).display !== "none" };
});
console.log("抽屜量測：", JSON.stringify(sheet));
await page.screenshot({ path: OUT + "/m2-sheet.png" });
// 捲到抽屜底看密度雙選項
await page.evaluate(() => document.querySelector(".account-menu__pop").scrollTo({ top: 99999 }));
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "/m2-sheet-bottom.png" });
// (c) 專案頁 FAB 直疊
await page.keyboard.press("Escape");
await page.goto(BASE + "/p/" + process.env.PROJ_ID);
await page.waitForTimeout(2500);
const fabs = await page.evaluate(() => {
  const out = {};
  const fb = document.querySelector(".fb-fab-root");
  const msg = document.querySelector(".project-messages-fab");
  if (fb) { const r = fb.getBoundingClientRect(); out.feedback = { right: Math.round(390 - r.right), bottom: Math.round(844 - r.bottom) }; }
  if (msg) { const r = msg.getBoundingClientRect(); out.messages = { right: Math.round(390 - r.right), bottom: Math.round(844 - r.bottom) }; }
  return out;
});
console.log("FAB 疊放：", JSON.stringify(fabs));
await browser.close();
