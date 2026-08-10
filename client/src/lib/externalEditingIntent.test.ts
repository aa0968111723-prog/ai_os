import { describe, expect, it } from "vitest";
import { detectEditingHandoffRequest } from "./externalEditingIntent";

describe("detectEditingHandoffRequest", () => {
  it.each([
    "把這個 Scene 交給 LumaFusion 剪輯",
    "請準備外部編輯交接",
    "Open a Luma Fusion editing handoff",
  ])("opens the handoff flow for an explicit editing request: %s", (message) => {
    expect(detectEditingHandoffRequest(message)).toBe(true);
  });

  it.each([
    "LumaFusion 是什麼？",
    "請幫我看看這一版還缺什麼",
    "建立新的專案",
  ])("does not hijack unrelated Assistant requests: %s", (message) => {
    expect(detectEditingHandoffRequest(message)).toBe(false);
  });
});
