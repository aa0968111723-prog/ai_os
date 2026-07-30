import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAiosDeepLink,
  hasDesktopBridge,
  normalizeAiosInternalPath,
  openAssetInExternalEditor,
  parseAiosDeepLink,
  revealAssetInFolder,
} from "./desktopBridge";

describe("Aios desktop deep links", () => {
  it("builds and parses safe project routes", () => {
    const link = buildAiosDeepLink("/p/01234567-89ab-cdef-0123-456789abcdef?tab=workbench#result");
    expect(link).toBe(
      "aios://open?path=%2Fp%2F01234567-89ab-cdef-0123-456789abcdef%3Ftab%3Dworkbench%23result",
    );
    expect(parseAiosDeepLink(link)).toBe("/p/01234567-89ab-cdef-0123-456789abcdef?tab=workbench#result");
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

  it("passes only validated asset metadata to the injected desktop bridge", async () => {
    const openAsset = vi.fn().mockResolvedValue({ ok: true, handoffId: "handoff-1" });
    window.__AIOS_DESKTOP__ = { version: 1, openAsset, revealAsset: vi.fn() };
    const request = {
      assetId: "01234567-89ab-cdef-0123-456789abcdef",
      projectId: "fedcba98-7654-3210-fedc-ba9876543210",
      editorKind: "video-editor" as const,
      suggestedName: "scene-01.mp4",
      returnPath: "/p/fedcba98-7654-3210-fedc-ba9876543210?tab=assets",
    };
    await expect(openAssetInExternalEditor(request)).resolves.toEqual({ ok: true, handoffId: "handoff-1" });
    expect(openAsset).toHaveBeenCalledWith(request);
  });

  it("supports reveal-in-folder only through the desktop bridge", async () => {
    await expect(revealAssetInFolder({
      assetId: "01234567-89ab-cdef-0123-456789abcdef",
    })).resolves.toMatchObject({ ok: false, reason: "unsupported" });
  });
});
