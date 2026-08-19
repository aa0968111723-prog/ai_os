import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatAgentRunMessage } from "./agentRunner";

const source = readFileSync(new URL("./agentRunner.ts", import.meta.url), "utf8");

describe("agentRunner PR-4 revision-safe edit steps", () => {
  it("update_scene uses applyWithRevision and pins baseRevision", () => {
    expect(source).toContain("applyWithRevision");
    expect(source).toContain("isAgentEditStepKindsV1Enabled");
    expect(source).toContain("baseRevision");
    expect(source).toContain("editAudit");
    expect(source).toContain("formatRevisionConflictMessage");
    const update = source.slice(source.indexOf('if (step.kind === "update_scene")'), source.indexOf('if (step.kind === "record_to_database")'));
    expect(update).toContain("applyWithRevision");
    expect(update).not.toContain("db.update(schema.scenes).set(patch)");
  });

  it("create_scene / update_scene read the scene row back before marking done", () => {
    expect(source).toContain("verifySceneWriteReadBack");
    expect(source).toContain("寫入後驗證未通過，未標記完成");
    const create = source.slice(source.indexOf('if (step.kind === "create_scene")'), source.indexOf('if (step.kind === "update_scene")'));
    const update = source.slice(source.indexOf('if (step.kind === "update_scene")'), source.indexOf('if (step.kind === "record_to_database")'));
    expect(create).toContain("verifySceneWriteReadBack");
    expect(create).toContain("if (!readBack.verified)");
    expect(update).toContain("verifySceneWriteReadBack");
    expect(update).toContain("if (!readBack.verified)");
    expect(update).not.toMatch(/step\.status = "done";[\s\S]{0,80}verifySceneWriteReadBack/);
  });

  it("reorder_scenes validates exact set and order fingerprint", () => {
    expect(source).toContain("validateReorderSceneIds");
    expect(source).toContain("sceneOrderFingerprint");
    expect(source).toContain("isReorderAlreadyApplied");
  });

  it("records edit_audit observation events", () => {
    expect(source).toContain("edit_audit");
    expect(source).toContain("editAudit: step.editAudit");
    expect(source).toContain('eventType: "observation"');
  });
});

describe("agentRunner sweepZombies placeholder generationId", () => {
  it("fails stale runs when advanceGeneration returns NOT_FOUND and run is past STALE_MS", () => {
    // (a′) 佔位 generationId 永遠找不到列時，不得永久卡 running（與 workflowRunner 對齊）
    expect(source).toContain("!anyGenFound && run.updatedAt.getTime() < cutoff");
    expect(source).toContain("await failStaleRun(run)");
    // 註解鎖死語意：不對幽靈 id 退點、視同 case (b)
    expect(source).toMatch(/佔位 generationId[\s\S]*failStaleRun/);
    expect(source).toContain("NOT_FOUND");
  });
});

