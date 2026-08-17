import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.E2E_UI_BASE ?? "http://localhost:5173";
const PROJECT_ID = process.env.ANIMATION_EVIDENCE_PROJECT_ID;
const OUT = process.env.ANIMATION_EVIDENCE_OUT ?? "/opt/cursor/artifacts";
if (!PROJECT_ID) throw new Error("ANIMATION_EVIDENCE_PROJECT_ID is required");
mkdirSync(OUT, { recursive: true });

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', "admin@aidirector.local");
  await page.fill('input[type="password"]', "dev-admin-123456");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function openBoard(page) {
  await page.goto(`${BASE}/p/${PROJECT_ID}#stage-board`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_200);
  if (await page.getByTestId("animation-production-board").count() === 0) {
    const continueButton = page.getByRole("button", { name: /繼續製作|完整工作台/ }).first();
    if (await continueButton.count()) {
      await continueButton.click();
      await page.waitForTimeout(1_000);
    }
  }
  if (await page.getByTestId("animation-production-board").count() === 0) {
    const storyboardChip = page.getByRole("button", { name: /鏡頭\s*3|分鏡/ }).first();
    if (await storyboardChip.count()) await storyboardChip.click();
  }
  const board = page.getByTestId("animation-production-board");
  await board.waitFor({ state: "visible", timeout: 30_000 });
  await board.scrollIntoViewIfNeeded();
  const primary = board.locator("button.primary");
  if (await primary.count()) await primary.click();
  await page.waitForTimeout(300);
  return board;
}

const viewports = [
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-430", width: 430, height: 932 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 900 },
  { name: "desktop-1440", width: 1440, height: 960 },
];
const results = {};
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/local/bin/google-chrome",
});
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await login(page);
    const board = await openBoard(page);
    const axe = await new AxeBuilder({ page }).include('[data-testid="animation-production-board"]').analyze();
    const metrics = await page.evaluate(() => {
      const boardEl = document.querySelector('[data-testid="animation-production-board"]');
      const comparison = boardEl?.querySelector(".animation-board__comparison");
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        boardRight: boardEl?.getBoundingClientRect().right ?? 0,
        comparisonSlots: comparison?.children.length ?? 0,
        primaryButtons: boardEl?.querySelectorAll("button.primary").length ?? 0,
        summary: boardEl?.querySelector(".animation-board__header p")?.textContent?.trim() ?? "",
      };
    });
    const serious = axe.violations.filter((row) => row.impact === "serious" || row.impact === "critical");
    const result = {
      ...metrics,
      noHorizontalOverflow: metrics.documentWidth <= metrics.viewportWidth + 1 && metrics.boardRight <= metrics.viewportWidth + 1,
      seriousA11yViolations: serious.map((row) => ({ id: row.id, impact: row.impact, nodes: row.nodes.length })),
    };
    if (!result.noHorizontalOverflow) throw new Error(`${viewport.name}: horizontal overflow`);
    if (result.primaryButtons !== 1) throw new Error(`${viewport.name}: expected one primary CTA, got ${result.primaryButtons}`);
    if (result.comparisonSlots !== 4) throw new Error(`${viewport.name}: expected four comparison slots, got ${result.comparisonSlots}`);
    if (serious.length) throw new Error(`${viewport.name}: serious axe violations ${serious.map((row) => row.id).join(",")}`);
    await board.screenshot({ path: `${OUT}/animation_board_${viewport.name}.png` });
    results[viewport.name] = result;
    await context.close();
  }
  writeFileSync(`${OUT}/animation_board_browser_results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}

