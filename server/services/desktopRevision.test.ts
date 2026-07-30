import { describe, expect, it } from "vitest";
import { buildDesktopRevisionMeta, parseDesktopRevisionFields } from "./desktopRevision";

const SOURCE = "01234567-89ab-4def-8123-456789abcdef";
const HANDOFF = "12345678-89ab-4def-8123-456789abcdef";

describe("desktop revision metadata", () => {
  it("treats a regular upload as non-desktop", () => {
    expect(parseDesktopRevisionFields({ projectId: SOURCE })).toEqual({ ok: true, value: null });
  });

  it("accepts valid revision identifiers", () => {
    expect(parseDesktopRevisionFields({
      sourceAssetId: SOURCE,
      desktopHandoffId: HANDOFF,
      editorId: "davinci-resolve",
    })).toEqual({
      ok: true,
      value: {
        sourceAssetId: SOURCE,
        handoffId: HANDOFF,
        editorId: "davinci-resolve",
      },
    });
  });

  it("rejects partial or malformed desktop metadata", () => {
    expect(parseDesktopRevisionFields({ editorId: "premiere-pro" }).ok).toBe(false);
    expect(parseDesktopRevisionFields({ sourceAssetId: "../secret" }).ok).toBe(false);
    expect(parseDesktopRevisionFields({ sourceAssetId: SOURCE, editorId: "../../cmd" }).ok).toBe(false);
  });

  it("keeps the original filename and creates revision provenance", () => {
    const meta = buildDesktopRevisionMeta("edited.mp4", {
      sourceAssetId: SOURCE,
      handoffId: HANDOFF,
      editorId: "premiere-pro",
    });
    expect(meta.originalName).toBe("edited.mp4");
    expect(meta.desktopRevision).toMatchObject({
      sourceAssetId: SOURCE,
      handoffId: HANDOFF,
      editorId: "premiere-pro",
    });
  });
});
