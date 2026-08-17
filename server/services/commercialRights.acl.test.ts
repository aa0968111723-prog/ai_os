import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { deliveryRightsVerdict } from "../../shared/commercialRights";

describe("commercial rights ACL / delivery contract", () => {
  it("19. a missing group membership is a tenancy failure, not a leaked profile", () => {
    const err = new TRPCError({ code: "FORBIDDEN", message: "你不屬於這個組" });
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).not.toMatch(/asset_rights|profile/);
  });

  it("delivery never promotes UNKNOWN to CLEAR", () => {
    const verdict = deliveryRightsVerdict({
      usageContext: "client_delivery",
      counts: { CLEAR: 0, CONDITIONAL: 0, REVIEW_REQUIRED: 0, BLOCKED: 0, UNKNOWN: 4 },
    });
    expect(verdict.blocked).toBe(true);
  });
});
