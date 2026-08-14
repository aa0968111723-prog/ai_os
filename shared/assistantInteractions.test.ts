import { describe, expect, it } from "vitest";
import { assistantInteractionLifecycleSchema, assistantInteractionRequestSchema, assistantInteractionSubmissionSchema, expireAssistantInteraction, interactionIsWaiting, interactionPickerMode, isAssistantInteractionExpired } from "./assistantInteractions";

describe("Assistant interaction contract", () => {
  const request = {
    interactionId: "11111111-1111-4111-8111-111111111111",
    runId: "run-1",
    goalId: "22222222-2222-4222-8222-222222222222",
    type: "DRIVE_PICKER",
    title: "選擇 Drive 檔案",
    required: true,
    resumeToken: "33333333-3333-4333-8333-333333333333",
    expiresAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-08-12T00:00:00.000Z",
  };

  it("binds every picker to run, goal, interaction and one-time token", () => {
    expect(assistantInteractionRequestSchema.parse(request)).toMatchObject({ runId: "run-1", type: "DRIVE_PICKER", status: "pending" });
    expect(interactionPickerMode("DRIVE_PICKER")).toBe("drive");
  });

  it("rejects an unbound callback without a selection or import refs", () => {
    expect(assistantInteractionSubmissionSchema.safeParse({
      groupId: request.goalId,
      conversationId: request.interactionId,
      runId: request.runId,
      goalId: request.goalId,
      interactionId: request.interactionId,
      resumeToken: request.resumeToken,
    }).success).toBe(false);
  });

  it("binds non-consuming UI lifecycle events to the same callback identity", () => {
    expect(assistantInteractionLifecycleSchema.safeParse({
      groupId: request.goalId,
      conversationId: request.interactionId,
      runId: request.runId,
      goalId: request.goalId,
      interactionId: request.interactionId,
      resumeToken: request.resumeToken,
      event: "cancelled",
    }).success).toBe(true);
  });

  it("expires a pending handoff after expiresAt so reopen cannot stay waiting forever", () => {
    const pending = assistantInteractionRequestSchema.parse({ ...request, status: "pending" });
    expect(isAssistantInteractionExpired(pending, Date.parse("2026-09-01T00:00:01.000Z"))).toBe(true);
    expect(isAssistantInteractionExpired(pending, Date.parse("2026-08-31T23:59:59.000Z"))).toBe(false);
    expect(interactionIsWaiting(pending, Date.parse("2026-09-01T00:00:01.000Z"))).toBe(false);
    expect(interactionIsWaiting(pending, Date.parse("2026-08-31T23:59:59.000Z"))).toBe(true);
    expect(expireAssistantInteraction(pending, Date.parse("2026-09-01T00:00:01.000Z")).status).toBe("expired");
    expect(expireAssistantInteraction({ ...pending, status: "cancelled" }, Date.parse("2026-09-01T00:00:01.000Z")).status).toBe("cancelled");
  });
});
