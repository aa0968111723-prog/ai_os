import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { loadGroupProjectInventory, visibleProjectsWhere } from "./projectInventory";

const RUN_PG = Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("project inventory matches website list filter (real PostgreSQL)", () => {
  const groupId = randomUUID();
  const ownerId = randomUUID();
  const ids: string[] = [];

  afterAll(async () => {
    if (ids.length) await db.delete(schema.projects).where(inArray(schema.projects.id, ids));
    await db.delete(schema.users).where(eq(schema.users.id, ownerId));
  });

  it("counts 15 active + 2 archived the same way projects.list does", async () => {
    await db.insert(schema.users).values({
      id: ownerId,
      name: "inventory-qa",
      email: `inventory-${ownerId}@example.test`,
      passwordHash: "x",
    });
    for (let i = 0; i < 17; i += 1) {
      const id = randomUUID();
      ids.push(id);
      await db.insert(schema.projects).values({
        id,
        groupId,
        ownerId,
        title: i < 15 ? `Active ${i + 1}` : `Archived ${i - 14}`,
        kind: "qa",
        platform: "internal",
        format: "fixture",
        status: i < 15 ? "active" : "archived",
      });
    }

    const inventory = await loadGroupProjectInventory(groupId);
    const uiRows = await db.select({ id: schema.projects.id }).from(schema.projects).where(visibleProjectsWhere([groupId]));
    const uiAll = await db.select({ id: schema.projects.id }).from(schema.projects).where(visibleProjectsWhere([groupId], { includeArchived: true }));

    expect(inventory.activeCount).toBe(15);
    expect(inventory.archivedCount).toBe(2);
    expect(uiRows).toHaveLength(15);
    expect(uiAll).toHaveLength(17);
    expect(inventory.listedCount).toBe(15);
    expect(inventory.truncated).toBe(false);
    expect(inventory.activeCount).toBe(uiRows.length);
  });
});
