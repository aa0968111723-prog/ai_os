import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../db";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const describePg = RUN_PG ? describe : describe.skip;

describePg("Agent PostgreSQL query plans and pool pressure", () => {
  afterAll(async () => {
    while (pool.waitingCount > 0) await new Promise((resolve) => setTimeout(resolve, 5));
  });

  it.each([
    ["run receipt lookup", "select id from agent_tool_receipts where run_id = $1", "agent_tool_receipts_run_idx"],
    ["tenant receipt listing", "select id from agent_tool_receipts where group_id = $1 limit 20", "agent_tool_receipts_group_run_idx"],
    ["lease reconciliation", "select id from agent_tool_receipts where status = $1 and lease_expires_at < now()", "agent_tool_receipts_lease_idx"],
    ["group recent run", "select id from agent_runs where group_id = $1 order by updated_at desc limit 20", "agent_runs_group_updated_idx"],
  ])("uses the certified index for %s", async (_label, query, expectedIndex) => {
    const client = await pool.connect();
    try {
      await client.query("begin"); await client.query("set local enable_seqscan = off");
      const params = query.includes("status = $1") ? ["executing"] : [randomUUID()];
      const result = await client.query(`explain (format json) ${query}`, params);
      expect(JSON.stringify(result.rows[0]["QUERY PLAN"])).toContain(expectedIndex);
      await client.query("rollback");
    } finally { client.release(); }
  });

  it("drains bounded concurrent Agent reads without leaking pool waiters", async () => {
    const durations: number[] = [];
    await Promise.all(Array.from({ length: 80 }, async () => {
      const started = performance.now();
      await pool.query("select pg_sleep(0.003), count(*) from agent_tool_receipts where run_id = $1", [randomUUID()]);
      durations.push(performance.now() - started);
    }));
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)]!;
    expect(pool.waitingCount).toBe(0); expect(pool.idleCount).toBeGreaterThan(0); expect(p95).toBeLessThan(2_000);
  });
});
