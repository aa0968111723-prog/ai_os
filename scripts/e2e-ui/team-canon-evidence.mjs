/**
 * Team Canon（PR-A~C）的瀏覽器證據擷取。
 *
 * 走真的 UI＋真的 tRPC（E2E_MOCK 環境、不打付費 provider）：
 * 登入 → 專案 A 建卡 → 升為 Team Canon → 專案 B pin →
 * 專案 A 改卡開新版＋promote → 專案 B 看到 UPDATE_AVAILABLE →
 * 面板展開看影響 → 明確升級 → stale 只落在依賴鏡。
 * 桌機 1280/1440 與手機 390/430 各拍一輪（master plan §17 驗證尺寸）。
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = (process.env.E2E_UI_BASE || "http://127.0.0.1:3241").replace(/\/$/, "");
const OUT = process.env.E2E_UI_OUT || "./docs/evidence/team-canon";
const EMAIL = process.env.TEST_EMAIL || "admin@aidirector.local";
const PW = process.env.TEST_PW || "test-admin-123";

fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("▸", ...a);
const results = [];

const browser = await chromium.launch({ headless: true });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-email", { timeout: 30000 });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-pw", PW);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => !document.querySelector("#login-email"), { timeout: 30000 });
  await page.waitForTimeout(1200);
}

/** tRPC 直呼（在頁面 context 內帶 cookie）；只鋪資料，不假造任何生成 */
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

/** tRPC query 是 GET；POST 打 query 會 405（稽核抓到的假證據來源） */
async function rpcQuery(page, path, input) {
  return page.evaluate(async ({ path, input }) => {
    const qs = encodeURIComponent(JSON.stringify({ json: input }));
    const res = await fetch(`/api/trpc/${path}?input=${qs}`);
    const body = await res.json();
    if (body?.error) throw new Error(`${path}: ${body.error.json?.message ?? "failed"}`);
    return body?.result?.data?.json;
  }, { path, input });
}

async function seed(page) {
  const me = await page.evaluate(async () => (await (await fetch("/api/trpc/auth.me")).json())?.result?.data?.json);
  const groupId = me?.groups?.[0]?.groupId;
  if (!groupId) throw new Error("登入帳號沒有任何組別");
  const stamp = Date.now() % 100000;

  const projectA = await rpc(page, "projects.create", {
    groupId, title: `Canon 來源專案 ${stamp}`, kind: "video", platform: "youtube", format: "16:9",
  });
  const luffy = await rpc(page, "characters.add", {
    projectId: projectA.id, name: "魯夫", appearance: "草帽、紅背心、短褲",
  });
  const beach = await rpc(page, "scenePresets.add", {
    projectId: projectA.id, name: "淺水灣", palette: "灰藍海面、濕沙", lighting: "陰天散射光",
  });

  // 升為 Team Canon（confirmRights＝明確確認授權）
  const luffyCanon = await rpc(page, "canon.createFromEntity", {
    projectId: projectA.id, entityKind: "character", entityId: luffy.id, confirmRights: true,
  });
  await rpc(page, "canon.createFromEntity", {
    projectId: projectA.id, entityKind: "scene_preset", entityId: beach.id, confirmRights: true,
  });

  // 專案 B：pin 團隊魯夫 → 建一鏡引用 → 凍結 packet
  const projectB = await rpc(page, "projects.create", {
    groupId, title: `Canon 引用專案 ${stamp}`, kind: "video", platform: "youtube", format: "16:9",
  });
  const pinned = await rpc(page, "canon.pin", { projectId: projectB.id, canonId: luffyCanon.canonId });
  const shot = await rpc(page, "scenes.addDraft", {
    projectId: projectB.id, title: "魯夫出場", prompt: "魯夫站在船頭遠望",
  });
  await rpc(page, "scenes.setCards", { sceneId: shot.id, characterIds: [pinned.localEntityId] });
  await rpc(page, "creativeContext.freezeShotPacket", { projectId: projectB.id, shotId: shot.id });

  // Team 端出 V2 並 promote → 專案 B 應顯示 UPDATE_AVAILABLE
  await rpc(page, "characters.update", { id: luffy.id, appearance: "草帽、黃背心、短褲、傷疤" });
  const v2 = await rpc(page, "canon.addVersionFromPin", { pinId: luffyCanon.pinId });
  await rpc(page, "canon.promoteVersion", { versionId: v2.versionId });

  return { projectA: projectA.id, projectB: projectB.id, shotId: shot.id };
}

