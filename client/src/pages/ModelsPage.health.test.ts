/**
 * 模型指南健康標籤／排序純邏輯（不渲染 React）。
 * 與 ModelsPage 內 HEALTH_META / wizScore 契約對齊。
 */
import { describe, expect, it } from "vitest";
import { getModel, type ModelEntry } from "@shared/models";

/** 複製 ModelsPage 的 wizScore 權重（測回歸） */
function wizScore(
  m: ModelEntry,
  source: "" | "yes" | "no",
  health: string | null | undefined,
): number {
  let s = (m.verified ? 10 : 0) + (m.recommended ? 2 : 0) + (source === "yes" && m.needs ? 1 : 0);
  if (health === "live_ok") s += 8;
  if (health === "openapi_404") s -= 30;
  if (health === "live_fail") s -= 5;
  return s;
}

describe("ModelsPage health scoring", () => {
  it("boosts live_ok over never_probed for same model base score", () => {
    const m = getModel("fal-ai/flux/dev") ?? getModel("fal-ai/ltx-video");
    expect(m).toBeTruthy();
    const a = wizScore(m!, "no", "live_ok");
    const b = wizScore(m!, "no", "never_probed");
    expect(a).toBeGreaterThan(b);
  });

  it("sinks openapi_404 below normal", () => {
    const m = getModel("fal-ai/flux/dev") ?? getModel("fal-ai/ltx-video");
    expect(m).toBeTruthy();
    expect(wizScore(m!, "no", "openapi_404")).toBeLessThan(wizScore(m!, "no", null));
  });
});
