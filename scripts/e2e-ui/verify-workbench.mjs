// 工作台一體化 e2e 驗證：登入 → 建專案 → 進工作台 →
// 檢查三幕結構／摘要條／選項就地新增／跨卡跳轉，全程截圖。
import { chromium } from "playwright";

const BASE = process.env.E2E_UI_BASE || "http://127.0.0.1:3210";
const SHOT = (n) => `${process.env.E2E_UI_OUT || "./e2e-ui-out"}/shot-${n}.png`;
const results = [];
const ok = (name, cond) => { results.push([cond ? "✅" : "❌", name]); console.log(cond ? "✅" : "❌", name); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// 登入
await page.goto(BASE);
await page.fill("#login-email", "aa0968111723@gmail.com");
await page.fill("#login-pw", "test12345");
await page.click('button:has-text("登入")');
await page.waitForTimeout(1500);
ok("登入成功（看得到作業台）", await page.locator("text=AI Director OS").first().isVisible());

// 直接進已建好的驗證專案
await page.goto(BASE + "/p/4dc3b14d-2207-435f-9598-128ee38d3d79");
await page.waitForSelector("#stage-context", { timeout: 20000 });
await page.screenshot({ path: SHOT("1-top"), fullPage: false });

// ── 三幕結構 ──
ok("① 專案上下文 標頭", await page.locator("#stage-context").isVisible());
ok("② AI 創作中心 標頭", (await page.locator("#stage-create").count()) === 1);
ok("③ 分鏡・時間軸・交付 標頭", (await page.locator("#stage-deliver").count()) === 1);
ok("TocNav 三項", (await page.locator(".toc-link").count()) === 3);

// 摘要條
ok("上下文摘要條存在", await page.locator(".ctx-summary").first().isVisible());
ok("摘要條有素材 chip", (await page.locator('.ctx-summary >> text=素材').count()) >= 1);

// 素材庫在 ①（sec-assets 在 stage-create 之前）
const assetsBox = await page.locator("#sec-assets").boundingBox();
const createHead = await page.locator("#stage-create").boundingBox();
ok("素材庫已搬進 ①（位於創作中心之前）", !!assetsBox && !!createHead && assetsBox.y < createHead.y);

// 成員權限收合卡
ok("成員權限收合卡存在", (await page.locator("#sec-members summary").count()) === 1);

// ── 選項就地新增 ──
await page.locator("#onboard-worldview").scrollIntoViewIfNeeded();
const addChips = page.locator('#onboard-worldview .chip:has-text("新增")');
ok("世界觀三列都有「＋新增」chip", (await addChips.count()) === 3);
await addChips.first().click();
await page.fill('input[aria-label="新增選項名稱"]', "驗證用主軸B");
await page.click('#onboard-worldview button:has-text("加入")');
await page.waitForTimeout(1200);
const newChip = page.locator('#onboard-worldview .chip:has-text("驗證用主軸B")').first();
ok("新選項出現在 chips 列", await newChip.isVisible());
ok("新選項自動勾上（.on）", ((await newChip.getAttribute("class")) ?? "").includes("on"));
await page.screenshot({ path: SHOT("2-worldview"), fullPage: false });

// ── ② 單一 AI 創作工作台（CreationWorkbench）：四模式 tabs，非平行整頁卡 ──
ok("單一 AI 創作工作台 #sec-ai-hub", (await page.locator("#sec-ai-hub").count()) === 1);
ok(
  "工作台有四個模式 tabs",
  (await page.locator('#sec-ai-hub [role="tab"]').count()) >= 4
    && (await page.locator('#sec-ai-hub [role="tab"]:has-text("問 AI")').count()) === 1
    && (await page.locator('#sec-ai-hub [role="tab"]:has-text("直接生成")').count()) === 1
    && (await page.locator('#sec-ai-hub [role="tab"]:has-text("製作範本")').count()) === 1
    && (await page.locator('#sec-ai-hub [role="tab"]:has-text("執行計畫")').count()) === 1,
);
ok("預設問 AI 模式有對話輸入", (await page.locator('#sec-ai-hub input[aria-label="問 AI 專案助手"]').count()) === 1);
// 舊平行整頁卡不得再掛在頁面（embedded 用 div[data-fb]，非 section.card）
ok("無平行整頁提示詞庫卡", (await page.locator('section.card[data-fb="提示詞庫"]').count()) === 0);
ok("無平行整頁製作範本卡", (await page.locator('section.card[data-fb="製作範本"]').count()) === 0);
// 生成紀錄僅在資源抽屜（div[data-fb]），無獨立 section.card 殼
ok("無平行整頁生成紀錄卡", (await page.locator('section.card[data-fb="生成紀錄"]').count()) === 0);
ok("資源抽屜入口在工作台內", (await page.locator("#sec-prompts").count()) === 1);

// 直接生成模式：tab 切換後 #sec-studio 可見且有上下文 chips
await page.locator('#sec-ai-hub [role="tab"]:has-text("直接生成")').click();
await page.waitForTimeout(400);
await page.locator("#sec-studio").scrollIntoViewIfNeeded();
ok("直接生成模式露出 #sec-studio", await page.locator("#sec-studio").isVisible());
ok("生成台就地顯示帶入 chips", (await page.locator('#sec-studio .ctx-summary').count()) === 1);
await page.screenshot({ path: SHOT("3-studio"), fullPage: false });

// 摘要條 chip 跳轉（點「知識」捲到知識庫）
await page.locator(".ctx-summary").first().scrollIntoViewIfNeeded();
await page.locator('.ctx-summary .chip:has-text("知識")').first().click();
await page.waitForTimeout(900);
const kbBox = await page.locator("#sec-knowledge").boundingBox();
ok("摘要條 chip 點了捲到知識庫", !!kbBox && kbBox.y > -50 && kbBox.y < 400);

// 銜接語（指向工作台／資源抽屜，非舊「生成卡」）
ok(
  "幕間銜接語 ×2",
  (await page.locator("text=自動注入下方每一次生成").count()) === 1
    && (await page.locator("text=成品會自動存入素材庫").count()) === 1,
);
ok("② 標頭文案對齊統一工作台", (await page.locator("#stage-create >> text=同一工作台切換").count()) >= 1);

await page.screenshot({ path: SHOT("4-full"), fullPage: true });
await browser.close();
const fails = results.filter(([s]) => s === "❌").length;
console.log(`—— ${results.length} 項：${results.length - fails} 過 / ${fails} 敗 ——`);
process.exit(fails ? 1 : 0);
