#!/usr/bin/env node
/**
 * Phone AI-first acceptance run.
 *
 * Drives a real browser through the agreed matrix and asserts the two things
 * that are easy to break invisibly:
 *
 *  1. **Which UI each width gets.** Phone widths must show the bottom tab bar
 *     and the AI-first home; tablet and desktop widths must show the desktop
 *     navigation and must NOT show the tab bar. "Two navigations at once" and
 *     "no navigation at all" are both failures, and both have happened here
 *     before (see styles.css 手機 App 殼層 v2).
 *
 *  2. **What the phone actually downloads and requests.** Screenshots cannot
 *     see a 234KB chunk, so this counts real JS bytes and real API calls off
 *     the network log.
 *
 * Usage: TARGET_URL=http://127.0.0.1:3000 TEST_EMAIL=... TEST_PW=... \
 *        node scripts/e2e-ui/verify-phone-ai-first.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const TARGET = (process.env.TARGET_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL;
const PW = process.env.TEST_PW;
const OUT = process.env.OUT_DIR || "docs/uiux-audit/phone-ai-first";

const PHONES = [
  { name: "phone-360x800", width: 360, height: 800 },
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "phone-430x932", width: 430, height: 932 },
];
const TABLETS = [
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "tablet-820x1180", width: 820, height: 1180 },
  { name: "tablet-1024x1366", width: 1024, height: 1366 },
];
const DESKTOPS = [
  { name: "desktop-1280x800", width: 1280, height: 800 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
];

const results = [];
const fail = (name, detail) => { results.push({ ok: false, name, detail }); console.log(`  ✗ ${name} — ${detail}`); };
const pass = (name, detail = "") => { results.push({ ok: true, name, detail }); console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); };
const check = (cond, name, detail) => (cond ? pass(name, detail) : fail(name, detail));

fs.mkdirSync(OUT, { recursive: true });

/** Per-page network recorder: JS bytes actually transferred + API calls made. */
function recordNetwork(page) {
  const js = new Map();
  const api = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.startsWith(TARGET)) return;
    const p = new URL(url).pathname;
    if (p.endsWith(".js")) {
      try {
        const body = await res.body();
        js.set(path.basename(p), body.length);
      } catch { /* redirects / aborted */ }
    } else if (p.startsWith("/api/")) {
      // tRPC batches several procedures into one HTTP call; count procedures.
      const procs = decodeURIComponent(p.replace("/api/trpc/", "")).split(",").filter(Boolean);
      api.push(...(procs.length ? procs : [p]));
    }
  });
  return {
    js,
    api,
    reset() { js.clear(); api.length = 0; },
    jsBytes() { return [...js.values()].reduce((a, b) => a + b, 0); },
    /**
     * 快照。`interactive` 是「畫面可以用了」那一刻，`settled` 是連閒置時
     * 預載（例如 posthog）都跑完之後——後者會把刻意延後載入的東西也算進來，
     * 用它比較會讓「延後載入」看起來沒有效果，所以兩個都留。
     */
    snapshot() {
      return { jsBytes: this.jsBytes(), jsChunks: js.size, api: [...api] };
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

const main = async () => {
  if (!EMAIL || !PW) {
    console.error("TEST_EMAIL and TEST_PW are required");
    process.exit(2);
  }
  // 這個環境預裝的 Chromium build 與 @playwright/test 釘住的版本不同號，
  // 直接 launch 會去找不存在的 build 目錄；有 CHROMIUM_PATH 就用它。
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({ args: ["--no-sandbox"], ...(executablePath ? { executablePath } : {}) });

  // ── Phones: AI-first shell, bottom nav, one-tap continue, AI compose ──────
  const phoneMetrics = {};
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
    await page.goto(`${TARGET}/dashboard`, { waitUntil: "commit" });
    // 「可以用了」＝首屏那顆主要動作與 AI 輸入列都在畫面上
    await page.getByLabel("跟 Aios 說一句話").waitFor({ state: "visible", timeout: 30_000 });
    const homeInteractive = net.snapshot();
    await page.waitForLoadState("networkidle");

    const hasMobileNav = await page.locator("nav.mobile-nav").isVisible().catch(() => false);
    check(hasMobileNav, `${vp.name}: 底部分頁列出現`);

    const tabs = await page.locator("nav.mobile-nav > *").count();
    check(tabs === 3, `${vp.name}: 底欄三格（專案｜AI 助手｜更多）`, `實際 ${tabs}`);

    const orbCentered = await page.locator(".mobile-nav__orb").isVisible().catch(() => false);
    check(orbCentered, `${vp.name}: 中央 AI 助手球是主要入口`);

    const aiBar = await page.getByLabel("跟 Aios 說一句話").isVisible().catch(() => false);
    check(aiBar, `${vp.name}: 首頁有 AI 輸入列`);

    const quick = await page.locator(".m-ai__chip").count();
    check(quick >= 2 && quick <= 4, `${vp.name}: 快捷 2–4 顆`, `實際 ${quick}`);

    const desktopNav = await page.locator(".topbar-nav-link").first().isVisible().catch(() => false);
    check(!desktopNav, `${vp.name}: 沒有第二套（桌面）導航`);

    // No horizontal overflow at any phone width
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `${vp.name}: 無水平溢出`, `${overflow}px`);

    phoneMetrics[vp.name] = { homeSettled: net.snapshot(), homeInteractive };
    await page.screenshot({ path: path.join(OUT, `${vp.name}-home.png`), fullPage: false });

    // AI compose: typing on the home screen must open the assistant with the text
    await page.getByLabel("跟 Aios 說一句話").fill("繼續上一個專案");
    await page.getByLabel("送出給 Aios").click();
    const sheet = await page.locator("#global-assistant-sheet").isVisible({ timeout: 10_000 }).catch(() => false);
    check(sheet, `${vp.name}: 送出後 AI 面板打開`);
    if (sheet) {
      // The sentence must survive the lazy mount of the assistant body.
      // Poll rather than sample once: the assistant chunk mounts, then React
      // flushes the replayed text a tick later — a single read races that flush.
      const field = page.locator("#global-assistant-sheet textarea, #global-assistant-sheet input[type=text]").first();
      let carried = "";
      for (let i = 0; i < 40 && !carried; i++) {
        carried = await field.inputValue({ timeout: 5_000 }).catch(() => "");
        if (!carried) await page.waitForTimeout(250);
      }
      check(carried.includes("繼續上一個專案"), `${vp.name}: 那句話有帶進助手輸入框`, `實際「${carried}」`);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-ai.png`) });
      // 關掉再往下走：sheet 的 scrim 是全幅 fixed 元素，沒關的話下面那一下
      // 點擊會落在遮罩上，看起來像「按了沒反應」而不是測試沒關面板。
      await page.keyboard.press("Escape");
      await page.locator("#global-assistant-sheet").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
      await page.locator(".menu-surface__scrim").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
    }

    // Project page. Two distinct entries, and they must behave differently:
    //   • opening a project (no hash)  → cheap summary, workbench NOT downloaded
    //   • pressing 繼續製作 (with hash) → straight into the workbench at that section
    // Testing only one of them is how the anchor bug survived a "58/58 passed" run.
    const projectHref = await page.locator(".m-current__go").first().isVisible().catch(() => false);
    if (projectHref) {
      // Recover the project id from the button's navigation target by using the
      // recent list when present, else read it after a plain click-through.
      const summaryUrl = await page.evaluate(() => {
        const row = document.querySelector(".m-recent__row");
        return row ? "row" : null;
      });

      net.reset();
      if (summaryUrl === "row") {
        await page.locator(".m-recent__row").first().click();
      } else {
        // No second project seeded: reach the summary by dropping the hash.
        await page.locator(".m-current__go").first().click();
        await page.waitForURL(/\/p\//, { timeout: 20_000 });
        const bare = page.url().split("#")[0];
        net.reset();
        await page.goto(bare, { waitUntil: "commit" });
      }
      await page.waitForURL(/\/p\//, { timeout: 20_000 });
      await page.locator(".m-project").first().waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForLoadState("networkidle");
      phoneMetrics[vp.name].project = net.snapshot();

      check(true, `${vp.name}: 專案頁走手機摘要版`, `url=${page.url()}`);
      const heavyLoaded = await page.locator(".m-project-full").count();
      check(heavyLoaded === 0, `${vp.name}: 開專案不下載完整工作台`, `m-project-full=${heavyLoaded}`);
      const stillMobileNav = await page.locator("nav.mobile-nav").isVisible().catch(() => false);
      check(stillMobileNav, `${vp.name}: 導航到專案頁後底欄仍在（SPA 未整頁重載）`);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-project.png`) });

      // 「繼續製作」必須真的捲到那一段。錨點原本用的是 section id
      // （storyboard／production），但 DOM 上渲染的是 anchorId（stage-board／
      // stage-create），getElementById 永遠回 null——工作台打開了卻停在頁面最上方，
      // 而且完全不報錯。只驗「頁面有打開」抓不到這種失敗。
      const goLabel = await page.locator(".m-current__go").first().innerText().catch(() => "");
      await page.locator(".m-current__go").first().click();
      const landed = await page.waitForFunction(() => {
        if (!document.querySelector(".m-project-full")) return null;
        const ids = ["stage-story", "stage-board", "stage-create", "stage-deliver"];
        return ids.filter((id) => document.getElementById(id)).join(",") || null;
      }, null, { timeout: 40_000 }).then((h) => h.jsonValue()).catch(() => null);
      check(!!landed, `${vp.name}: 「${goLabel.trim()}」開啟工作台且錨點真的存在`, `found=${landed}`);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-workbench.png`) });
    }

    await ctx.close();
  }

  // ── Tablets + desktops: existing desktop UI, no phone shell ───────────────
  for (const vp of [...TABLETS, ...DESKTOPS]) {
    console.log(`\n[${vp.name}]`);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await login(page);
    await page.goto(`${TARGET}/dashboard`, { waitUntil: "networkidle" });

    const mobileNav = await page.locator("nav.mobile-nav").isVisible().catch(() => false);
    check(!mobileNav, `${vp.name}: 不出現手機底部分頁列`);

    const desktopNav = await page.locator(".topbar").first().isVisible().catch(() => false);
    check(desktopNav, `${vp.name}: 桌面頂欄導航正常`);

    const assistantBtn = await page.locator(".assistant-launcher").isVisible().catch(() => false);
    check(assistantBtn, `${vp.name}: 桌面 AI 助手入口在頂欄`);

    const phoneHome = await page.locator(".m-home").count();
    check(phoneHome === 0, `${vp.name}: 沒有手機版首頁節點（不是兩套 UI 疊著）`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `${vp.name}: 無嚴重水平溢出`, `${overflow}px`);

    await page.screenshot({ path: path.join(OUT, `${vp.name}-home.png`) });
    await ctx.close();
  }

  await browser.close();

  console.log("\n── phone network ──");
  for (const [name, m] of Object.entries(phoneMetrics)) {
    for (const [route, v] of Object.entries(m)) {
      console.log(`${name} ${route}: ${(v.jsBytes / 1024).toFixed(1)} kB JS over ${v.jsChunks} chunks, ${v.api.length} API procedures`);
      console.log(`    ${[...new Set(v.api)].join(", ") || "(none)"}`);
    }
  }
  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify({ phoneMetrics, results }, null, 2));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
