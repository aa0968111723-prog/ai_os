#!/usr/bin/env node
/**
 * Phone Action-first acceptance run (Phone UX, <768px).
 *
 * Complements `verify-phone-ai-first.mjs` (which guards the #766 shell). This one
 * guards the things v2 adds on top, and the two things v2 could break invisibly:
 *
 *  1. **Truthfulness of the phone control surface.** A work card may only appear
 *     because a real assistant turn happened, it must never claim a verified
 *     result the runtime did not produce, and it must never render a percentage
 *     or a chain-of-thought line. Screenshots cannot see "this card is a lie";
 *     these assertions read the DOM contract instead.
 *
 *  2. **The payload budget from #766.** Cards render inside the phone chunk, so
 *     the full 234KB workbench must still not be downloaded when a card is on
 *     screen. This counts real bytes off the network log, not intentions.
 *
 * It also re-asserts that none of the new phone chrome leaks into >=768px.
 *
 * No paid provider is required or used: the run only needs the assistant request
 * path to complete *or fail*, and both outcomes are legitimate evidence that the
 * projection seam is wired to real runtime state.
 *
 * Usage: TARGET_URL=http://127.0.0.1:3000 TEST_EMAIL=... TEST_PW=... \
 *        node scripts/e2e-ui/verify-phone-action-first.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const TARGET = (process.env.TARGET_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL;
const PW = process.env.TEST_PW;
const OUT = process.env.OUT_DIR || "docs/uiux-audit/phone-action-first";

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

/**
 * Budgets carried over from the measured #766 baseline on this build
 * (home 563.4 kB / 11 procedures; opening a project 6.5 kB / 1 procedure).
 * The headroom is deliberately small: this suite exists to catch "the workbench
 * came back", not a few hundred bytes of drift.
 */
