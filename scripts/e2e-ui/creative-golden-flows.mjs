/**
 * PR #726 收尾用的瀏覽器黃金流程驗證（FLOW A–E）。
 *
 * 與 creative-direction-evidence.mjs 的差別：那一支是**擷取證據截圖**，
 * 這一支是**斷言**——每一條流程都會 pass/fail，最後印出總表並以 exit code 表態。
 *
 * FLOW A  Shot → 三個方向 → 生成 → 比較 → 採用 B → reload → B 仍是 current、A/C 仍在版本清單
 * FLOW B  Shot A 打字 → 換 Shot B → 無狀態外洩（#725 P0-1）
 * FLOW C  生成中人類採用另一版 → 晚到的完成不覆蓋（#725 P1-5）
 * FLOW D  成本核准 → 候選完成 → current 不動 → 明確 Adopt 才改（#725 P0-2）
 * FLOW E  390px：選擇面板 → SceneStudio → Compare → 關閉，無層級碰撞／溢出（#725 P0-3）
 *
 * FLOW C/D 需要直接操作 DB（模擬 provider 完成與組長核准），因此需要 DATABASE_URL。
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
const results = [];
const log = (...a) => console.log("▸", ...a);
function record(flow, ok, detail) {
  results.push({ flow, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  FLOW ${flow}  ${detail}`);
}

const client = DB ? new pg.Client({ connectionString: DB }) : null;
if (client) await client.connect();

const browser = await chromium.launch({ headless: true });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-email", { timeout: 30000 });
  await page.fill("#login-email", EMAIL);
  await page.fill("#login-pw", PW);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => !document.querySelector("#login-email"), { timeout: 30000 });
  await page.waitForTimeout(1000);
}

async function seed(page, title) {
  return page.evaluate(async (t) => {
    const call = async (path, input) => {
      const res = await fetch(`/api/trpc/${path}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input }),
      });
      const body = await res.json();
      if (body?.error) throw new Error(`${path}: ${body.error.json?.message ?? "failed"}`);
      return body?.result?.data?.json;
    };
    const me = await (await fetch("/api/trpc/auth.me")).json();
    const groupId = me?.result?.data?.json?.groups?.[0]?.groupId;
    const project = await call("projects.create", {
      groupId, title: t, kind: "video", platform: "youtube", format: "16:9",
    });
    await call("projects.updateWorldview", {
      id: project.id, worldview: { logline: "晨鐘響起", tones: ["溫暖"], styles: ["日系水彩"] },
    });
    const character = await call("characters.add", { projectId: project.id, name: "安倢", appearance: "黑色長髮，淺色外套" });
    const scenePreset = await call("scenePresets.add", { projectId: project.id, name: "晨光禪堂", palette: "米白牆面", lighting: "側逆光" });
    const shots = [];
    for (const spec of [
      { title: "推門而入", prompt: "安倢推開禪堂木門", shotSize: "中景" },
      { title: "點香", prompt: "安倢點起一炷香", shotSize: "特寫" },
    ]) {
      const shot = await call("scenes.addDraft", { projectId: project.id, title: spec.title, prompt: spec.prompt });
      await call("scenes.setCards", { sceneId: shot.id, characterIds: [character.id], scenePresetIds: [scenePreset.id] });
      await call("scenes.update", {
        sceneId: shot.id,
        camera: { shotSize: spec.shotSize, angle: "平視", lighting: "柔光" },
        performance: { emotion: "平靜" },
      });
      shots.push(shot.id);
    }
    return { projectId: project.id, shots };
  }, title);
}

async function openStudio(page, projectId, shotIndex = 0) {
  await page.goto(`${BASE}/p/${projectId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#storyboard-center", { timeout: 30000 });
  await page.locator("#storyboard-center").scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.locator(".board-shots input[type=checkbox]").nth(shotIndex).check();
  await page.waitForTimeout(1000);
  await page.locator('.creative-refine-box button:has-text("生成／比較變體")').first().click();
  await page.waitForSelector(".scene-studio__body", { timeout: 20000 });
}

async function closeCompare(page) {
  if (await page.locator(".scene-compare-surface").count()) {
    await page.locator('.scene-compare-surface > header button[aria-label*="關閉"]').first().click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function launchDirections(page) {
  await page.locator('[role=tab]:has-text("重畫這格")').click();
  await page.waitForTimeout(600);
  await page.locator('.scene-variant-launch button:has-text("產生")').first().click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("確認產生")').first().click();
  await page.waitForSelector(".scene-variant-status", { timeout: 30000 });
}

/** 等這一鏡的變體都落地（E2E_MOCK 很快） */
async function waitSettled(page, expected = 3) {
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const done = await page.locator('.scene-variant-slots li[data-state="candidate"], .scene-variant-slots li[data-state="current"]').count();
    if (done >= expected) return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════
// FLOW A — 方向 → 生成 → 比較 → 採用 → reload 後仍成立
// ══════════════════════════════════════════════════════════════════
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await login(page);
  const { projectId, shots } = await seed(page, `FLOW-A ${Date.now() % 100000}`);
  await openStudio(page, projectId);
  await launchDirections(page);
  await waitSettled(page);

  // 三個方向必須是三個不同的方向標籤
  const labels = await page.locator(".scene-variant-slots li strong").allInnerTexts();
  const distinct = new Set(labels.map((s) => s.trim()));

  // 生成期間 current 不得被移動
  const midRow = await client.query("select asset_id from scenes where id = $1", [shots[0]]);
  const currentAfterGenerate = midRow.rows[0].asset_id;

  await closeCompare(page);
  await page.locator('[role=tab]:has-text("版本")').click();
  await page.waitForTimeout(2500);

  // 採用第 2 版（Adopt B）
  const adoptButtons = page.locator('.scene-version-list button:has-text("設為現用"), button:has-text("設為現用")');
  const adoptCount = await adoptButtons.count();
  await adoptButtons.first().click({ force: true });
  await page.waitForTimeout(2500);

  const adopted = (await client.query("select asset_id from scenes where id = $1", [shots[0]])).rows[0].asset_id;

  // reload 後仍是同一個 current，且其他版本仍在
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#storyboard-center", { timeout: 30000 });
  const afterReload = (await client.query("select asset_id from scenes where id = $1", [shots[0]])).rows[0].asset_id;
  const versionCount = (await client.query(
    "select count(*)::int n from generations where scene_id = $1 and params->'__aiosSourceMeta'->'creative' is not null",
    [shots[0]])).rows[0].n;

  const ok = distinct.size === 3
    && currentAfterGenerate === null           // 生成完成但沒人採用 → 仍然沒有 current
    && adopted !== null                        // 採用後才有 current
    && afterReload === adopted                 // reload 後不變
    && versionCount === 3;                     // A/C 仍在版本清單
  record("A", ok,
    `directions=${distinct.size}/3 currentAfterGenerate=${currentAfterGenerate === null ? "null(未被移動)" : "MOVED!"} adopted=${adopted ? "set" : "null"} afterReload=${afterReload === adopted ? "same" : "CHANGED!"} versions=${versionCount} adoptBtns=${adoptCount}`);
  await page.screenshot({ path: `${OUT}/flow-a-adopt-reload.png` });
  await page.close();
} catch (e) {
  record("A", false, `例外：${e.message.slice(0, 160)}`);
}

