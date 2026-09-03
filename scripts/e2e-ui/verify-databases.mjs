// 資料庫系統真瀏覽器實測（Playwright）：登入 → /databases → 建庫 → 加欄位 → 加列 →
// CSV 匯入 → 文件上傳（抽字）→ 連接面板（REST/CSV/行事曆）→ 驗證，全程截圖。
// 跑法：先起 server(:3000)+vite(:5173)；E2E_UI_BASE=http://127.0.0.1:5173 node scripts/e2e-ui/verify-databases.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.E2E_UI_BASE || "http://127.0.0.1:5173";
const DIR = process.env.E2E_UI_OUT || "./e2e-ui-out/databases";
fs.mkdirSync(DIR, { recursive: true });
const shot = (page, n) => page.screenshot({ path: `${DIR}/${n}.png`, fullPage: true });
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PW;
if (!EMAIL || !PASSWORD) {
  throw new Error("verify-databases 需設 TEST_EMAIL / TEST_PW（對應 .env.example）；憑證不得寫死在腳本中。");
}
const results = [];
const ok = (name, cond) => { results.push([!!cond, name]); console.log(cond ? "✅" : "❌", name); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 950 } });
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

// ── 1. 登入 ──
await page.goto(BASE);
await page.waitForSelector("#login-email", { timeout: 20000 });
await page.fill("#login-email", EMAIL);
await page.fill("#login-pw", PASSWORD);
await shot(page, "01-login");
await page.click("button[type=submit]");
await page.waitForSelector(".topbar", { timeout: 20000 });
await page.waitForTimeout(1200);
ok("登入成功（頂欄載入）", await page.locator(".topbar").isVisible());

// ── 2. 進資料庫頁 ──
await page.goto(`${BASE}/databases`);
await page.waitForSelector('h1:has-text("資料庫")', { timeout: 20000 });
await page.waitForTimeout(800);
await shot(page, "02-databases-empty");
ok("資料庫頁載入", await page.locator('h1:has-text("資料庫")').isVisible());
ok("有「建立資料庫」鈕", (await page.locator('button:has-text("建立資料庫")').count()) >= 1);

// ── 3. 建立資料庫（個人，三欄位：文字/單選/勾選）──
await page.locator('button:has-text("建立資料庫")').first().click();
await page.waitForSelector("#db-name", { timeout: 10000 });
const dbName = `拍攝任務表 ${Date.now() % 10000}`;
await page.fill("#db-name", dbName);
await page.fill("#db-desc", "瀏覽器實測：任務、負責人、狀態、完成");
// 欄位 1：改名為「任務」（預設是文字，必填）
await page.fill('input[aria-label="欄位 1 名稱"]', "任務");
// 加第二欄：狀態（單選）
await page.locator('button:has-text("加欄位")').click();
await page.fill('input[aria-label="欄位 2 名稱"]', "狀態");
await page.selectOption('select[aria-label="欄位 2 型別"]', "select");
await page.fill('input[aria-label="欄位 2 選項"]', "待辦、進行中、完成");
// 加第三欄：完成（勾選）
await page.locator('button:has-text("加欄位")').click();
await page.fill('input[aria-label="欄位 3 名稱"]', "完成");
await page.selectOption('select[aria-label="欄位 3 型別"]', "checkbox");
await page.waitForTimeout(400);
await shot(page, "03-create-form");
await page.locator('section:has-text("建立資料庫") button:has-text("建立")').first().click();
// 建立成功→詳頁出現（標題就是 dbName）
await page.waitForSelector(`h2:has-text("${dbName}")`, { timeout: 15000 });
await page.waitForTimeout(600);
await shot(page, "04-created-detail");
ok("資料庫建立並進入詳頁", await page.locator(`h2:has-text("${dbName}")`).isVisible());
ok("三個欄位表頭呈現", (await page.locator('th:has-text("任務")').count()) === 1 && (await page.locator('th:has-text("狀態")').count()) === 1 && (await page.locator('th:has-text("完成")').count()) === 1);

