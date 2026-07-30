/**
 * MOB-04：斷點水平溢出驗收
 *
 * 在固定 viewport 集合上載入公開頁（與可選的已登入專案頁），
 * 斷言 documentElement（與 body）無水平溢出；任一失敗以非 0 結束。
 *
 * Env:
 *   TARGET_URL / E2E_UI_BASE  — 預設 http://localhost:3000
 *   TEST_EMAIL / TEST_PW      — 登入（測 /p/:id 時必填，fail-closed）
 *   TEST_PROJECT_ID           — 若設則納入 /p/:id
 *   OUT_DIR                   — 可選截圖目錄（預設 ./docs/uiux-audit/screenshots/breakpoints）
 *   SKIP_SCREENSHOTS=1        — 略過截圖
 */
import fs from "fs";
import path from "path";

const VIEWPORTS = [
  { name: "S-360", width: 360, height: 800 },
  { name: "S-390", width: 390, height: 844 },
  { name: "M-768", width: 768, height: 1024 },
  { name: "L-1280", width: 1280, height: 800 },
  { name: "XL-1440", width: 1440, height: 900 },
];

const TARGET_URL = (process.env.TARGET_URL || process.env.E2E_UI_BASE || "http://localhost:3000").replace(/\/$/, "");
const OUT_DIR = process.env.OUT_DIR || "./docs/uiux-audit/screenshots/breakpoints";
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PW = process.env.TEST_PW;
const TEST_PROJECT_ID = process.env.TEST_PROJECT_ID;
const SKIP_SCREENSHOTS = process.env.SKIP_SCREENSHOTS === "1" || process.env.SKIP_SCREENSHOTS === "true";

const AUTHENTICATED_MARKER = 'header.topbar button[aria-haspopup="menu"]';
const LOGIN_EMAIL = "#login-email";
const LOGIN_PASSWORD = "#login-pw";

