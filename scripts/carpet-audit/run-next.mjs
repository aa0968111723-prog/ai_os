#!/usr/bin/env node
/**
 * 地毯式測試：每次只跑「下一個」區塊，寫入狀態與日誌。
 * 設計給 60s 排程 / CI / 人工：卡住就重跑同一格；--force-id= 可指定。
 *
 * 環境：
 *   CARPET_STATE   狀態檔（預設 .data/carpet-audit/state.json）
 *   CARPET_LOG_DIR 日誌目錄（預設 .data/carpet-audit/logs）
 *   CARPET_REPORT  累積報告 markdown（預設 docs/carpet-audit/FINDINGS.md）
 *   PORT / DATABASE_URL / E2E_*  與 e2e 相同
 *   CARPET_SKIP_E2E=1  略過耗時 e2e（只做 static/folder/health）
 *   CARPET_DRY=1       只印下一格不執行
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STATE_PATH = process.env.CARPET_STATE || path.join(ROOT, ".data/carpet-audit/state.json");
const LOG_DIR = process.env.CARPET_LOG_DIR || path.join(ROOT, ".data/carpet-audit/logs");
const REPORT_PATH = process.env.CARPET_REPORT || path.join(ROOT, "docs/carpet-audit/FINDINGS.md");
const BLOCKS_PATH = path.join(ROOT, "scripts/carpet-audit/blocks.json");
const PORT = process.env.PORT || "3000";
const SKIP_E2E = process.env.CARPET_SKIP_E2E === "1";
const DRY = process.env.CARPET_DRY === "1";

const forceId = process.argv.find((a) => a.startsWith("--force-id="))?.split("=")[1];
const reset = process.argv.includes("--reset");

function loadBlocks() {
  const raw = JSON.parse(fs.readFileSync(BLOCKS_PATH, "utf8"));
  return raw.blocks;
}

function defaultState(blocks) {
  return {
    version: 1,
    cursor: 0,
    cycle: 0,
    updatedAt: new Date().toISOString(),
    lastBlockId: null,
    lastStatus: null,
    history: [],
    results: Object.fromEntries(blocks.map((b) => [b.id, { status: "pending", runs: 0 }])),
  };
}

function loadState(blocks) {
  if (reset || !fs.existsSync(STATE_PATH)) return defaultState(blocks);
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    for (const b of blocks) {
      if (!s.results[b.id]) s.results[b.id] = { status: "pending", runs: 0 };
    }
    return s;
  } catch {
    return defaultState(blocks);
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function pickNext(blocks, state) {
  if (forceId) {
    const b = blocks.find((x) => x.id === forceId);
    if (!b) throw new Error(`未知 block id: ${forceId}`);
    return { block: b, index: blocks.indexOf(b) };
  }
  // 優先：上次 failed；否則 cursor 前進
  const failed = blocks.find((b) => state.results[b.id]?.status === "failed");
  if (failed && process.env.CARPET_RETRY_FAILED === "1") {
    return { block: failed, index: blocks.indexOf(failed) };
  }
  let idx = state.cursor % blocks.length;
  // 一輪內先掃 pending，再掃全部
  for (let i = 0; i < blocks.length; i++) {
    const j = (idx + i) % blocks.length;
    if (state.results[blocks[j].id]?.status === "pending") {
      return { block: blocks[j], index: j };
    }
  }
  return { block: blocks[idx], index: idx };
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, PORT, PATH: process.env.PATH },
      shell: opts.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      err += d;
      process.stderr.write(d);
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 3000);
        }, opts.timeoutMs)
      : null;
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, signal, out, err });
    });
  });
}

async function ensureServerReady() {
  const url = `http://127.0.0.1:${PORT}/api/ready`;
  try {
    const r = await fetch(url);
    if (r.ok) return true;
  } catch {
    /* not up */
  }
  return false;
}

