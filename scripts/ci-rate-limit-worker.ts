/**
 * One-shot worker for ci-rate-limit-test.ts. Each invocation is a fresh Node
 * process with its own PostgreSQL pool, simulating an independent app replica.
 */
const diagnostic = (...args: Parameters<typeof console.error>) => console.error(...args);

// stdout is a strict one-record JSON protocol consumed by ci-rate-limit-test.ts.
// Imported DB modules can emit startup diagnostics through console.log/info/debug;
// keep those diagnostics on stderr so they cannot corrupt the JSON result.
console.log = diagnostic;
console.info = diagnostic;
console.debug = diagnostic;

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
  (result) => process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0)),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  },
);
