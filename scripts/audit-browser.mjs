// 全站瀏覽器掃描：登入→逐一走訪每個路由→擷取 console/pageerror/網路失敗→截圖。
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:5173";
const EMAIL = process.env.EMAIL || "aa0968111723@gmail.com";
const PW = process.env.PW || "Audit2026x";
const OUT = process.env.OUT || "/tmp/audit-out";
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
const record = (route, type, detail) => {
  findings.push({ route, type, detail });
  console.log(`[${type}] (${route}) ${detail}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

let currentRoute = "boot";
page.on("console", (msg) => {
  const t = msg.type();
  if (t === "error" || t === "warning") {
    const text = msg.text();
    // 濾掉已知無害噪音
    if (/Download the React DevTools|Lit is in dev mode|\[vite\]/.test(text)) return;
    record(currentRoute, t === "error" ? "console.error" : "console.warn", text.slice(0, 300));
  }
});
page.on("pageerror", (err) => record(currentRoute, "pageerror", String(err).slice(0, 300)));
page.on("requestfailed", (req) => {
  const f = req.failure();
  record(currentRoute, "requestfailed", `${req.method()} ${req.url()} — ${f?.errorText}`);
});
page.on("response", (res) => {
  const s = res.status();
  const u = res.url();
  if (s >= 400 && u.includes("/api/")) record(currentRoute, "http" + s, `${res.request().method()} ${u.replace(BASE, "")}`);
});

const shot = async (n) => { try { await page.screenshot({ path: `${OUT}/${n}.png` }); } catch {} };
const goto = async (path, label) => {
  currentRoute = path;
  try {
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 25000 });
  } catch (e) {
    record(path, "nav-timeout", String(e).slice(0, 160));
  }
  await page.waitForTimeout(1200);
  await shot(label);
};

// ── 1. 登入 ──
currentRoute = "/login";
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await shot("00-login");
// 檢查登入頁必要欄位
const hasEmail = await page.locator("#login-email").count();
const hasPw = await page.locator("#login-pw").count();
if (!hasEmail || !hasPw) record("/login", "missing-field", `login-email=${hasEmail} login-pw=${hasPw}`);
await page.fill("#login-email", EMAIL);
await page.fill("#login-pw", PW);
await page.click("button[type=submit]");
try {
  await page.waitForFunction(() => !document.querySelector("#login-email"), { timeout: 20000 });
  record("/login", "ok", "登入成功");
} catch {
  record("/login", "login-fail", "登入後仍停在登入頁");
  const err = await page.locator(".error").allInnerTexts().catch(() => []);
  if (err.length) record("/login", "login-error-msg", err.join(" | "));
}
await page.waitForTimeout(1500);
await shot("01-launchpad");

// ── 2. 逐一走訪每個路由 ──
const routes = [
  ["/", "02-home"],
  ["/help", "03-help"],
  ["/models", "04-models"],
  ["/planner", "05-planner"],
  ["/databases", "06-databases"],
  ["/mcp", "07-mcp"],
  ["/downloads", "08-downloads"],
  ["/options", "09-options"],
  ["/logs", "10-logs"],
  ["/admin", "11-admin"],
  ["/feedback", "12-feedback"],
  ["/my-reports", "13-my-reports"],
  ["/nonexistent-xyz", "14-404"],
];
for (const [p, label] of routes) {
  await goto(p, label);
  // 每頁抓可見文字量，空白頁 = 潛在渲染失敗
  const bodyLen = await page.evaluate(() => document.body.innerText.trim().length);
  if (bodyLen < 20) record(p, "blank-page", `可見文字僅 ${bodyLen} 字`);
  // 抓明顯錯誤字樣
  const errs = await page.locator(".error, [role=alert]").allInnerTexts().catch(() => []);
  for (const e of errs.filter((x) => x && x.trim())) record(p, "visible-error", e.slice(0, 160));
}

fs.writeFileSync(`${OUT}/findings.json`, JSON.stringify(findings, null, 2));
console.log(`\n===DONE=== ${findings.length} 筆事件，輸出於 ${OUT}/findings.json`);
await browser.close();