async function executeBlock(block) {
  const findings = [];
  if (SKIP_E2E && (block.kind === "e2e-py" || block.kind === "ui-playwright" || block.kind === "npm")) {
    return { ok: true, skipped: true, detail: "CARPET_SKIP_E2E=1", findings };
  }

  switch (block.kind) {
    case "api": {
      const ready = await ensureServerReady();
      if (!ready) {
        return { ok: false, detail: `server not ready on :${PORT}`, findings };
      }
      const r = await runCmd("bash", ["-lc", `curl -sf http://127.0.0.1:${PORT}/api/ready | head -c 2000`]);
      return { ok: r.code === 0, detail: r.out.slice(0, 500) || r.err.slice(0, 500), findings };
    }
    case "e2e-py": {
      // 需要已啟動的 server；套件腳本假設 DB 已 seed
      if (!(await ensureServerReady())) {
        return { ok: false, detail: "server not ready — start npm run dev / tsx server first", findings };
      }
      // AUTH_MODE=dev 會讓 createContext 永遠是種子開發者——多使用者隔離 e2e 必假紅
      if (process.env.AUTH_MODE === "dev") {
        findings.push({
          severity: "high",
          id: "E2E-AUTH-MODE-DEV",
          title: "伺服器以 AUTH_MODE=dev 運行，e2e 隔離斷言不可信",
          file: "server/trpc.ts",
          evidence: "AUTH_MODE=dev in process env of carpet runner (server likely same)",
          consequence: "多使用者／跨組 e2e 假陰性；請重啟 server 且勿設 AUTH_MODE=dev",
          fix: "export -n AUTH_MODE；重啟 tsx server 後再跑 e2e",
        });
        return { ok: false, detail: "AUTH_MODE=dev blocks trustworthy e2e", findings };
      }
      const r = await runCmd("python3", [`scripts/e2e-${block.suite}.py`], {
        timeoutMs: 10 * 60 * 1000,
      });
      return { ok: r.code === 0, detail: `exit=${r.code}`, findings };
    }
    case "npm": {
      const r = await runCmd("bash", ["-lc", block.command], { timeoutMs: 15 * 60 * 1000, shell: false });
      return { ok: r.code === 0, detail: `exit=${r.code}`, findings };
    }
    case "ui-playwright": {
      if (!(await ensureServerReady())) {
        return { ok: false, detail: "server not ready for UI", findings };
      }
      const envNote = block.script?.includes("audit-routes")
        ? "needs TEST_EMAIL/TEST_PW"
        : "";
      const r = await runCmd(
        "bash",
        [
          "-lc",
          `export E2E_UI_BASE="\${E2E_UI_BASE:-http://127.0.0.1:${PORT}}" TARGET_URL="\${TARGET_URL:-http://127.0.0.1:${PORT}}"; node ${block.script}`,
        ],
        { timeoutMs: 20 * 60 * 1000 },
      );
      return { ok: r.code === 0, detail: `exit=${r.code} ${envNote}`.trim(), findings };
    }
    case "static-review": {
      // 靜態：印路徑與 focus，實際深度審查由 agent 排程回合完成；此處做存在性 + 關鍵 pattern 掃描
      const missing = [];
      for (const p of block.paths || []) {
        const abs = path.join(ROOT, p);
        if (!fs.existsSync(abs)) missing.push(p);
      }
      if (missing.length) {
        return { ok: false, detail: `missing paths: ${missing.join(", ")}`, findings };
      }
      // agent parallel 已知缺陷 pattern 自動檢查
      if (block.id === "static.agent-parallel") {
        const runner = fs.readFileSync(path.join(ROOT, "server/services/agentRunner.ts"), "utf8");
        if (/const authzError = await checkRunAuthority\(run\);\s*\n\s*if \(authzError\) return;/.test(runner)) {
          findings.push({
            severity: "high",
            id: "AGENT-PAR-AUTHZ-SILENT",
            title: "並行 generate 路徑權限失敗只 return 不 failRun",
            file: "server/services/agentRunner.ts",
            evidence: "startParallelGenerateBranches: if (authzError) return;",
            consequence: "發起人被降權/移出組時，並行支線可能空轉而非明確 failed；與 serial 路徑 failRun 不一致",
            fix: "if (authzError) { await failRun(...); return; } 或回傳錯誤給 advanceRun 統一收攏",
          });
        }
        if (
          /INTERNAL_SERVER_ERROR[\s\S]{0,200}return;/.test(runner) &&
          /step\.generationId = randomUUID\(\)/.test(runner)
        ) {
          findings.push({
            severity: "medium",
            id: "AGENT-PAR-GHOST-GENID",
            title: "並行送出 INTERNAL_SERVER_ERROR 後留下幽靈 generationId",
            file: "server/services/agentRunner.ts",
            evidence: "generationId 已寫入 steps 後 catch INTERNAL 直接 return，未清 generationId",
            consequence: "步驟卡在 running 直到 30 分鐘 STALE 陳屍回收；期間不再重試送出",
            fix: "暫時失敗時清除 generationId 並回 pending，或寫 detail 並排退避重試",
          });
        }
      }
      if (block.id === "static.acl-routers") {
        // 粗掃：mutation 檔內 requireGroup 後 15 行內無 assertProjectEditable（启发式，仅提示）
        const routersDir = path.join(ROOT, "server/routers");
        for (const f of fs.readdirSync(routersDir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
          const text = fs.readFileSync(path.join(routersDir, f), "utf8");
          // 跳过明显只读 list/get 注释
          if (!text.includes(".mutation(")) continue;
          if (text.includes("assertProjectEditable") || text.includes("assertProjectNotArchived")) continue;
          // 允许 auth/options 等非 project 内容写
          if (["auth.ts", "options.ts", "feedback.ts", "push.ts", "quota.ts", "models.ts", "admin.ts", "audit.ts", "directory.ts", "dm.ts", "insights.ts", "integrations.ts", "mcpTokens.ts", "googleCalendar.ts", "feedbackReports.ts"].includes(f)) {
            continue;
          }
          findings.push({
            severity: "low",
            id: `ACL-SCAN-${f}`,
            title: `router ${f} 含 mutation 但未出現 assertProjectEditable（需人工確認是否適用）`,
            file: `server/routers/${f}`,
            evidence: "heuristic scan",
            consequence: "可能是合法（組級/個人資源）或漏掛",
            fix: "人工對照每個 mutation 是否寫專案內容",
          });
        }
      }
      return {
        ok: findings.filter((f) => f.severity === "high" || f.severity === "critical").length === 0,
        detail: findings.length ? `${findings.length} finding(s)` : "paths ok, no auto findings",
        findings,
      };
    }
    case "folder-scan": {
      const p = block.paths?.[0];
      if (!p) return { ok: false, detail: "no path", findings };
      const abs = path.join(ROOT, p);
      if (!fs.existsSync(abs)) return { ok: false, detail: `missing ${p}`, findings };
      const entries = fs.readdirSync(abs);
      return { ok: true, detail: `${entries.length} entries under ${p}`, findings };
    }
    default:
      return { ok: false, detail: `unknown kind ${block.kind}`, findings };
  }
}

function appendReport(block, result, state) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const ts = new Date().toISOString();
  let body = "";
  if (!fs.existsSync(REPORT_PATH)) {
    body += `# 全站地毯式測試紀錄（Carpet Audit）\n\n`;
    body += `> 自動／半自動累積。每格執行後 append。狀態：\`.data/carpet-audit/state.json\`\n\n`;
    body += `| 欄位 | 說明 |\n|------|------|\n`;
    body += `| 循環 | 60s 推進下一區塊 |\n`;
    body += `| 實機 | e2e-py + Playwright + 單元測試 |\n`;
    body += `| 記錄 | 本檔 + PR |\n\n---\n\n`;
  }
  const status = result.skipped ? "⏭ skipped" : result.ok ? "✅ pass" : "❌ fail";
  body += `## ${ts} · \`${block.id}\` ${status}\n\n`;
  body += `**${block.title}** · kind=\`${block.kind}\` · cycle=${state.cycle} · cursor→${state.cursor}\n\n`;
  body += `Detail: \`${(result.detail || "").replace(/`/g, "'").slice(0, 300)}\`\n\n`;
  if (result.findings?.length) {
    body += `### Findings\n\n`;
    for (const f of result.findings) {
      body += `#### [${f.severity}] ${f.id}: ${f.title}\n\n`;
      body += `- **File**: \`${f.file}\`\n`;
      body += `- **Evidence**: ${f.evidence}\n`;
      body += `- **Consequence**: ${f.consequence}\n`;
      body += `- **Fix**: ${f.fix}\n\n`;
    }
  }
  body += `---\n\n`;
  fs.appendFileSync(REPORT_PATH, body);
}