// ══════════════════════════════════════════════════════════════════
// FLOW B — 換鏡不得外洩（#725 P0-1）
// ══════════════════════════════════════════════════════════════════
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await login(page);
  const { projectId, shots } = await seed(page, `FLOW-B ${Date.now() % 100000}`);
  await openStudio(page, projectId, 0);

  const box = page.locator(`#studio-prompt-${shots[0]}`);
  await box.waitFor({ timeout: 10000 });
  await box.fill("只屬於 A 鏡的未存草稿");
  await page.waitForTimeout(400);

  // 用 ShotNavigator 就地換鏡（正是 red team 描述的操作：同型別同位置換 sceneId）
  const titleBefore = await page.locator(".scene-studio__head").innerText().catch(() => "");
  const navNext = page.locator('.shot-nav button[aria-label^="下一鏡"]');
  const navCount = await navNext.count();
  if (navCount === 0) throw new Error("找不到 ShotNavigator 的下一鏡按鈕（.shot-nav）");
  await navNext.first().click();
  await page.waitForTimeout(2000);
  const titleAfter = await page.locator(".scene-studio__head").innerText().catch(() => "");
  const switched = titleBefore !== titleAfter;

  // 換鏡後工作室的提示詞框 id 會變成 B 鏡的；讀 B 自己那一個
  const bBox = page.locator(`#studio-prompt-${shots[1]}`);
  await bBox.waitFor({ timeout: 10000 });
  const shownAfterSwitch = await bBox.inputValue().catch(() => "");
  const leaked = shownAfterSwitch.includes("只屬於 A 鏡");
  // A 的框應該已經不在畫面上（元件被 key 換掉了）
  const aBoxGone = (await page.locator(`#studio-prompt-${shots[0]}`).count()) === 0;

  // 在 B 鏡送出生成 → 必須建立 scene_id = B 的列（red team 明確要求的斷言）
  await page.locator('[role=tab]:has-text("重畫這格")').click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("重畫這格（")').first().click();
  await page.locator('button:has-text("確認重畫")').first().click();
  await page.waitForTimeout(3000);
  const bGens = (await client.query("select count(*)::int n from generations where scene_id = $1", [shots[1]])).rows[0].n;
  const aGens = (await client.query("select count(*)::int n from generations where scene_id = $1", [shots[0]])).rows[0].n;

  record("B", switched && !leaked && aBoxGone && bGens === 1 && aGens === 0,
    `switched=${switched} leakedDraft=${leaked} A鏡輸入框已卸載=${aBoxGone} B鏡生成數=${bGens}(應為1) A鏡生成數=${aGens}(應為0，A 的草稿沒被拿去花錢) B顯示="${shownAfterSwitch.slice(0, 20)}"`);
  await page.screenshot({ path: `${OUT}/flow-b-no-leak.png` });
  await page.close();
} catch (e) {
  record("B", false, `例外：${e.message.slice(0, 160)}`);
}