function safeName(route) {
  return route === "/" ? "home" : route.replace(/\//g, "-").replace(/^-/, "");
}

function buildRoutes() {
  /** @type {{ route: string, requiresAuth: boolean }[]} */
  const routes = [{ route: "/", requiresAuth: false }];
  if (TEST_PROJECT_ID) {
    routes.push({ route: `/p/${TEST_PROJECT_ID}`, requiresAuth: true });
  }
  return routes;
}

/**
 * Fail closed：要測已登入路由卻沒有帳密就直接丟錯，
 * 避免把登入頁誤判成專案頁通過。
 * （在 import playwright 之前執行，方便無瀏覽器環境也能驗 env 契約。）
 */
function requireCredentialsForAuthedRoutes(routes) {
  const needsAuth = routes.some((r) => r.requiresAuth);
  if (!needsAuth) return;
  const missing = [];
  if (!TEST_EMAIL) missing.push("TEST_EMAIL");
  if (!TEST_PW) missing.push("TEST_PW");
  if (missing.length > 0) {
    throw new Error(
      `已設定 TEST_PROJECT_ID，需登入後才能驗 /p/:id，但缺少：${missing.join(", ")}。` +
        `為避免把登入頁誤存成受保護頁面，不再使用假預設帳密（fail-closed）。`,
    );
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
  await page.goto(`${TARGET_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(LOGIN_EMAIL).fill(TEST_EMAIL);
  await page.locator(LOGIN_PASSWORD).fill(TEST_PW);
  await page.locator('button[type="submit"]').click();
  await assertAuthenticated(page);
}

/**
 * 量測水平溢出：documentElement 必檢；body 一併回報。
 * 容差 +1px 與 audit-routes.mjs 一致（亞像素／scrollbar 邊界）。
 */
async function measureOverflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const rootOverflow = root.scrollWidth > root.clientWidth + 1;
    const bodyOverflow = body
      ? body.scrollWidth > body.clientWidth + 1
      : false;
    return {
      root: {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        horizontalOverflow: rootOverflow,
      },
      body: body
        ? {
            clientWidth: body.clientWidth,
            scrollWidth: body.scrollWidth,
            horizontalOverflow: bodyOverflow,
          }
        : null,
      horizontalOverflow: rootOverflow || bodyOverflow,
    };
  });
}

function formatOverflow(layout) {
  const r = layout.root;
  const b = layout.body;
  const parts = [
    `html scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth}${r.horizontalOverflow ? " OVERFLOW" : ""}`,
  ];
  if (b) {
    parts.push(
      `body scrollWidth=${b.scrollWidth} clientWidth=${b.clientWidth}${b.horizontalOverflow ? " OVERFLOW" : ""}`,
    );
  }
  return parts.join("; ");
}

async function run() {
  const routes = buildRoutes();
  // Fail-closed env 檢查必須在啟動瀏覽器之前
  requireCredentialsForAuthedRoutes(routes);

  const needsLogin = routes.some((r) => r.requiresAuth);
  if (!SKIP_SCREENSHOTS) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  /** @type {string[]} */
  const failures = [];
  /** @type {{ route: string, viewport: string, status: string, layout?: object, error?: string, screenshot?: string }[]} */
  const results = [];

  console.log("════════════════════════════════════════════════════════");
  console.log(" MOB-04 breakpoint overflow audit");
  console.log(` target: ${TARGET_URL}`);
  console.log(` routes: ${routes.map((r) => r.route).join(", ")}`);
  console.log(` viewports: ${VIEWPORTS.map((v) => v.name).join(", ")}`);
  console.log(` login: ${needsLogin ? `yes (${TEST_EMAIL})` : "no (public only)"}`);
  console.log("════════════════════════════════════════════════════════");

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    if (needsLogin) {
      console.log(`\n→ 登入 ${TEST_EMAIL} …`);
      await login(page);
      console.log("✅ 登入成功\n");
    }

    for (const { route, requiresAuth } of routes) {
      for (const vp of VIEWPORTS) {
        const label = `${route} @ ${vp.name} (${vp.width}×${vp.height})`;
        try {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(`${TARGET_URL}${route}`, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
          // 等 layout / 字體稍穩
          await page.waitForTimeout(700);

          if (requiresAuth) {
            await assertAuthenticated(page);
            const actualPath = new URL(page.url()).pathname;
            // 專案路徑不得被導回 /login
            if (actualPath === "/login" || actualPath.startsWith("/login")) {
              throw new Error(`受保護路由被導向 ${actualPath}`);
            }
            if (actualPath !== route && !actualPath.startsWith(`/p/${TEST_PROJECT_ID}`)) {
              throw new Error(`路由被導向 ${actualPath}，預期 ${route}`);
            }
          }

          const layout = await measureOverflow(page);
          if (layout.horizontalOverflow) {
            throw new Error(`水平溢出：${formatOverflow(layout)}`);
          }

          let shotPath;
          if (!SKIP_SCREENSHOTS) {
            shotPath = path.join(OUT_DIR, `bp-${safeName(route)}-${vp.name}.png`);
            await page.screenshot({ path: shotPath, fullPage: true });
          }

          results.push({
            route,
            viewport: vp.name,
            status: "passed",
            layout,
            screenshot: shotPath,
          });
          console.log(`✅ ${label}  — ${formatOverflow(layout)}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failures.push(`${label}：${message}`);
          results.push({
            route,
            viewport: vp.name,
            status: "failed",
            error: message,
          });
          console.error(`❌ ${label}：${message}`);
        }
      }
    }
  } finally {
    const report = {
      targetUrl: TARGET_URL,
      projectFixture: TEST_PROJECT_ID || null,
      finishedAt: new Date().toISOString(),
      viewports: VIEWPORTS,
      results,
      failures,
    };
    if (!SKIP_SCREENSHOTS) {
      const reportPath = path.join(OUT_DIR, "breakpoint-audit-manifest.json");
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\n📄 manifest → ${reportPath}`);
    }
    await browser.close();
  }

  console.log("\n────────────────────────────────────────────────────────");
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = failures.length;
  console.log(`  ${passed} passed / ${failed} failed  (of ${results.length} checks)`);
  if (!TEST_PROJECT_ID) {
    console.warn("⚠️  未設定 TEST_PROJECT_ID — 僅驗公開 `/`，工作台 /p/:id 未納入");
  }
  console.log("────────────────────────────────────────────────────────");

  if (failures.length > 0) {
    console.error("\n失敗清單：");
    for (const f of failures) console.error(`  • ${f}`);
    throw new Error(`MOB-04 breakpoint audit：${failures.length} 項失敗`);
  }

  console.log("\n🎉 MOB-04 breakpoint overflow audit 全部通過");
}

run().catch((err) => {
  console.error("\nMOB-04 斷點驗收失敗：", err instanceof Error ? err.message : err);
  process.exit(1);
});