const BUDGET = {
  homeJsKb: 620,
  homeApi: 12,
  projectJsKb: 40,
  projectApi: 3,
};

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
    if (!url.startsWith(TARGET)) return;
    const p = new URL(url).pathname;
    if (p.endsWith(".js")) {
      try {
        const body = await res.body();
        js.set(path.basename(p), body.length);
      } catch { /* redirects / aborted */ }
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
        jsChunks: js.size,
        api: [...api],
        chunks: [...js.keys()],
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

async function closeAssistant(page) {
  await page.keyboard.press("Escape");
  await page.locator("#global-assistant-sheet").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
  // scrim 是全幅 fixed 元素；沒等它消失，下一次點擊會落在遮罩上，
  // 看起來像「按了沒反應」而不是測試沒關面板。
  await page.locator(".menu-surface__scrim").waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
}

const metrics = {};

const main = async () => {
  if (!EMAIL || !PW) {
    console.error("TEST_EMAIL and TEST_PW are required");
    process.exit(2);
  }
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({ args: ["--no-sandbox"], ...(executablePath ? { executablePath } : {}) });

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

    // ── 首頁：預算 ──────────────────────────────────────────────────
    net.reset();
    await page.goto(`${TARGET}/dashboard`, { waitUntil: "commit" });
    await page.getByLabel("跟 Aios 說一句話").waitFor({ state: "visible", timeout: 30_000 });
    const homeInteractive = net.snapshot();
    await page.waitForLoadState("networkidle");
    metrics[vp.name] = { home: net.snapshot(), homeInteractive };

    const homeKb = homeInteractive.jsBytes / 1024;
    check(homeKb <= BUDGET.homeJsKb, `${vp.name}: 首頁 JS 在 #766 預算內`, `${homeKb.toFixed(1)} kB（上限 ${BUDGET.homeJsKb}）`);
    const homeApi = new Set(homeInteractive.api).size;
    check(homeApi <= BUDGET.homeApi, `${vp.name}: 首頁 API 支數在預算內`, `${homeApi} 支（上限 ${BUDGET.homeApi}）`);

    // 卡片與膠囊在第一屏都不該存在——還沒有任何一輪工作發生過。
    // 「空狀態就先畫一張卡」正是這個功能最容易長出來的假進度。
    const idleCards = await page.locator(".m-card").count();
    check(idleCards === 0, `${vp.name}: 還沒說話前不畫任何工作卡`, `.m-card=${idleCards}`);
    const idleCapsule = await page.locator(".m-capsule").count();
    check(idleCapsule === 0, `${vp.name}: 沒有焦點時膠囊收起（不與標題區重複）`, `.m-capsule=${idleCapsule}`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `${vp.name}: 無水平溢出`, `${overflow}px`);

    // ── 上下文補完：首頁說「這個專案」時，送出的句子帶得出專案身分 ────
    const projectTitle = await page.locator(".m-current__title").first().innerText().catch(() => "");
    check(!!projectTitle.trim(), `${vp.name}: 首頁有目前專案（下面的上下文斷言全靠它）`, `title=${projectTitle}`);

    await page.getByLabel("跟 Aios 說一句話").fill("第三幕還缺什麼？");
    await page.getByLabel("送出給 Aios").click();
    const sheet = await page.locator("#global-assistant-sheet").isVisible({ timeout: 10_000 }).catch(() => false);
    check(sheet, `${vp.name}: 送出後 AI 面板打開（仍是同一套助手）`);

    let carried = "";
    if (sheet) {
      const field = page.locator("#global-assistant-sheet textarea, #global-assistant-sheet input[type=text]").first();
      for (let i = 0; i < 40 && !carried; i++) {
        carried = await field.inputValue({ timeout: 5_000 }).catch(() => "");
        if (!carried) await page.waitForTimeout(250);
      }
    }
    check(carried.includes("第三幕還缺什麼"), `${vp.name}: 原話完整帶進助手輸入框`, `實際「${carried}」`);
    // 這是 v2 的核心差異：#766 送的是裸句，助手在 /dashboard 上不知道是哪個專案的第三幕。
    check(
      !projectTitle.trim() || carried.includes(projectTitle.trim()),
      `${vp.name}: 送出的句子補上了目前專案（不是裸句）`,
      `實際「${carried}」`,
    );
    await page.screenshot({ path: path.join(OUT, `${vp.name}-compose.png`) });

    // ── 真的跑一輪，然後看卡片是否只反映真實結果 ────────────────────
    // 這裡不需要（也不使用）任何付費供應商：成功與失敗都是合法證據，
    // 兩者都必須產生「非 result」的卡，因為沒有任何 verified 收據存在。
    // 助手的送出鈕是 type="button"（不是 submit）——用 type 選會選不到，
    // 而選不到時 `if (count)` 會讓整段安靜跳過，下面的卡片斷言就消失了。
    const sendBtn = page.locator("#global-assistant-sheet .ai-copilot-send-btn").first();
    check(await sendBtn.count() > 0, `${vp.name}: 助手面板有送出鈕（下面的卡片斷言全靠它）`);
    if (await sendBtn.count()) {
      await sendBtn.click({ timeout: 10_000 }).catch(() => {});
      // 等到助手真的把這一輪畫出來為止（回答或錯誤都算）；輪詢比固定 sleep 誠實，
      // 慢一點的機器不會因為時間到了就把「還沒回來」記成「沒有卡片」。
      await page.locator("#global-assistant-sheet .ai-copilot-msg--assistant, #global-assistant-sheet [class*='ai-copilot-msg']")
        .first().waitFor({ state: "visible", timeout: 90_000 }).catch(() => {});
      await page.waitForTimeout(1_500);
    }
    await closeAssistant(page);

    const cardCount = await page.locator(".m-card").count();
    check(cardCount <= 1, `${vp.name}: 最多一張工作卡（看板不是對話歷史）`, `.m-card=${cardCount}`);
    if (cardCount === 1) {
      const card = page.locator(".m-card").first();
      const cls = (await card.getAttribute("class")) ?? "";
      const text = (await card.innerText()) ?? "";
      // 沒有任何 verified 收據時不得出現「結果」卡——這正是「假執行」的樣子。
      check(!cls.includes("m-card--result"), `${vp.name}: 沒有已驗證收據時不出現結果卡`, `class=${cls}`);
      check(!/\d+\s*%/.test(text), `${vp.name}: 卡上沒有假百分比`, text.slice(0, 60));
      const ctas = await card.locator(".m-card__cta").all();
      for (const cta of ctas) {
        const box = await cta.boundingBox();
        check(!box || box.height >= 44, `${vp.name}: 卡片動作 ≥44px`, `${box?.height}px`);
      }
      await page.screenshot({ path: path.join(OUT, `${vp.name}-card.png`) });
    } else {
      // 前置條件必須是一條**失敗**：舊寫法記成 pass，於是「助手整條斷線」
      // 與「卡片全部正確」在報告上長得一模一樣——那正是 58/58 綠燈能騙人的機制。
      fail(`${vp.name}: 一輪真實工作之後應該要有一張卡`, ".m-card=0（下面的卡片斷言整段未執行）");
    }

    const overflowAfter = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflowAfter <= 1, `${vp.name}: 有卡片時仍無水平溢出`, `${overflowAfter}px`);

    // 卡片在畫面上，工作台仍然不准被下載——這是 §11 的紅線。
    const workbenchChunk = net.snapshot().chunks.some((c) => /^ProjectPage-/.test(c));
    check(!workbenchChunk, `${vp.name}: 卡片渲染沒有把完整工作台拉進來`, `chunks=${net.snapshot().chunks.filter((c) => /Project/.test(c)).join(",") || "none"}`);

    // ── 開專案：預算（SPA 導航，不是整頁重載）──────────────────────
    const hasRecent = await page.locator(".m-recent__row").count();
    check(hasRecent > 0, `${vp.name}: 首頁有第二個專案（開專案的預算斷言全靠它）`, `rows=${hasRecent}`);
    if (hasRecent > 0) {
      net.reset();
      await page.locator(".m-recent__row").first().click();
      await page.waitForURL(/\/p\//, { timeout: 20_000 });
      await page.locator(".m-project").first().waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForLoadState("networkidle");
      const project = net.snapshot();
      metrics[vp.name].project = project;

      const projectKb = project.jsBytes / 1024;
      check(projectKb <= BUDGET.projectJsKb, `${vp.name}: 開專案 JS 在預算內`, `${projectKb.toFixed(1)} kB（上限 ${BUDGET.projectJsKb}）`);
      const projectApi = new Set(project.api).size;
      check(projectApi <= BUDGET.projectApi, `${vp.name}: 開專案 API 支數在預算內`, `${projectApi} 支（上限 ${BUDGET.projectApi}）`);
      const heavy = await page.locator(".m-project-full").count();
      check(heavy === 0, `${vp.name}: 開專案不下載完整工作台`, `m-project-full=${heavy}`);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-project.png`) });
    }

    await ctx.close();
  }

  // ── 平板／桌機：新的手機外殼一個都不准漏出去 ─────────────────────
  const topbarHeights = {};
  for (const vp of DESKTOPS) {
    console.log(`\n[${vp.name}]`);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await login(page);
    await page.goto(`${TARGET}/dashboard`, { waitUntil: "networkidle" });

    // 新增的手機外殼一個節點都不准出現在桌面樹裡。
    for (const selector of [".m-card", ".m-capsule", ".m-ai", ".m-home"]) {
      const count = await page.locator(selector).count();
      check(count === 0, `${vp.name}: 沒有手機節點 ${selector}`, `count=${count}`);
    }
    // 底部分頁列是既有元件（#766 已用「不可見」定義它的桌面契約，不是「不存在」），
    // 這裡沿用同一條，不另立一個會與既有基準打架的標準。
    const mobileNavVisible = await page.locator("nav.mobile-nav").isVisible().catch(() => false);
    check(!mobileNavVisible, `${vp.name}: 手機底部分頁列不可見`);
    const desktopNav = await page.locator(".topbar").first().isVisible().catch(() => false);
    check(desktopNav, `${vp.name}: 桌面頂欄導航正常`);
    const assistantBtn = await page.locator(".assistant-launcher").isVisible().catch(() => false);
    check(assistantBtn, `${vp.name}: 桌面 AI 助手入口仍在頂欄（單一擁有者）`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `${vp.name}: 無嚴重水平溢出`, `${overflow}px`);

    topbarHeights[vp.name] = await page
      .locator(".topbar").first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().height))
      .catch(() => -1);

    await page.screenshot({ path: path.join(OUT, `${vp.name}-home.png`) });
    await ctx.close();
  }

  const desktopRef = topbarHeights["desktop-1280x800"];
  check(desktopRef > 0, "桌機頂欄量得到高度", `${desktopRef}px`);
  for (const [name, height] of Object.entries(topbarHeights)) {
    check(height === desktopRef, `${name}: 頂欄高度與桌機基準一致`, `${height}px vs ${desktopRef}px`);
  }

  await browser.close();

  console.log("\n── phone network ──");
  for (const [name, m] of Object.entries(metrics)) {
    for (const [route, v] of Object.entries(m)) {
      console.log(`${name} ${route}: ${(v.jsBytes / 1024).toFixed(1)} kB JS over ${v.jsChunks} chunks, ${new Set(v.api).size} API procedures`);
      console.log(`    ${[...new Set(v.api)].join(", ") || "(none)"}`);
    }
  }
  fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify({ metrics, budget: BUDGET, results }, null, 2));

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