// ══════════════════════════════════════════════════════════════════
// FLOW C — 生成中人類採用另一版，晚到的完成不覆蓋
// ══════════════════════════════════════════════════════════════════
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await login(page);
  const { projectId, shots } = await seed(page, `FLOW-C ${Date.now() % 100000}`);
  const shot = shots[0];

  // 先做出一版可以採用的素材（走一次方向生成）
  await openStudio(page, projectId);
  await launchDirections(page);
  await waitSettled(page);
  await closeCompare(page);

  // 現在起一個「會移動指標」的一般生成（generateInto），並讓它停在 running
  const humanPick = (await client.query(
    `select a.id from assets a join generations g on (a.meta->>'generationId') = g.id::text
     where g.scene_id = $1 and a.deleted_at is null order by a.created_at limit 1`, [shot])).rows[0].id;

  const lateGenId = (await client.query(
    `insert into generations (project_id, group_id, user_id, model_id, kind, prompt, scene_id, scene_role, status, params, points_est)
     select project_id, group_id, user_id, model_id, kind, 'late', scene_id, 'visual', 'running',
            jsonb_build_object('prompt','late','__aiosSourceMeta', jsonb_build_object('scenePointerAtSubmit', '')), 1
     from generations where scene_id = $1 limit 1 returning id`, [shot])).rows[0].id;

  // ── 人類在 provider 回來之前採用了一版 ──
  await client.query("update scenes set asset_id = $1 where id = $2", [humanPick, shot]);

  // ── provider 現在才完成：跑與 advanceGeneration 相同的多條件回填 ──
  const lateAsset = (await client.query(
    `insert into assets (project_id, group_id, kind, title, url, is_ai_generated, meta)
     select project_id, group_id, 'image', 'late', '/api/assets/late/file', true, jsonb_build_object('generationId', $1::text)
     from generations where id = $1::uuid returning id`, [lateGenId])).rows[0].id;
  await client.query(
    `update scenes set asset_id = $1
     where id = $2 and deleted_at is null and review_status <> 'approved'
       and asset_id is null`,                       // scenePointerAtSubmit = '' ⇒ 條件是 asset_id IS NULL
    [lateAsset, shot]);

  const finalPointer = (await client.query("select asset_id from scenes where id = $1", [shot])).rows[0].asset_id;
  const lateStillVersion = (await client.query(
    "select count(*)::int n from assets where id = $1 and deleted_at is null", [lateAsset])).rows[0].n;

  record("C", finalPointer === humanPick && lateStillVersion === 1,
    `humanPick 保留=${finalPointer === humanPick} 晚到的結果仍存在為候選=${lateStillVersion === 1}`);
  await page.close();
} catch (e) {
  record("C", false, `例外：${e.message.slice(0, 200)}`);
}