async function main() {
  const blocks = loadBlocks();
  const state = loadState(blocks);
  const { block, index } = pickNext(blocks, state);

  console.log(`\n🧶 carpet-audit · block ${index + 1}/${blocks.length} · ${block.id}`);
  console.log(`   ${block.title}`);
  if (DRY) {
    console.log("   (dry-run)");
    process.exit(0);
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `${Date.now()}-${block.id.replace(/\./g, "_")}.log`);

  const started = Date.now();
  let result;
  try {
    result = await executeBlock(block);
  } catch (e) {
    result = { ok: false, detail: e instanceof Error ? e.message : String(e), findings: [] };
  }
  const ms = Date.now() - started;

  const status = result.skipped ? "skipped" : result.ok ? "pass" : "failed";
  state.results[block.id] = {
    status,
    runs: (state.results[block.id]?.runs || 0) + 1,
    lastDetail: (result.detail || "").slice(0, 500),
    lastMs: ms,
    findings: result.findings || [],
    at: new Date().toISOString(),
  };
  state.lastBlockId = block.id;
  state.lastStatus = status;
  state.history = [
    ...(state.history || []).slice(-200),
    { id: block.id, status, ms, at: new Date().toISOString() },
  ];
  state.cursor = (index + 1) % blocks.length;
  if (state.cursor === 0) state.cycle += 1;
  saveState(state);
  appendReport(block, result, state);

  fs.writeFileSync(
    logFile,
    JSON.stringify({ block, result, ms, stateCursor: state.cursor }, null, 2),
  );

  console.log(`\n→ ${status} in ${ms}ms · next cursor=${state.cursor} · log=${path.relative(ROOT, logFile)}`);
  if (result.findings?.length) {
    console.log(`→ ${result.findings.length} finding(s) appended to ${path.relative(ROOT, REPORT_PATH)}`);
  }
  process.exit(result.ok || result.skipped ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
