import { describe, expect, it } from "vitest";
import {
  capabilityUsableForAutonomousWrite,
  formatCapabilityMaturityReport,
  listCapabilityMaturity,
} from "./assistantCapabilityMaturity";

describe("assistantCapabilityMaturity", () => {
  it("lists every registered capability with a maturity level", () => {
    const records = listCapabilityMaturity();
    expect(records.length).toBeGreaterThan(10);
    expect(records.every((record) => record.capabilityId && record.level)).toBe(true);
  });

  it("never treats mock browser as autonomous live write", () => {
    expect(capabilityUsableForAutonomousWrite("open_browser_runtime")).toBe(false);
  });

  it("allows attach_asset_to_shot after verified staging path", () => {
    expect(capabilityUsableForAutonomousWrite("attach_asset_to_shot")).toBe(true);
  });

  it("formats a readable report", () => {
    const text = formatCapabilityMaturityReport();
    expect(text).toContain("[MOCK_VERIFIED] open_browser_runtime");
    expect(text).toContain("attach_asset_to_shot");
  });
});
