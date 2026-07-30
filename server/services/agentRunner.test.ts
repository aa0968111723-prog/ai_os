import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatAgentRunMessage } from "./agentRunner";

const source = readFileSync(new URL("./agentRunner.ts", import.meta.url), "utf8");

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
    expect(source).toContain("sourceAssetId: step.sourceAssetId");
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
