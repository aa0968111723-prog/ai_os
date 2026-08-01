/**
 * AUTH-03：upload grant pure helpers + token shape contract.
 */
import { describe, expect, it } from "vitest";
import {
  UPLOAD_GRANT_MAX_TTL_SEC,
  UPLOAD_GRANT_TOKEN_PREFIX,
  buildUploadLineageMeta,
  hashUploadGrantToken,
  looksLikeUuid,
  tryConsumeUploadGrant,
  releaseUploadGrant,
  markUploadGrantUsed,
} from "./uploadGrants";

describe("uploadGrants pure helpers", () => {
  it("looksLikeUuid accepts standard UUID v4 shape", () => {
    expect(looksLikeUuid("3fa2aaaa-1111-4222-8333-444455556666")).toBe(true);
    expect(looksLikeUuid("not-a-uuid")).toBe(false);
    expect(looksLikeUuid("")).toBe(false);
  });

  it("hashUploadGrantToken is stable sha256 hex", () => {
    const a = hashUploadGrantToken(`${UPLOAD_GRANT_TOKEN_PREFIX}abc`);
    const b = hashUploadGrantToken(`${UPLOAD_GRANT_TOKEN_PREFIX}abc`);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(`${UPLOAD_GRANT_TOKEN_PREFIX}abc`);
  });

  it("buildUploadLineageMeta only includes set lineage fields", () => {
    expect(buildUploadLineageMeta({ originalName: "a.png" })).toEqual({ originalName: "a.png" });
    expect(
      buildUploadLineageMeta({
        originalName: "edit.png",
        sourceAssetId: "3fa2aaaa-1111-4222-8333-444455556666",
        desktopHandoffId: "h1",
        editorId: "davinci",
      }),
    ).toEqual({
      originalName: "edit.png",
      sourceAssetId: "3fa2aaaa-1111-4222-8333-444455556666",
      desktopHandoffId: "h1",
      editorId: "davinci",
    });
  });

  it("TTL caps are documented constants", () => {
    expect(UPLOAD_GRANT_MAX_TTL_SEC).toBe(7 * 86_400);
    expect(UPLOAD_GRANT_TOKEN_PREFIX).toBe("aidup_");
  });

  it("exports CAS consume/release helpers for single-use grant race fix", () => {
    expect(typeof tryConsumeUploadGrant).toBe("function");
    expect(typeof releaseUploadGrant).toBe("function");
    expect(typeof markUploadGrantUsed).toBe("function");
  });
});
