/**
 * 雙人協作／鏡像跟隨實機驗證（Playwright + Chromium CDP）。
 *
 * 前置：API :3000 ready、Vite :5173、兩個同組帳號可登入並能開同一專案。
 *
 * 環境變數：
 *   COLLAB_A_EMAIL / COLLAB_A_PASSWORD  帳一
 *   COLLAB_B_EMAIL / COLLAB_B_PASSWORD  帳二
 *   COLLAB_PROJECT_ID                   共用專案 UUID（可選；省略則取帳一 projects.list 第一筆）
 *   COLLAB_HOST                         前端（預設 http://127.0.0.1:5173）
 *   COLLAB_API                          API（預設 http://127.0.0.1:3000）
 *   PW_CHROMIUM                         chrome-headless-shell 路徑（可選）
 *
 * 用法：
 *   COLLAB_A_EMAIL=... COLLAB_A_PASSWORD=... \
 *   COLLAB_B_EMAIL=... COLLAB_B_PASSWORD=... \
 *   node scripts/e2e-ui/verify-collab-mirror.mjs
 */
import { chromium } from "playwright";
import { spawn } from "child_process";
import { setTimeout as sleep } from "timers/promises";
import fs from "fs";
import path from "path";
import os from "os";

const HOST = process.env.COLLAB_HOST || "http://127.0.0.1:5173";
const API = process.env.COLLAB_API || "http://127.0.0.1:3000";
const A = {
  email: process.env.COLLAB_A_EMAIL,
  password: process.env.COLLAB_A_PASSWORD,
  label: "帳一",
};
const B = {
  email: process.env.COLLAB_B_EMAIL,
  password: process.env.COLLAB_B_PASSWORD,
  label: "帳二",
};

const SHELL =
  process.env.PW_CHROMIUM ||
  path.join(
    os.homedir(),
    ".cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell",
  );

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}
function pass(msg) {
  console.log("✅", msg);
}

async function apiLogin(email, password) {
  const r = await fetch(`${API}/api/trpc/auth.login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: { email, password } }),
  });
  const body = await r.json();
  if (body.error) throw new Error(body.error.json?.message || "login failed");
  const cookie = (r.headers.getSetCookie?.() || [])
    .map((c) => c.split(";")[0])
    .join("; ") || (r.headers.get("set-cookie") || "").split(";")[0];
  return { user: body.result.data.json.user, cookie };
}

async function apiListProjects(cookie) {
  const r = await fetch(`${API}/api/trpc/projects.list`, {
    headers: { Cookie: cookie },
  });
  const body = await r.json();
  if (body.error) throw new Error(body.error.json?.message || "list failed");
  return body.result.data.json;
}

function launchChrome(port, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const log = fs.openSync(`/tmp/collab-chrome-${port}.log`, "w");
  if (!fs.existsSync(SHELL)) fail(`chromium not found: ${SHELL}`);
  const child = spawn(
    SHELL,
    [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--user-data-dir=${dir}`,
      `--remote-debugging-port=${port}`,
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: ["ignore", log, log], detached: true },
  );
  child.unref();
  return child;
}

async function waitCdp(port) {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return;
    } catch {}
    await sleep(250);
  }
  fail(`CDP ${port} not ready`);
}