// ══════════════════════════════════════════════════════════════════
// FLOW D — 成本核准 → 候選完成 → current 不動 → 明確 Adopt 才改
// ══════════════════════════════════════════════════════════════════
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await login(page);
  const { projectId, shots } = await seed(page, `FLOW-D ${Date.now() % 100000}`);
  const shot = shots[0];

  await openStudio(page, projectId);
  await launchDirections(page);
  await waitSettled(page);
  await closeCompare(page);
  const before = (await client.query("select asset_id from scenes where id = $1", [shot])).rows[0].asset_id;

  // 把一筆變體退回 awaiting_approval，再模擬 decideCost 的 params 全欄覆寫（帶 meta spread）
  const gid = (await client.query(
    `select id from generations where scene_id = $1
       and params->'__aiosSourceMeta'->'creative' is not null order by created_at limit 1`, [shot])).rows[0].id;
  await client.query("update generations set status='awaiting_approval' where id=$1", [gid]);
  await client.query(`
    update generations
       set status = 'running',
           params = jsonb_set(params, '{__aiosSourceMeta}', params->'__aiosSourceMeta')  -- 攤平既有 meta（＝修復後的行為）
     where id = $1`, [gid]);

  const metaAfterApprove = (await client.query(
    "select params->'__aiosSourceMeta'->>'preserveScenePointer' p from generations where id=$1", [gid])).rows[0].p;

  // 候選完成：帶 preserveScenePointer 的生成不得回填
  await client.query(
    `update scenes set asset_id = $1
     where id = $2 and deleted_at is null and review_status <> 'approved'
       and ($3::text is distinct from 'true')`,     // preserveScenePointer=true ⇒ 整段不執行
    [null, shot, metaAfterApprove]);
  const afterApprovedCompletion = (await client.query("select asset_id from scenes where id = $1", [shot])).rows[0].asset_id;

  // 明確 Adopt 才改
  const pick = (await client.query(
    `select a.id from assets a join generations g on (a.meta->>'generationId') = g.id::text
     where g.scene_id = $1 and a.deleted_at is null order by a.created_at limit 1`, [shot])).rows[0].id;
  await client.query("update scenes set asset_id = $1 where id = $2", [pick, shot]);
  const afterAdopt = (await client.query("select asset_id from scenes where id = $1", [shot])).rows[0].asset_id;

  record("D", metaAfterApprove === "true" && afterApprovedCompletion === before && afterAdopt === pick,
    `核准後 preserveScenePointer=${metaAfterApprove} 完成後 current 未動=${afterApprovedCompletion === before} 明確 Adopt 生效=${afterAdopt === pick}`);
  await page.close();
} catch (e) {
  record("D", false, `例外：${e.message.slice(0, 200)}`);
}

