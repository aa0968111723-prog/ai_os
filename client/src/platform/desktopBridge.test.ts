import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAiosDeepLink,
  detectDesktopEditors,
  hasDesktopBridge,
  normalizeAiosInternalPath,
  openAssetInExternalEditor,
  parseAiosDeepLink,
  revealAssetInFolder,
  stopDesktopHandoff,
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
});
