import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAiosDeepLink,
  detectDesktopEditors,
  editorKindForAsset,
  hasDesktopBridge,
  hasDesktopFolderImport,
  materializeEditingPackage,
  normalizeAiosInternalPath,
  openAssetInExternalEditor,
  parseAiosDeepLink,
  pickDesktopImportFolder,
  revealAssetInFolder,
  sanitizeDesktopScan,
  scanDesktopImportFolder,
  stopDesktopHandoff,
  suggestedFileName,
} from "./desktopBridge";

describe("Aios desktop deep links", () => {
  it("builds and parses safe project routes", () => {
    const link = buildAiosDeepLink("/p/01234567-89ab-cdef-0123-456789abcdef?tab=workbench#result");
    expect(link).toBe(
      "aios://open?path=%2Fp%2F01234567-89ab-cdef-0123-456789abcdef%3Ftab%3Dworkbench%23result",
    );
    expect(parseAiosDeepLink(link)).toBe("/p/01234567-89ab-cdef-0123-456789abcdef?tab=workbench#result");
  });

  it.each(["/dashboard", "/desktop", "/planner", "/databases"])("accepts supported app route: %s", (path) => {
    expect(parseAiosDeepLink(buildAiosDeepLink(path))).toBe(path);
  });

  it.each([
    "https://evil.example/p/01234567-89ab-cdef-0123-456789abcdef",
    "//evil.example/path",
    "/admin",
    "/p/x",
    "/unknown",
    "/chat/../../admin",
  ])("rejects unsafe or unsupported internal path: %s", (path) => {
    expect(normalizeAiosInternalPath(path)).toBeNull();
  });

  it.each([
    "https://ai-os-app.zeabur.app/p/01234567-89ab-cdef-0123-456789abcdef",
    "aios://evil?path=%2Fplanner",
    "aios://open?path=https%3A%2F%2Fevil.example",
    "aios://open?path=%2Fadmin",
  ])("rejects invalid deep link: %s", (link) => {
    expect(parseAiosDeepLink(link)).toBeNull();
  });
});

describe("editorKindForAsset / suggestedFileName", () => {
  it.each([
    ["video", "video-editor"],
    ["audio", "audio-editor"],
    ["image", "image-editor"],
    ["doc", "system-default"],
    ["other", "system-default"],
  ] as const)("maps kind %s → %s", (kind, editorKind) => {
    expect(editorKindForAsset(kind)).toBe(editorKind);
  });

  it("prefers meta.originalName, then titled extension, then mime-derived name", () => {
    expect(suggestedFileName({ title: "clip", mime: "video/mp4", meta: { originalName: "scene-01.mp4" } }))
      .toBe("scene-01.mp4");
    expect(suggestedFileName({ title: "already.mov", mime: "video/quicktime", meta: {} }))
      .toBe("already.mov");
    expect(suggestedFileName({ title: "voice", mime: "audio/mpeg", meta: null }))
      .toBe("voice.mp3");
    expect(suggestedFileName({ title: "shot", mime: "video/quicktime" }))
      .toBe("shot.mov");
    expect(suggestedFileName({ title: "note", mime: null }))
      .toBe("note.bin");
  });
});