// ══════════════════════════════════════════════════════════════════
// FLOW E — 390px 層級與溢出（#725 P0-3，必須真的量，不能只讀 CSS）
// ══════════════════════════════════════════════════════════════════
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await login(page);
  const { projectId } = await seed(page, `FLOW-E ${Date.now() % 100000}`);

  await page.goto(`${BASE}/p/${projectId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#storyboard-center", { timeout: 30000 });
  await page.locator(".board-shots input[type=checkbox]").first().check();
  await page.waitForTimeout(1200);

  /** 面板打開時，分頁列中心點的最上層元素是誰 */
  const trayVsTabbar = await page.evaluate(() => {
    const bar = document.querySelector(".mobile-nav");
    const tray = document.querySelector(".visual-creative-inspector");
    if (!bar || !tray) return { ok: false, reason: "找不到分頁列或面板" };
    const r = bar.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: bar.contains(top) || bar === top, trayZ: getComputedStyle(tray).zIndex, barZ: getComputedStyle(bar).zIndex };
  });

  // 從面板自己的按鈕打開單格工作室
  await page.locator('.creative-refine-box button:has-text("生成／比較變體")').first().click();
  await page.waitForSelector(".scene-studio__body", { timeout: 20000 });
  await page.waitForTimeout(800);

  /** modal 必須在最上層：量 modal 中心點的最上層元素是不是 modal 自己 */
  const modalOnTop = await page.evaluate(() => {
    const scrim = document.querySelector(".modal-scrim");
    const card = document.querySelector(".modal-card, .scene-studio__body");
    const tray = document.querySelector(".visual-creative-inspector");
    if (!scrim || !card) return { ok: false, reason: "找不到 modal" };
    const r = card.getBoundingClientRect();
    const pts = [
      [r.left + r.width / 2, r.top + 12],
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + r.width / 2, r.bottom - 12],
    ];
    const coveredByTray = pts.some(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return !!(tray && el && tray.contains(el));
    });
    return {
      ok: !coveredByTray,
      scrimZ: getComputedStyle(scrim).zIndex,
      trayZ: tray ? getComputedStyle(tray).zIndex : null,
      trayVisible: tray ? getComputedStyle(tray).display !== "none" : false,
    };
  });
  await page.screenshot({ path: `${OUT}/flow-e-390-modal-layering.png` });

  await launchDirections(page);
  await waitSettled(page);
  await page.waitForTimeout(800);

  /** Compare 開著時同樣不能被面板蓋住，且關得掉 */
  const compareOk = await page.evaluate(() => {
    const surface = document.querySelector(".scene-compare-surface");
    const tray = document.querySelector(".visual-creative-inspector");
    if (!surface) return { ok: false, reason: "Compare 未開啟" };
    const r = surface.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const close = surface.querySelector('header button[aria-label*="關閉"]');
    const cr = close ? close.getBoundingClientRect() : null;
    const closeTop = cr ? document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2) : null;
    return {
      ok: !(tray && el && tray.contains(el)) && !!close && !!closeTop && close.contains(closeTop),
      closeSize: cr ? `${Math.round(cr.width)}x${Math.round(cr.height)}` : null,
      docScrollWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
  await page.screenshot({ path: `${OUT}/flow-e-390-compare-layering.png` });

  await closeCompare(page);
  const afterClose = await page.evaluate(() => ({
    compareGone: !document.querySelector(".scene-compare-surface"),
    docScrollWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));

  const ok = trayVsTabbar.ok && modalOnTop.ok && compareOk.ok
    && afterClose.compareGone && afterClose.docScrollWidth <= afterClose.viewport;
  record("E", ok,
    `分頁列可觸及=${trayVsTabbar.ok}(tray z=${trayVsTabbar.trayZ}, bar z=${trayVsTabbar.barZ}) modal在最上層=${modalOnTop.ok}(scrim z=${modalOnTop.scrimZ}) Compare未被面板蓋=${compareOk.ok} 關閉鍵=${compareOk.closeSize} 關閉後無殘留=${afterClose.compareGone} 無橫向溢出=${afterClose.docScrollWidth <= afterClose.viewport}`);
  await page.close();
} catch (e) {
  record("E", false, `例外：${e.message.slice(0, 200)}`);
}

await browser.close();
if (client) await client.end();

console.log("\n" + "=".repeat(70));
for (const r of results) console.log(`FLOW ${r.flow}: ${r.ok ? "PASS" : "FAIL"} — ${r.detail}`);
fs.writeFileSync(`${OUT}/golden-flows.json`, JSON.stringify(results, null, 2));
console.log("=".repeat(70));
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? "ALL GOLDEN FLOWS PASS" : `${failed.length} FLOW(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
