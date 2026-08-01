import { describe, expect, it } from "vitest";
import { normalizeHandoffStatusEvent } from "./tauriDesktop";

describe("normalizeHandoffStatusEvent", () => {
  it("accepts a full camelCase handoff status with percent clamped", () => {
    expect(
      normalizeHandoffStatusEvent({
        handoffId: "handoff-1",
        projectId: "proj-1",
        sourceAssetId: "asset-1",
        phase: "downloading",
        message: "下載中",
        percent: 150.7,
      }),
    ).toEqual({
      handoffId: "handoff-1",
      projectId: "proj-1",
      sourceAssetId: "asset-1",
      phase: "downloading",
      message: "下載中",
      percent: 100,
    });
  });

  it("clamps negative percent to 0 and rounds", () => {
    expect(
      normalizeHandoffStatusEvent({
        handoffId: "h1",
        phase: "uploading",
        message: "上傳",
        percent: -3.2,
      }),
    ).toMatchObject({ percent: 0 });
  });

  it("omits percent when missing or non-finite", () => {
    expect(
      normalizeHandoffStatusEvent({
        handoffId: "h1",
        phase: "watching",
        message: "監看",
      }),
    ).toEqual({
      handoffId: "h1",
      projectId: undefined,
      sourceAssetId: undefined,
      phase: "watching",
      message: "監看",
      percent: undefined,
    });
    expect(
      normalizeHandoffStatusEvent({
        handoffId: "h1",
        phase: "watching",
        message: "監看",
        percent: Number.NaN,
      })?.percent,
    ).toBeUndefined();
  });

  it("maps unknown phase to watching", () => {
    expect(
      normalizeHandoffStatusEvent({
        handoffId: "h1",
        phase: "mystery",
        message: "ok",
      })?.phase,
    ).toBe("watching");
  });

  it("returns null when required fields are missing", () => {
    expect(normalizeHandoffStatusEvent(null)).toBeNull();
    expect(normalizeHandoffStatusEvent("x")).toBeNull();
    expect(normalizeHandoffStatusEvent({ phase: "watching", message: "m" })).toBeNull();
    expect(normalizeHandoffStatusEvent({ handoffId: "h", message: "m" })).toBeNull();
    expect(normalizeHandoffStatusEvent({ handoffId: "h", phase: "watching" })).toBeNull();
  });

  it("keeps all known phases", () => {
    const phases = [
      "downloading",
      "downloaded",
      "launched",
      "watching",
      "uploading",
      "uploaded",
      "error",
      "stopped",
    ] as const;
    for (const phase of phases) {
      expect(
        normalizeHandoffStatusEvent({
          handoffId: "h",
          phase,
          message: phase,
        })?.phase,
      ).toBe(phase);
    }
  });
});
