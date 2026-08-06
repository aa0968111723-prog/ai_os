import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decideSplitRecovery,
  deriveEffectUuid,
  type AgentStep,
} from "./agentRunner";

const agentSource = readFileSync(new URL("./agentRunner.ts", import.meta.url), "utf8");
const databaseSource = readFileSync(new URL("./databaseCore.ts", import.meta.url), "utf8");
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
    expect(agentSource.match(/persistStepEffectId\(run, steps, step\)/g)).toHaveLength(9);
    expectBefore(
      agentSource,
      "const effectId = await persistStepEffectId(run, steps, step);",
      "id: effectId,",
    );
    expect(agentSource).toContain(
      "addDataRowValidated(table, run.userId, step.rowData ?? {}, effectId)",
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

  it("persists the scene target before generation can start", () => {
    expect(agentSource).toContain("targetSceneId?: string");
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
    // 凍結卡片 id 後才保存／建列：保存的那一份必須就是寫進 DB 的那一份
    expectBefore(directorSource, "const frozen = freezeCards(parsed.data);", "await input.onPrepared?.(frozen);");
    expectBefore(directorSource, "await input.onPrepared?.(frozen);", "const rows = await createScenes(frozen)");
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

// ── #133 PR-5：排程／任務重播與負向守門（對齊驗收情境三：Runner 重啟不重複建立） ──

const taskCoreSource = readFileSync(new URL("./taskCore.ts", import.meta.url), "utf8");

describe("schedule/task replay safety (#133 PR-5)", () => {
  it("create_schedule：固定 effectId 先查再建，重播回既有列；冪等身分不符即停", () => {
    expectBefore(
      agentSource,
      "schema.scheduleItems.id, effectId",
      "await addScheduleItemCore({",
    );
    // 重播撞到「同 id 但不同 run/step」＝跨計畫覆寫，必須 fail-closed
    expect(agentSource).toContain("行程冪等識別碼碰撞，已停止以避免跨計畫覆寫");
    expectBefore(
      agentSource,
      "schema.scheduleItems.id, effectId",
      "行程冪等識別碼碰撞",
    );
  });

  it("create_task：固定 effectId 先查再建，重播回既有列；冪等身分不符即停", () => {
    expectBefore(
      agentSource,
      "schema.projectTasks.id, effectId",
      "await addProjectTaskCore({",
    );
    expect(agentSource).toContain("任務冪等識別碼碰撞，已停止以避免跨計畫覆寫");
    expectBefore(
      agentSource,
      "schema.projectTasks.id, effectId",
      "任務冪等識別碼碰撞",
    );
  });

  it("wait_for_human 綁既有任務時同樣走固定 effectId 先查再建", () => {
    // agentRunner 內兩處 projectTasks 固定 id 建立（create_task 與 wait_for_human 衍生任務）
    expect(agentSource.match(/schema\.projectTasks\.id, effectId/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("封存專案負向：排程與任務建立核心都在寫入前擋封存", () => {
    expectBefore(scheduleSource, "assertProjectNotArchived(project)", ".insert(schema.scheduleItems)");
    expectBefore(taskCoreSource, "assertProjectNotArchived(project)", ".insert(schema.projectTasks)");
  });

  it("跨組 assignee 負向：任務負責人必須是本組成員，且在 insert 之前驗", () => {
    expect(taskCoreSource).toContain("任務負責人必須是本組成員");
    expectBefore(taskCoreSource, "await memberChecked(input.groupId, input.assigneeId);", ".insert(schema.projectTasks)");
  });
});