describe("agentRunner CA-01 generate parity (source-lock)", () => {
  it("passes characterIds / scenePresetIds / sourceAssetId / sourceUrl to executeGenerationCommand", () => {
    expect(source).toContain("characterIds: step.characterIds");
    expect(source).toContain("scenePresetIds: step.scenePresetIds");
    expect(source).toContain("resolveSceneCards(scene,");
    expect(source.match(/resolveSceneCards\(scene,/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("lookIds = step.lookIds ?? scene.lookIds");
    expect(source).toContain("shotDirection");
    expect(source.match(/shotDirection,/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("step.shotDirection ??");
    expect(source).toContain("let sourceAssetId = step.sourceAssetId");
    expect(source).toContain("resolveHonoredCharacterSheet");
    expect(source).toContain("sourceUrl: step.sourceUrl");
    expect(source).toContain("executeGenerationCommand({");
  });

  it("needs gate requires source (hasSource / model.needs) before submit", () => {
    expect(source).toContain("const hasSource = !!(step.sourceAssetId || step.sourceUrl?.trim())");
    expect(source).toContain("if (model.needs && !hasSource)");
    expect(source).toMatch(/sourceAssetRef|sourceUrl/);
  });

  it("does NOT call submitGenerationCore directly (Command path only)", () => {
    // TD-02／CA-01：代理生成走 executeGenerationCommand，禁止直呼 core 略過門檻
    expect(source).not.toMatch(/submitGenerationCore\s*\(/);
    expect(source).toContain("executeGenerationCommand({");
  });

  it("long multi-agent: parallel generate branches + in-flight settle", () => {
    expect(source).toContain("startParallelGenerateBranches");
    expect(source).toContain("MAX_PARALLEL_GEN_STARTS");
    expect(source).toContain("listInFlightGenerationSteps");
    expect(source).toContain("listRunnableDagSteps");
  });

  it("records generation outputRefs on Adopt and independent generateInto reconcile", () => {
    const start = source.indexOf("let adoptedWaiting = false");
    const block = source.slice(start, source.indexOf("使用者已按停／失敗：沒有新生成要送時收停 pending"));
    expect(block).toContain('addOutputRef(waiting, "generation"');
    const independent = source.slice(
      source.indexOf("if (step.kind === \"generate\" && sceneId && !step.generationId)"),
      source.indexOf("送出前再讀一次狀態：使用者若剛按停就不要再扣點送出"),
    );
    expect(independent).toContain('addOutputRef(next, "generation"');
  });

  it("after Adopt, re-evaluates the DAG so a waiting run can reach done", () => {
    const start = source.indexOf("let adoptedWaiting = false");
    const block = source.slice(start, source.indexOf("使用者已按停／失敗：沒有新生成要送時收停 pending"));
    expect(block).toContain("saveDagProgress");
    expect(block).not.toMatch(/if \(adoptedWaiting\) await saveRun\(run\.id, \{ steps \}\);/);
    expect(source).toContain('eq(schema.agentRuns.status, "waiting")');
    expect(source).toContain("steps.every((step) => step.status === \"done\")");
    expect(source).toContain("run.status !== \"running\" && run.status !== \"waiting\"");
    expect(source).toContain("freshNow.status !== \"running\" && freshNow.status !== \"waiting\"");
  });

  it("clears ghost generationId on INTERNAL_SERVER_ERROR and NOT_FOUND (no permanent stuck running)", () => {
    expect(source).toContain("clearGhostGenerationId");
    expect(source).toMatch(/INTERNAL_SERVER_ERROR[\s\S]*clearGhostGenerationId/);
    expect(source).toMatch(/NOT_FOUND[\s\S]*clearGhostGenerationId|生成列遺失/);
  });

  it("parallel authz failure failRun (not silent return)", () => {
    // 並行開拍路徑必須 failRun，不可 if (authzError) return
    expect(source).toMatch(/startParallelGenerateBranches[\s\S]*authzError[\s\S]*failRun/);
    expect(source).not.toMatch(/const authzError = await checkRunAuthority\(run\);\s*if \(authzError\) return;/);
  });

  it("tick continues failed runs that still have running steps (settle siblings)", () => {
    expect(source).toMatch(/status, "failed"[\s\S]*status":"running"/);
  });

  it("H1: serial generate also respects MAX_PARALLEL_GEN_STARTS", () => {
    expect(source).toMatch(
      /listInFlightGenerationSteps\(steps\)\.length >= MAX_PARALLEL_GEN_STARTS/,
    );
  });

  it("M2: failRun updates in-memory run.status to failed", () => {
    expect(source).toMatch(/run\.status = "failed"/);
    expect(source).toMatch(/run\.error = error/);
  });

  it("M3: skips parallel start when same sceneNo already in-flight", () => {
    expect(source).toContain("hasInFlightSameScene");
    expect(source).toMatch(/hasInFlightSameScene\(steps, idx, step\.sceneNo\)/);
  });

  it("M1: rechecks status after writing generationId before execute", () => {
    expect(source).toMatch(/已停止，取消送出/);
    expect(source).toMatch(/clearGhostGenerationId\(step, "已停止，取消送出"\)/);
  });

  it("B13: awaiting_approval transitions run to waiting and times out after 24h", () => {
    expect(source).toMatch(/等組長核准超額生成中/);
    expect(source).toMatch(/AWAITING_APPROVAL_MAX_MS/);
    expect(source).toMatch(/status: "waiting"/);
    expect(source).toContain('eq(schema.agentRuns.status, "waiting")');
  });
});

describe("formatAgentRunMessage（代理終局系統訊息）", () => {
  it("完成：帶勾、目標、已執行步數", () => {
    const msg = formatAgentRunMessage("把腳本拆成分鏡並逐鏡出圖", 5, 5, "done");
    expect(msg).toContain("✅");
    expect(msg).toContain("把腳本拆成分鏡並逐鏡出圖");
    expect(msg).toContain("5/5 步");
  });

  it("失敗：帶叉、錯誤原因、已完成步數（部分完成）", () => {
    const msg = formatAgentRunMessage("為每一鏡生成畫面", 2, 6, "failed", "本週額度不足");
    expect(msg).toContain("❌");
    expect(msg).toContain("本週額度不足");
    expect(msg).toContain("2/6 步");
  });

  it("失敗但沒有錯誤字串時回「未知原因」，不顯示 null/undefined", () => {
    const msg = formatAgentRunMessage("某目標", 0, 3, "failed", null);
    expect(msg).toContain("未知原因");
    expect(msg).not.toContain("null");
    expect(msg).not.toContain("undefined");
  });

  it("過長目標截斷到 40 字加省略號（系統訊息不被灌爆）", () => {
    const longGoal = "字".repeat(80);
    const msg = formatAgentRunMessage(longGoal, 1, 1, "done");
    expect(msg).toContain("…");
    // 截斷後不應包含完整 80 字
    expect(msg).not.toContain("字".repeat(80));
  });

  it("短目標不加省略號", () => {
    const msg = formatAgentRunMessage("短目標", 1, 1, "done");
    expect(msg).not.toContain("…");
  });
});
