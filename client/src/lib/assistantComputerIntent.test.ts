import { describe, expect, it } from "vitest";
import { classifyAssistantComputerIntent, formatComputerCapabilityAnswer, isRealBrowserReady } from "./assistantComputerIntent";

describe("assistant computer intent", () => {
  it("辨識能力詢問，不把『你可以用瀏覽器嗎』當成已執行", () => {
    expect(classifyAssistantComputerIntent("你可以用瀏覽器嗎？")).toBe("capability");
  });

  it("辨識明確操作要求", () => {
    expect(classifyAssistantComputerIntent("幫我開啟瀏覽器")).toBe("operate");
  });

  it("mock provider 永遠不宣稱能真實瀏覽外網", () => {
    const status = { enabled: true, browserEnabled: true, browserProvider: "mock", liveExternalWebEnabled: false };
    expect(isRealBrowserReady(status)).toBe(false);
    expect(formatComputerCapabilityAnswer(status)).toContain("mock");
    expect(formatComputerCapabilityAnswer(status)).toContain("尚不能");
  });

  it("只有 server 明確回報 real external web ready 才允許建立工作階段", () => {
    expect(isRealBrowserReady({ enabled: true, browserEnabled: true, browserProvider: "browserbase", liveExternalWebEnabled: true })).toBe(true);
  });
});
