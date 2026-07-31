import { describe, expect, it } from "vitest";
import { prettyGpuName } from "./deviceHint";

/**
 * 顯示卡字串整理。測資皆為各平台實際回傳的原文
 * （第一筆是本機 Chrome 實測抓到的，早期正則會把它切成「Intel(R」）。
 */
describe("prettyGpuName", () => {
  // ★迴歸測試：型號本身含括號，早期用 `[^,]+?` + `(?:,|\))` 會在 "Intel(R" 的
  //   那個右括號提早收尾，畫面顯示「Intel(R」——由實機資料抓到
  it("型號含括號時不會被提早切斷", () => {
    expect(
      prettyGpuName("ANGLE (Intel, Intel(R) UHD Graphics (0x00009A60) Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ).toBe("Intel(R) UHD Graphics");
  });

  it("取出 NVIDIA 顯示卡型號並去掉驅動雜訊", () => {
    expect(
      prettyGpuName("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ).toBe("NVIDIA GeForce RTX 4070");
  });

  it("取出 AMD 顯示卡型號", () => {
    expect(
      prettyGpuName("ANGLE (AMD, AMD Radeon RX 7900 XT Direct3D11 vs_5_0 ps_5_0, D3D11)"),
    ).toBe("AMD Radeon RX 7900 XT");
  });

  it("Apple 的 Metal 後端", () => {
    expect(prettyGpuName("ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)"))
      .toBe("ANGLE Metal Renderer: Apple M2 Pro");
  });

  it("非 ANGLE 包裝的原始字串原樣清理", () => {
    expect(prettyGpuName("Apple GPU")).toBe("Apple GPU");
    expect(prettyGpuName("Mali-G78 MP14 OpenGL ES 3.2")).toBe("Mali-G78 MP14");
  });

  it("過長字串截斷，不讓畫面被灌爆", () => {
    expect(prettyGpuName("x".repeat(200)).length).toBe(80);
  });
});
