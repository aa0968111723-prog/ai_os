/**
 * Real PostgreSQL rate-limit integration test.
 *
 * It is intentionally not part of ordinary unit tests. CI runs it only against
 * its disposable PostgreSQL service after migrations. Every worker is a fresh
 * Node process/pool, proving cross-replica serialization and restart
 * persistence instead of accidentally testing a shared in-process object.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.RATE_LIMIT_TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("RATE_LIMIT_TEST_DATABASE_URL（或 CI DATABASE_URL）未設定");
const target = new URL(connectionString);
const databaseName = target.pathname.replace(/^\/+/, "");
if (process.env.CI !== "true" && !/(test|ci)/i.test(databaseName)) {
  throw new Error(`拒絕在非測試資料庫執行：${databaseName || "(default)"}`);
}

const worker = path.resolve("scripts/ci-rate-limit-worker.ts");
const secret = process.env.RATE_LIMIT_SECRET || "ci-rate-limit-integration-secret-000000000000000000000000";

function runWorker(
  action: "consume" | "inspect-failure" | "record-failure" | "clear",
  scope: string,
  subject: string,
  limit: number,
  windowMs: number,
  blockMs = 0,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", worker, action, scope, subject, String(limit), String(windowMs), String(blockMs)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: connectionString,
          NODE_ENV: "test",
          RATE_LIMIT_SECRET: secret,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    // worker 的診斷（含 server/db 的啟動訊息）全走 stderr。這裡除了累積起來備用，
    // 也即時轉發到父程序的 stderr——否則成功的 run 會把診斷整段吞掉，workflow 的
    // `tee` 與 migration-and-rate-limit-* artifact 就只在失敗時才看得到東西。
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(`[worker ${action}] ${chunk}`);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error(`worker ${action} failed (${code}): ${stderr || stdout}`));
      try {
        resolve(JSON.parse(stdout.trim()) as Record<string, unknown>);
      } catch {
        reject(new Error(`worker ${action} returned invalid JSON: ${stdout}\n${stderr}`));
      }
    });
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const suffix = randomUUID();
const scope = "test:distributed-rate-limit";
const subject = `cross-replica-${suffix}`;
const failureSubject = `failure-block-${suffix}`;
const pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000 });

try {
  // Twelve independent replicas race on one 5/min bucket. Advisory xact locks
  // must serialize them so exactly five pass—never six.
  const concurrent = await Promise.all(
    Array.from({ length: 12 }, () => runWorker("consume", scope, subject, 5, 60_000)),
  );
  const allowed = concurrent.filter((result) => result.allowed === true).length;
  assert(allowed === 5, `cross-replica atomicity failed: expected 5 allowed, got ${allowed}`);

  // A brand-new process still sees the persisted full bucket.
  const afterRestart = await runWorker("consume", scope, subject, 5, 60_000);
  assert(afterRestart.allowed === false, "restart persistence failed: fresh process bypassed the bucket");

  // MCP-style failure state is also serialized/persistent: failure #10 starts
  // a 5-minute block and a new process observes it before key verification.
  const failureResults = await Promise.all(
    Array.from({ length: 10 }, () =>
      runWorker("record-failure", scope, failureSubject, 10, 60_000, 5 * 60_000)),
  );
  assert(
    failureResults.filter((result) => result.blocked === true).length >= 1,
    "10th concurrent failure did not create a block",
  );
  const blocked = await runWorker("inspect-failure", scope, failureSubject, 10, 60_000, 5 * 60_000);
  assert(blocked.blocked === true && Number(blocked.retryAfterMs) > 0, "fresh process did not observe failure block");

  // Privacy check directly against PostgreSQL: neither raw synthetic subject is
  // present in key/state/scope text.
  const rows = await pool.query<{ payload: string }>(
    "select key_hash || scope || state::text as payload from rate_limit_buckets where scope = $1",
    [scope],
  );
  assert(rows.rowCount != null && rows.rowCount >= 2, "expected persisted integration-test buckets");
  for (const row of rows.rows) {
    assert(!row.payload.includes(subject), "raw rate-limit subject leaked into PostgreSQL");
    assert(!row.payload.includes(failureSubject), "raw failure subject leaked into PostgreSQL");
  }

  await runWorker("clear", scope, subject, 1, 1_000);
  await runWorker("clear", scope, failureSubject, 1, 1_000);
  console.log("[rate-limit-ci] cross-replica concurrency, restart persistence, block, and privacy passed");
} finally {
  await pool.end();
}