async function login(page, acc) {
  await page.goto(`${HOST}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  for (let i = 0; i < 50; i++) {
    if ((await page.locator("#login-email").count()) > 0) break;
    if (!page.url().includes("/login")) break;
    await sleep(250);
  }
  if ((await page.locator("#login-email").count()) > 0) {
    await page.fill("#login-email", acc.email);
    await page.fill('input[type="password"]', acc.password);
    await page.locator('button[type="submit"]').click();
  }
  for (let i = 0; i < 50; i++) {
    if (!page.url().includes("/login")) break;
    await sleep(200);
  }
  console.log(`[${acc.label}]`, page.url());
}

async function openProject(page, id) {
  await page.goto(`${HOST}/p/${id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  for (let i = 0; i < 50; i++) {
    const t = await page.locator("body").innerText().catch(() => "");
    if (t.includes("找不到這個專案") || t.includes("找不到頁面")) return false;
    if (t.includes("世界觀") || t.includes("分鏡") || t.includes("鏡像") || t.includes("在線")) return true;
    await sleep(300);
  }
  return true;
}

(async () => {
  if (!A.email || !A.password || !B.email || !B.password) {
    fail("需要 COLLAB_A_EMAIL/PASSWORD 與 COLLAB_B_EMAIL/PASSWORD");
  }

  // Resolve project id
  let projectId = process.env.COLLAB_PROJECT_ID;
  if (!projectId) {
    const { cookie } = await apiLogin(A.email, A.password);
    const list = await apiListProjects(cookie);
    if (!list?.length) fail("帳一沒有可開的專案");
    projectId = list[0].id;
    console.log("use project", projectId, list[0].title);
  }

  const ca = launchChrome(9222, "/tmp/collab-chrome-a");
  const cb = launchChrome(9223, "/tmp/collab-chrome-b");
  await waitCdp(9222);
  await waitCdp(9223);

  const browserA = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const browserB = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const pA = browserA.contexts()[0].pages()[0] || (await browserA.contexts()[0].newPage());
  const pB = browserB.contexts()[0].pages()[0] || (await browserB.contexts()[0].newPage());
  await pA.setViewportSize({ width: 1280, height: 900 });
  await pB.setViewportSize({ width: 1280, height: 900 });

  await login(pA, A);
  await login(pB, B);
  if (!(await openProject(pA, projectId))) fail("帳一開專案失敗");
  if (!(await openProject(pB, projectId))) fail("帳二開專案失敗");
  pass("雙方開啟同一專案");
  await sleep(3500);

  let presence = false;
  for (let i = 0; i < 20; i++) {
    const tA = await pA.locator("body").innerText();
    const tB = await pB.locator("body").innerText();
    if (tA.includes(B.label.slice(0, 2)) || tB.includes(A.label.slice(0, 2)) || /人在線|測試帳/.test(tA + tB)) {
      presence = true;
      break;
    }
    await sleep(400);
  }
  if (!presence) fail("presence 未互見");
  pass("presence 雙方互見");

  const mirrorBtn = pB.locator('button:has-text("鏡像跟隨")').first();
  await mirrorBtn.waitFor({ state: "visible", timeout: 15000 });
  await mirrorBtn.click();
  await sleep(500);
  if ((await mirrorBtn.getAttribute("aria-pressed")) !== "true") {
    await mirrorBtn.click();
    await sleep(400);
  }
  if ((await mirrorBtn.getAttribute("aria-pressed")) !== "true") fail("鏡像模式未開啟");
  pass("帳二進入鏡像跟隨");

  const sel = pB.locator('select[aria-label="選擇要跟隨的夥伴"]');
  if ((await sel.count()) > 0) {
    const opts = await sel.locator("option").evaluateAll((els) =>
      els.map((e) => ({ v: e.value, t: (e.textContent || "").trim() })),
    );
    if (opts[0]?.v) await sel.selectOption(opts[0].v);
  }

  await pA.evaluate(() => {
    window.__cursorSends = 0;
    const Orig = WebSocket.prototype.send;
    if (!WebSocket.prototype.__patchedForCollab) {
      WebSocket.prototype.send = function (data) {
        try {
          const s = typeof data === "string" ? data : "";
          if (s.includes('"type":"cursor"')) {
            window.__cursorSends = (window.__cursorSends || 0) + 1;
            window.__lastCursor = s;
          }
        } catch {}
        return Orig.apply(this, arguments);
      };
      WebSocket.prototype.__patchedForCollab = true;
    }
  });

  const targets = ["#onboard-worldview", "#sec-characters", "#sec-scenes", "#sec-knowledge"];
  let maxBY = 0;
  for (const s of targets) {
    const el = pA.locator(s).first();
    if ((await el.count()) === 0) continue;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    const box = await el.boundingBox().catch(() => null);
    if (!box) continue;
    await pA.mouse.move(box.x + Math.min(box.width / 2, 100), box.y + Math.min(30, box.height / 2));
    await sleep(600);
    const bY = await pB.evaluate(() => window.scrollY);
    maxBY = Math.max(maxBY, bY);
    console.log(`  hover ${s} → B.scrollY=${bY}`);
  }

  const beforeB = await pB.evaluate(() => window.scrollY);
  for (let y = 200; y <= 1600; y += 200) {
    await pA.evaluate((top) => window.scrollTo(0, top), y);
    await pA.mouse.move(480, 360);
    await sleep(180);
  }
  await sleep(600);
  const afterB = await pB.evaluate(() => window.scrollY);
  const sends = await pA.evaluate(() => ({ n: window.__cursorSends || 0, last: window.__lastCursor || "" }));

  if (sends.n < 1) fail("帳一未送出 cursor 封包");
  pass(`cursor 封包 n=${sends.n}`);
  if (!sends.last.includes('"vy"')) fail("cursor 封包缺少 vy（高準度協定）");
  pass("cursor 含 vy/錨點協定欄位");

  const bMoved = afterB !== beforeB || maxBY > 50;
  if (!bMoved) fail(`鏡像未跟隨捲動 (B ${beforeB}→${afterB}, max hover ${maxBY})`);
  pass(`鏡像跟隨捲動 B ${beforeB}→${afterB} (hover max ${maxBY})`);

  console.log("last cursor", sends.last.slice(0, 180));
  console.log("DONE all green");

  await browserA.close().catch(() => {});
  await browserB.close().catch(() => {});
  try {
    process.kill(-ca.pid);
  } catch {}
  try {
    process.kill(-cb.pid);
  } catch {}
  process.exit(0);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
