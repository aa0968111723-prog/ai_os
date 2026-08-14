/**
 * 變體批次的計費冪等性（真 PostgreSQL）。
 *
 * 為什麼一定要打真資料庫：這裡要證明的是「同一筆生成的預留只會在帳本上記一次」，
 * 而那道保護是交易內的 `select count(*) where generationId and delta < 0` 加上
 * per-user advisory lock——in-memory 替身測不到並行序列化，也測不到「第二次真的沒插列」。
 *
 * 稽核抓到的實際缺陷：reserveQuota 對 generationId 不冪等，但 refund 是冪等的
 *（每筆生成至多一列自動退點）。扣兩次、退一次 ⇒ 差額永久由使用者承擔。
 *
 * 閘門與其他 *.pg.test.ts 相同（RUN_PG_INTEGRATION=1 + DATABASE_URL）。
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { reserveQuota, refund } from "./points";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("變體批次計費冪等（真 PostgreSQL）", () => {
  const groupId = randomUUID();
  const projectId = randomUUID();
  const userId = randomUUID();
  const generationIds: string[] = [];

  async function makeGeneration(): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.generations).values({
      id, projectId, groupId, userId, modelId: "fal-ai/x", kind: "image", prompt: "p",
      status: "queued", pointsEst: 5,
    });
    generationIds.push(id);
    return id;
  }

  /** 這筆生成在帳本上的扣款列數與淨額 */
  async function ledgerOf(generationId: string) {
    const rows = await db
      .select({ delta: schema.costLedger.delta })
      .from(schema.costLedger)
      .where(eq(schema.costLedger.generationId, generationId));
    return {
      charges: rows.filter((r) => r.delta < 0).length,
      refunds: rows.filter((r) => r.delta > 0).length,
      net: rows.reduce((sum, r) => sum + r.delta, 0),
    };
  }

  beforeAll(async () => {
    await db.insert(schema.users).values({ id: userId, email: `u-${userId}@test.local`, name: "Bruce", passwordHash: "x" });
    await db.insert(schema.projects).values({
      id: projectId, groupId, ownerId: userId, title: "計費冪等測試", kind: "video", platform: "youtube", format: "16:9",
    });
  });

  afterAll(async () => {
    if (generationIds.length) {
      await db.delete(schema.costLedger).where(inArray(schema.costLedger.generationId, generationIds));
      await db.delete(schema.generations).where(inArray(schema.generations.id, generationIds));
    }
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("同一筆生成重複預留只扣一次（timeout 重送／成本核准補扣都走這條）", async () => {
    const genId = await makeGeneration();

    expect(await reserveQuota(userId, groupId, 5, "分鏡變體 測試", genId)).toBeNull();
    expect(await reserveQuota(userId, groupId, 5, "分鏡變體 測試（重送）", genId)).toBeNull();

    const ledger = await ledgerOf(genId);
    expect(ledger.charges).toBe(1);
    expect(ledger.net).toBe(-5);
  });

  it("並行重送同一把冪等鍵，帳本仍只有一列扣款", async () => {
    const genId = await makeGeneration();
    await Promise.all([
      reserveQuota(userId, groupId, 5, "並行 A", genId),
      reserveQuota(userId, groupId, 5, "並行 B", genId),
      reserveQuota(userId, groupId, 5, "並行 C", genId),
    ]);
    expect((await ledgerOf(genId)).charges).toBe(1);
  });

  it("扣一次退一次淨額歸零——不會出現扣兩次只退一次的差額", async () => {
    const genId = await makeGeneration();
    await reserveQuota(userId, groupId, 5, "扣款", genId);
    await reserveQuota(userId, groupId, 5, "重送", genId); // 冪等，不再扣
    await refund(userId, groupId, 5, "失敗退點", genId);

    const ledger = await ledgerOf(genId);
    expect(ledger.charges).toBe(1);
    expect(ledger.refunds).toBe(1);
    expect(ledger.net).toBe(0);
  });

  it("一批 3 個變體＝3 把不同的鍵＝3 筆各自獨立的扣款", async () => {
    const ids = await Promise.all([makeGeneration(), makeGeneration(), makeGeneration()]);
    for (const id of ids) await reserveQuota(userId, groupId, 5, "分鏡變體", id);

    for (const id of ids) expect((await ledgerOf(id)).charges).toBe(1);
    const [total] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.costLedger)
      .where(and(inArray(schema.costLedger.generationId, ids), lt(schema.costLedger.delta, 0)));
    expect(Number(total?.n)).toBe(3);
  });

  it("退點本身也冪等（重試不會退兩倍）", async () => {
    const genId = await makeGeneration();
    await reserveQuota(userId, groupId, 5, "扣款", genId);
    await refund(userId, groupId, 5, "退點", genId);
    await refund(userId, groupId, 5, "退點重試", genId);
    expect((await ledgerOf(genId)).refunds).toBe(1);
  });
});
