/**
 * 手機字族策略驗收（P2-42）：量測某視寬下實際下載的字型檔。
 * 手機（390）不應再抓 noto-serif-tc 的 CJK 分包；桌機（1280）應維持原樣。
 * 用法：TARGET_URL=http://localhost:3231 node scripts/e2e-ui/font-usage-check.mjs
 */
import { chromium } from "playwright";

const TARGET_URL = (process.env.TARGET_URL || "http://localhost:3231").replace(/\/$/, "");
const browser = await chromium.launch();

async function measure(width, height, label) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const fonts = [];
  page.on("response", (res) => {
    const u = res.url();
    if (/\.(woff2?|ttf)(\?|$)/.test(u)) fonts.push(u.split("/").pop());
  });
  await page.goto(TARGET_URL + "/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2500);
  await context.close();
  const serif = fonts.filter((f) => f.includes("noto-serif-tc"));
  const sans = fonts.filter((f) => f.includes("noto-sans-tc"));
  const fraunces = fonts.filter((f) => f.includes("fraunces"));
  return { label, width, total: fonts.length, serifCjk: serif.length, sansCjk: sans.length, fraunces: fraunces.length, serifFiles: serif.slice(0, 5) };
}

const mobile = await measure(390, 844, "mobile-390");
const desktop = await measure(1280, 800, "desktop-1280");
console.log(JSON.stringify({ mobile, desktop }, null, 2));
await browser.close();
