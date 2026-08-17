import { describe, expect, it } from "vitest";
import { SnapshotLicenseProvider, TimeoutRightsProvider, resolveLicenseWithProviders } from "./rightsProvider";

describe("rights providers", () => {
  it("parses a public CC snapshot and never invents a license", async () => {
    const result = await new SnapshotLicenseProvider().resolveLicense({
      sourceType: "CREATIVE_COMMONS",
      sourceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      licenseText: "CC0 1.0",
    });
    expect(result.failed).toBe(false);
    expect(result.license?.licenseType).toBe("cc0");
  });

  it("14. provider timeout stays failed / UNKNOWN, not safe", async () => {
    const result = await resolveLicenseWithProviders(
      { sourceType: "STOCK_MEDIA", sourceUrl: "https://stock.example/item/1" },
      [new TimeoutRightsProvider(true)],
    );
    expect(result.failed).toBe(true);
    expect(result.license).toBeNull();
  });

  it("does not fetch login-walled stock pages", async () => {
    const result = await resolveLicenseWithProviders({
      sourceType: "STOCK_MEDIA",
      sourceUrl: "https://stock.adobe.com/item/secret",
    });
    expect(result.failed).toBe(true);
    expect(result.failureReason).toMatch(/不會抓取/);
  });
});
