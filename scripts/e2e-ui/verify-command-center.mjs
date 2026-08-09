import { chromium } from "playwright";

const BASE = (process.env.TARGET_URL || process.env.E2E_UI_BASE || "http://127.0.0.1:3210").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PW;
const IMPORT_URL = process.env.COMMAND_CENTER_TEST_URL || "https://www.w3.org/Icons/w3c_home.png";

if (!EMAIL || !PASSWORD) {
  throw new Error("verify-command-center requires TEST_EMAIL and TEST_PW; credentials are never embedded in the script.");
}

const launchOptions = { headless: true };
if (process.env.PW_CHROMIUM) launchOptions.executablePath = process.env.PW_CHROMIUM;
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const assistant = () => page.locator('#global-assistant-sheet[role="dialog"]');
const composer = () => assistant().locator('textarea[aria-label="向 AI 助手提問"]');
const testProjectName = `Command Center E2E ${Date.now()}`;

async function send(text) {
  await composer().fill(text);
  await composer().press("Enter");
}

async function openAssistant() {
  await page.getByTitle("AI 助手").click();
  await assistant().waitFor({ state: "visible", timeout: 20_000 });
  await composer().waitFor({ state: "visible", timeout: 20_000 });
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator("#login-email").fill(EMAIL);
  await page.locator("#login-pw").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 30_000 });

  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await openAssistant();
  const homePath = new URL(page.url()).pathname;

  await send(`幫我建立動畫專案「${testProjectName}」`);
  await assistant().getByText(new RegExp(`已建立.*${testProjectName}`)).first().waitFor({ timeout: 60_000 });
  if (new URL(page.url()).pathname !== homePath) throw new Error("create_project navigated away from the conversation");

  const importPrompt = `把這個 URL 加入剛建立的專案：${IMPORT_URL}`;
  await send(importPrompt);
  await assistant().getByText(/已加入\s*1\s*項資料/).first().waitFor({ timeout: 60_000 });
  if (new URL(page.url()).pathname !== homePath) throw new Error("import_url navigated away from the conversation");

  const assistantCount = await assistant().locator(".ai-copilot-bubble--assistant").count();
  await send("查看剛匯入的資料");
  await page.waitForFunction(
    ({ selector, count }) => document.querySelectorAll(selector).length > count,
    { selector: "#global-assistant-sheet .ai-copilot-bubble--assistant", count: assistantCount },
    { timeout: 60_000 },
  );
  if (new URL(page.url()).pathname !== homePath) throw new Error("a follow-up turn navigated without user action");

  const viewButton = assistant().getByRole("button", { name: "查看資料" }).last();
  await viewButton.waitFor({ state: "visible", timeout: 10_000 });
  await viewButton.click();
  await page.waitForFunction(() => location.pathname.startsWith("/p/"), { timeout: 20_000 });

  // Navigation is now user initiated. Reopen the persistent surface and switch
  // from project scope back to the group conversation; the original turns and
  // typed result card must still be present.
  await openAssistant();
  const groupScope = assistant().getByRole("radio", { name: "整個組" });
  if (await groupScope.count()) await groupScope.click();
  await assistant().getByText(testProjectName, { exact: false }).first().waitFor({ timeout: 20_000 });
  await assistant().getByText(IMPORT_URL, { exact: false }).first().waitFor({ timeout: 20_000 });

  console.log("✓ Command Center conversation-home flow passed");
  console.log(`  project: ${testProjectName}`);
  console.log(`  imported: ${IMPORT_URL}`);
} finally {
  await browser.close();
}
