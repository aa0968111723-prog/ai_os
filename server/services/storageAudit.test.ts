import { describe, it, expect } from "vitest";
import { isReviewedLandingBackfillStatement } from "../db/migrationState";

describe("storageAudit / landing backfill whitelist", () => {
  it("accepts the exact reviewed backfill statement from 0023", () => {
    const stmt =
      "UPDATE assets SET land_state='pending', land_next_try_at=now(), origin_url=url WHERE storage_path IS NULL AND url LIKE 'http%' AND is_ai_generated = true";
    expect(isReviewedLandingBackfillStatement(stmt)).toBe(true);
  });

  it("rejects a generic UPDATE", () => {
    expect(isReviewedLandingBackfillStatement("UPDATE assets SET name = 'x'")).toBe(false);
  });

  it("rejects DELETE / DROP", () => {
    expect(isReviewedLandingBackfillStatement("DELETE FROM assets")).toBe(false);
    expect(isReviewedLandingBackfillStatement("DROP TABLE assets")).toBe(false);
  });
});
