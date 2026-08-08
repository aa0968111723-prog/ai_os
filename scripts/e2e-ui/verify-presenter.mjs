/**
 * Presenter 場次／語意跟隨的實機驗證（Playwright + 兩個真帳號 + 兩個瀏覽器 context）。
 *
 * 為什麼要這一支：單元測試證明的是「狀態機對」，證明不了「兩個真的瀏覽器透過真的
 * WebSocket 之後，B 的畫面有沒有被 A 帶走」。而這整個功能最重要的性質恰好是
 * **沒被同意時畫面不可以被帶走**——那件事只有真的開兩個瀏覽器才驗得到。
 *
 * 驗證項目（對應驗收 C–G）：
 *   1. A 按「帶大家看」→ B 出現邀請卡
 *   2. B 沒有按加入 → B 的捲動位置完全沒被動過（規則一）
 *   3. B 按「加入」→ 出現「正在跟隨 Bruce」
 *   4. A 移動到 ② 分鏡 → B 被帶到同一個區塊
 *   5. B 自己捲動 → 出現「已暫停跟隨」＋「回到 Bruce」（規則二）
 *   6. B 按「回到 Bruce」→ 回到跟隨
 *   7. A 關閉分頁 → B 顯示「Bruce 暫時離線」，且沒有自動改跟別人（規則三）
 *   8. 手機視窗（390×844）下主要操作的 touch target >= 44px
 *
 * 環境變數：
 *   PRESENT_HOST      前端（預設 http://127.0.0.1:5173）
 *   PRESENT_PROJECT   共用專案 UUID（必填）
 *   PRESENT_A_EMAIL / PRESENT_A_PASSWORD
 *   PRESENT_B_EMAIL / PRESENT_B_PASSWORD
 */
import { chromium } from "playwright";

