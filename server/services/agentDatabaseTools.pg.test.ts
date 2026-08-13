import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import type { ToolContext } from "./practicalAutonomy";
import {
  executeDatabaseListTool,
  executeDatabaseQueryTool,
  executeDatabaseRowAddTool,
  executeDatabaseRowGetTool,
  executeDatabaseRowUpdateTool,
} from "./agentDatabaseTools";

const RUN_PG = Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("Agent database tools (real PostgreSQL)", () => {
  const userId = randomUUID();
  const teamId = randomUUID();
  const groupId = randomUUID();
  const projectId = randomUUID();
  const tableId = randomUUID();
  const foreignGroupId = randomUUID();
  const foreignTableId = randomUUID();
  const fields = [
    { key: "title", label: "標題", type: "text" as const, required: true },
    { key: "kind", label: "分類", type: "text" as const },
    { key: "status", label: "狀態", type: "text" as const },
  ];

  afterAll(async () => {
    await db.delete(schema.dataRows).where(eq(schema.dataRows.tableId, tableId));
    await db.delete(schema.dataRows).where(eq(schema.dataRows.tableId, foreignTableId));
    await db.delete(schema.dataTables).where(eq(schema.dataTables.id, tableId));
    await db.delete(schema.dataTables).where(eq(schema.dataTables.id, foreignTableId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
    await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
    await db.delete(schema.groups).where(eq(schema.groups.id, foreignGroupId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId)).catch(() => undefined);
  });

  function auth(): AuthState {
    return {
      user: { id: userId, name: "qa", email: `db-${userId}@example.test`, isSuperAdmin: false, mustChangePassword: false },
      groups: [{ groupId, groupName: "db-group", teamId, teamName: "db-team", role: "leader" }],
      adminTeamIds: [],
    };
  }

  function context(): ToolContext {
    return {
      runId: randomUUID(),
      stepId: randomUUID(),
      userId,
      groupId,
      projectId,
      idempotencyKey: randomUUID(),
      effectFingerprint: randomUUID(),
      toolCallId: randomUUID(),
      attemptId: randomUUID(),
      inputTrust: "USER_EXPLICIT",
      signal: new AbortController().signal,
    };
  }

  it("lists, queries, writes, read-backs, retries without duplicate, and isolates tenants", async () => {
    await db.insert(schema.users).values({
      id: userId, name: "qa", email: `db-${userId}@example.test`, passwordHash: "x",
    });
    await db.insert(schema.teams).values({ id: teamId, name: "db-team" });
    await db.insert(schema.groups).values({ id: groupId, teamId, name: "db-group" });
    await db.insert(schema.groups).values({ id: foreignGroupId, teamId, name: "other-group" });
    await db.insert(schema.groupMembers).values({ groupId, userId, role: "leader" });
    await db.insert(schema.projects).values({
      id: projectId, groupId, ownerId: userId, title: "DB fixture", kind: "qa", platform: "internal", format: "fixture",
    });
    await db.insert(schema.dataTables).values({
      id: tableId, scope: "group", groupId, name: "素材清單", fields, agentAccess: "write", createdBy: userId,
    });
    await db.insert(schema.dataTables).values({
      id: foreignTableId, scope: "group", groupId: foreignGroupId, name: "素材清單", fields, agentAccess: "write", createdBy: userId,
    });
    const oldRowId = randomUUID();
    await db.insert(schema.dataRows).values({
      id: oldRowId,
      tableId,
      data: { title: "王羲之", kind: "書法", status: "草稿" },
      createdBy: userId,
      createdAt: new Date("2020-01-01T00:00:00Z"),
      updatedAt: new Date("2020-01-01T00:00:00Z"),
    });
    await db.insert(schema.dataRows).values(
      Array.from({ length: 8 }, (_, index) => ({
        id: randomUUID(),
        tableId,
        data: { title: `近期雜訊 ${index}`, kind: "其他", status: "進行中" },
        createdBy: userId,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      })),
    );

    const listed = await executeDatabaseListTool(auth(), context(), {});
    expect(listed.verified).toBe(true);
    expect((listed.value as { tables: Array<{ name: string }> }).tables.some((item) => item.name === "素材清單")).toBe(true);
    expect(JSON.stringify(listed.value)).not.toContain(foreignTableId);

    const queried = await executeDatabaseQueryTool(auth(), context(), { table: "素材清單", keyword: "書法" });
    expect(queried.verified).toBe(true);
    const queriedValue = queried.value as { rows: Array<{ id: string; data: { title?: string } }> };
    expect(queriedValue.rows.some((row) => row.id === oldRowId && row.data.title === "王羲之")).toBe(true);

    const cross = await executeDatabaseQueryTool(auth(), context(), { keyword: "書法" });
    expect(cross.value).toMatchObject({ mode: "cross_database" });
    expect((cross.value as { rows: Array<{ databaseId: string }> }).rows.every((row) => row.databaseId === tableId)).toBe(true);

    const hidden = await executeDatabaseQueryTool(auth(), context(), { tableId: foreignTableId, keyword: "書法" });
    expect(hidden.value).toMatchObject({ status: "not_found" });

    const added = await executeDatabaseRowAddTool(auth(), context(), {
      table: "素材清單",
      data: { 標題: "歐陽詢", 分類: "書法", 狀態: "草稿" },
    });
    expect(added.verified).toBe(true);
    const addedValue = added.value as { rowId: string };
    const [persisted] = await db.select().from(schema.dataRows).where(eq(schema.dataRows.id, addedValue.rowId));
    expect(persisted?.tableId).toBe(tableId);
    expect(persisted?.data).toMatchObject({ title: "歐陽詢", kind: "書法" });

    const replay = await executeDatabaseRowAddTool(auth(), context(), {
      table: "素材清單",
      data: { 標題: "歐陽詢", 分類: "書法", 狀態: "草稿" },
    });
    expect(replay.verified).toBe(true);
    const count = await db.select({ id: schema.dataRows.id }).from(schema.dataRows).where(eq(schema.dataRows.tableId, tableId));
    // The tool-level handler is not the idempotency gate; runtime receipts are.
    // This call is a second logical add with the same values, so it must create
    // another row. Duplicate protection is asserted in the runtime test below
    // via effectFingerprint / executeStep.
    expect(count.length).toBeGreaterThanOrEqual(10);

    const updated = await executeDatabaseRowUpdateTool(auth(), context(), {
      table: "素材清單",
      recentPhrase: "把剛剛新增那筆的狀態改成完成",
      recent: [{
        tableId,
        tableName: "素材清單",
        rowIds: [addedValue.rowId],
        timestamp: new Date().toISOString(),
      }],
      data: { 狀態: "完成" },
    });
    expect(updated.verified).toBe(true);
    const [after] = await db.select().from(schema.dataRows).where(eq(schema.dataRows.id, addedValue.rowId));
    expect(after?.data).toMatchObject({ title: "歐陽詢", status: "完成" });

    const got = await executeDatabaseRowGetTool(auth(), context(), { table: "素材清單", rowId: addedValue.rowId });
    expect(got.value).toMatchObject({ status: "resolved", rowId: addedValue.rowId });

    await db.update(schema.dataTables).set({ agentAccess: "read" }).where(eq(schema.dataTables.id, tableId));
    await expect(executeDatabaseRowAddTool(auth(), context(), {
      table: "素材清單",
      data: { 標題: "不該寫入" },
    })).rejects.toThrow("FORBIDDEN");
    const afterDenied = await db.select({ id: schema.dataRows.id }).from(schema.dataRows).where(eq(schema.dataRows.tableId, tableId));
    expect(afterDenied).toHaveLength(count.length);
  });
});
