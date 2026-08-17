#!/usr/bin/env node
/**
 * Desktop layout fingerprint.
 *
 * The hardest constraint on the phone AI-first branch is "desktop must not change".
 * Screenshots prove that badly: antialiasing and font loading make them noisy, and a
 * red diff does not say *what* moved. This records the thing the constraint is
 * actually about — where desktop elements land and how they are painted — as JSON,
 * so a diff names the offending selector and the pixel delta.
 *
 * Run it once per build and diff the two files:
 *   node scripts/e2e-ui/capture-desktop-layout.mjs > before.json   # base branch build
 *   node scripts/e2e-ui/capture-desktop-layout.mjs > after.json    # this branch
 *   node scripts/e2e-ui/capture-desktop-layout.mjs --diff before.json after.json
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const TARGET = (process.env.TARGET_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL;
const PW = process.env.TEST_PW;

/** Desktop widths only — the phone shell is a different product and is expected to differ. */
const WIDTHS = [1280, 1440];
const ROUTES = ["/dashboard", "/planner", "/databases", "/models", "/help", "/collab"];

/**
 * Selectors that make up the desktop chrome and page frame. Deliberately structural:
 * if any of these move, a desktop user sees a different page.
 */
const SELECTORS = [
  ".topbar",
  ".topbar-actions",
  ".topbar-nav-link",
  ".assistant-launcher",
  ".brand",
  "main#main-content",
  ".page-shell",
  ".app-main",
  ".card",
  ".empty-state",
  "nav.mobile-nav",
];

const round = (n) => Math.round(n * 10) / 10;

async function capture() {
  if (!EMAIL || !PW) {
    console.error("TEST_EMAIL and TEST_PW are required");
    process.exit(2);
  }
  const browser = await chromium.launch({
    args: ["--no-sandbox"],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const out = {};
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${TARGET}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PW);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });

    for (const route of ROUTES) {
      await page.goto(`${TARGET}${route}`, { waitUntil: "networkidle" });
      // Fonts settle after paint; without this the first route reads different metrics.
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(400);
      const snap = await page.evaluate((selectors) => {
        const r = (n) => Math.round(n * 10) / 10;
        const result = { doc: {}, els: {} };
        result.doc = {
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
        };
        for (const sel of selectors) {
          const nodes = [...document.querySelectorAll(sel)];
          result.els[sel] = nodes.slice(0, 6).map((el) => {
            const b = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
              x: r(b.x), y: r(b.y), w: r(b.width), h: r(b.height),
              display: cs.display,
              position: cs.position,
              flexWrap: cs.flexWrap,
              fontSize: cs.fontSize,
              visible: cs.display !== "none" && cs.visibility !== "hidden" && b.width > 0,
            };
          });
          result.els[sel].unshift({ count: nodes.length });
        }
        return result;
      }, SELECTORS);
      out[`${width}${route}`] = snap;
    }
    await ctx.close();
  }
  await browser.close();
  return out;
}

function diff(beforeFile, afterFile) {
  const before = JSON.parse(readFileSync(beforeFile, "utf8"));
  const after = JSON.parse(readFileSync(afterFile, "utf8"));
  const changes = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    if (!b || !a) { changes.push(`${key}: 只出現在其中一邊`); continue; }
    if (b.doc.scrollWidth !== a.doc.scrollWidth) {
      changes.push(`${key} doc.scrollWidth ${b.doc.scrollWidth} → ${a.doc.scrollWidth}`);
    }
    for (const sel of Object.keys(b.els)) {
      const bl = b.els[sel];
      const al = a.els[sel] ?? [];
      if (bl[0]?.count !== al[0]?.count) {
        changes.push(`${key} ${sel} 數量 ${bl[0]?.count} → ${al[0]?.count}`);
      }
      for (let i = 1; i < Math.max(bl.length, al.length); i++) {
        const x = bl[i]; const y = al[i];
        if (!x || !y) { changes.push(`${key} ${sel}[${i}] 只出現在其中一邊`); continue; }
        for (const prop of ["x", "y", "w", "h"]) {
          // 1px 容差：字型 hinting 在不同 build 之間會有次像素差，不是版面變動
          if (Math.abs(x[prop] - y[prop]) > 1) {
            changes.push(`${key} ${sel}[${i}].${prop} ${x[prop]} → ${y[prop]}`);
          }
        }
        for (const prop of ["display", "position", "flexWrap", "fontSize", "visible"]) {
          if (x[prop] !== y[prop]) {
            changes.push(`${key} ${sel}[${i}].${prop} ${x[prop]} → ${y[prop]}`);
          }
        }
      }
    }
  }
  if (changes.length === 0) {
    console.log("桌面版面指紋完全一致（1280 / 1440 × 6 條路由）");
  } else {
    console.log(`桌面版面有 ${changes.length} 處差異：`);
    for (const c of changes.slice(0, 60)) console.log(`  ${c}`);
    if (changes.length > 60) console.log(`  …還有 ${changes.length - 60} 處`);
  }
  process.exit(changes.length === 0 ? 0 : 1);
}

const args = process.argv.slice(2);
if (args[0] === "--diff") {
  diff(args[1], args[2]);
} else {
  const snap = await capture();
  console.log(JSON.stringify(snap, null, 2));
}
