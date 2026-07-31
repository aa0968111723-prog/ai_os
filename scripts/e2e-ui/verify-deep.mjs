// 深度優化驗證：世界觀進階編輯／導演建議存成分鏡／勾選持久化／逐格模型選擇／助手快速提問／注入透明化
import { chromium } from "playwright";

const BASE = process.env.E2E_UI_BASE || "http://127.0.0.1:3210";
const PROJ = "4dc3b14d-2207-435f-9598-128ee38d3d79";
const SHOT = (n) => `${process.env.E2E_UI_OUT || "./e2e-ui-out"}/shot-${n}.png`;
const results = [];
const ok = (name, cond) => { results.push([!!cond, name]); console.log(cond ? "✅" : "❌", name); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(BASE);
await page.fill("#login-email", "aa0968111723@gmail.com");
await page.fill("#login-pw", "test12345");
await page.click("button[type=submit]");
await page.waitForTimeout(1500);
await page.goto(`${BASE}/p/${PROJ}`);
await page.waitForSelector("#stage-context", { timeout: 20000 });

// ── 1. 世界觀進階欄位可編輯 ──
await page.locator("#onboard-worldview details summary").click();
await page.waitForTimeout(300);
ok("進階設定含目標觀眾輸入框", (await page.locator("#wv-audience").count()) === 1);
await page.fill("#wv-audience", "想找安定的年輕人");
await page.locator("#wv-audience").blur();
await page.waitForTimeout(800);
// 三幕結構 hook
await page.fill('input[aria-label="三幕結構：鉤子"]', "清晨禪堂前庭的紅傘");
await page.locator('input[aria-label="三幕結構：鉤子"]').blur();
await page.waitForTimeout(800);
// 人物 token 新增
await page.fill('input[aria-label="新增人物（供 AI 導演參考）"]', "安倢＝紅傘米白外套");
await page.press('input[aria-label="新增人物（供 AI 導演參考）"]', "Enter");
await page.waitForTimeout(800);
ok("人物 chip 已加入", (await page.locator('#onboard-worldview .chip:has-text("安倢＝紅傘米白外套")').count()) === 1);
// 禁忌預設 3 條存在＋可移除鈕
ok("禁忌事項預設條目存在", (await page.locator('#onboard-worldview [aria-label^="移除「不得使用"]').count()) === 1);
// 重整驗證持久化到後端
await page.reload();
await page.waitForSelector("#stage-context", { timeout: 20000 });
await page.locator("#onboard-worldview details summary").click();
await page.waitForTimeout(300);
ok("目標觀眾重整後仍在（已存後端）", (await page.locator("#wv-audience").inputValue()) === "想找安定的年輕人");
ok("三幕鉤子重整後仍在", (await page.locator('input[aria-label="三幕結構：鉤子"]').inputValue()) === "清晨禪堂前庭的紅傘");
ok("人物重整後仍在", (await page.locator('#onboard-worldview .chip:has-text("安倢＝紅傘米白外套")').count()) === 1);
await page.screenshot({ path: SHOT("1-advanced"), fullPage: false });

// ── 2. 角色勾選持久化 ──
// 先建一個角色（若還沒有）
if ((await page.locator('#sec-characters input[type="checkbox"]').count()) === 0) {
  await page.locator('#sec-characters button:has-text("新增角色定裝")').click();
  await page.fill("#char-name", "安倢");
  await page.fill("#char-appearance", "紅色雨傘、米白外套");
  await page.locator('#sec-characters button:has-text("建立角色")').click();
  await page.waitForTimeout(1000);
}
const charCheck = page.locator('#sec-characters input[type="checkbox"]').first();
if (!(await charCheck.isChecked())) await charCheck.check();
await page.waitForTimeout(400);
await page.reload();
await page.waitForSelector("#sec-characters", { timeout: 20000 });
await page.waitForTimeout(800);
ok("角色勾選重整後仍勾著（持久化）", await page.locator('#sec-characters input[type="checkbox"]').first().isChecked());

// ── 3. 統一入口快速開場 chips ──
await page.locator("#sec-ai-hub").scrollIntoViewIfNeeded();
ok("統一入口有快速開場 chips", (await page.locator('#sec-assistant button:has-text("這個專案進度到哪？")').count()) === 1);
await page.locator('#sec-assistant button:has-text("這個專案進度到哪？")').click();
ok("點了帶入輸入框（不自動送出）", (await page.locator('input[aria-label="問 AI 專案助手"]').inputValue()).includes("進度"));

// ── 4. 統一入口發想（導演職能併入對話）：問 idea → 有 AI 回覆（mock 模式回確定性摘要＋plan_agent 提議） ──
await page.fill('input[aria-label="問 AI 專案助手"]', "給我 3 個分鏡 idea");
await page.locator('#sec-assistant button.primary:has-text("問")').click();
await page.waitForTimeout(4000);
ok("對話有 AI 回覆", (await page.locator('#sec-assistant [role="log"] >> text=助手').count()) >= 1);
ok("回覆帶可執行提議（確認才執行）", (await page.locator('#sec-assistant button:has-text("讓 AI 代理排計畫")').count()) >= 1);
await page.screenshot({ path: SHOT("2-director"), fullPage: false });

// ── 5. 逐格模型選擇（深度優化後收進單格工作室「重畫這格」，分鏡列不再放選單）──
await page.locator("#onboard-delivery").scrollIntoViewIfNeeded();
await page.locator('#onboard-delivery button:has-text("單格工作室")').first().click();
await page.locator('[role="tab"]:has-text("重畫這格")').click();
const modelSel = page.locator('[id^="studio-regen-model-"]');
ok("單格工作室有重畫模型選單", (await modelSel.count()) === 1);
const modelVal = await modelSel.locator("option").nth(1).getAttribute("value");
await modelSel.selectOption(modelVal);
const chosen = await modelSel.inputValue();
await page.locator('[aria-label="關閉單格工作室"]').click();
await page.reload();
await page.waitForSelector('#onboard-delivery button:has-text("單格工作室")', { timeout: 20000 });
await page.locator('#onboard-delivery button:has-text("單格工作室")').first().click();
await page.locator('[role="tab"]:has-text("重畫這格")').click();
ok("模型選擇重整後仍記住", (await page.locator('[id^="studio-regen-model-"]').inputValue()) === chosen);
await page.keyboard.press("Escape");
await page.screenshot({ path: SHOT("3-scenemodel"), fullPage: false });

// ── 6. 生成確認彈窗注入透明化 ──
await page.locator("#gen-prompt").fill("清晨禪堂一炷香");
await page.locator('#sec-studio button:has-text("生成（")').click();
await page.waitForTimeout(600);
ok("確認彈窗列出自動注入", (await page.locator('.confirm-panel:has-text("自動注入")').count()) >= 0 && (await page.locator("text=自動注入：").count()) >= 1);
await page.screenshot({ path: SHOT("4-confirm"), fullPage: false });

await browser.close();
const fails = results.filter(([s]) => !s).length;
console.log(`—— ${results.length} 項：${results.length - fails} 過 / ${fails} 敗 ——`);
process.exit(fails ? 1 : 0);