async function openSettingsPanel(page, projectId) {
  await page.goto(`${BASE}/p/${projectId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=專案設定", { timeout: 30000 });
  await page.click("text=專案設定");
  // #sec-team-canon 在「資料來源」群組裡（分頁／<details> 收合，視視口而定）——
  // 先把它所有的收合祖先打開，再等它真的可見，證據才不是拍到空白
  await page.waitForSelector("#sec-team-canon", { state: "attached", timeout: 30000 });
  await page.evaluate(() => {
    const target = document.querySelector("#sec-team-canon");
    let node = target;
    while (node) {
      if (node instanceof HTMLDetailsElement) node.open = true;
      node = node.parentElement;
    }
    target?.scrollIntoView({ block: "center" });
  });
  // 桌機的群組分頁：若 canon 面板仍不可見，點含「資料」的分頁鈕再試
  const visible = await page.locator("#sec-team-canon").isVisible();
  if (!visible) {
    const tab = page.locator("button", { hasText: "資料" }).first();
    if (await tab.count()) await tab.click().catch(() => {});
    await page.evaluate(() => document.querySelector("#sec-team-canon")?.scrollIntoView({ block: "center" }));
  }
  await page.waitForSelector(".story-canon-panel", { state: "visible", timeout: 30000 });
  await page.waitForTimeout(800);
}

async function captureFlow(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await login(page);
    const ctx = await seedCache.promise;
    await openSettingsPanel(page, ctx.projectB);
    await page.screenshot({ path: `${OUT}/${tag}-canon-panel.png`, fullPage: false });
    // 展開 pin：看到升級影響與版本歷史
    const pinRow = page.locator(".story-canon-panel__pin-row", { hasText: "魯夫" }).first();
    await pinRow.click();
    await page.waitForSelector(".canon-pin-detail", { timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${tag}-canon-pin-detail.png`, fullPage: false });
    const hasUpdate = await page.locator("text=有新版").count();
    results.push({ tag, panel: true, updateChip: hasUpdate > 0 });
    log(tag, "panel captured, updateChip:", hasUpdate > 0);
  } finally {
    await page.close();
  }
}

const seedCache = {};
seedCache.promise = (async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await login(page);
    return await seed(page);
  } finally {
    await page.close();
  }
})();

try {
  const ctx = await seedCache.promise;
  log("seeded:", JSON.stringify(ctx));
  await captureFlow(1280, 900, "desktop-1280");
  await captureFlow(1440, 900, "desktop-1440");
  await captureFlow(390, 844, "mobile-390");
  await captureFlow(430, 932, "mobile-430");

  // 效能量測（§19）：首載 tRPC 請求數（新增的 canon 摘要不得造成 query explosion）
  {
    const perfPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await login(perfPage);
    const trpcCalls = [];
    perfPage.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/trpc/")) {
        for (const part of url.split("/api/trpc/")[1].split("?")[0].split(",")) trpcCalls.push(part);
      }
    });
    await perfPage.goto(`${BASE}/p/${ctx.projectB}`, { waitUntil: "domcontentloaded" });
    await perfPage.waitForTimeout(8000);
    const counts = trpcCalls.reduce((acc, name) => { acc[name] = (acc[name] ?? 0) + 1; return acc; }, {});
    const duplicated = Object.entries(counts).filter(([, n]) => n > 2).map(([name, n]) => `${name}×${n}`);
    results.push({ tag: "perf-first-load", totalTrpcProcedures: trpcCalls.length, duplicated });
    log("first-load trpc procedures:", trpcCalls.length, "duplicated(>2):", JSON.stringify(duplicated));
    await perfPage.close();
  }

  // 明確升級（1280 視圖走一次真流程）並驗證 stale 只落在依賴鏡
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await login(page);
  await openSettingsPanel(page, ctx.projectB);
  await page.locator(".story-canon-panel__pin-row", { hasText: "魯夫" }).first().click();
  await page.waitForSelector(".canon-pin-detail", { timeout: 20000 });
  const upgradeBtn = page.locator("button", { hasText: "升級到最新版" });
  if (await upgradeBtn.count()) {
    await upgradeBtn.first().click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/desktop-1280-after-upgrade.png`, fullPage: false });
    const packets = await rpcQuery(page, "creativeContext.listShotPackets", { projectId: ctx.projectB });
    const staleShots = packets.filter((row) => row.stale).map((row) => row.shotId);
    results.push({ tag: "upgrade", staleShots, expected: [ctx.shotId] });
    log("upgrade done; stale shots:", JSON.stringify(staleShots), "expected:", ctx.shotId);
  } else {
    results.push({ tag: "upgrade", error: "upgrade button not found" });
  }
  await page.close();

  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  log("done →", OUT);
} finally {
  await browser.close();
}
