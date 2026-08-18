#!/usr/bin/env node
/**
 * Phone Animation Production repair-loop golden flow.
 *
 * Phone: 360 / 390 / 430. Desktop regression: 768 / 820 / 1024 / 1280 / 1440.
 * No paid provider is used. Cards must come from server projections.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const TARGET = (process.env.TARGET_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL;
const PW = process.env.TEST_PW;
const PROJECT_ID = process.env.PHONE_REPAIR_PROJECT_ID;
const OUT = process.env.OUT_DIR || "/opt/cursor/artifacts/phone-animation-repair";

const PHONES = [
  { name: "phone-360x800", width: 360, height: 800 },
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "phone-430x932", width: 430, height: 932 },
];
const DESKTOPS = [
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "tablet-820x1180", width: 820, height: 1180 },
  { name: "tablet-1024x1366", width: 1024, height: 1366 },
  { name: "desktop-1280x800", width: 1280, height: 800 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
];

const results = [];
const fail = (name, detail) => { results.push({ ok: false, name, detail }); console.log(`  ✗ ${name} — ${detail}`); };
const pass = (name, detail = "") => { results.push({ ok: true, name, detail }); console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); };
const check = (cond, name, detail) => (cond ? pass(name, detail) : fail(name, detail));

fs.mkdirSync(OUT, { recursive: true });

function recordNetwork(page) {
  const js = new Map();
  const api = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.startsWith(TARGET) && !url.includes("/api/trpc")) return;
    const p = new URL(url).pathname;
    if (p.endsWith(".js")) {
      try { js.set(path.basename(p), (await res.body()).length); } catch { /* ignore */ }
    } else if (p.startsWith("/api/")) {
      const procs = decodeURIComponent(p.replace("/api/trpc/", "")).split(",").filter(Boolean);
      api.push(...(procs.length ? procs : [p]));
    }
  });
  return {
    js,
    api,
    reset() { js.clear(); api.length = 0; },
    snapshot() {
      return {
        jsBytes: [...js.values()].reduce((a, b) => a + b, 0),
        api: [...api],
      };
    },
  };
}

