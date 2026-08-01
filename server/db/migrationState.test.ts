import { describe, it, expect } from "vitest";
import { isReviewedLandingBackfillStatement, LEGACY_ADOPTION_PENDING_TAGS } from "./migrationState";

describe("migrationState asset-durability", () => {
  it("LEGACY list includes both 0022_device_trust and 0023_asset_durability", () => {
    expect(LEGACY_ADOPTION_PENDING_TAGS).toContain("0022_device_trust");
    expect(LEGACY_ADOPTION_PENDING_TAGS).toContain("0023_asset_durability");
  });

  it("isReviewedLandingBackfillStatement accepts the 0023 backfill", () => {
    const stmt =
      "UPDATE assets SET land_state='pending', land_next_try_at=now(), origin_url=url WHERE storage_path IS NULL AND url LIKE 'http%' AND is_ai_generated = true";
    expect(isReviewedLandingBackfillStatement(stmt)).toBe(true);
  });

  it("rejects unrelated UPDATE", () => {
    expect(isReviewedLandingBackfillStatement("UPDATE assets SET title = 'x'")).toBe(false);
  });
});
