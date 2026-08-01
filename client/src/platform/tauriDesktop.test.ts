import { describe, expect, it } from "vitest";
import { normalizeHandoffStatusEvent } from "./tauriDesktop";

describe("normalizeHandoffStatusEvent", () => {
  it("parses full payload with percent", () => {
    const ev = normalizeHandoffStatusEvent({
      handoffId: "h1",
      projectId: "p1",
      sourceAssetId: "a1",
      phase: "downloading",
      message: "下載中",
      percent: 42.7,
    });
    expect(ev).toEqual({
      handoffId: "h1",
      projectId: "p1",
      sourceAssetId: "a1",
      phase: "downloading",
      message: "下載中",
      percent: 43,
    });
  });

  it("clamps percent to 0–100", () => {
    expect(normalizeHandoffStatusEvent({
      handoffId: "h",
      phase: "uploading",
      message: "x",
      percent: 150,
    })?.percent).toBe(100);
    expect(normalizeHandoffStatusEvent({
      handoffId: "h",
      phase: "uploading",
      message: "x",
      percent: -3,
    })?.percent).toBe(0);
  });

  it("returns null for incomplete payloads", () => {
    expect(normalizeHandoffStatusEvent(null)).toBeNull();
    expect(normalizeHandoffStatusEvent({ phase: "watching", message: "m" })).toBeNull();
    expect(normalizeHandoffStatusEvent({ handoffId: "h", phase: "watching" })).toBeNull();
  });

  it("maps unknown phase to watching", () => {
    const ev = normalizeHandoffStatusEvent({
      handoffId: "h",
      phase: "mystery",
      message: "still ok",
    });
    expect(ev?.phase).toBe("watching");
  });
});
