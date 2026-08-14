/**
 * One-shot worker for ci-rate-limit-test.ts. Each invocation is a fresh Node
 * process with its own PostgreSQL pool, simulating an independent app replica.
 *
 * stdout 是與父程序之間的嚴格協定：整個程序只准輸出「最後那一筆 JSON」。
 * 但 worker 一定得載入 server/db（那裡在 import 期就 `console.info` 連線診斷），
 * 任何一個多餘字元都會讓父程序的 `JSON.parse` 失敗——CI 的「驗證分散式 rate limit」
 * 因此紅燈，而不是 rate limit 邏輯真的錯。
 *
 * 所以在載入任何模組之前先把整支 stdout 改道到 stderr（不只是 console.log／info／debug，
 * 連相依套件直接 `process.stdout.write` 的診斷也一併擋下），只留一支私有的原始 writer
 * 給最後的結果用。診斷不會消失，全都在 stderr，CI log 仍看得到。
 */
const writeResult = process.stdout.write.bind(process.stdout);
process.stdout.write = ((
  chunk: string | Uint8Array,
  encodingOrCallback?: unknown,
  callback?: unknown,
) =>
  (process.stderr.write as (...args: unknown[]) => boolean)(
    chunk,
    encodingOrCallback,
    callback,
  )) as typeof process.stdout.write;

const [action, scope, subject, limitRaw, windowRaw, blockRaw] = process.argv.slice(2);

async function main(): Promise<unknown> {
  const rateLimit = await import("../server/services/rateLimit");
  const limit = Number(limitRaw);
  const windowMs = Number(windowRaw);
  if (action === "consume") {
    return rateLimit.consumeRateLimit(scope, subject, { limit, windowMs });
  }
  if (action === "inspect-failure") {
    return rateLimit.inspectFailureRateLimit(scope, subject, {
      limit,
      windowMs,
      blockMs: Number(blockRaw),
    });
  }
  if (action === "record-failure") {
    return rateLimit.recordRateLimitFailure(scope, subject, {
      limit,
      windowMs,
      blockMs: Number(blockRaw),
    });
  }
  if (action === "clear") {
    await rateLimit.clearRateLimit(scope, subject);
    return { ok: true };
  }
  throw new Error(`unknown worker action: ${action}`);
}

main().then(
  (result) => writeResult(`${JSON.stringify(result)}\n`, () => process.exit(0)),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  },
);

