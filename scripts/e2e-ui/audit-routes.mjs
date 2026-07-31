import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import fs from "fs";
import path from "path";

const PUBLIC_ROUTES = ["/", "/login"];
const AUTHENTICATED_ROUTES = [
  "/dashboard",
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

/**
 * SPA 是否掛載：`<div className="app">` 在 AppShell 無條件渲染，不等任何 API。
 * 先前用 header.topbar 當唯一 marker 是錯的——header 被 `{me.data && …}` 閘門
 * 控制，任何一支慢查詢都會讓它整個不存在，於是「資料層卡住」被誤報成「頁面壞了」。
 */
const SHELL_MARKER = "div.app";
/** 已登入才會出現（保留，但只用來斷言登入狀態，不再兼任「頁面可用」的判準） */
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
  // 先確認 SPA 真的掛起來了（不依賴任何 API）
  await page.locator(SHELL_MARKER).waitFor({ state: "attached", timeout: 15_000 });

  // 再等頂欄。順序很重要：登入送出後導向尚未完成時，div.app 已存在而登入表單也還在，
  // 若先檢查「是否還在登入頁」會誤判成登入失敗（實測踩過）。所以先等頂欄，
  // 只有等不到時才去分辨成因。
  try {
    await page.locator(AUTHENTICATED_MARKER).waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    // 分開報錯才能區分「真的沒登入」與「資料層慢到 header 沒渲染」——
    // 兩者都會讓舊版的單一 marker 逾時，但成因與修法完全不同。
    if (await page.locator(LOGIN_EMAIL).isVisible().catch(() => false)) {
      throw new Error("仍停留在登入頁，未建立有效工作階段");
    }
    throw new Error("SPA 已掛載但頂欄未出現：auth.me 或與它同批次的查詢逾時（資料層問題，非頁面壞掉）");
  }
}

/**
 * 等真實內容，而非等固定秒數。
 *
 * 舊版是 `waitForTimeout(700)` 就截圖，結果 /admin 在**所有** viewport 都只截到
 * Suspense fallback（一顆按鈕都沒渲染）卻標記為 passed——那份 baseline 對這些路由
 * 其實什麼都沒驗到，比沒驗更危險，因為它給人「已驗證」的錯覺。
 */
async function waitForRouteContent(page) {
  await page.waitForFunction(
    () => {
      const main = document.querySelector("#main-content") ?? document.querySelector("main");
      if (!main) return false;
      const text = (main.innerText || "").trim();
      // 只有 Suspense fallback 的「載入中…」不算內容
      return text.length > 0 && text !== "載入中…" && !/^載入中…?$/.test(text);
    },
    { timeout: 20_000 },
  ).catch(() => {
    throw new Error("主內容區在 20 秒內仍只有載入中佔位（頁面 chunk 或其資料未就緒）");
  });
}

async function login(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${TARGET_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator(LOGIN_EMAIL).fill(TEST_EMAIL);
  await page.locator(LOGIN_PASSWORD).fill(TEST_PW);
  await page.locator('button[type="submit"]').click();
  await assertAuthenticated(page);
}

async function inspectViewport(page, vp) {
  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    const controls = [...document.querySelectorAll(
      "button,input,select,textarea,[role=button],a.btn,a.brand,.mobile-nav a,.menu-item",
    )]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
      })
      .map((element) => {
        // 包在 <label> 裡的 checkbox/radio，實際觸控目標是整個 label（點 label 就命中），
        // 量 13px 的原生小方塊是誤報——WCAG 2.5.5/2.5.8 算的是可點區域，不是控件本體。
        const type = element.getAttribute("type");
        const wrapper =
          element.tagName === "INPUT" && (type === "checkbox" || type === "radio")
            ? element.closest("label")
            : null;
        const rect = (wrapper ?? element).getBoundingClientRect();
        return {
          tag: element.tagName,
          label: (element.getAttribute("aria-label") || element.textContent || (wrapper?.textContent ?? "")).trim().slice(0, 60),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
      undersizedControls: controls.filter((item) => item.width < 44 || item.height < 44),
    };
  });
  if (layout.horizontalOverflow) {
    throw new Error(`水平溢出：scrollWidth ${layout.scrollWidth} > clientWidth ${layout.clientWidth}`);
  }
  if (vp.width <= 390 && layout.undersizedControls.length > 0) {
    throw new Error(`手機觸控目標小於 44px：${JSON.stringify(layout.undersizedControls.slice(0, 8))}`);
  }
  return layout;
}

