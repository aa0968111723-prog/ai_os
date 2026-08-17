#!/usr/bin/env node
import { chromium } from "playwright";
import fs from "node:fs";

const TARGET = (process.env.TARGET_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
const PROJECT_ID = process.env.PHONE_REPAIR_PROJECT_ID;
const EMAIL = process.env.TEST_EMAIL;
const PW = process.env.TEST_PW;
const OUT = "/opt/cursor/artifacts";

const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: fs.existsSync("/usr/local/bin/google-chrome") ? "/usr/local/bin/google-chrome" : undefined,
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const api = [];
page.on("response", (res) => {
  const url = res.url();
  if (url.includes("/api/trpc/")) {
    api.push(decodeURIComponent(new URL(url).pathname.replace("/api/trpc/", "")));
  }
});
await page.goto(`${TARGET}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PW);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
  page.click('button[type="submit"]'),
]);
await page.goto(`${TARGET}/p/${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
await page.getByLabel("跟 Aios 說一句話").waitFor({ state: "visible", timeout: 30_000 });
api.length = 0;
await page.getByLabel("跟 Aios 說一句話").fill("這一幕還有什麼問題？");
await page.getByLabel("送出給 Aios").click();
await page.locator(".m-card").first().waitFor({ state: "visible", timeout: 20_000 });
const afterSummary = [...api];
api.length = 0;
await page.getByLabel("跟 Aios 說一句話").fill("人物跟連戲先修，畫風不要");
await page.getByLabel("送出給 Aios").click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /查看成本/ }).click();
await page.waitForTimeout(600);
const costText = await page.locator(".m-card").first().innerText();
await page.screenshot({ path: `${OUT}/phone_390_cost_confirmation.png` });
const afterCost = [...api];
const report = {
  afterSummary,
  afterCost,
  costText,
  executeCalled: afterCost.some((row) => row.includes("executeAnimationStage")),
};
fs.writeFileSync(`${OUT}/phone_repair_cost_api.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!/執行前確認|預估/.test(costText)) {
  console.error("cost card missing");
  process.exit(1);
}
if (report.executeCalled) {
  console.error("execute ran before explicit confirm");
  process.exit(1);
}
await browser.close();
