/**
 * PR #742 evidence: chip in-place reveal at required viewports.
 * Uses the live Story workspace (login + create + parse), not a fixture.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_UI_BASE || "http://localhost:5173").replace(/\/$/, "");
const OUT = process.env.OUT_DIR || "./docs/evidence/story-inline-workspace/pr-742";
const EMAIL = process.env.TEST_EMAIL || "admin@aidirector.local";
const PW = process.env.TEST_PW || "test-admin-123";
const STORY = [
  "角色：安倢（黑髮、柔和五官）、師父（灰袍長者）",
  "場景：克難坡（石階、老樹、灰藍色調）",
  "道具：紅傘（紅色油紙傘）",
  "造型：安倢＝米白外套",
  "",
  "清晨的克難坡下著雨。安倢撐著紅傘走下石階。",
  "",
  "師父在坡頂等她。安倢停下腳步，回頭看了一眼。",
].join("\n");

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1440x900", width: 1440, height: 900 },
];

fs.mkdirSync(OUT, { recursive: true });

function fail(msg) {
  throw new Error(msg);
}

async function measure(page) {
  return page.evaluate(() => {
    const chips = [...document.querySelectorAll(".story-parse-bar__chips .chip")];
    const slot = document.getElementById("story-reveal-slot");
    const rails = document.querySelectorAll(".story-inline-rail");
    const chipRow = document.querySelector(".story-parse-bar__chips");
    const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const chipBoxes = chips.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent || "").trim(),
        w: Math.round(r.width),
        h: Math.round(r.height),
        expanded: el.getAttribute("aria-expanded"),
        controls: el.getAttribute("aria-controls"),
      };
    });
    let slotBelow = null;
    if (slot && chipRow) {
      const chipsBottom = chipRow.getBoundingClientRect().bottom;
      const slotTop = slot.getBoundingClientRect().top;
      slotBelow = slotTop >= chipsBottom - 2;
    }
    return {
      overflowX,
      railCount: rails.length,
      slotPresent: Boolean(slot),
      slotSection: slot?.getAttribute("data-section") ?? null,
      slotBelowChips: slotBelow,
      chips: chipBoxes,
    };
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
const page = await context.newPage();
const report = { base: BASE, steps: [], viewports: [] };

try {
  page.on("pageerror", (err) => report.steps.push({ pageerror: String(err) }));
  page.on("console", (msg) => {
    if (msg.type() === "error") report.steps.push({ console: msg.text() });
  });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator("#login-email").waitFor({ timeout: 20_000 });
  await page.locator("#login-email").fill(EMAIL);
  await page.locator("#login-pw").fill(PW);
  await page.locator('button[type="submit"]').click();
  await page.waitForSelector('header.topbar, #np-title', { timeout: 20_000 });
  report.steps.push({ login: "PASS" });

  const title = `PR742 chips ${Date.now() % 100000}`;
  async function trpc(method, path, data) {
    const url = `${BASE}/api/trpc/${path}`;
    if (method === "GET") {
      const res = await page.request.get(`${url}?input=${encodeURIComponent(JSON.stringify({ json: data ?? {} }))}`);
      return (await res.json()).result.data.json;
    }
    const res = await page.request.post(url, { data: { json: data } });
    const body = await res.json();
    if (body.error) throw new Error(body.error.json?.message || JSON.stringify(body.error));
    return body.result.data.json;
  }
  const teams = await trpc("GET", "admin.overview");
  const north = teams.find((t) => t.name === "北區工作組") ?? teams[0];
  const gid = north.groups[0].id;
  const proj = await trpc("POST", "projects.create", {
    groupId: gid,
    title,
    kind: "healing",
    platform: "shorts",
  });
  await page.goto(`${BASE}/p/${proj.id}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator("#story-workspace").waitFor({ state: "attached", timeout: 20_000 });
  report.steps.push({ createProject: "PASS", title, projectId: proj.id });

  const editor = page.locator("#story-workspace textarea, .script-editor textarea, .story-editor").first();
  await editor.waitFor({ timeout: 15_000 });
  await editor.fill(STORY);
  await editor.blur();
  try {
    await trpc("POST", "story.save", { projectId: proj.id, content: STORY });
    const parsed = await trpc("POST", "story.parse", { projectId: proj.id });
    report.steps.push({ parse: "API_PASS", pendingCount: parsed?.pendingCount, mock: parsed?.mock });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#story-workspace").waitFor({ state: "attached", timeout: 20_000 });
  } catch (err) {
    report.steps.push({ parse: "API_FAIL", error: String(err) });
    const parseBtn = page.locator('button:has-text("AI 解析"), button:has-text("重新解析")').first();
    await parseBtn.click();
  }
  await page.locator('.story-parse-bar__chips .chip:has-text("角色")').waitFor({ timeout: 30_000 });

  const roleChip = page.locator('.story-parse-bar__chips .chip:has-text("角色")').first();
  await roleChip.click();
  await page.locator("#story-reveal-slot").waitFor({ timeout: 10_000 });
  const afterRole = await measure(page);
  if (!afterRole.slotPresent) fail("角色 chip 未展開 #story-reveal-slot");
  if (afterRole.slotSection !== "characters") fail(`expected characters slot, got ${afterRole.slotSection}`);
  if (afterRole.railCount > 0) fail("仍存在 .story-inline-rail 第二組導航");
  report.steps.push({ openCharacters: "PASS", measure: afterRole });
  await page.screenshot({ path: path.join(OUT, "1280-characters.png"), fullPage: true });

  const sceneChip = page.locator('.story-parse-bar__chips .chip:has-text("場景")').first();
  await sceneChip.click();
  await page.waitForTimeout(400);
  const afterScene = await measure(page);
  if (afterScene.slotSection !== "scenes") fail(`switch chip should replace slot, got ${afterScene.slotSection}`);
  report.steps.push({ switchScenes: "PASS", measure: afterScene });
  await page.screenshot({ path: path.join(OUT, "1280-scenes.png"), fullPage: true });

  await sceneChip.click();
  await page.waitForTimeout(300);
  const afterClose = await measure(page);
  if (afterClose.slotPresent) fail("再點同一 chip 應收合 slot");
  report.steps.push({ collapse: "PASS" });

  try {
    await trpc("POST", "story.generateStoryboard", { projectId: proj.id });
    report.steps.push({ storyboard: "API_PASS" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#story-workspace").waitFor({ state: "attached", timeout: 20_000 });
  } catch (err) {
    report.steps.push({ storyboard: "API_FAIL", error: String(err) });
  }
  const shotChip = page.locator('.story-parse-bar__chips .chip:has-text("分鏡")').first();
  if ((await shotChip.getAttribute("aria-expanded")) !== "true") await shotChip.click();
  if (await page.locator("#story-reveal-slot").count()) {
    report.steps.push({ openStoryboard: "PASS" });
    await page.screenshot({ path: path.join(OUT, "1280-storyboard.png"), fullPage: true });
  } else {
    report.steps.push({ openStoryboard: "SLOT_NOT_OPEN" });
  }

  const genBtn = page.locator('button:has-text("生成影片")').first();
  if (await genBtn.count()) {
    page.once("dialog", (d) => d.accept());
    await genBtn.click();
    await page.waitForTimeout(2000);
    report.steps.push({ oneClick: "CLICKED" });
    await page.screenshot({ path: path.join(OUT, "1280-generation.png"), fullPage: true });
  } else {
    report.steps.push({ oneClick: "CTA_NOT_VISIBLE_YET" });
  }

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(250);
    const role = page.locator('.story-parse-bar__chips .chip:has-text("角色")').first();
    if ((await role.getAttribute("aria-expanded")) !== "true") {
      await role.click();
    }
    await page.locator("#story-reveal-slot").waitFor({ timeout: 8_000 });
    const m = await measure(page);
    const smallChips = m.chips.filter((c) => c.h < 44);
    const shotName = `${vp.name}-characters.png`;
    await page.screenshot({ path: path.join(OUT, shotName), fullPage: true });
    const result = {
      viewport: vp.name,
      overflowX: m.overflowX,
      railCount: m.railCount,
      slotBelowChips: m.slotBelowChips,
      slotSection: m.slotSection,
      chipMinHeight: Math.min(...m.chips.map((c) => c.h)),
      smallChips: smallChips.map((c) => c.text),
      screenshot: shotName,
      status:
        m.overflowX <= 1 && m.railCount === 0 && m.slotBelowChips && m.slotSection === "characters"
          ? "PASS"
          : "FAIL",
    };
    report.viewports.push(result);
    if (result.status === "FAIL") {
      report.steps.push({ viewportFail: result });
    }
  }

  fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(report, null, 2));
  const failedVp = report.viewports.filter((v) => v.status !== "PASS");
  if (failedVp.length) {
    console.error("viewport failures", failedVp);
    process.exitCode = 1;
  } else {
    console.log("PR742 chip workspace evidence PASS");
    console.log(JSON.stringify({ viewports: report.viewports.map((v) => v.viewport + ":" + v.status) }, null, 2));
  }
} catch (err) {
  report.error = String(err?.stack || err);
  fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(report, null, 2));
  await page.screenshot({ path: path.join(OUT, "failure.png"), fullPage: true }).catch(() => {});
  console.error(report.error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
