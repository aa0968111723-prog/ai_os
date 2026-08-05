import { describe, expect, it } from "vitest";
import { assetMaintenanceEnabled } from "./assetMaintenance";

describe("assetMaintenance", () => {
  it("assetMaintenanceEnabled defaults on", () => {
    const prev = process.env.BG_ASSET_MAINT;
    delete process.env.BG_ASSET_MAINT;
    expect(assetMaintenanceEnabled()).toBe(true);
    process.env.BG_ASSET_MAINT = "0";
    expect(assetMaintenanceEnabled()).toBe(false);
    process.env.BG_ASSET_MAINT = "false";
    expect(assetMaintenanceEnabled()).toBe(false);
    process.env.BG_ASSET_MAINT = "off";
    expect(assetMaintenanceEnabled()).toBe(false);
    process.env.BG_ASSET_MAINT = "1";
    expect(assetMaintenanceEnabled()).toBe(true);
    if (prev === undefined) delete process.env.BG_ASSET_MAINT;
    else process.env.BG_ASSET_MAINT = prev;
  });
});
