import { describe, expect, it } from "vitest";
import { SCENARIO_PLAYBOOK, scenarioPlaybookText } from "./scenarioPlaybook";
import { getModel } from "./models";

describe("scenarioPlaybook", () => {
  // 手冊裡的 modelIds 必須全部在目錄——否則助手會推薦一顆不存在的模型(提議按鈕註定失敗)
  it("所有 modelIds 都在模型目錄", () => {
    const missing = SCENARIO_PLAYBOOK.flatMap((s) => s.modelIds.filter((id) => !getModel(id)));
    expect(missing).toEqual([]);
  });

  it("情境 id 不重複且滿 20 條", () => {
    const ids = SCENARIO_PLAYBOOK.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SCENARIO_PLAYBOOK.length).toBe(20);
  });

  it("濃縮文字版包含每條情境與心法,尺寸收斂", () => {
    const text = scenarioPlaybookText();
    for (const s of SCENARIO_PLAYBOOK) expect(text).toContain(s.title);
    expect(text).toContain("【心法】");
    // 提示詞預算守門:手冊爆長會吃掉知識庫上下文(粗略上限 6KB)
    expect(text.length).toBeLessThan(6000);
  });
});
