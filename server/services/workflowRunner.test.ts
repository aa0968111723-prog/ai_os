import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./workflowRunner.ts", import.meta.url), "utf8");

describe("workflowRunner cost approval boundary", () => {
  it("recomputes the initiator role and passes it through Generation Command", () => {
    // TD-02：背景工作流不得直呼 submitGenerationCore 略過門檻；改走 Command + 每步重載 auth
    expect(source).toContain("resolveBackgroundProjectRole(run.userId, run.projectId");
    expect(source).toContain("executeGenerationCommand({");
    expect(source).toContain('source: "workflow"');
    expect(source).toContain("backgroundResume: true");
    expect(source).toContain("loadAuthState(run.userId)");
    expect(source).not.toContain("不帶 assertAccess");
    // 禁止退回舊的「只傳 assertAccess 給 generationCore」捷徑
    expect(source).not.toMatch(/submitGenerationCore\s*\(/);
  });

  it("waits for leader approval and handles rejection as terminal", () => {
    expect(source).toContain('gen.status === "awaiting_approval"');
    expect(source).toContain('gen.status === "failed" || gen.status === "rejected"');
    expect(source).toContain("等組長核准超額生成中");
  });
});

describe("workflowRunner sweepZombies placeholder generationId", () => {
  it("fails stale runs when advanceGeneration returns NOT_FOUND and run is past STALE_MS", () => {
    // (a′) 佔位 generationId 永遠找不到列時，不得永久卡 running
    expect(source).toContain("!gen && run.updatedAt.getTime() < cutoff");
    expect(source).toContain("await failStaleRun(run)");
    // 註解鎖死語意：不對幽靈 id 退點、視同 case (b)
    expect(source).toMatch(/佔位 generationId[\s\S]*failStaleRun/);
    expect(source).toContain("NOT_FOUND");
  });
});

