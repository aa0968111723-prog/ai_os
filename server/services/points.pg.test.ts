import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { settleUsagePoints } from "./points";

const RUN_PG = Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG)("settleUsagePoints idempotency (real PostgreSQL)", () => {
  const userId = randomUUID();
  const groupId = randomUUID();
  const settleKey = `agent-plan:${randomUUID()}`;

  afterAll(async () => {
    await db.delete(schema.costLedger).where(and(
      eq(schema.costLedger.userId, userId),
      eq(schema.costLedger.groupId, groupId),
      like(schema.costLedger.reason, `%#settle:${settleKey}`),
    ));
  });

  it("refunds the over-reservation only once across concurrent retries", async () => {
    const results = await Promise.all([
      settleUsagePoints({ userId, groupId, reserved: 10, actual: 3, reason: "AI 代理規劃", settleKey }),
      settleUsagePoints({ userId, groupId, reserved: 10, actual: 3, reason: "AI 代理規劃", settleKey }),
    ]);
    expect(results).toEqual([3, 3]);
    const rows = await db.select({ delta: schema.costLedger.delta }).from(schema.costLedger).where(and(
      eq(schema.costLedger.userId, userId),
      eq(schema.costLedger.groupId, groupId),
      like(schema.costLedger.reason, `%#settle:${settleKey}`),
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delta).toBe(7);
  });
});
