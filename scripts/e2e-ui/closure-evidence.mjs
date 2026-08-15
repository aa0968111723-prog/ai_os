/**
 * Closure PR-D 瀏覽器證據（#760 §12A／§14）：
 * 1. Project Settings 四大區（基本資料／作品設定／團隊與權限／進階）四視口截圖
 * 2. Settings ↔ Story workspace 同一 server truth：
 *    建立 Style Canon 前 scorecard 有「風格」警示 → 建立後同一 workspace 查詢消失
 * 3. 團隊與權限分頁（ProjectMembersCard）入鏡
 * 不打付費 provider；資料鋪陳全走 tRPC（E2E_MOCK 伺服器）。
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.E2E_UI_BASE ?? "http://127.0.0.1:3242";
const OUT = "./docs/evidence/closure";
mkdirSync(OUT, { recursive: true });

async function rpc(page, path, input) {
  return page.evaluate(async ({ path, input }) => {
    const res = await fetch(`/api/trpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
    });
    const body = await res.json();
    if (body?.error) throw new Error(`${path}: ${body.error.json?.message ?? "failed"}`);
    return body?.result?.data?.json;
  }, { path, input });
}

async function rpcQuery(page, path, input) {
  return page.evaluate(async ({ path, input }) => {
    const qs = encodeURIComponent(JSON.stringify({ json: input }));
    const res = await fetch(`/api/trpc/${path}?input=${qs}`);
    const body = await res.json();
    if (body?.error) throw new Error(`${path}: ${body.error.json?.message ?? "failed"}`);
    return body?.result?.data?.json;
  }, { path, input });
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', "admin@aidirector.local");
  await page.fill('input[type="password"]', "test-admin-123");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 30000 });
}

async function openSettings(page) {
  // 頁上有多顆「專案設定」入口（header＋故事卡）——取第一顆；#766 手機殼層可能沒有
  const entry = page.locator('button:has-text("專案設定")').first();
  await entry.waitFor({ state: "visible", timeout: 20000 });
  await entry.click();
  await page.waitForSelector('.psettings-sheet [role="tablist"]', { timeout: 30000 });
  await page.waitForTimeout(600);
}

const results = { viewports: {}, singleTruth: {}, tabs: [] };

const browser = await chromium.launch();
try {
  const setup = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await setup.newPage();
  await login(page);
  const me = await rpcQuery(page, "auth.me");
  const groupId = me.groups[0].groupId;
  const project = await rpc(page, "projects.create", { groupId, title: `Closure 證據 ${Date.now() % 100000}`, kind: "campaign", platform: "youtube", format: "16:9" });
  await rpc(page, "characters.add", { projectId: project.id, name: "索隆", appearance: "綠髮三刀流" });

  // ── 同一 truth：pin 前 scorecard 有「風格」列 ──
  const before = await rpcQuery(page, "creativeContext.workspace", { projectId: project.id });
  results.singleTruth.beforeStyleRow = before.scorecard.find((row) => row.dimension === "style") ?? null;

  // Settings 動作：建立 Style Canon（＝Project Settings 的「作品設定」治理動作）
  await rpc(page, "canon.createProjectCanon", {
    projectId: project.id, kind: "style", name: "主視覺風格",
    descriptor: { styles: ["水彩", "吉卜力"], negative: "不要棚拍打光" }, confirmRights: true,
  });
  const after = await rpcQuery(page, "creativeContext.workspace", { projectId: project.id });
  results.singleTruth.afterStyleRow = after.scorecard.find((row) => row.dimension === "style") ?? null;
  results.singleTruth.pass = Boolean(results.singleTruth.beforeStyleRow) && !results.singleTruth.afterStyleRow;
  await setup.close();

  for (const [name, viewport] of Object.entries({
    "desktop-1280": { width: 1280, height: 900 },
    "desktop-1440": { width: 1440, height: 960 },
    "mobile-390": { width: 390, height: 844 },
    "mobile-430": { width: 430, height: 932 },
  })) {
    const ctx = await browser.newContext({ viewport });
    const vp = await ctx.newPage();
    await login(vp);
    await vp.goto(`${BASE}/p/${project.id}`, { waitUntil: "domcontentloaded" });
    await vp.waitForTimeout(2500);
    // #766 Phone AI-first 殼層（<768px）：設定入口可能不同——誠實記錄，不假裝
    const hasEntry = await vp.locator('button:has-text("專案設定")').count();
    if (!hasEntry) {
      await vp.screenshot({ path: `${OUT}/${name}-shell.png` });
      results.viewports[name] = { settingsAvailable: false, note: "#766 手機殼層無專案設定入口（另有 AI-first 導覽）" };
      await ctx.close();
      console.log(`▸ ${name} shell captured (no settings entry)`);
      continue;
    }
    await openSettings(vp);
    // 四大分頁列＋基本資料
    await vp.click('button[role="tab"]:has-text("基本資料")');
    await vp.waitForTimeout(400);
    await vp.screenshot({ path: `${OUT}/${name}-settings-basic.png` });
    // 團隊與權限
    await vp.click('button[role="tab"]:has-text("團隊與權限")');
    await vp.waitForSelector("text=誰可以編輯這部作品", { timeout: 15000 }).catch(() => {});
    await vp.waitForTimeout(400);
    await vp.screenshot({ path: `${OUT}/${name}-settings-team.png` });
    // 作品設定（三疊）
    await vp.click('button[role="tab"]:has-text("作品設定")');
    await vp.waitForTimeout(400);
    await vp.screenshot({ path: `${OUT}/${name}-settings-work.png` });
    const tabs = await vp.$$eval('.psettings-sheet [role="tab"]', (els) => els.map((el) => el.textContent?.trim() ?? ""));
    results.viewports[name] = { tabs, fourBlocks: tabs.length === 4 };
    await ctx.close();
    console.log(`▸ ${name} captured, tabs: ${JSON.stringify(tabs)}`);
  }

  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log("▸ single-truth:", JSON.stringify(results.singleTruth.pass));
  console.log(`▸ done → ${OUT}`);
} finally {
  await browser.close();
}
