import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = (process.env.TARGET_URL || process.env.E2E_UI_BASE || "http://localhost:5173").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PW;
if (!EMAIL || !PASSWORD) {
  throw new Error("verify-external-editing requires TEST_EMAIL and TEST_PW; credentials are never embedded in the script.");
}

const launchOptions = { headless: true };
if (process.env.PW_CHROMIUM) launchOptions.executablePath = process.env.PW_CHROMIUM;
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const assistant = () => page.locator('#global-assistant-sheet[role="dialog"]');
const outputDir = "test-results/external-editing";

function unwrapTrpc(payload) {
  const envelope = Array.isArray(payload) ? payload[0] : payload;
  if (envelope?.error) throw new Error(envelope.error.json?.message ?? envelope.error.message ?? "tRPC request failed");
  return envelope?.result?.data?.json ?? envelope?.result?.data;
}

async function trpcQuery(path, input) {
  return page.evaluate(async ({ path, input }) => {
    const encoded = encodeURIComponent(JSON.stringify({ "0": { json: input } }));
    const response = await fetch(`/api/trpc/${path}?batch=1&input=${encoded}`, { credentials: "same-origin" });
    return { status: response.status, payload: await response.json() };
  }, { path, input }).then(({ status, payload }) => {
    if (status >= 400) throw new Error(`${path} query failed (${status})`);
    return unwrapTrpc(payload);
  });
}

async function trpcMutation(path, input) {
  return page.evaluate(async ({ path, input }) => {
    const response = await fetch(`/api/trpc/${path}?batch=1`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "0": { json: input } }),
    });
    return { status: response.status, payload: await response.json() };
  }, { path, input }).then(({ status, payload }) => {
    if (status >= 400) throw new Error(`${path} mutation failed (${status}): ${JSON.stringify(payload).slice(0, 500)}`);
    return unwrapTrpc(payload);
  });
}

async function uploadFixture(projectId) {
  // A valid 1×1 PNG. The unique title is enough because legacy upload explicitly
  // permits a duplicate fixture; the real bytes still land in canonical storage.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  return page.evaluate(async ({ projectId, png }) => {
    const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append("projectId", projectId);
    form.append("title", `External Editing E2E ${Date.now()}`);
    form.append("file", new File([bytes], `editing-source-${Date.now()}.png`, { type: "image/png" }));
    const response = await fetch("/api/upload", { method: "POST", credentials: "same-origin", body: form });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? `upload failed (${response.status})`);
    return payload.asset;
  }, { projectId, png });
}

