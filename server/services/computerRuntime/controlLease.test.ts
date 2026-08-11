import { describe, expect, it } from "vitest";
import {
  canAcceptComputerAction,
  canAcceptHumanControl,
  isComputerHumanTakeoverEnabled,
} from "../../../shared/computerRuntime";

/**
 * Lease state-machine pure checks (DB CAS covered by integration when DATABASE_URL set).
 * PR-6B acceptance: agent input frozen during human control / waiting_human.
 */
describe("control lease state machine (pure)", () => {
  it("agent cannot act while waiting or human holds control", () => {
    expect(canAcceptComputerAction("waiting_human", "none")).toBe(false);
    expect(canAcceptComputerAction("human_control", "human")).toBe(false);
    expect(canAcceptComputerAction("agent_control", "agent")).toBe(true);
  });

  it("human control accepted only in takeover states", () => {
    expect(canAcceptHumanControl("human_control", "human")).toBe(true);
    expect(canAcceptHumanControl("waiting_human", "none")).toBe(true);
    expect(canAcceptHumanControl("agent_control", "agent")).toBe(false);
    expect(canAcceptHumanControl("stopped", "none")).toBe(false);
  });

  it("takeover flag requires runtime enabled", () => {
    expect(isComputerHumanTakeoverEnabled({})).toBe(false);
    expect(isComputerHumanTakeoverEnabled({ COMPUTER_RUNTIME_ENABLED: "1" })).toBe(true);
  });
});