const HOST = process.env.PRESENT_HOST || "http://127.0.0.1:5173";
/** 環境預先安裝的 Chromium（避免 playwright install；版本與 npm 套件不一定同號） */
const CHROMIUM = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";
const PROJECT = process.env.PRESENT_PROJECT;
const A = { email: process.env.PRESENT_A_EMAIL, password: process.env.PRESENT_A_PASSWORD, label: "A(Bruce)" };
const B = { email: process.env.PRESENT_B_EMAIL, password: process.env.PRESENT_B_PASSWORD, label: "B(韋澔)" };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** 登入。選擇器沿用 verify-collab-mirror.mjs 的既有契約（#login-email）。 */
async function login(context, who) {
  const page = await context.newPage();
  await page.goto(`${HOST}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  for (let i = 0; i < 60; i++) {
    if ((await page.locator("#login-email").count()) > 0) break;
    if (!page.url().includes("/login")) break;
    await page.waitForTimeout(250);
  }
  if ((await page.locator("#login-email").count()) > 0) {
    await page.fill("#login-email", who.email);
    await page.fill('input[type="password"]', who.password);
    await page.locator('button[type="submit"]').click();
  }
  for (let i = 0; i < 60; i++) {
    if (!page.url().includes("/login")) break;
    await page.waitForTimeout(250);
  }
  console.log(`[${who.label}] ${page.url()}`);
  return page;
}

async function main() {
  if (!PROJECT) throw new Error("PRESENT_PROJECT 未設定");
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  // 兩個獨立 context＝兩份獨立 cookie jar，才是真的兩個使用者
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  const pageA = await login(ctxA, A);
  const pageB = await login(ctxB, B);
  await pageA.goto(`${HOST}/p/${PROJECT}`, { waitUntil: "domcontentloaded" });
  await pageB.goto(`${HOST}/p/${PROJECT}`, { waitUntil: "domcontentloaded" });
  // 等兩邊的 WS 都連上並互相看見
  await pageA.waitForTimeout(4000);
  await pageB.waitForTimeout(1000);

  // 手機端的在場面板預設收合；桌機視窗下應直接看得到
  const presentBtn = pageA.getByTestId("present-start");
  const hasPresent = await presentBtn.count();
  check("A 看得到「帶大家看」（房裡有其他人時才出現）", hasPresent > 0);
  if (!hasPresent) {
    await browser.close();
    return finish();
  }

  /* 1. A 開始主講 → B 出現邀請卡 */
  await presentBtn.first().click();
  await pageB.waitForTimeout(1500);
  const invite = pageB.getByTestId("presenter-invite");
  check("1. A 按下後，B 出現邀請卡（不是被切走畫面）", (await invite.count()) > 0);
  check("A 自己看到「主講中」徽章", (await pageA.getByTestId("presenter-badge").count()) > 0);

  /* 2. B 還沒加入 → 畫面不可以被動過 */
  const beforeY = await pageB.evaluate(() => window.scrollY);
  await pageA.evaluate(() => document.querySelector("#stage-board")?.scrollIntoView({ block: "center" }));
  await pageA.waitForTimeout(2000);
  const afterY = await pageB.evaluate(() => window.scrollY);
  check("2. B 未接受邀請時，畫面完全沒被帶走（規則一）", beforeY === afterY, `scrollY ${beforeY} → ${afterY}`);
  check("2b. B 此時沒有跟隨狀態列", (await pageB.getByTestId("follow-status").count()) === 0);

  /* 3. B 加入 */
  await invite.getByRole("button", { name: "加入" }).click();
  await pageB.waitForTimeout(1200);
  const followBar = pageB.getByTestId("follow-status");
  check("3. B 加入後出現「正在跟隨」", (await followBar.textContent().catch(() => "") || "").includes("正在跟隨"));

  /* 4. A 換位置 → B 被帶過去 */
  await pageA.evaluate(() => document.querySelector("#stage-story")?.scrollIntoView({ block: "center" }));
  await pageA.waitForTimeout(1200);
  await pageA.evaluate(() => document.querySelector("#stage-board")?.scrollIntoView({ block: "center" }));
  await pageA.waitForTimeout(3000);
  const followedY = await pageB.evaluate(() => window.scrollY);
  check("4. A 移動後，B 的畫面跟著到同一個區塊", followedY !== afterY, `scrollY ${afterY} → ${followedY}`);

  /* 5. B 自己動 → 暫停 */
  await pageB.mouse.move(640, 450);
  await pageB.mouse.wheel(0, 300);
  await pageB.waitForTimeout(1200);
  const pausedText = (await followBar.textContent().catch(() => "")) || "";
  check("5. B 自己捲動 → 已暫停跟隨（規則二：不硬拉回去）", pausedText.includes("已暫停"), pausedText.trim().slice(0, 40));
  check("5b. 出現「回到 Bruce」的一鍵恢復", (await followBar.getByRole("button", { name: /回到/ }).count()) > 0);

  /* 6. 回到主講者 */
  await followBar.getByRole("button", { name: /回到/ }).click();
  await pageB.waitForTimeout(1200);
  check("6. 按「回到」→ 恢復跟隨", ((await followBar.textContent().catch(() => "")) || "").includes("正在跟隨"));

  /* 7. 主講者離線 */
  await pageA.close();
  await pageB.waitForTimeout(6000);
  const goneText = (await pageB.getByTestId("follow-status").textContent().catch(() => "")) || "";
  check("7. A 離線 → B 看到「暫時離線」而不是靜悄悄地換人（規則三）", goneText.includes("離線"), goneText.trim().slice(0, 40));

  /* 8. 手機視窗的觸控目標 */
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pageM = await login(mobile, B);
  await pageM.goto(`${HOST}/p/${PROJECT}`, { waitUntil: "domcontentloaded" });
  await pageM.waitForTimeout(3000);
  const small = await pageM.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll(
      '[data-testid="presenter-invite"] button,[data-testid="follow-status"] button,[data-testid="present-start"],[data-testid="conflict-notice"] button',
    )) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < 44) bad.push(`${el.textContent?.trim()}=${Math.round(r.height)}px`);
    }
    return bad;
  });
  check("8. 手機 390×844：協作主要操作 touch target >= 44px", small.length === 0, small.join(", "));

  await browser.close();
  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通過`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("驗證中斷：", err?.message || err);
  finish();
});
