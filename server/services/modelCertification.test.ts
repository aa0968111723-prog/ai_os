import { describe, expect, it } from "vitest";
import { certificationTargets } from "./modelCertification";

describe("certificationTargets", () => {
  it("展開 fal 模型 id（id 即 endpoint，唯一）", () => {
    const targets = certificationTargets(["fal-ai/wan/v2.7/text-to-video"]);
    expect(targets).toContain("fal-ai/wan/v2.7/text-to-video");
  });

  it("OpenRouter LLM 只加該 id、絕不加共用 endpoint openrouter/router", () => {
    const targets = certificationTargets(["openrouter/router#deepseek-v4-flash"]);
    expect(targets).toContain("openrouter/router#deepseek-v4-flash");
    expect(targets).not.toContain("openrouter/router");
  });

  it("nvidia-nim 只加該 id、絕不加共用 endpoint nvidia-nim", () => {
    const targets = certificationTargets(["nvidia-nim#deepseek-r1"]);
    expect(targets).toContain("nvidia-nim#deepseek-r1");
    expect(targets).not.toContain("nvidia-nim");
  });

  it("靜態表找不到的 id 至少帶 id（沒命中 catalog row 時認證即 no-op）", () => {
    expect(certificationTargets(["openrouter/router#nonexistent-model"])).toEqual([
      "openrouter/router#nonexistent-model",
    ]);
  });
});
