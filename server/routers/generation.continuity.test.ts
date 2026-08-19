/**
 * 這一份只斷言**原始碼層的結構性質**，不再假裝證明行為。
 *
 * 原本的第一條測試是 `expect(source).toContain("parsedSnapshot.success && parsedSnapshot.data.locked")`——
 * 那串字現在住在 `services/generationRetryInput.ts`（兩個重試入口共用的單一真相，#725 P1-4）。
 * 字串搬家之後測試立刻紅，但行為一個位元組都沒變；反過來說，保留字串卻改壞行為，
 * 這種測試會一路綠燈。所以它被移到真正的行為測試：
 *   → `server/services/generationRetryInput.test.ts`（11 項，直接餵 generation 列斷言輸出）
 *
 * 留在這裡的只有一條原始碼真的能回答的問題：**核准路徑的呼叫順序**。
 * 「重簽 → 套用參考圖 → 才送 provider」是一段**同檔案內的順序約束**，
 * 讀原始碼是合理工具（要用行為測，得起真的 provider）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("generation 核准路徑的順序約束", () => {
  const source = readFileSync(new URL("./generation.ts", import.meta.url), "utf8");

  it("重試組法只有一份：router 不再自己拼，改用共用建構函式", () => {
    // 這是結構斷言（有沒有長出第二套實作），不是行為斷言——行為由
    // services/generationRetryInput.test.ts 覆蓋。
    expect(source).toContain("buildRetryGenerationInput(gen)");
    expect(source).toContain("scheduleReconcileAfterIndependentGenerate");
    expect(source).toContain("shouldReplayIdempotentGeneration(retried.status)");
    expect(source).not.toContain("const lockedSnapshot =");
  });

  it("web generation.submit drops leftover 待你過目 on land (not only retry)", () => {
    const submit = source.slice(source.indexOf("submit: authedProcedure"), source.indexOf("ablation: authedProcedure"));
    expect(submit).toContain("scheduleReconcileAfterIndependentGenerate");
    expect(submit).toContain("shouldReplayIdempotentGeneration(generation.status)");
    expect(submit).toContain("generationId: generation.id");
    const ablation = source.slice(source.indexOf("ablation: authedProcedure"), source.indexOf("bench: authedProcedure"));
    expect(ablation).toContain("scheduleReconcileAfterIndependentGenerate");
    const bench = source.slice(source.indexOf("bench: authedProcedure"), source.indexOf("benchResult: authedProcedure"));
    expect(bench).toContain("scheduleReconcileAfterIndependentGenerate");
  });

  it("核准後送出前，鎖定的參考圖都已重簽並套用", () => {
    const approvalIdx = source.indexOf("const parsedContinuity = continuitySnapshotSchema.safeParse");
    const refreshIdx = source.indexOf("await resolveContinuityReferenceUrls(", approvalIdx);
    const applyIdx = source.indexOf("applyContinuityReferences(submitParams", refreshIdx);
    // provider 分流之後送出不再一定是 falSubmit（#725 P1-10：Gemini/NIM 走各自的 submit），
    // 所以錨點改抓分流那一行，順序約束不變。
    const submitIdx = source.indexOf("const { requestId } = isNimModel(model)", applyIdx);
    expect(approvalIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(approvalIdx);
    expect(applyIdx).toBeGreaterThan(refreshIdx);
    expect(submitIdx).toBeGreaterThan(applyIdx);
  });

  it("核准路徑依 provider 分流，不再寫死 falSubmit（#725 P1-10）", () => {
    const approvalBlock = source.slice(source.indexOf("成本審核已核准"));
    expect(approvalBlock).toContain("isNimModel(model)");
    expect(approvalBlock).toContain("isGeminiModel(model)");
  });
});
