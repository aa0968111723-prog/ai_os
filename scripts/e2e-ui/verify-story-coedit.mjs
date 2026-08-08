/**
 * Story 共編（Yjs）實機驗證——驗收場景 5：
 * 「Bruce 與韋澔同時在 Story 編輯。兩人都有名字、caret、顏色。同時輸入。
 *   任何人的文字都不會因另一個人的 autosave 而消失。」
 *
 * 兩個真帳號、兩個 browser context、真 /ws-doc WebSocket。單元測試證明 CRDT 收斂；
 * 這裡證明**接上真的瀏覽器與伺服器之後**，兩個人同時打字誰的字都還在。
 *
 * 環境變數同 verify-presenter.mjs（COEDIT_* 前綴）。
 */
import { chromium } from "playwright";

const HOST = process.env.COEDIT_HOST || "http://127.0.0.1:5173";
const CHROMIUM = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";
const PROJECT = process.env.COEDIT_PROJECT;
const A = { email: process.env.COEDIT_A_EMAIL, password: process.env.COEDIT_A_PASSWORD, label: "A(Bruce)" };
const B = { email: process.env.COEDIT_B_EMAIL, password: process.env.COEDIT_B_PASSWORD, label: "B(韋澔)" };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

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

/** 故事編輯器的 textarea（ScriptEditor 的主輸入框） */
async function storyArea(page) {
  const area = page.locator('#story-workspace textarea').first();
  await area.waitFor({ state: "visible", timeout: 30_000 });
  return area;
}

async function main() {
  if (!PROJECT) throw new Error("COEDIT_PROJECT 未設定");
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageA = await login(ctxA, A);
  const pageB = await login(ctxB, B);

  await pageA.goto(`${HOST}/p/${PROJECT}`, { waitUntil: "domcontentloaded" });
  await pageB.goto(`${HOST}/p/${PROJECT}`, { waitUntil: "domcontentloaded" });

  const areaA = await storyArea(pageA);
  const areaB = await storyArea(pageB);
  // 等兩邊 /ws-doc 都連上（共編標籤出現）
  await pageA.waitForTimeout(3500);

  const coeditA = await pageA.locator("#story-workspace").textContent();
  check("1. A 看得到「共編中 · 即時同步」（/ws-doc 已連上）", (coeditA ?? "").includes("共編中"));

  /* 2. A 打字 → B 看得到 */
  await areaA.click();
  await areaA.pressSequentially("下雨了。淡水好容易下雨呀。", { delay: 15 });
  await pageB.waitForTimeout(2000);
  const bSees = await areaB.inputValue();
  check("2. A 打的字即時出現在 B 的編輯器", bSees.includes("下雨了。淡水好容易下雨呀。"), bSees.slice(0, 40));

  /* 3. B 看得到 A 的 caret（名牌＋顏色） */
  await pageB.waitForTimeout(500);
  const caretOnB = await pageB.getByTestId("remote-caret").count();
  check("3. B 的編輯器上有 A 的 caret（名牌不同顏色）", caretOnB > 0, `carets=${caretOnB}`);

  /* 4. 同時輸入：A 在開頭、B 在結尾——誰的字都不能消失 */
  await areaA.click();
  await areaA.press("Control+Home");
  const typeA = areaA.pressSequentially("【第一場】", { delay: 25 });
  await areaB.click();
  await areaB.press("Control+End");
  const typeB = areaB.pressSequentially("她撐起紅傘。", { delay: 25 });
  await Promise.all([typeA, typeB]);
  await pageA.waitForTimeout(2500);

  const finalA = await areaA.inputValue();
  const finalB = await areaB.inputValue();
  check("4. 同時輸入後兩端一致（converged）", finalA === finalB, finalA === finalB ? finalA.slice(0, 50) : `A="${finalA.slice(0, 40)}" B="${finalB.slice(0, 40)}"`);
  check("4b. A 的字還在", finalB.includes("【第一場】"));
  check("4c. B 的字還在", finalA.includes("她撐起紅傘。"));
  check("4d. 原文沒有被任何人的同步吃掉", finalA.includes("下雨了。淡水好容易下雨呀。"));

  /* 5. materialize：重新載入頁面（讀 stories.content / 快照）內容還在 */
  await pageB.waitForTimeout(2500); // 等防抖落盤
  await pageA.reload({ waitUntil: "domcontentloaded" });
  const areaA2 = await storyArea(pageA);
  await pageA.waitForTimeout(3000);
  const reloaded = await areaA2.inputValue();
  check("5. 重新整理後內容持久（快照＋materialize 落盤）", reloaded.includes("她撐起紅傘。") && reloaded.includes("【第一場】"), reloaded.slice(0, 50));

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
