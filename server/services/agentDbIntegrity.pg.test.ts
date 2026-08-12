import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { runAgentDbIntegrityScan } from "./agentDbIntegrity";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const describePg = RUN_PG ? describe : describe.skip;

describePg("Agent DB integrity scanner", () => {
  const receiptId = randomUUID();

  afterAll(async () => {
    await db.delete(schema.agentToolReceipts).where(eq(schema.agentToolReceipts.id, receiptId));
  });

  it("reports an orphan/invalid receipt without persisting secret contents in the report", async () => {
    await db.insert(schema.agentToolReceipts).values({
      id: receiptId,
      runId: randomUUID(),
      idempotencyKey: `v6:forged:${randomUUID()}`,
      toolId: "test.write",
      status: "verified",
      settled: true,
      actualPoints: -1,
      targetRefs: [],
      result: { error: "AIOS_CERT_SECRET_DO_NOT_PERSIST" },
    });
    const report = await runAgentDbIntegrityScan(60);
    const codes = report.violations.filter((item) => item.entityId === receiptId).map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining([
      "RECEIPT_ORPHAN_RUN",
      "VERIFIED_RECEIPT_MISSING_EVIDENCE",
      "INVALID_RECEIPT_SETTLEMENT",
      "SECRET_CANARY_IN_RECEIPT",
    ]));
    expect(JSON.stringify(report)).not.toContain("AIOS_CERT_SECRET_DO_NOT_PERSIST");
  });
});
