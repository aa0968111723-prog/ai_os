import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decideSplitRecovery,
  deriveEffectUuid,
  type AgentStep,
} from "./agentRunner";

const agentSource = readFileSync(new URL("./agentRunner.ts", import.meta.url), "utf8");
const databaseSource = readFileSync(new URL("./databaseCore.ts", import.meta.url), "utf8");
const approvalSource = readFileSync(new URL("../routers/approvals.ts", import.meta.url), "utf8");
const directorSource = readFileSync(new URL("../routers/director.ts", import.meta.url), "utf8");
const effectSource = readFileSync(new URL("./agentEffectCore.ts", import.meta.url), "utf8");
const notesSource = readFileSync(new URL("./notesCore.ts", import.meta.url), "utf8");
const scheduleSource = readFileSync(new URL("./scheduleCore.ts", import.meta.url), "utf8");

function expectBefore(source: string, first: string, second: string): void {
  const firstAt = source.indexOf(first);
  const secondAt = source.indexOf(second);
  expect(firstAt).toBeGreaterThanOrEqual(0);
  expect(secondAt).toBeGreaterThan(firstAt);
}

describe("agent crash-replay effect ids", () => {
  it("persists one effect id before every replayable side effect", () => {
    expect(agentSource).toContain("effectId?: string");
    expect(agentSource.match(/persistStepEffectId\(run, steps, step\)/g)).toHaveLength(8);
    expectBefore(
      agentSource,
      "const effectId = await persistStepEffectId(run, steps, step);",
      "id: effectId,",
    );
    expect(agentSource).toContain(
      "addDataRowValidated(table, run.userId, step.rowData ?? {}, effectId)",
    );
    expect(agentSource).toContain(
      "submitApprovalCore(scene.id, run.userId, () => {}, effectId)",
    );
  });

  it("uses fixed ids for creates and transaction-bound receipts for updates", () => {
    expect(agentSource).toContain("id: effectId,");
    expect(agentSource).toContain("appendNoteOnceCore({");
    expect(agentSource).toContain("updateScheduleItemOnceCore({");
    expectBefore(
      agentSource,
      "schema.notes.id, effectId",
      "await addNoteCore({",
    );
    expectBefore(
      agentSource,
      "schema.scheduleItems.id, effectId",
      "await addScheduleItemCore({",
    );
    expect(notesSource).toContain("executeAgentEffectOnce({");
    expect(scheduleSource).toContain("executeAgentEffectOnce({");
    expectBefore(effectSource, "const outputId = await apply(tx);", "tx.insert(schema.agentStepEffects)");
    expect(agentSource).toContain('addOutputRef(step, "note"');
    expect(agentSource).toContain('addOutputRef(step, "schedule"');
  });

  it("uses the persisted UUID as scene id and recognizes a committed replay", () => {
    expect(agentSource).toContain("eq(schema.scenes.id, effectId)");
    expect(agentSource).toContain("eq(schema.scenes.projectId, run.projectId)");
    const lookupAt = agentSource.indexOf("eq(schema.scenes.id, effectId)");
    const insertAt = agentSource.indexOf("await tx.insert(schema.scenes).values({", lookupAt);
    expect(lookupAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeGreaterThan(lookupAt);
    expect(agentSource.slice(insertAt, insertAt + 180)).toContain("id: effectId,");
  });

  it("persists the scene target before approval or generation can start", () => {
    expect(agentSource).toContain("targetSceneId?: string");
    expectBefore(
      agentSource,
      "step.targetSceneId = scene.id;",
      "await submitApprovalCore(scene.id, run.userId, () => {}, effectId)",
    );
    expectBefore(
      agentSource,
      "step.targetSceneId = scene.id;",
      "step.generationId = randomUUID();",
    );
  });
});

describe("split-script crash recovery", () => {
  const effectId = "b798e2f5-0be0-4a1f-aea2-c62a48205459";
  const projectId = "5d4be49b-fbf8-46f2-9df5-64f4c76296dd";
  const prepared = [{
    title: "第一幕",
    durationSec: 5,
    prompt: "清晨的窗光",
    voiceover: "新的一天開始了",
  }];

  function step(patch: Partial<AgentStep> = {}): AgentStep {
    return {
      kind: "split_script",
      note: "拆稿",
      status: "running",
      effectId,
      ...patch,
    };
  }

  it("derives stable, distinct RFC-4122-shaped scene ids", () => {
    const first = deriveEffectUuid(effectId, "split-scene", 0);
    expect(first).toBe(deriveEffectUuid(effectId, "split-scene", 0));
    expect(first).not.toBe(deriveEffectUuid(effectId, "split-scene", 1));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("covers every persisted crash point without repeating an ambiguous provider call", () => {
    const sceneId = deriveEffectUuid(effectId, "split-scene", 0);
    expect(decideSplitRecovery(step(), [], projectId)).toBe("invoke");
    expect(decideSplitRecovery(step({ splitProviderStartedAt: new Date().toISOString() }), [], projectId))
      .toBe("ambiguous");
    expect(decideSplitRecovery(step({ splitPreparedScenes: prepared }), [], projectId))
      .toBe("replay_prepared");
    expect(decideSplitRecovery(
      step({ splitPreparedScenes: prepared }),
      [{ id: sceneId, projectId }],
      projectId,
    )).toBe("committed");
    expect(decideSplitRecovery(
      step({ splitPreparedScenes: [...prepared, { ...prepared[0], title: "第二幕" }] }),
      [{ id: sceneId, projectId }],
      projectId,
    )).toBe("conflict");
    expect(decideSplitRecovery(
      step({ splitPreparedScenes: prepared }),
      [{ id: sceneId, projectId: "d9c34232-baa8-4515-a62e-2047515077af" }],
      projectId,
    )).toBe("conflict");
  });

  it("saves provider start and parsed output before the corresponding side effect", () => {
    expectBefore(directorSource, "await input.onProviderStart?.();", "const output = await nimComplete");
    expectBefore(directorSource, "await input.onPrepared?.(parsed.data);", "const rows = await createScenes(parsed.data)");
    expect(directorSource).toContain("preparedResult?.success");
    expect(directorSource).toContain("where(inArray(schema.scenes.id, targetIds))");
  });
});

describe("database row idempotency boundary", () => {
  it("checks ownership before validation/count, then preserves validation, lock and cap", () => {
    expect(databaseSource).toContain("rowId?: string");
    expect(databaseSource).toContain(
      "existing.tableId !== table.id || existing.createdBy !== userId",
    );
    expect(databaseSource).toContain("id: rowId,");
    expectBefore(
      databaseSource,
      "eq(schema.dataRows.id, rowId)",
      "validateRowData(table.fields as DataField[], rawData)",
    );
    expectBefore(
      databaseSource,
      "validateRowData(table.fields as DataField[], rawData)",
      "currentRows >= MAX_ROWS_PER_TABLE",
    );
  });
});

describe("approval idempotency boundary", () => {
  it("looks up after the per-scene lock and suppresses repeat messages and pushes", () => {
    expect(approvalSource).toContain("idempotencyApprovalId?: string");
    expectBefore(
      approvalSource,
      "pg_advisory_xact_lock(hashtext(${scene.id}), 1)",
      "eq(schema.approvals.id, idempotencyApprovalId)",
    );
    expectBefore(
      approvalSource,
      "eq(schema.approvals.id, idempotencyApprovalId)",
      "insert into approvals (id, project_id, scene_id, version, submitted_by)",
    );
    expect(approvalSource).toContain("return { approval: existing, created: false }");
    expect(approvalSource).toContain("if (result.created)");
  });
});