async function login(page) {
  await page.goto(`${TARGET}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PW);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

const metrics = {};

const main = async () => {
  if (!EMAIL || !PW) {
    console.error("TEST_EMAIL and TEST_PW are required");
    process.exit(2);
  }
  const executablePath = process.env.CHROMIUM_PATH || "/usr/local/bin/google-chrome";
  const browser = await chromium.launch({
    args: ["--no-sandbox"],
    executablePath: fs.existsSync(executablePath) ? executablePath : undefined,
  });

  for (const vp of PHONES) {
    console.log(`\n[${vp.name}]`);
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    const net = recordNetwork(page);
    await login(page);
    net.reset();
    if (!PROJECT_ID) {
      await page.goto(`${TARGET}/dashboard`, { waitUntil: "domcontentloaded" });
      await page.getByLabel("跟 Aios 說一句話").waitFor({ state: "visible", timeout: 30_000 });
      const createBtn = page.getByRole("button", { name: /建立專案/ }).first();
      check(await createBtn.count() > 0, `${vp.name}: 首頁有建立專案入口`);
      if (await createBtn.count()) {
        await createBtn.click();
        const createSheet = page.getByLabel("建立新專案");
        check(await createSheet.isVisible().catch(() => false), `${vp.name}: 手機建立表單打開`);
        if (await createSheet.count()) {
          await page.screenshot({ path: path.join(OUT, `${vp.name}-create.png`) });
          await createSheet.getByRole("button", { name: "取消" }).click();
        }
      }
      const projectLink = page.locator("a[href^='/p/']").first();
      const continueBtn = page.getByRole("button", { name: /繼續|開始寫故事|繼續排分鏡|開始做畫面|繼續生成/ }).first();
      if (await projectLink.count()) {
        await projectLink.click();
      } else if (await continueBtn.count()) {
        await continueBtn.click();
      } else {
        await createBtn.click();
        const createSheet = page.getByLabel("建立新專案");
        await createSheet.waitFor({ state: "visible", timeout: 10_000 });
        await createSheet.getByLabel("專案名稱").fill("overnight-test-phone-repair");
        await createSheet.getByRole("button", { name: "建立專案" }).click();
      }
      await page.waitForURL((u) => u.pathname.startsWith("/p/"), { timeout: 30_000 });
      // Continue uses a hash, so openFull mounts the workbench. Production cards
      // and 場景 live on the summary — go back if we landed in the full page.
      const backToSummary = page.getByRole("button", { name: /回專案摘要/ });
      if (await backToSummary.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
        await backToSummary.click();
      }
      await page.getByLabel("跟 Aios 說一句話").waitFor({ state: "visible", timeout: 30_000 });
    } else {
      await page.goto(`${TARGET}/p/${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
      await page.getByLabel("跟 Aios 說一句話").waitFor({ state: "visible", timeout: 30_000 });
    }
    const scenesEntry = page.getByRole("button", { name: /場景/ });
    check(await scenesEntry.count() > 0, `${vp.name}: 專案頁有場景入口`);
    await page.screenshot({ path: path.join(OUT, `${vp.name}-summary.png`) });
    const assetsEntry = page.getByRole("button", { name: /^素材/ });
    if (await assetsEntry.count()) {
      await assetsEntry.click();
      const uploadBtn = page.getByRole("button", { name: /加入素材/ });
      check(await uploadBtn.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false), `${vp.name}: 素材抽屜有加入素材`);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-assets.png`) });
      const closeAssets = page.getByRole("button", { name: "關閉素材" });
      if (await closeAssets.count()) await closeAssets.click();
    }
    const projectNav = net.snapshot();
    metrics[vp.name] = { project: projectNav };

    await page.getByLabel("跟 Aios 說一句話").fill("這一幕還有什麼問題？");
    await page.getByLabel("送出給 Aios").click();
    await page.locator(".m-card").first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    const cardText = await page.locator(".m-card").first().innerText().catch(() => "");
    check(/動畫檢查|鏡需要處理|尚未檢查|沒有要處理/.test(cardText), `${vp.name}: 問問題得到 Production 卡`, cardText.slice(0, 80));
    check(!/fingerprint|evaluator|packet/i.test(cardText), `${vp.name}: 不回 raw evaluator JSON`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `${vp.name}: 無水平溢出`, `${overflow}px`);
    const cta = page.locator(".m-card__cta").first();
    if (await cta.count()) {
      const box = await cta.boundingBox();
      check(!box || box.height >= 44, `${vp.name}: 主 CTA ≥44px`, `${box?.height}px`);
      await cta.click();
      await page.waitForTimeout(800);
    }
    const after = await page.locator(".m-card").first().innerText().catch(() => "");
    check(!/ProjectPage|分鏡中心/.test(after), `${vp.name}: 打開 findings 不載完整工作台`);
    await page.screenshot({ path: path.join(OUT, `${vp.name}-findings.png`) });

    await page.getByLabel("跟 Aios 說一句話").fill("人物跟連戲先修，畫風不要");
    await page.getByLabel("送出給 Aios").click();
    await page.waitForTimeout(1200);
    const planText = await page.locator(".m-card").first().innerText().catch(() => "");
    check(/修復計畫|執行前確認|目前沒有符合|要全部規劃/.test(planText), `${vp.name}: 規劃卡來自 server planner`, planText.slice(0, 80));
    check(!/正在深入思考/.test(planText), `${vp.name}: 沒有假進度`);
    await page.screenshot({ path: path.join(OUT, `${vp.name}-plan.png`) });
    await ctx.close();
  }

  for (const vp of DESKTOPS) {
    console.log(`\n[${vp.name}]`);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await login(page);
    await page.goto(PROJECT_ID ? `${TARGET}/p/${PROJECT_ID}` : `${TARGET}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const phoneCards = await page.locator(".m-card").count();
    check(phoneCards === 0, `${vp.name}: 不出現 Phone Production cards`, `.m-card=${phoneCards}`);
    const phoneAi = await page.locator(".m-ai").count();
    check(phoneAi === 0, `${vp.name}: 不出現手機 AI 控制面`);
    await page.screenshot({ path: path.join(OUT, `${vp.name}-desktop.png`) });
    await ctx.close();
  }

  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify({ metrics, results }, null, 2));
  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
