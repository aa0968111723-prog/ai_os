import { describe, expect, it } from "vitest";
import { assistantInteractionLifecycleSchema, assistantInteractionRequestSchema, assistantInteractionSubmissionSchema, interactionPickerMode } from "./assistantInteractions";

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
});