try {
  await mkdir(outputDir, { recursive: true });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator("#login-email").fill(EMAIL);
  await page.locator("#login-pw").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 30_000 });

  const meResponse = await page.evaluate(async () => {
    const input = encodeURIComponent(JSON.stringify({ json: null }));
    const response = await fetch(`/api/trpc/auth.me?input=${input}`, { credentials: "same-origin" });
    return response.json();
  });
  const me = unwrapTrpc(meResponse);
  const groupId = me?.groups?.[0]?.groupId;
  if (!groupId) throw new Error("signed-in account has no group available for the workflow test");

  const project = await trpcMutation("projects.createSample", { groupId });
  const shots = await trpcQuery("scenes.listByProject", { projectId: project.id });
  if (!shots?.length) throw new Error("sample project has no shots");
  const sourceAsset = await uploadFixture(project.id);
  await trpcMutation("scenes.setVisualFromAsset", { sceneId: shots[0].id, assetId: sourceAsset.id });

  await page.goto(`${BASE}/p/${project.id}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await assistant().waitFor({ state: "visible", timeout: 20_000 });
  const groupScope = assistant().getByRole("radio", { name: "整個組" });
  if (await groupScope.count()) await groupScope.click();
  const composer = assistant().locator('textarea[aria-label="向 AI 助手提問"], input[aria-label="問 AI 專案助手"]');
  await page.waitForTimeout(500);
  if (await composer.count() === 0) {
    await page.screenshot({ path: `${outputDir}/assistant-missing.png`, fullPage: false });
    throw new Error(`assistant composer missing: ${(await assistant().innerText()).slice(0, 1_000)}`);
  }
  await composer.fill("把目前這個專案交給 LumaFusion 剪輯");
  await composer.press("Enter");

  const handoffDialog = page.getByRole("dialog", { name: "建立 LumaFusion 剪輯交接" });
  await handoffDialog.waitFor({ state: "visible", timeout: 20_000 });
  await handoffDialog.getByText("這不是 LumaFusion 專案檔", { exact: false }).waitFor();
  await handoffDialog.getByRole("button", { name: "一個 Shot", exact: true }).click();
  const shotPicker = handoffDialog.getByRole("radiogroup", { name: "Shot" });
  await page.waitForTimeout(500);
  if (await shotPicker.getByRole("button").count() === 0) {
    await page.screenshot({ path: `${outputDir}/shot-picker-missing.png`, fullPage: false });
    throw new Error(`shot picker has no options: ${(await handoffDialog.innerText()).slice(0, 1_500)}`);
  }
  await shotPicker.getByRole("button").first().click();
  await page.waitForTimeout(1_000);
  const previewReady = handoffDialog.getByText(/已找到 1 個 Shot、\d+ 份可交接素材/);
  if (await previewReady.count() === 0) {
    await page.screenshot({ path: `${outputDir}/preview-missing.png`, fullPage: false });
    throw new Error(`handoff preview missing: ${(await handoffDialog.innerText()).slice(0, 1_500)}`);
  }
  await previewReady.waitFor({ timeout: 20_000 });
  await handoffDialog.getByRole("button", { name: "建立交接工作階段" }).click();
  await handoffDialog.waitFor({ state: "hidden", timeout: 30_000 });

  const sessionCard = assistant().locator(".editing-session-card").last();
  await sessionCard.waitFor({ state: "visible", timeout: 20_000 });
  await sessionCard.getByText("可交接", { exact: true }).waitFor();
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await sessionCard.getByRole("button", { name: /分享／下載交接包/ }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let bytes = 0;
  let firstChunk;
  for await (const chunk of stream) {
    if (!firstChunk) firstChunk = chunk;
    bytes += chunk.length;
  }
  if (bytes < 100 || firstChunk?.subarray(0, 2).toString() !== "PK") throw new Error("downloaded handoff is not a non-empty ZIP");
  await sessionCard.getByText("已交接", { exact: true }).waitFor({ timeout: 20_000 });

  await sessionCard.getByRole("button", { name: "回傳剪輯成果" }).click();
  const returnDialog = page.getByRole("dialog", { name: "帶入外部生成成果" });
  await returnDialog.waitFor({ state: "visible", timeout: 10_000 });
  await returnDialog.getByText("回傳到同一個 LumaFusion 剪輯工作階段", { exact: false }).waitFor();
  const returnPng = Buffer.concat([
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zk2IAAAAASUVORK5CYII=", "base64"),
    // Valid PNG decoders ignore trailing bytes; the nonce keeps repeated E2E
    // executions from correctly triggering Universal Intake deduplication.
    Buffer.from(`aios-external-editing-e2e-${Date.now()}`),
  ]);
  await returnDialog.locator('input[type="file"]').setInputFiles({
    name: `lumafusion-result-${Date.now()}.png`, mimeType: "image/png", buffer: returnPng,
  });
  await returnDialog.getByText(/1 個成果已安全保存/).waitFor({ timeout: 30_000 });
  await returnDialog.getByRole("button", { name: "關閉" }).click();
  await assistant().getByText("LumaFusion 剪輯成果已回到原工作階段", { exact: false }).waitFor({ timeout: 20_000 });
  await sessionCard.getByText("成果待審核", { exact: true }).waitFor({ timeout: 20_000 });
  await sessionCard.getByRole("button", { name: "確認完成" }).click();
  await sessionCard.getByText("已完成", { exact: true }).waitFor({ timeout: 20_000 });

  const reviewRequest = page.waitForRequest((request) => request.url().includes("/api/assistant/site-ask"), { timeout: 20_000 });
  await composer.fill("幫我看看這版還缺什麼");
  await composer.press("Enter");
  const reviewPayload = (await reviewRequest).postDataJSON();
  const recent = reviewPayload?.recentActionResults ?? [];
  if (!recent.some((item) => item?.type === "import" && item?.assetIds?.length)) {
    throw new Error("AI review follow-up did not carry the returned editing result reference");
  }

  await page.screenshot({ path: `${outputDir}/desktop.png`, fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  // The responsive shell intentionally closes transient sheets when crossing
  // breakpoints. Reopen the same Assistant conversation and verify the durable
  // Editing Session card instead of holding a stale desktop locator.
  if (!(await assistant().isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await assistant().waitFor({ state: "visible", timeout: 20_000 });
  }
  const mobileGroupScope = assistant().getByRole("radio", { name: "整個組" });
  if (await mobileGroupScope.count()) await mobileGroupScope.click();
  const mobileSessionCard = assistant().locator(".editing-session-card").last();
  await mobileSessionCard.waitFor({ state: "visible", timeout: 20_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`mobile layout has ${overflow}px horizontal overflow`);
  await mobileSessionCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${outputDir}/mobile.png`, fullPage: false });

  console.log("✓ External Editing Bridge real workflow passed");
  console.log(`  project: ${project.id}`);
  console.log(`  source asset: ${sourceAsset.id}`);
  console.log(`  package bytes: ${bytes}`);
  console.log("  assistant → prepare → ZIP → return → lineage → complete: verified");
  console.log("  AI review entry and recent returned-result reference: verified");
  console.log("  viewports: 1280×900 and 390×844");
} finally {
  await browser.close();
}