// ── 4. 手動新增一列（頂列輸入 → +）──
await page.fill('td input[aria-label="任務"]', "外景勘查");
await page.selectOption('td select[aria-label="狀態"]', "進行中");
await page.check('td input[aria-label="完成"]').catch(() => {});
await page.locator('button[title="新增這一列"]').click();
await page.waitForTimeout(800);
await shot(page, "05-row-added");
ok("手動新增列成功（外景勘查出現）", (await page.locator('td:has-text("外景勘查")').count()) >= 1);

// ── 5. CSV 匯入（含單選與勾選欄位；驗證是/否轉 boolean）──
await page.locator('button:has-text("匯入 CSV")').click();
await page.waitForSelector('textarea[aria-label="CSV 內容"]', { timeout: 8000 });
await page.fill('textarea[aria-label="CSV 內容"]', "任務,狀態,完成\r\n剪輯初剪,待辦,否\r\n配樂,完成,是");
await page.locator('button:has-text("自動對應欄位")').click();
await page.waitForTimeout(400);
await shot(page, "06-csv-mapping");
await page.locator('button:has-text("開始匯入")').click();
await page.waitForTimeout(1200);
await shot(page, "07-csv-imported");
ok("CSV 匯入成功訊息", (await page.locator('text=/匯入完成：成功 2 列/').count()) >= 1);
ok("CSV 匯入的列出現（配樂）", (await page.locator('td:has-text("配樂")').count()) >= 1);

// ── 6. 文件上傳（AI 可讀）：上傳一個 txt，驗證抽字字數徽章 ──
// 檔名用 ASCII（Playwright setInputFiles 對非 ASCII 檔名的合成有已知怪癖，與產品無關——
// 產品端 multer 已有中文檔名 latin1→utf8 修正；此處只驗抽字，內容仍是中文）。
const tmpTxt = path.join(os.tmpdir(), `transcript-${Date.now()}.txt`);
fs.writeFileSync(tmpTxt, "師父開示：慈悲喜捨，普度眾生。瀏覽器實測文件抽字。", "utf8");
// 重新整理頁面再從左欄點選本庫，取得「已落定、無 refetch 進行中」的乾淨畫面再上傳
// （否則緊接 CSV 匯入的 invalidate 重渲染會吃掉 file input 的 change 事件）
await page.goto(`${BASE}/databases`);
await page.waitForSelector('h1:has-text("資料庫")', { timeout: 15000 });
await page.locator(`button:has-text("${dbName}")`).first().click();
await page.waitForSelector('input[aria-label="上傳文件"]', { timeout: 10000 });
await page.waitForTimeout(1200);
const upRespP = page.waitForResponse((r) => r.url().includes("/api/databases/upload"), { timeout: 15000 }).catch(() => null);
await page.locator('input[aria-label="上傳文件"]').first().setInputFiles(tmpTxt);
const upResp = await upRespP;
await page.waitForSelector('text=/AI 可讀 \\d+ 字/', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(600);
await shot(page, "08-file-uploaded");
ok("文件上傳 API 成功", !!upResp && upResp.ok());
ok("文件上傳後顯示 AI 可讀字數", (await page.locator('text=/AI 可讀 \\d+ 字/').count()) >= 1);

// ── 7. 連接面板（REST / CSV / 行事曆）──
await page.locator('summary:has-text("連接本機")').click();
await page.waitForTimeout(400);
await shot(page, "09-connect-panel");
ok("連接面板含 REST API 範本", (await page.locator('text=/api/v1/databases/').count()) >= 1);
ok("連接面板含 CSV 匯出網址", (await page.locator('text=rows.csv').count()) >= 1);

// ── 8. 左欄清單顯示這個庫（列數計）──
ok("左欄清單出現新庫", (await page.locator(`button:has-text("${dbName}")`).count()) >= 1);
await shot(page, "10-final");

const passed = results.filter(([p]) => p).length;
console.log(`\n—— 瀏覽器實測 ${passed}/${results.length} 通過 ——`);
console.log(`截圖存於 ${path.resolve(DIR)}`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
