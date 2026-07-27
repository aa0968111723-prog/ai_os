import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  TRY_RUNNER_LOCK_SQL,
  UNLOCK_RUNNER_LOCK_SQL,
  type RunnerLockClient,
  type RunnerLockPool,
  withRunnerAdvisoryLock,
} from "./runnerAdvisoryLock";

type QueryReply = { rows: Array<Record<string, unknown>> } | Error;

class FakeClient implements RunnerLockClient {
  readonly queries: Array<{ sql: string; values?: unknown[] }> = [];
  readonly releases: Array<boolean | undefined> = [];

  constructor(private readonly replies: QueryReply[]) {}

  async query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push({ sql, values });
    const reply = this.replies.shift();
    if (!reply) throw new Error("fake query reply missing");
    if (reply instanceof Error) throw reply;
    return reply;
  }

  release(destroy?: boolean): void {
    this.releases.push(destroy);
  }
}

function fakePool(client: FakeClient): RunnerLockPool {
  return {
    async connect() {
      return client;
    },
  };
}

describe("withRunnerAdvisoryLock", () => {
  it("acquires and releases the same parameterized PostgreSQL session lock", async () => {
    const client = new FakeClient([
      { rows: [{ acquired: true }] },
      { rows: [{ unlocked: true }] },
    ]);
    const work = vi.fn(async () => "done");

    const result = await withRunnerAdvisoryLock(
      "workflow-run:abc",
      work,
      fakePool(client),
    );

    expect(result).toEqual({ acquired: true, value: "done" });
    expect(work).toHaveBeenCalledOnce();
    expect(client.queries).toEqual([
      { sql: TRY_RUNNER_LOCK_SQL, values: ["workflow-run:abc"] },
      { sql: UNLOCK_RUNNER_LOCK_SQL, values: ["workflow-run:abc"] },
    ]);
    expect(TRY_RUNNER_LOCK_SQL).toContain("hashtextextended($1::text");
    expect(client.releases).toEqual([false]);
  });

  it("skips work immediately when another replica owns the run", async () => {
    const client = new FakeClient([{ rows: [{ acquired: false }] }]);
    const work = vi.fn(async () => "must not run");

    const result = await withRunnerAdvisoryLock(
      "agent-run:busy",
      work,
      fakePool(client),
    );

    expect(result).toEqual({ acquired: false });
    expect(work).not.toHaveBeenCalled();
    expect(client.queries).toHaveLength(1);
    expect(client.releases).toEqual([false]);
  });

  it("unlocks in finally and preserves a work error", async () => {
    const client = new FakeClient([
      { rows: [{ acquired: true }] },
      { rows: [{ unlocked: true }] },
    ]);
    const workError = new Error("provider failed");

    await expect(
      withRunnerAdvisoryLock(
        "workflow-run:throws",
        async () => {
          throw workError;
        },
        fakePool(client),
      ),
    ).rejects.toBe(workError);

    expect(client.queries.map(({ sql }) => sql)).toEqual([
      TRY_RUNNER_LOCK_SQL,
      UNLOCK_RUNNER_LOCK_SQL,
    ]);
    expect(client.releases).toEqual([false]);
  });

  it("destroys the checked-out session when unlock fails", async () => {
    const client = new FakeClient([
      { rows: [{ acquired: true }] },
      new Error("connection lost during unlock"),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = await withRunnerAdvisoryLock(
        "agent-run:unsafe-session",
        async () => 42,
        fakePool(client),
      );

      // Work already completed, so an unlock transport error must not make the
      // runner repeat possibly non-idempotent side effects.
      expect(result).toEqual({ acquired: true, value: 42 });
      expect(client.releases).toEqual([true]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("runner lock source regression guards", () => {
  const workflowSource = readFileSync(
    new URL("./workflowRunner.ts", import.meta.url),
    "utf8",
  );
  const agentSource = readFileSync(
    new URL("./agentRunner.ts", import.meta.url),
    "utf8",
  );

  it("uses one per-run lock namespace in both normal advance and zombie sweep", () => {
    expect(workflowSource.match(/workflowRunLockName\(run\.id\)/g)).toHaveLength(2);
    expect(agentSource.match(/agentRunLockName\(run\.id\)/g)).toHaveLength(2);
    expect(workflowSource).toContain("withRunnerAdvisoryLock");
    expect(agentSource).toContain("withRunnerAdvisoryLock");
  });

  it("keeps agent fetch and execution concurrency bounded", () => {
    expect(agentSource.match(/\.limit\(BATCH\)/g)).toHaveLength(2);
    expect(agentSource).toContain("MAX_CONCURRENT_ADVANCE");
    expect(agentSource).toContain("pending.slice(i, i + MAX_CONCURRENT_ADVANCE)");
    expect(agentSource).toContain("if (cycleRunning) return");
    expect(agentSource).toContain("cycleRunning = false");
  });

  it("prevents workflow timer cycles from stacking beyond the batch concurrency limit", () => {
    expect(workflowSource).toContain("MAX_CONCURRENT_ADVANCE");
    expect(workflowSource).toContain("pending.slice(i, i + MAX_CONCURRENT_ADVANCE)");
    expect(workflowSource).toContain("if (cycleRunning) return");
    expect(workflowSource).toContain("cycleRunning = false");
  });

  it("preserves background role checks and cost-approval terminal states", () => {
    for (const source of [workflowSource, agentSource]) {
      expect(source).toContain(
        "resolveBackgroundProjectRole(run.userId, run.projectId",
      );
      expect(source).toContain("assertAccess: () => accessRole");
      expect(source).toContain('gen.status === "awaiting_approval"');
      expect(source).toContain('gen.status === "failed" || gen.status === "rejected"');
    }
  });
});
