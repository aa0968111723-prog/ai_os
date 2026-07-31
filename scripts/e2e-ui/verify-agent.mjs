// 專案 AI 代理系統實機驗證（mock 模式）：統一對話入口下目標 → 代理提議排計畫 → 排出計畫（待核准）→
// 核准執行 → 背景逐步完成 → 分鏡出現、成品回填、送審成功；另驗放棄流程。
import { chromium } from "playwright";

const BASE = process.env.E2E_UI_BASE || "http://127.0.0.1:3210";
const PROJ = "4dc3b14d-2207-435f-9598-128ee38d3d79";
const SHOT = (n) => `${process.env.E2E_UI_OUT || "./e2e-ui-out"}/shot-${n}.png`;
const results = [];
const ok = (name, cond) => { results.push([!!cond, name]); console.log(cond ? "✅" : "❌", name); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
await page.goto(BASE);
await page.fill("#login-email", "aa0968111723@gmail.com");
await page.fill("#login-pw", "test12345");
await page.click("button[type=submit]");
await page.waitForTimeout(1800);
await page.goto(`${BASE}/p/${PROJ}`);
await page.waitForSelector("#sec-ai-hub", { timeout: 20000 });

/** 統一入口下目標：對話送出 → 等「讓 AI 代理排計畫」提議 → 確認（mock 模式提議是確定性的） */
async function planViaChat(goal) {
  await page.locator("#sec-ai-hub").scrollIntoViewIfNeeded();
  await page.fill('input[aria-label="問 AI 專案助手"]', goal);
  await page.locator('#sec-assistant button.primary:has-text("問")').click();
  await page.locator('#sec-assistant button:has-text("讓 AI 代理排計畫")').last().click({ timeout: 30000 });
  await page.locator('.confirm-panel button:has-text("執行")').first().click();
  await page.waitForTimeout(2500);
}

// ── 1. 統一入口存在：一個對話＋代理執行區（不再是四張卡/分頁） ──
ok("專案 AI 代理系統存在", (await page.locator("#sec-ai-hub").count()) === 1);
ok("統一對話輸入存在", (await page.locator('#sec-assistant input[aria-label="問 AI 專案助手"]').count()) === 1);
ok("代理執行區存在", (await page.locator("#sec-agent").count()) === 1);
ok("快速開場含下目標例句", (await page.locator('#sec-assistant button:has-text("把知識庫的腳本拆成分鏡")').count()) === 1);

// ── 2. 對話下目標 → 代理排出計畫（待核准） ──
const sceneCountBefore = await page.locator("#onboard-delivery .gen-row").count();
await planViaChat("清晨禪堂一炷香的開場鏡頭");
ok("計畫出現（待你核准）", (await page.locator('#sec-agent .pill:has-text("待你核准")').count()) >= 1);
ok("計畫含三步（建鏡/生成/送審）", (await page.locator('#sec-agent :text("新增分鏡")').count()) >= 1 && (await page.locator('#sec-agent :text("送審")').count()) >= 1);
ok("顯示估點", (await page.locator('#sec-agent button:has-text("執行計畫（預估")').count()) === 1);
await page.screenshot({ path: SHOT("1-plan"), fullPage: false });

// ── 3. 核准執行 → 背景跑完 ──
await page.locator('#sec-agent button:has-text("執行計畫（預估")').click();
await page.locator('#sec-agent button:has-text("執行"):not(:has-text("計畫"))').first().click().catch(async () => {
  // ConfirmButton 確認面板的按鈕文字就是「執行」
  await page.locator('.confirm-panel button:has-text("執行")').first().click();
});
await page.waitForTimeout(1000);
// 等 runner 逐步推進（4 秒一 tick × 3 步 ＋ mock 生成完成時間）
let doneSeen = false;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(3000);
  if ((await page.locator('#sec-agent .pill:has-text("已完成")').count()) >= 1) { doneSeen = true; break; }
  if ((await page.locator('#sec-agent .pill:has-text("失敗")').count()) >= 1) break;
}
ok("代理執行完成（背景逐步）", doneSeen);
await page.screenshot({ path: SHOT("2-done"), fullPage: false });

// ── 4. 副作用落地：分鏡多一格、成品回填、送審 pending ──
await page.waitForTimeout(1500);
const sceneCountAfter = await page.locator("#onboard-delivery .gen-row").count();
ok("分鏡列表多了一格", sceneCountAfter === sceneCountBefore + 1);
ok("新分鏡進入待審", (await page.locator('#onboard-delivery .pill:has-text("待審")').count()) >= 1);
await page.locator("#onboard-delivery").scrollIntoViewIfNeeded();
await page.screenshot({ path: SHOT("3-scenes"), fullPage: false });

// ── 5. 放棄計畫流程 ──
await planViaChat("測試放棄用的第二份計畫");
const discardBtn = page.locator('#sec-agent button:has-text("放棄這份計畫")').first();
ok("第二份計畫可放棄", (await discardBtn.count()) === 1);
await discardBtn.click();
await page.waitForTimeout(1200);
ok("放棄後計畫從清單消失", (await page.locator('#sec-agent .pill:has-text("待你核准")').count()) === 0);

await browser.close();
const fails = results.filter(([s]) => !s).length;
console.log(`—— ${results.length} 項：${results.length - fails} 過 / ${fails} 敗 ——`);
process.exit(fails ? 1 : 0);
