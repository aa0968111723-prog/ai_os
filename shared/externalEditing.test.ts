import { describe, expect, it } from "vitest";
import {
  EDITING_PACKAGE_TTL_HOURS,
  LUMAFUSION_ADAPTER,
  editingManifestSchema,
  editingPackageFileName,
  stableEditingFileName,
} from "./externalEditing";

const ID = "01234567-89ab-cdef-0123-456789abcdef";

describe("External Editing Bridge contract", () => {
  it("states only verified LumaFusion capabilities", () => {
    expect(LUMAFUSION_ADAPTER.capabilities).toMatchObject({
      webShare: true,
      fileImport: true,
      externalDrive: true,
      projectPackageImport: false,
      publicDeepLink: false,
      publicProjectWriterApi: false,
    });
    expect(LUMAFUSION_ADAPTER.returnModes).toEqual(["universal-intake"]);
    expect(LUMAFUSION_ADAPTER.platforms).toContain("macos");
    expect(EDITING_PACKAGE_TTL_HOURS).toBe(24);
  });

  it("creates stable, sanitized package and media names", () => {
    expect(stableEditingFileName({ index: 0, role: "PRIMARY_MEDIA", title: "Scene 01: 海/山", extension: ".MP4" }))
      .toBe("001_PRIMARY_MEDIA_Scene_01-_海-山.mp4");
    const packageName = editingPackageFileName("百日夢島 / Final", ID);
    expect(packageName).toBe("Aios_百日夢島_Final_LumaFusion_01234567.zip");
    expect(packageName).not.toMatch(/[\\/:*?"<>|]/);
    expect(stableEditingFileName({ index: 1, role: "SUBTITLE", title: "Scene03.zh-TW.srt", extension: "srt" }))
      .toBe("002_SUBTITLE_Scene03.zh-TW.srt");
  });

  it("validates versioned manifest, lineage and exact return session", () => {
    const manifest = editingManifestSchema.parse({
      schema: "aios.external-editing-manifest",
      schemaVersion: "1.0",
      version: "1.0",
      createdAt: "2026-08-10T00:00:00.000Z",
      editor: { id: "lumafusion", name: "LumaFusion" },
      editingSessionId: ID,
      project: { id: ID, title: "百日夢島", aspectRatio: "16:9", frameRate: null, timelineDurationMs: 5_000 },
      selection: { type: "shot", storySceneIds: [ID], shotIds: [ID] },
      assets: [{
        assetId: ID,
        fileName: "001_PRIMARY_MEDIA_clip.mp4",
        relativePath: "media/001_PRIMARY_MEDIA_clip.mp4",
        kind: "video",
        role: "PRIMARY_MEDIA",
        mime: "video/mp4",
        sizeBytes: 123,
        sha256: "a".repeat(64),
        projectId: ID,
        storySceneId: ID,
        sceneId: ID,
        shotId: ID,
        sourceAssetId: null,
        durationMs: 5_000,
        version: null,
        subtitle: null,
        locked: true,
      }],
      return: { method: "universal-intake", editingSessionId: ID, acceptedKinds: ["video"] },
      notes: [],
    });
    expect(manifest.assets[0]?.role).toBe("PRIMARY_MEDIA");
    expect(manifest.return.editingSessionId).toBe(manifest.editingSessionId);
  });
});
