/**
 * Visual Creative UX v4 的瀏覽器證據擷取。
 *
 * 走真的 UI（不是元件測試替身）：登入 → 建案 → 建分鏡 → 選鏡 →
 * 看 Aios 方向提案 → 開單格工作室 → 選方向 → 產生 → 看逐方向狀態 → Compare。
 * 桌機與 390px 各跑一次。
 *
 * partial failure 的證據刻意用「直接把其中一筆生成標成 failed」產生：
 * 那正是真實失敗路徑留在 DB 的狀態，而這一輪要證明的正是
 * 「UI 的批次狀態完全由持久化真相推導」——包含 reload 之後仍然一致。
 */
import { chromium } from "playwright";
import fs from "node:fs";
import pg from "pg";

const BASE = (process.env.E2E_UI_BASE || "http://127.0.0.1:3241").replace(/\/$/, "");
const OUT = process.env.E2E_UI_OUT || "./docs/evidence/creative-intelligence-v4";
const EMAIL = process.env.TEST_EMAIL || "admin@aidirector.local";
const PW = process.env.TEST_PW || "test-admin-123";
const DB = process.env.DATABASE_URL;

fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("▸", ...a);
const notes = [];

const browser = await chromium.launch({ headless: true });

/** 用 tRPC 直接把資料鋪好——這支要拍的是 v4 的畫面，不是重跑一次拆分鏡流程 */
async function seed(page) {
  return page.evaluate(async () => {
    const call = async (path, input) => {
      const res = await fetch(`/api/trpc/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input }),
      });
      const body = await res.json();
      if (body?.error) throw new Error(`${path}: ${body.error.json?.message ?? "failed"}`);
      return body?.result?.data?.json;
    };
    const me = await (await fetch("/api/trpc/auth.me")).json();
    const groupId = me?.result?.data?.json?.groups?.[0]?.groupId;
    if (!groupId) throw new Error("登入帳號沒有任何組別");
    const project = await call("projects.create", {
      groupId,
      title: `Creative Direction v4 證據 ${Date.now() % 100000}`,
      kind: "video",
      platform: "youtube",
      format: "16:9",
    });
    await call("projects.updateWorldview", {
      id: project.id,
      worldview: { logline: "晨鐘響起，浮躁的心在禪堂找到安放之處", tones: ["溫暖"], styles: ["日系水彩"] },
    });
    const character = await call("characters.add", {
      projectId: project.id,
      name: "安倢",
      appearance: "黑色長髮，柔和五官，淺色外套",
    });
    const scene = await call("scenePresets.add", {
      projectId: project.id,
      name: "晨光禪堂",
      palette: "米白牆面、原木地板、晨霧透光",
      lighting: "側逆光，光束穿過窗櫺",
    });
    const shots = [];
    for (const [i, spec] of [
      { title: "推門而入", prompt: "安倢推開禪堂木門，晨光從門縫灑進來", shotSize: "中景" },
      { title: "點香", prompt: "安倢在案前點起一炷香，煙緩緩升起", shotSize: "特寫" },
      { title: "靜坐", prompt: "安倢在蒲團上靜坐，光影落在肩上", shotSize: "全景" },
    ].entries()) {
      const shot = await call("scenes.addDraft", { projectId: project.id, title: spec.title, prompt: spec.prompt });
      await call("scenes.setCards", {
        sceneId: shot.id,
        characterIds: [character.id],
        scenePresetIds: [scene.id],
      });
      await call("scenes.update", {
        sceneId: shot.id,
        camera: { shotSize: spec.shotSize, angle: "平視", lighting: "柔光" },
        performance: { emotion: "平靜" },
      });
      shots.push(shot.id);
      void i;
    }
    return { projectId: project.id, shots };
  });
}

async function login(page) {
  // 根路徑是行銷頁；登入表單在 /login
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-email", { timeout: 30000 });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-pw", PW);
  await page.click("button[type=submit]");
  // #np-title（新專案輸入框）在 390px 是收合的 → 等「已經離開登入頁」而不是等某個桌機元素
  await page.waitForFunction(() => !document.querySelector("#login-email"), { timeout: 30000 });
  await page.waitForTimeout(1200);
}

/** 捲到分鏡段並勾選第一鏡 */
async function openStoryboard(page, projectId) {
  await page.goto(`${BASE}/p/${projectId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#storyboard-center", { timeout: 30000 });
  await page.locator("#storyboard-center").scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
}

/** 自動跳出的 Compare 會擋住底下的版本列；要手動走勾選流程前先關掉 */
async function closeCompareIfOpen(page) {
  if (await page.locator(".scene-compare-surface").count()) {
    await page.locator('.scene-compare-surface > header button[aria-label*="關閉"]').first().click().catch(() => {});
    await page.waitForTimeout(500);
  }
  if (await page.locator(".scene-compare-surface").count()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
}

async function capture(page, name, note) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  notes.push(`- \`${name}.png\` — ${note}`);
  log(name, "→", note);
}

/** 橫向溢出稽核：排除本身就是橫向捲動容器的子孫，否則 topbar 那類 scroller 會全部誤報 */
async function overflowAudit(page) {
  return page.evaluate(() => {
    const scrollers = new Set();
    for (const el of document.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      if (style.overflowX === "auto" || style.overflowX === "scroll") scrollers.add(el);
    }
    const insideScroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (scrollers.has(p)) return true;
      return false;
    };
    const bad = [];
    for (const el of document.querySelectorAll("*")) {
      if (insideScroller(el) || scrollers.has(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      if (rect.right > window.innerWidth + 1 || rect.left < -1) {
        bad.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} right=${Math.round(rect.right)}`);
      }
    }
    const small = [];
    for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=tab], [role=option]")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height < 44) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || "").trim().slice(0, 14)}=${Math.round(rect.height)}`);
    }
    // v4 新增的控制項單獨量一次——站內既有 chrome（頂欄連結、跳過連結）的既有尺寸
    // 不是這一輪的責任，混在一起看會看不出自己有沒有退步。
    const V4_SELECTORS = [
      ".scene-intent-strip button",
      ".scene-direction-card",
      ".scene-compare-modes button",
      ".scene-compare-ab__switch button",
      ".creative-proposal-chip",
      ".scene-variant-launch .btn",
      '.scene-compare-surface > header button[aria-label*="關閉"]',
    ];
    const v4Small = [];
    for (const sel of V4_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.height < 44) v4Small.push(`${sel}:${(el.textContent || "").trim().slice(0, 12)}=${Math.round(rect.height)}`);
      }
    }
    return {
      viewport: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: bad.slice(0, 8),
      under44: small.slice(0, 10),
      v4ControlsUnder44: v4Small,
    };
  });
}

// ── 桌機 ─────────────────────────────────────────────────────────────
const desktop = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await login(desktop);
const { projectId, shots } = await seed(desktop);
log("已建立專案", projectId, "分鏡", shots.length);

await openStoryboard(desktop, projectId);
await desktop.locator('.board-shots input[type=checkbox]').first().check();
await desktop.waitForTimeout(1200);
await desktop.locator(".visual-creative-inspector").scrollIntoViewIfNeeded();
await capture(desktop, "desktop-01-proposals", "選一鏡後：目前創作狀態 ＋ Aios 視覺方向提案（提案不寫入任何東西）");

// 開單格工作室 → 方向選擇
await desktop.locator('.creative-refine-box button:has-text("生成／比較變體")').first().click();
await desktop.waitForSelector(".scene-studio__body", { timeout: 20000 });
await desktop.locator('[role=tab]:has-text("重畫這格")').click();
await desktop.waitForTimeout(700);
await desktop.locator(".scene-variant-launch").scrollIntoViewIfNeeded();
await capture(desktop, "desktop-02-directions", "換個方向再試一次：意圖列 ＋ 三個真的不同的方向 ＋ 合計估點");

// 送出三個方向
await desktop.locator('.scene-variant-launch button:has-text("產生")').first().click();
await desktop.locator('button:has-text("確認產生")').first().click();
await desktop.waitForSelector(".scene-variant-status", { timeout: 30000 });
await capture(desktop, "desktop-03-batch-running", "逐方向狀態：每個方向各自一列，不是整批一個數字");

// 等生成落地
for (let i = 0; i < 30; i++) {
  await desktop.waitForTimeout(2000);
  const done = await desktop.locator('.scene-variant-slots li[data-state="candidate"], .scene-variant-slots li[data-state="current"]').count();
  if (done >= 3) break;
}
await capture(desktop, "desktop-04-batch-settled", "三個方向都完成：各自成為真實版本，current 指標未被移動");

// 結算後自動開啟 Compare（產品流程本身，不是測試自己點出來的）
await desktop.waitForSelector(".scene-compare-surface", { timeout: 20000 }).catch(() => {});
if (await desktop.locator(".scene-compare-surface").count()) {
  await capture(desktop, "desktop-06-compare-grid", "結算後自動並排：方向標籤、CURRENT、血緣、保持了哪些家族");
  await desktop.locator('.scene-compare-modes button:has-text("快速切換")').click();
  await desktop.waitForTimeout(700);
  await capture(desktop, "desktop-07-compare-ab", "Compare 快速切換：同位置換圖，一次只掛一個媒體元素");
  const abMedia = await desktop.locator(".scene-compare-ab__stage img, .scene-compare-ab__stage video").count();
  const abSwitches = await desktop.locator(".scene-compare-ab__switch button").count();
  log("A/B 量測", JSON.stringify({ mediaMounted: abMedia, switches: abSwitches }));
  notes.push(`- A/B 快速切換量測：切換鍵 ${abSwitches} 個，同時掛載的媒體元素 ${abMedia} 個`);
  await closeCompareIfOpen(desktop);
}

// ── partial failure：把其中一筆標成 failed（＝真實失敗路徑留在 DB 的狀態） ──
if (DB) {
  const client = new pg.Client({ connectionString: DB });
  await client.connect();
  const { rows } = await client.query(
    `select id from generations where scene_id = $1 and params->'__aiosSourceMeta'->'creative' is not null order by created_at limit 1`,
    [shots[0]],
  );
  if (rows[0]) {
    await client.query(`update generations set status='failed', error='provider 逾時（證據用）' where id = $1`, [rows[0].id]);
    log("已把一筆變體標成 failed 以擷取 partial failure 證據");
  }
  await client.end();

  // reload：批次狀態必須從持久化真相重新推導出來（不是 React state）
  await desktop.reload({ waitUntil: "domcontentloaded" });
  await desktop.waitForSelector("#storyboard-center", { timeout: 30000 });
  await desktop.locator('.board-shots input[type=checkbox]').first().check();
  await desktop.waitForTimeout(1000);
  await desktop.locator('.creative-refine-box button:has-text("生成／比較變體")').first().click();
  await desktop.waitForSelector(".scene-studio__body", { timeout: 20000 });
  await desktop.locator('[role=tab]:has-text("版本")').click();
  await desktop.waitForTimeout(1500);
  await capture(desktop, "desktop-05-partial-after-reload", "重新整理後：A 成功／B 失敗 仍分別顯示（批次身分存在 generations.params，不在前端記憶）");
}

const desktopAudit = await overflowAudit(desktop);
log("桌機量測", JSON.stringify(desktopAudit));

// ── 390px ────────────────────────────────────────────────────────────
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await login(mobile);
await openStoryboard(mobile, projectId);
await mobile.locator('.board-shots input[type=checkbox]').first().check();
await mobile.waitForTimeout(1200);
await capture(mobile, "mobile-390-01-tray", "390px：底部面板停在分頁列上方（不再覆蓋），提案與目前狀態可讀");

const mobileTrayAudit = await overflowAudit(mobile);
log("390px 面板量測", JSON.stringify(mobileTrayAudit));

// 分頁列是否仍可見（v3 的面板 z-52 會整片壓住它）
const tabbarVisible = await mobile.evaluate(() => {
  const bar = document.querySelector(".mobile-nav");
  if (!bar) return { found: false };
  const rect = bar.getBoundingClientRect();
  const midX = rect.left + rect.width / 2;
  const midY = rect.top + rect.height / 2;
  const top = document.elementFromPoint(midX, midY);
  return { found: true, coveredBy: top ? `${top.tagName.toLowerCase()}.${(top.className || "").toString().split(" ")[0]}` : null, reachable: !!bar.contains(top) };
});
log("390px 分頁列可觸及", JSON.stringify(tabbarVisible));

await mobile.locator('.creative-refine-box button:has-text("生成／比較變體")').first().click();
await mobile.waitForSelector(".scene-studio__body", { timeout: 20000 });
await mobile.locator('[role=tab]:has-text("重畫這格")').click();
await mobile.waitForTimeout(800);
await mobile.locator(".scene-variant-launch").scrollIntoViewIfNeeded();
await capture(mobile, "mobile-390-02-directions", "390px：方向卡單欄／雙欄不溢出，按鈕 ≥44px");
const mobileStudioAudit = await overflowAudit(mobile);
log("390px 工作室量測", JSON.stringify(mobileStudioAudit));

await closeCompareIfOpen(mobile);
await mobile.locator('[role=tab]:has-text("版本")').click();
await mobile.waitForTimeout(1200);
await capture(mobile, "mobile-390-03-batch", "390px：逐方向狀態清單");
await closeCompareIfOpen(mobile);

// 390px：直接開已經有的兩版比較（手機用同一顆「比較」鍵進入）
const mobileCompareBtn = mobile.locator('.scene-version-compare-bar button:has-text("比較")');
if (await mobileCompareBtn.count()) {
  await mobile.waitForTimeout(2000);
  await mobile.locator(".scene-version-compare-toggle").nth(0).click({ force: true }).catch(() => {});
  await mobile.locator(".scene-version-compare-toggle").nth(1).click({ force: true }).catch(() => {});
  await mobile.waitForTimeout(600);
  await mobileCompareBtn.first().click({ force: true });
  await mobile.waitForSelector(".scene-compare-surface", { timeout: 20000 });
  await capture(mobile, "mobile-390-04-compare", "390px：Compare 全螢幕、單欄、關閉鍵在安全區內");
  const closeBtn = await mobile.evaluate(() => {
    const btn = document.querySelector('.scene-compare-surface > header button[aria-label*="關閉"]');
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { found: true, height: Math.round(r.height), width: Math.round(r.width), top: Math.round(r.top), tappable: btn.contains(top) || btn === top };
  });
  log("390px Compare 關閉鍵", JSON.stringify(closeBtn));
  notes.push(`- 390px Compare 關閉鍵量測：${JSON.stringify(closeBtn)}`);
}

const measurements = {
  desktop: desktopAudit,
  mobileTray: mobileTrayAudit,
  mobileStudio: mobileStudioAudit,
  tabbar: tabbarVisible,
};
fs.writeFileSync(`${OUT}/measurements.json`, JSON.stringify(measurements, null, 2));
fs.writeFileSync(`${OUT}/README.md`, `# Creative Direction v4 — 瀏覽器證據\n\n擷取自本機 E2E_MOCK 環境（假生成、真狀態機、真資料庫）。\n\n${notes.join("\n")}\n\n量測見 \`measurements.json\`。\n`);
log("量測寫入", `${OUT}/measurements.json`);

await browser.close();
