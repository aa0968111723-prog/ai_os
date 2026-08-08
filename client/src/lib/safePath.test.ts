/**
 * #274：safeInternalPath 防 open-redirect 的合約測試。
 * 三例（issue 明列）：`//evil` 拒絕、`/\\evil` 拒絕、`/dashboard` 接受。
 */
import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./safePath";

describe("safeInternalPath", () => {
  it.each([
    "/dashboard",
    "/p/01234567-89ab-cdef-0123-456789abcdef?focus=scene-yyy",
    "/planner",
    "/login?next=/p/abc",
  ])("accepts same-origin internal path: %s", (path) => {
    expect(safeInternalPath(path)).toBe(path);
  });

  it.each([
    "//evil.example",
    "//example.com",
    "/\\evil.example",
    "/\\evil",
    "https://evil.example",
    "javascript:alert(1)",
    "\\\\evil.example",
    "/%2f%2fevil.example",
    `/dashboard${String.fromCharCode(0x00)}`,
    `/dashboard${String.fromCharCode(0x01)}`,
    `/dashboard${String.fromCharCode(0x1f)}`,
    `/dashboard${String.fromCharCode(0x7f)}`,
    "",
    "dashboard",
  ])("rejects non-internal path: %s", (path) => {
    expect(safeInternalPath(path)).toBeNull();
  });

  it("rejects null / undefined", () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
  });
});
