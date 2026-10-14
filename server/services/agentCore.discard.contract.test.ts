import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.join(__dirname, "agentCore.ts"), "utf8");

/**
 * 放棄（discard）語意契約。
 *
 * #721 起的公開契約（teamAssistant e2e「🔒 已開始執行的子計畫不能放棄」）：
 * 「放棄」只作用於還沒開始執行的計畫；running/waiting 要停請走 stopAgentCore。
 * #790 曾把 running 也收進 discard、轉成 stop——呼叫端拿到的訊息仍寫著
 * 「沒有花點」，而 running 的計畫點已經在花了。這份 source 契約讓
 * 「再把 discard 加寬」在單元層就先紅，不必等 e2e（team-assistant 不在
 * CI 的 e2e 矩陣裡，靠它守不住）。
 */
describe("agent discard contract", () => {
  const start = src.indexOf("export async function discardAgentCore");
  const block = src.slice(start, src.indexOf("\n}", start));

  it("discard 只收 awaiting_approval（原子 CAS，不是先查再判）", () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('allowedStatuses: ["awaiting_approval"]');
    expect(block).not.toContain('"stopped"');
  });

  it("terminal 一律 discarded——放棄不得偽裝成停止", () => {
    expect(block).toContain('terminal: "discarded"');
  });

  it("stopAgentCore 仍收 running/waiting（停止是另一個動作，不受本次收窄影響）", () => {
    const stopStart = src.indexOf("export async function stopAgentCore");
    const stopBlock = src.slice(stopStart, src.indexOf("\n}", stopStart));
    expect(stopBlock).toContain("canStopAgentRunStatus");
  });
});
