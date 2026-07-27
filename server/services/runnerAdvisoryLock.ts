import pg from "pg";

/**
 * Runner locks intentionally use a dedicated pool. A session advisory lock must
 * keep one physical PostgreSQL connection for the whole unit of work; borrowing
 * those sessions from Drizzle's request pool can starve transactions that the
 * locked work itself needs.
 */
const RUNNER_LOCK_POOL_MAX = 4;
const RUNNER_LOCK_CONNECT_TIMEOUT_MS = 10_000;

export const TRY_RUNNER_LOCK_SQL =
  "select pg_try_advisory_lock(hashtextextended($1::text, 0)) as acquired";
export const UNLOCK_RUNNER_LOCK_SQL =
  "select pg_advisory_unlock(hashtextextended($1::text, 0)) as unlocked";

export interface RunnerLockClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(destroy?: boolean): void;
}

export interface RunnerLockPool {
  connect(): Promise<RunnerLockClient>;
}

export type RunnerLockResult<T> =
  | { acquired: false }
  | { acquired: true; value: T };

let defaultPool: RunnerLockPool | undefined;

function getDefaultPool(): RunnerLockPool {
  if (defaultPool) return defaultPool;

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: RUNNER_LOCK_POOL_MAX,
    connectionTimeoutMillis: RUNNER_LOCK_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
  });
  pool.on("error", (err) => {
    console.warn(
      "[runner-lock] 閒置鎖連線錯誤（pool 會自動重建）：",
      err instanceof Error ? err.message : err,
    );
  });

  defaultPool = {
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql, values) {
          const result = await client.query(sql, values);
          return { rows: result.rows as Array<Record<string, unknown>> };
        },
        release(destroy) {
          client.release(destroy);
        },
      };
    },
  };
  return defaultPool;
}

/**
 * Tries to become the sole cross-process writer for one runner entity.
 *
 * The lock name is hashed inside PostgreSQL from a parameterized string. The
 * same checked-out session performs both lock and unlock. A failed unlock makes
 * that session unsafe to reuse, so it is destroyed; closing the session also
 * releases any advisory lock that might still be held.
 *
 * Unlock failures are deliberately not rethrown after `work`: the work may
 * already have emitted an external side effect, and retrying it would be less
 * safe than destroying the session and letting the next tick inspect DB state.
 */
export async function withRunnerAdvisoryLock<T>(
  lockName: string,
  work: () => Promise<T>,
  pool: RunnerLockPool = getDefaultPool(),
): Promise<RunnerLockResult<T>> {
  const client = await pool.connect();
  let acquired = false;
  let destroyClient = false;

  try {
    let claim: { rows: Array<Record<string, unknown>> };
    try {
      claim = await client.query(TRY_RUNNER_LOCK_SQL, [lockName]);
    } catch (err) {
      // A query-level connection error leaves the session state unknown.
      destroyClient = true;
      throw err;
    }

    acquired = claim.rows[0]?.acquired === true;
    if (!acquired) return { acquired: false };

    return { acquired: true, value: await work() };
  } finally {
    if (acquired) {
      try {
        const released = await client.query(UNLOCK_RUNNER_LOCK_SQL, [lockName]);
        if (released.rows[0]?.unlocked !== true) {
          destroyClient = true;
          console.warn(`[runner-lock] PostgreSQL 未確認解鎖，棄用連線：${lockName}`);
        }
      } catch (err) {
        destroyClient = true;
        console.warn(
          `[runner-lock] PostgreSQL 解鎖失敗，棄用連線：${lockName}`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    client.release(destroyClient);
  }
}

export function workflowRunLockName(runId: string): string {
  return `workflow-run:${runId}`;
}

export function agentRunLockName(runId: string): string {
  return `agent-run:${runId}`;
}
