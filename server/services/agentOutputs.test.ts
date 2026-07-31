import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_OUTPUT_KIND_LABEL, agentOutputKindLabel } from "../../shared/agentOutputs";

/**
 * 防漂移：agentRunner 每新增一種產出型別，畫面就得有對應的中文。
 *
 * 沒有這道檢查時，新型別會以英文原文（例如 `database_row`）直接出現在使用者眼前——
 * 這不是假設，實機驗證時就看到 `approval` 沒被翻譯。掃原始碼比維護一份手抄清單可靠：
 * 清單會忘記更新，掃描不會。
 */
describe("代理產出型別標籤與 agentRunner 同步", () => {
  const runnerSource = readFileSync(
    join(import.meta.dirname, "agentRunner.ts"),
    "utf8",
  );
  const emitted = [...runnerSource.matchAll(/addOutputRef\(\s*step\s*,\s*"([a-z_]+)"/g)]
    .map((m) => m[1]);

  it("掃得到 agentRunner 的產出型別（掃描本身要有效）", () => {
    expect(emitted.length).toBeGreaterThan(0);
    expect(new Set(emitted)).toContain("scene");
  });

  it("每一種實際發出的產出型別都有中文標籤", () => {
    const missing = [...new Set(emitted)].filter((t) => !(t in AGENT_OUTPUT_KIND_LABEL));
    expect(missing, `agentRunner 發出但 shared/agentOutputs 沒有標籤的型別：${missing.join(", ")}`).toEqual([]);
  });

  it("標籤表沒有多出 agentRunner 不會發出的型別（避免誤導維護者）", () => {
    const extra = Object.keys(AGENT_OUTPUT_KIND_LABEL).filter((t) => !emitted.includes(t));
    expect(extra, `標籤表有但 agentRunner 不會發出的型別：${extra.join(", ")}`).toEqual([]);
  });

  it("未知型別原樣回傳，不吞掉也不顯示成空白", () => {
    expect(agentOutputKindLabel("scene")).toBe("分鏡");
    expect(agentOutputKindLabel("brand_new_kind")).toBe("brand_new_kind");
  });
});