async function run() {
  requiredEnvironment();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const routes = [...AUTHENTICATED_ROUTES];
  if (TEST_PROJECT_ID) routes.push(`/p/${TEST_PROJECT_ID}`);
  if (TEST_PEER_ID) routes.push(`/chat/${TEST_PEER_ID}`);

  const failures = [];
  const manifest = {
    targetUrl: TARGET_URL,
    role: TEST_ROLE,
    projectFixture: TEST_PROJECT_ID || null,
    peerFixture: TEST_PEER_ID || null,
    startedAt: new Date().toISOString(),
    results: [],
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const consoleErrors = [];
  /**
   * 每個路由開一個新分頁。
   *
   * 舊版整輪共用同一個 page：某個路由卡住時，在途請求會拖累後續 iteration——
   * 實測 `/options` 那個 30 秒 `page.goto` 逾時，其實是被前一個 `/admin` 的停頓
   * 拖下水的，本身沒問題。分頁隔離讓每個路由的失敗只代表它自己。
   * 登入狀態存在 context 的 cookie 上，換分頁不需要重新登入。
   */
  const newAuditPage = async () => {
    const p = await context.newPage();
    p.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    p.on("pageerror", (error) => consoleErrors.push(error.message));
    return p;
  };
  let page = await newAuditPage();

  try {
    for (const route of PUBLIC_ROUTES) {
      for (const vp of VIEWPORTS) {
        const label = `public ${route} @ ${vp.name}`;
        try {
          consoleErrors.length = 0;
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(`${TARGET_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await page.waitForTimeout(700);
          if (new URL(page.url()).pathname !== route) throw new Error(`公開路由被導向 ${new URL(page.url()).pathname}`);
          const layout = await inspectViewport(page, vp);
          const accessibility = vp.name === "L-1280"
            ? await new AxeBuilder({ page }).analyze()
            : null;
          const severe = accessibility?.violations.filter((item) => item.impact === "critical" || item.impact === "serious") ?? [];
          if (severe.length) throw new Error(`無障礙 serious/critical：${severe.map((item) => item.id).join(", ")}`);
          if (consoleErrors.length) throw new Error(`console/page error：${consoleErrors.slice(0, 3).join(" | ")}`);
          const shotPath = path.join(OUT_DIR, `public-${safeName(route)}-${vp.name}.png`);
          await page.screenshot({ path: shotPath, fullPage: true });
          manifest.results.push({ route, public: true, viewport: vp, status: "passed", layout, screenshot: shotPath });
          console.log(`✅ ${label}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failures.push(`${label}：${message}`);
          manifest.results.push({ route, public: true, viewport: vp, status: "failed", currentUrl: page.url(), error: message });
          console.error(`❌ ${label}：${message}`);
        }
      }
    }

    console.log(`登入 UI 巡覽帳號：${TEST_EMAIL}（角色：${TEST_ROLE}）`);
    await login(page);
    console.log("✅ 已確認登入成功，開始巡覽受保護路由");

    for (const route of routes) {
      const routeName = safeName(route);
      let contentSaved = false;

      // 換新分頁，切斷上一個路由可能還卡著的在途請求
      const previous = page;
      page = await newAuditPage();
      await previous.close().catch(() => {});

      for (const vp of VIEWPORTS) {
        const label = `${route} @ ${vp.name}`;
        try {
          consoleErrors.length = 0;
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.goto(`${TARGET_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await assertAuthenticated(page);
          await waitForRouteContent(page);

          const currentUrl = page.url();
          const actualPath = new URL(currentUrl).pathname;
          if (actualPath !== route) {
            throw new Error(`路由被導向 ${actualPath}，預期為 ${route}`);
          }

          const title = await page.title();
          const pageText = (await page.locator("body").innerText()).trim();
          if (!pageText) throw new Error("頁面沒有可讀內容");
          const layout = await inspectViewport(page, vp);
          const accessibility = vp.name === "L-1280"
            ? await new AxeBuilder({ page }).analyze()
            : null;
          const severe = accessibility?.violations.filter((item) => item.impact === "critical" || item.impact === "serious") ?? [];
          if (severe.length) throw new Error(`無障礙 serious/critical：${severe.map((item) => item.id).join(", ")}`);
          if (consoleErrors.length) throw new Error(`console/page error：${consoleErrors.slice(0, 3).join(" | ")}`);

          if (!contentSaved && vp.name === "L-1280") {
            const textPath = path.join(OUT_DIR, `route-${routeName}-content.txt`);
            fs.writeFileSync(
              textPath,
              `Route: ${route}\nURL: ${currentUrl}\nTitle: ${title}\nRole: ${TEST_ROLE}\n\n${pageText}`,
            );
            contentSaved = true;
          }

          const shotPath = path.join(OUT_DIR, `route-${routeName}-${vp.name}.png`);
          await page.screenshot({ path: shotPath, fullPage: true });
          manifest.results.push({ route, viewport: vp, status: "passed", currentUrl, title, layout, screenshot: shotPath });
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