describe("desktop asset handoff", () => {
  afterEach(() => {
    delete window.__AIOS_DESKTOP__;
    vi.restoreAllMocks();
  });

  it("returns a clear web fallback when no desktop bridge exists", async () => {
    expect(hasDesktopBridge()).toBe(false);
    await expect(openAssetInExternalEditor({
      assetId: "01234567-89ab-cdef-0123-456789abcdef",
      editorKind: "video-editor",
      returnPath: "/p/01234567-89ab-cdef-0123-456789abcdef",
    })).resolves.toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("never forwards invalid local path or executable-like input", async () => {
    const openAsset = vi.fn();
    window.__AIOS_DESKTOP__ = { version: 1, openAsset, revealAsset: vi.fn() };
    const result = await openAssetInExternalEditor({
      assetId: "../../etc/passwd",
      editorKind: "system-default",
      suggestedName: "clip.mp4",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid-request" });
    expect(openAsset).not.toHaveBeenCalled();
  });

  it("rejects an editor id that is not an allowlist-style identifier", async () => {
    const openAsset = vi.fn();
    window.__AIOS_DESKTOP__ = { version: 1, openAsset, revealAsset: vi.fn() };
    const result = await openAssetInExternalEditor({
      assetId: "01234567-89ab-cdef-0123-456789abcdef",
      editorKind: "video-editor",
      editorId: "../../Premiere.exe",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid-request" });
    expect(openAsset).not.toHaveBeenCalled();
  });

  it("passes only validated asset metadata to the injected desktop bridge", async () => {
    const openAsset = vi.fn().mockResolvedValue({ ok: true, handoffId: "handoff-1" });
    window.__AIOS_DESKTOP__ = { version: 1, openAsset, revealAsset: vi.fn() };
    const request = {
      assetId: "01234567-89ab-cdef-0123-456789abcdef",
      projectId: "fedcba98-7654-3210-fedc-ba9876543210",
      editorKind: "video-editor" as const,
      editorId: "davinci-resolve",
      suggestedName: "scene-01.mp4",
      returnPath: "/p/fedcba98-7654-3210-fedc-ba9876543210?tab=assets",
    };
    await expect(openAssetInExternalEditor(request)).resolves.toEqual({ ok: true, handoffId: "handoff-1" });
    expect(openAsset).toHaveBeenCalledWith(request);
  });

  it("keeps only valid, installed, unique editor descriptors", async () => {
    window.__AIOS_DESKTOP__ = {
      version: 1,
      openAsset: vi.fn(),
      revealAsset: vi.fn(),
      detectEditors: vi.fn().mockResolvedValue([
        { id: "davinci-resolve", name: "DaVinci Resolve", kind: "video-editor", installed: true },
        { id: "davinci-resolve", name: "Duplicate", kind: "video-editor", installed: true },
        { id: "not-installed", name: "Missing", kind: "video-editor", installed: false },
        { id: "../../cmd", name: "Unsafe", kind: "video-editor", installed: true },
        { id: "photoshop", name: "Photoshop", kind: "unknown", installed: true },
      ]),
    };
    await expect(detectDesktopEditors()).resolves.toEqual([
      { id: "davinci-resolve", name: "DaVinci Resolve", kind: "video-editor", installed: true },
    ]);
  });

  it("supports reveal-in-folder only through the desktop bridge", async () => {
    await expect(revealAssetInFolder({
      assetId: "01234567-89ab-cdef-0123-456789abcdef",
    })).resolves.toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("materializes only a validated server package id, session id and ZIP name", async () => {
    const nativeMaterialize = vi.fn().mockResolvedValue({ ok: true, localName: "Aios_Project.zip" });
    window.__AIOS_DESKTOP__ = {
      version: 1,
      openAsset: vi.fn(),
      revealAsset: vi.fn(),
      materializeEditingPackage: nativeMaterialize,
    };
    const request = {
      packageId: "01234567-89ab-cdef-0123-456789abcdef",
      editingSessionId: "fedcba98-7654-3210-fedc-ba9876543210",
      fileName: "Aios_Project.zip",
    };
    await expect(materializeEditingPackage(request)).resolves.toMatchObject({ ok: true });
    expect(nativeMaterialize).toHaveBeenCalledWith(request);

    await expect(materializeEditingPackage({ ...request, fileName: "../unsafe.zip" }))
      .resolves.toMatchObject({ ok: false, reason: "invalid-request" });
    expect(nativeMaterialize).toHaveBeenCalledTimes(1);
  });

  it("stops an active watcher only with a valid handoff id", async () => {
    const stopHandoff = vi.fn().mockResolvedValue({ ok: true, handoffId: "12345678-89ab-cdef-0123-456789abcdef" });
    window.__AIOS_DESKTOP__ = {
      version: 1,
      openAsset: vi.fn(),
      revealAsset: vi.fn(),
      stopHandoff,
    };
    await expect(stopDesktopHandoff("../bad")).resolves.toMatchObject({ ok: false, reason: "invalid-request" });
    expect(stopHandoff).not.toHaveBeenCalled();
    await expect(stopDesktopHandoff("12345678-89ab-cdef-0123-456789abcdef")).resolves.toMatchObject({ ok: true });
    expect(stopHandoff).toHaveBeenCalledWith("12345678-89ab-cdef-0123-456789abcdef");
  });
  /* ── 桌面資料夾匯入：本機絕對路徑不得外流（§11） ── */

  it("★ 掃描結果裡的本機絕對路徑一律丟掉，且算進 skipped 而不是靜默消失", () => {
    const sanitized = sanitizeDesktopScan({
      rootId: "12345678-89ab-4def-8123-456789abcdef",
      displayName: "北藝專案",
      entries: [
        { relativePath: "北藝專案/人物/IMG001.jpg", filename: "IMG001.jpg", parentPath: "北藝專案/人物", size: 10, lastModified: null, mime: null },
        { relativePath: "C:\\Users\\Bruce\\IMG002.jpg", filename: "IMG002.jpg", parentPath: "", size: 10, lastModified: null, mime: null },
        { relativePath: "/Users/bruce/IMG003.jpg", filename: "IMG003.jpg", parentPath: "", size: 10, lastModified: null, mime: null },
        { relativePath: "北藝專案/../../etc/passwd", filename: "passwd", parentPath: "", size: 10, lastModified: null, mime: null },
      ],
      skipped: [],
      totalBytes: 40,
      truncated: false,
    });
    expect(sanitized.entries.map((entry) => entry.relativePath)).toEqual(["北藝專案/人物/IMG001.jpg"]);
    expect(sanitized.skipped.some((item) => item.reason.startsWith("dropped_unsafe_paths"))).toBe(true);
  });

  it("沒有桌面版時，資料夾能力一律回 unsupported，不假裝可以", async () => {
    delete window.__AIOS_DESKTOP__;
    expect(hasDesktopFolderImport()).toBe(false);
    await expect(pickDesktopImportFolder()).resolves.toMatchObject({ ok: false, reason: "unsupported" });
    await expect(scanDesktopImportFolder("12345678-89ab-4def-8123-456789abcdef"))
      .resolves.toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("rootId 格式不對就不呼叫原生端", async () => {
    const scanImportFolder = vi.fn();
    window.__AIOS_DESKTOP__ = {
      version: 1,
      openAsset: vi.fn(),
      revealAsset: vi.fn(),
      scanImportFolder,
    };
    await expect(scanDesktopImportFolder("../../etc")).resolves.toMatchObject({ ok: false, reason: "invalid-request" });
    expect(scanImportFolder).not.toHaveBeenCalled();
  });
});
