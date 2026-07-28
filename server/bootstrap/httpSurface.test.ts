import { describe, expect, it } from "vitest";
import { httpSurfaceForRole } from "./httpSurface";

describe("httpSurfaceForRole (TD-07b)", () => {
  it("all and web serve SPA", () => {
    expect(httpSurfaceForRole("all")).toEqual({ serveSpa: true });
    expect(httpSurfaceForRole("web")).toEqual({ serveSpa: true });
  });

  it("worker skips SPA (health surface only)", () => {
    expect(httpSurfaceForRole("worker")).toEqual({ serveSpa: false });
  });
});
