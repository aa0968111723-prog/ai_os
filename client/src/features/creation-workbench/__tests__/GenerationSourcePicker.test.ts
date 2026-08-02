import { describe, expect, it } from "vitest";
import { fileMatchesSource, sourceAccept, sourceKindLabel } from "../GenerationSourcePicker";

describe("GenerationSourcePicker source contract", () => {
  it("offers a real local file chooser for every model source kind", () => {
    expect(sourceAccept("image")).toContain("image/*");
    expect(sourceAccept("video")).toContain("video/*");
    expect(sourceAccept("audio")).toContain("audio/*");
    expect(sourceAccept("zip")).toContain(".zip");
    expect(sourceAccept("zip")).toContain(".safetensors");
  });

  it("accepts the media each Fal source kind can actually consume", () => {
    expect(fileMatchesSource({ name: "frame.png", type: "image/png" }, "image")).toBe(true);
    expect(fileMatchesSource({ name: "clip.mp4", type: "video/mp4" }, "video")).toBe(true);
    expect(fileMatchesSource({ name: "voice.wav", type: "audio/wav" }, "audio")).toBe(true);
    // Speech-to-text endpoints can extract the audio track from a video container.
    expect(fileMatchesSource({ name: "interview.mp4", type: "video/mp4" }, "audio")).toBe(true);
    expect(fileMatchesSource({ name: "training.zip", type: "application/zip" }, "zip")).toBe(true);
    expect(fileMatchesSource({ name: "style.safetensors", type: "application/octet-stream" }, "zip")).toBe(true);
  });

  it("rejects mismatched local files before uploading", () => {
    expect(fileMatchesSource({ name: "voice.mp3", type: "audio/mpeg" }, "image")).toBe(false);
    expect(fileMatchesSource({ name: "photo.jpg", type: "image/jpeg" }, "video")).toBe(false);
    expect(fileMatchesSource({ name: "notes.pdf", type: "application/pdf" }, "zip")).toBe(false);
    expect(sourceKindLabel("zip")).toContain("LoRA");
  });
});
