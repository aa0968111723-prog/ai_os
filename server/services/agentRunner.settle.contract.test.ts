import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.join(__dirname, "agentRunner.ts"), "utf8");

/**
 * settleGeneration 的完成語意契約。
 *
 * 守的是一個曾經真實發生的死鎖（#790 → e2e-agent／e2e-databases 全紅）：
 * 代理自己送出的 scene-bound 視覺生成一律帶 preserveScenePointer（#753），
 * 指標永遠不會自動指到它；若 settle 又以「指標指到我」當完成條件，
 * 任何含 generate 的計畫都永遠到不了終局——run 卡 waiting、下游步驟
 * （record_to_database 等）永不執行、per-user 併發鎖永不釋放。
 *
 * 行為級的覆蓋在 e2e-agent（背景 Runner 完成完整代理計畫）與 e2e-databases
 * （AI 代理把成果寫進資料庫）；這份 source 契約讓「把 park 加回去」在
 * 單元測試層就先紅，不必等 e2e。
 */
describe("agent settleGeneration completion contract", () => {
  const start = src.indexOf("async function settleGeneration");
  const block = src.slice(start, src.indexOf("\n}", start));

  it("done 生成完成步驟，不 park 等人採用（那會與 preserveScenePointer 互相死鎖）", () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).not.toContain('step.status = "waiting"');
    expect(block).toContain('step.status = "done"');
  });

  it("未採用的成品誠實標成候選，不謊稱畫面已換", () => {
    expect(block).toContain("已存為候選");
    expect(block).toContain("scenePointerIsGeneration");
  });

  it("人搶先生成、代理讓路的 park 仍在（另一條路，防重複扣點）", () => {
    // applyIndependentGenerateToSteps 的 waiting 是刻意的，不得被這次修復順手移除
    expect(src).toContain("applyIndependentGenerateToSteps");
  });
});
