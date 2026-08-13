import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const tray = readFileSync(join(root, "client/src/features/storyboard-center/VisualChoiceTray.tsx"), "utf8");
const stage = readFileSync(join(root, "client/src/features/storyboard-center/StoryboardStage.tsx"), "utf8");
const css = readFileSync(join(root, "client/src/styles.css"), "utf8");

describe("Visual Creative UX architecture contract", () => {
  it("uses real project sources instead of generic Character/Look/Scene/Prop presets", () => {
    expect(tray).toContain("trpc.characters.list.useQuery");
    expect(tray).toContain("trpc.characterLooks.list.useQuery");
    expect(tray).toContain("trpc.scenePresets.list.useQuery");
    expect(tray).toContain("trpc.props.list.useQuery");
    expect(tray).toContain("trpc.projects.assets.useQuery");
  });

  it("persists Style to the existing worldview truth and keeps current generation path", () => {
    expect(tray).toContain("trpc.projects.updateWorldview.useMutation");
    expect(tray).toContain("worldview: { styles: [pending.preset.label] }");
    expect(tray).not.toContain("client-side Gemini");
    expect(tray).not.toMatch(/fetch\([^)]*google/i);
  });

  it("freezes targets per operation, not as a permanent UI selection lock", () => {
    expect(tray).toContain("snapshotOperationTargets(pickedShotIds)");
    expect(tray).not.toContain("frozenIds");
    expect(tray).toContain('shot.reviewStatus !== "approved"');
  });

  it("keeps one contextual inspector beside the artwork instead of two permanent docks", () => {
    expect(stage).toContain("<VisualChoiceTray");
    expect(stage).not.toContain("<ResourceDock");
  });

  it("becomes a bottom sheet at mobile width with 44px controls and no 260px rail", () => {
    const mobile = css.slice(css.indexOf("/* ── Visual Creative UX v2"));
    expect(mobile).toContain("@media (max-width: 820px)");
    expect(mobile).toContain("position: fixed");
    expect(mobile).toContain("min-height: 44px");
    expect(mobile).not.toContain("260px");
  });

  it("bounds project asset previews and never preloads preview videos", () => {
    expect(tray).toContain(".slice(0, 24)");
    expect(tray).toContain('preload="none"');
  });
});
