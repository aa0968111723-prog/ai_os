// 黃金路徑真人走查：登入→建案→世界觀→知識庫→拆分鏡→逐格生成→配音→送審→通過→預覽→打包驗證→AI代理
// 每一步截圖存檔，最後下載 zip 與 srt 落地供人工驗證內容。
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.E2E_UI_BASE || "http://127.0.0.1:3210";
const DIR = process.env.E2E_UI_OUT || "./e2e-ui-out";
fs.mkdirSync(DIR, { recursive: true });
const shot = (page, n) => page.screenshot({ path: `${DIR}/${n}.png`, fullPage: false });
const log = (...a) => console.log("▸", ...a);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

// 1. 登入
await page.goto(BASE);
await shot(page, "01-login");
await page.fill("#login-email", "aa0968111723@gmail.com");
await page.fill("#login-pw", "test12345");
await page.click("button[type=submit]");
await page.waitForSelector("#np-title", { timeout: 20000 });
await shot(page, "02-launchpad");
log("登入成功，作業台載入");

// 2. 建專案
await page.fill("#np-title", `黃金路徑・晨鐘之路 ${Date.now() % 10000}`);
await page.click('button:has-text("建立專案")');
// 建案成功會自動導入專案頁（Launchpad create onSuccess navigate）
await page.waitForSelector("#stage-context", { timeout: 20000 });
await shot(page, "03-project-top");
log("專案建立並進入工作台");

// 3. 世界觀
await page.fill("#wv-logline", "晨鐘響起，浮躁的心在禪堂找到安放之處");
await page.locator("#wv-logline").blur();
await page.waitForTimeout(600);
await page.locator('#onboard-worldview .chip:has-text("莊嚴")').first().click();
await page.locator('#onboard-worldview .chip:has-text("日系水彩")').first().click();
await page.waitForTimeout(800);
await shot(page, "04-worldview");
log("世界觀已定盤（logline＋調性＋風格）");

// 4. 知識庫貼腳本
await page.locator('button:has-text("加入素材知識")').click();
await page.selectOption('select[id^="kb-kind"]', "script");
await page.fill('input[id^="kb-title"]', "晨鐘三幕腳本");
await page.fill('textarea[id^="kb-content"]', "清晨五點的禪堂，鐘聲穿過薄霧，安倢撐著紅傘走進前庭。\n\n大殿裡，一炷香緩緩升起，慕恩靜坐蒲團，浮躁在呼吸間慢慢沉澱。\n\n日光漫過門檻，眾人合十起身，把心交給佛，日子有了呼吸的空隙。");
await page.locator('button:has-text("加入知識庫")').click();
await page.waitForTimeout(1200);
await shot(page, "05-knowledge");
log("腳本已入知識庫");

// 5. AI 拆分鏡（留空用知識庫）——四合一：先切到「拆分鏡」分頁
await page.locator('#sec-ai-hub [role="tab"]:has-text("拆分鏡")').click();
await page.locator('button:has-text("貼腳本自動拆分鏡")').click();
await page.getByRole("button", { name: "拆成分鏡", exact: true }).click();
await page.locator('button:has-text("開始拆分")').click();
await page.waitForSelector('text=已建立', { timeout: 30000 });
await shot(page, "06-split");
log("拆分鏡完成");

// 6. 逐格生成第 1 格 ＋ 配音
await page.locator("#onboard-delivery").scrollIntoViewIfNeeded();
await page.locator('button:has-text("生成這一格")').first().click();
await page.locator('button:has-text("確認生成")').first().click();
// 等縮圖回填（背景 runner）
let gotThumb = false;
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(3000);
  if ((await page.locator("#onboard-delivery img.gen-thumb").count()) >= 1) { gotThumb = true; break; }
}
log("逐格生成回填縮圖：", gotThumb);
await page.locator('button:has-text("生成配音")').first().click();
await page.locator('button:has-text("確認生成")').first().click();
let gotAudio = false;
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(3000);
  if ((await page.locator("#onboard-delivery audio").count()) >= 1) { gotAudio = true; break; }
}
log("旁白音檔出現：", gotAudio);
await page.locator("#onboard-delivery").scrollIntoViewIfNeeded();
await shot(page, "07-scene-generated");

// 7. 送審 → 通過（開發者）
await page.locator('#onboard-delivery button:has-text("送審")').first().click();
await page.waitForTimeout(1500);
await page.locator('#onboard-delivery button:has-text("通過")').first().click();
await page.waitForTimeout(1500);
await shot(page, "08-approved");
log("第 1 鏡送審→通過");

// 8. 粗剪預覽
await page.locator('button:has-text("粗剪預覽")').click();
await page.waitForTimeout(1500);
await shot(page, "09-preview");
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
log("粗剪預覽開啟/關閉");

// 9. 下載 zip 與 srt 驗證
const url = page.url();
const pid = url.split("/p/")[1];
const zipRes = await page.request.get(`${BASE}/api/export/${pid}`);
const zipBuf = await zipRes.body();
fs.writeFileSync(`${DIR}/deliver.zip`, zipBuf);
log("zip 下載：", zipRes.status(), zipBuf.length, "bytes");
const srtRes = await page.request.get(`${BASE}/api/export/${pid}/timeline?format=srt`);
const srtText = await srtRes.text();
fs.writeFileSync(`${DIR}/timeline.srt`, srtText);
log("srt 下載：", srtRes.status(), srtText.length, "chars");

// 10. AI 代理一輪——四合一：先切回「AI 代理」分頁
await page.locator("#sec-ai-hub").scrollIntoViewIfNeeded();
await page.locator('#sec-ai-hub [role="tab"]:has-text("AI 代理")').click();
await page.locator("#sec-agent").scrollIntoViewIfNeeded();
await page.fill(`#agent-goal-${pid}`, "為片尾補一格感恩收尾鏡並生成畫面");
await page.locator('#sec-agent button:has-text("規劃計畫")').click();
await page.locator('button:has-text("開始規劃")').click();
await page.waitForSelector('#sec-agent .pill:has-text("待你核准")', { timeout: 20000 });
await shot(page, "10-agent-plan");
await page.locator('#sec-agent button:has-text("執行計畫（預估")').click();
await page.locator('#sec-agent button:has-text("執行"):not(:has-text("計畫"))').first().click();
let agentDone = false;
for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(3000);
  if ((await page.locator('#sec-agent .pill:has-text("已完成")').count()) >= 1) { agentDone = true; break; }
}
log("AI 代理跑完：", agentDone);
await shot(page, "11-agent-done");

await browser.close();
log("走查完成，截圖與交付檔在", DIR);
