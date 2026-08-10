import { describe, expect, it } from "vitest";
import {
  aspectRatioOf,
  intakePageContextSchema,
  intakeTokens,
  publicUrlIntakeCapability,
  rankSceneMatches,
  shouldBlockDuplicate,
} from "./universalIntake";

const scenes = [
  { id: "scene-1", title: "山門晨霧", orderIndex: 0, prompt: "清晨 山門 雲霧" },
  { id: "scene-2", title: "禪堂點燈", orderIndex: 1, prompt: "法師在禪堂點亮燈火" },
  { id: "scene-3", title: "城市夜景", orderIndex: 2, prompt: "雨夜 城市 車流" },
];

describe("universal intake matching", () => {
  it("gives an external generation session precedence and explains why", () => {
    const [match] = rankSceneMatches({
      scenes,
      filename: "城市夜景.mp4",
      contextSceneId: "scene-3",
      sessionSceneId: "scene-2",
    });
    expect(match).toMatchObject({ sceneId: "scene-2", score: 0.995 });
    expect(match?.reasons).toContain("外部生成工作階段指定此分鏡");
  });

  it("uses the current Shot Card as strong context without auto-applying", () => {
    const [match] = rankSceneMatches({ scenes, filename: "unrelated.png", contextSceneId: "scene-1" });
    expect(match).toMatchObject({ sceneId: "scene-1", score: 0.98 });
    expect(match?.reasons).toContain("素材從此分鏡帶入");
  });

  it("falls back to deterministic filename matching with visible evidence", () => {
    const [match] = rankSceneMatches({ scenes, filename: "禪堂點燈-final-v3.png" });
    expect(match?.sceneId).toBe("scene-2");
    expect(match?.score).toBeGreaterThanOrEqual(0.28);
    expect(match?.reasons.join(" ")).toContain("名稱／內容對上");
  });

  it("does not invent a suggestion without context or lexical evidence", () => {
    expect(rankSceneMatches({ scenes, filename: "ZXQ-991.bin" })).toEqual([]);
  });
});

describe("universal intake deterministic helpers", () => {
  it("normalizes mixed Chinese and Latin filename tokens", () => {
    expect(intakeTokens("Scene_08-禪堂點燈-FINAL.PNG")).toEqual(expect.arrayContaining(["scene", "08", "禪堂", "堂點", "點燈", "final"]));
  });

  it("validates page context and rejects unknown fields", () => {
    expect(intakePageContextSchema.safeParse({ currentWorkspace: "storyboard" }).success).toBe(true);
    expect(intakePageContextSchema.safeParse({ currentWorkspace: "storyboard", hiddenTarget: "x" }).success).toBe(false);
  });

  it("blocks exact duplicates unless the user explicitly keeps another copy", () => {
    expect(shouldBlockDuplicate({ duplicateAssetId: "asset-1" })).toBe(true);
    expect(shouldBlockDuplicate({ duplicateAssetId: "asset-1", forceDuplicate: true })).toBe(false);
    expect(shouldBlockDuplicate({ duplicateAssetId: null })).toBe(false);
  });

  it("keeps aspect ratio calculation stable", () => {
    expect(aspectRatioOf(1920, 1080)).toBe(1.7778);
    expect(aspectRatioOf(undefined, 1080)).toBeUndefined();
  });

  it("does not mistake a Google Photos share page for an original media URL", () => {
    expect(publicUrlIntakeCapability("https://photos.app.goo.gl/demo")).toEqual(expect.objectContaining({
      kind: "requires-transfer",
      provider: "google-photos",
      alternatives: ["files", "google-drive", "download-upload"],
    }));
    expect(publicUrlIntakeCapability("https://photos.google.com/share/demo").kind).toBe("requires-transfer");
    expect(publicUrlIntakeCapability("https://example.com/video.mp4")).toEqual({ kind: "direct", provider: "public-url" });
  });
});
