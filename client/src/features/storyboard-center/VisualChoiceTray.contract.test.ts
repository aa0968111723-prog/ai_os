/**
 * ⚠️ 這一份是**結構**斷言（有沒有長出第二套 selection store／第二條生成管線／
 * 第二個 dock），不是行為證明。#725 P2 點名 v3 的兩支 contract test 是讀原始碼字串。
 *
 * 這一區真正的行為由這些覆蓋：
 *   → client/src/features/storyboard-center/visualCreativeState.test.ts（Mixed State 分群鍵）
 *   → client/src/features/storyboard-center/visualCreativeSemantics.test.ts（語意與孤兒 Look）
 *   → client/src/components/SceneStudio.test.tsx（跨鏡隔離、方向送出、Compare）
 *   → server/services/creativeVariantPointer.pg.test.ts（指標與併發，真 PostgreSQL）
 *   → scripts/e2e-ui/creative-golden-flows.mjs（瀏覽器 FLOW A–E）
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const tray = readFileSync(join(root, "client/src/features/storyboard-center/VisualChoiceTray.tsx"), "utf8");
const stage = readFileSync(join(root, "client/src/features/storyboard-center/StoryboardStage.tsx"), "utf8");
const css = readFileSync(join(root, "client/src/styles.css"), "utf8");

describe("Visual Creative UX 的結構約束（行為見上方檔案清單）", () => {
  it("uses real project sources instead of generic Character/Look/Scene/Prop presets", () => {
    expect(tray).toContain("trpc.characters.list.useQuery");
    expect(tray).toContain("trpc.characterLooks.list.useQuery");
    expect(tray).toContain("trpc.scenePresets.list.useQuery");
    expect(tray).toContain("trpc.props.list.useQuery");
    expect(tray).toContain("trpc.projects.assets.useQuery");
  });

  it("persists Style to the existing worldview truth and keeps current generation path", () => {
    expect(tray).toContain("trpc.projects.updateWorldview.useMutation");
    expect(tray).toContain("selectWorldviewStyle(worldview.styles, pending.preset.label)");
    expect(tray).toContain("worldview: { styles }");
    expect(tray).not.toContain("client-side Gemini");
    expect(tray).not.toMatch(/fetch\([^)]*google/i);
  });

  it("projects mixed state and communicates add/remove/replace before applying", () => {
    expect(tray).toContain("buildMixedCreativeState");
    expect(tray).toContain("projectChoiceChange");
    expect(tray).toContain("pendingOperation");
    expect(tray).not.toContain("appendBoundId");
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
