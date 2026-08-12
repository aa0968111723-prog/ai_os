import { chromium } from "playwright";

const BASE = (process.env.TARGET_URL || process.env.E2E_UI_BASE || "http://127.0.0.1:3210").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PW;
if (!EMAIL || !PASSWORD) throw new Error("verify-agent-ui-handoffs requires TEST_EMAIL and TEST_PW");

const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const assistant = () => page.locator('#global-assistant-sheet[role="dialog"]');
const composer = () => assistant().locator('textarea[aria-label="向 AI 助手提問"]');

async function openAssistant() {
  await page.getByRole("button", { name: "AI 助手", exact: true }).first().click();
  await assistant().waitFor({ state: "visible", timeout: 20_000 });
  const groupScope = assistant().getByRole("radio", { name: "整個組" });
  if (await groupScope.count()) await groupScope.click();
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("textbox", { name: "密碼", exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 30_000 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await openAssistant();

  await composer().fill("雲端有多少素材？");
  await composer().press("Enter");
  const card = assistant().locator('[data-interaction-type="SOURCE_PICKER"]');
  await card.waitFor({ state: "visible", timeout: 60_000 });
  const touchTargets = await card.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  if (touchTargets.some((height) => height < 44)) throw new Error(`mobile source target below 44px: ${touchTargets.join(",")}`);
  if (!await card.getByRole("button", { name: /Google Photos/ }).isDisabled()) throw new Error("Unavailable Google Photos was not disabled");
  const interactionId = await card.getAttribute("data-interaction-id");

  // Closing and reopening the persistent panel must restore the same durable
  // interaction instead of asking the user to hunt for the global + tool.
  await page.keyboard.press("Escape");
  await assistant().waitFor({ state: "hidden", timeout: 10_000 });
  await openAssistant();
  const restored = assistant().locator(`[data-interaction-id="${interactionId}"]`);
  await restored.waitFor({ state: "visible", timeout: 20_000 });
  if (await assistant().getByText(/Aios 已完成/).count()) throw new Error("waiting_user_input rendered as completed");

  // The first available source must continue the same goal. No new user ASK
  // or manual global + hunt is allowed between clarification and handoff.
  const userMessagesBefore = await assistant().locator(".ai-copilot-bubble--user").count();
  await restored.getByRole("button", { name: "本機檔案", exact: true }).click();
  const fileDialog = page.locator('[role="dialog"][aria-label="加入資料"]');
  const projectPicker = assistant().locator('[data-interaction-type="PROJECT_PICKER"]');
  await Promise.race([
    fileDialog.waitFor({ state: "visible", timeout: 20_000 }),
    projectPicker.waitFor({ state: "visible", timeout: 20_000 }),
  ]);
  if (await projectPicker.isVisible()) {
    const firstProject = projectPicker.locator("button.assistant-interaction__option:not([disabled])").first();
    await firstProject.click();
  }
  await fileDialog.waitFor({ state: "visible", timeout: 20_000 });
  const userMessagesAfter = await assistant().locator(".ai-copilot-bubble--user").count();
  if (userMessagesAfter !== userMessagesBefore) throw new Error("picker return path created a new user goal");

  console.log("✓ Agent-initiated mobile handoff passed");
  console.log("  manual_tool_hunt_rate=0");
} finally {
  await browser.close();
}
