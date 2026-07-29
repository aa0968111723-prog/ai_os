import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const STATIC_ROUTES = [
  "/",
  "/admin",
  "/options",
  "/logs",
  "/members",
  "/feedback",
  "/my-reports",
  "/models",
  "/help",
  "/mcp",
  "/integrations",
  "/downloads",
  "/planner",
  "/databases",
  "/chat",
];

const VIEWPORTS = [
  { name: "S-360", width: 360, height: 800 },
  { name: "S-390", width: 390, height: 844 },
  { name: "M-768", width: 768, height: 1024 },
  { name: "L-1280", width: 1280, height: 800 },
  { name: "XL-1440", width: 1440, height: 900 },
];

const TARGET_URL = (process.env.TARGET_URL || "http://localhost:3000").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR || "./docs/uiux-audit/screenshots";
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PW = process.env.TEST_PW;
const TEST_ROLE = process.env.TEST_ROLE || "unspecified";
const TEST_PROJECT_ID = process.env.TEST_PROJECT_ID;
const TEST_PEER_ID = process.env.TEST_PEER_ID;

const AUTHENTICATED_MARKER = 'header.topbar button[aria-haspopup="menu"]';
const LOGIN_EMAIL = "#login-email";
const LOGIN_PASSWORD = "#login-pw";

function safeName(route) {
  return route === "/" ? "home" : route.replace(/\//g, "-").replace(/^-/, "");
}

function requiredEnvironment() {
  const missing = [];
  if (!TEST_EMAIL) missing.push("TEST_EMAIL");
  if (!TEST_PW) missing.push("TEST_PW");
  if (missing.length > 0) {
    throw new Error(`缺少 UI 巡覽測試環境變數：${missing.join(", ")}。為避免把登入頁誤存成受保護頁面，不再使用假預設帳密。`);
  }
}

async function assertAuthenticated(page) {
  await page.locator(AUTHENTICATED_MARKER).waitFor({ state: "visible", timeout: 15_000 });
  if (await page.locator(LOGIN_EMAIL).isVisible().catch(() => false)) {
    throw new Error("仍停留在登入頁，未建立有效工作階段");
  }
}

async function login(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(LOGIN_EMAIL).fill(TEST_EMAIL);
  await page.locator(LOGIN_PASSWORD).fill(TEST_PW);
  await page.locator('button[type="submit"]').click();
  await assertAuthenticated(page);
}

async function run() {
  requiredEnvironment();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const routes = [...STATIC_ROUTES];
  if (TEST_PROJECT_ID) routes.push(`/p/${TEST_PROJECT_ID}`);
  if (TEST_PEER_ID) routes.push(`/chat/${TEST_PEER_ID}`);

  const failures = [];
  const manifest = {
    targetUrl: TARGET_URL,
    role: TEST_ROLE,
    testEmail: TEST_EMAIL,
    projectFixture: TEST_PROJECT_ID || null,
    peerFixture: TEST_PEER_ID || null,
    startedAt: new Date().toISOString(),
    results: [],
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`登入 UI 巡覽帳號：${TEST_EMAIL}（角色：${TEST_ROLE}）`);
    await login(page);
    console.log("✅ 已確認登入成功，開始巡覽受保護路由");

    for (const route of routes) {
      const routeName = safeName(route);
      let contentSaved = false;

      for (const vp of VIEWPORTS) {
        const label = `${route} @ ${vp.name}`;
        try {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(`${TARGET_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await assertAuthenticated(page);
          await page.waitForTimeout(700);

          const currentUrl = page.url();
          const actualPath = new URL(currentUrl).pathname;
          if (actualPath !== route) {
            throw new Error(`路由被導向 ${actualPath}，預期為 ${route}`);
          }

          const title = await page.title();
          const pageText = (await page.locator("body").innerText()).trim();
          if (!pageText) throw new Error("頁面沒有可讀內容");

          if (!contentSaved && vp.name === "L-1280") {
            const textPath = path.join(OUT_DIR, `route-${routeName}-content.txt`);
            fs.writeFileSync(
              textPath,
              `Route: ${route}\nURL: ${currentUrl}\nTitle: ${title}\nRole: ${TEST_ROLE}\nAccount: ${TEST_EMAIL}\n\n${pageText}`,
            );
            contentSaved = true;
          }

          const shotPath = path.join(OUT_DIR, `route-${routeName}-${vp.name}.png`);
          await page.screenshot({ path: shotPath, fullPage: true });
          manifest.results.push({ route, viewport: vp, status: "passed", currentUrl, title, screenshot: shotPath });
          console.log(`✅ ${label}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failures.push(`${label}：${message}`);
          manifest.results.push({ route, viewport: vp, status: "failed", currentUrl: page.url(), error: message });
          console.error(`❌ ${label}：${message}`);
        }
      }
    }
  } finally {
    manifest.finishedAt = new Date().toISOString();
    manifest.failures = failures;
    fs.writeFileSync(path.join(OUT_DIR, "audit-manifest.json"), JSON.stringify(manifest, null, 2));
    await browser.close();
  }

  if (!TEST_PROJECT_ID) {
    console.warn("⚠️ 未設定 TEST_PROJECT_ID，核心專案工作台 /p/:id 尚未納入本次真實資料巡覽");
  }
  if (!TEST_PEER_ID) {
    console.warn("⚠️ 未設定 TEST_PEER_ID，一對一私訊 /chat/:peerId 尚未納入本次巡覽");
  }
  if (failures.length > 0) {
    throw new Error(`UI/UX 路由巡覽有 ${failures.length} 項失敗；詳見 ${path.join(OUT_DIR, "audit-manifest.json")}`);
  }

  console.log(`🎉 UI/UX 路由巡覽全部通過；證據已寫入 ${OUT_DIR}`);
}

run().catch((err) => {
  console.error("UI/UX 巡覽失敗：", err instanceof Error ? err.message : err);
  process.exit(1);
});
