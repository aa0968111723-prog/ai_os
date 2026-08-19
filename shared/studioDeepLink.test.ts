import { describe, expect, it } from "vitest";
import { studioCanonicalPath, studioProjectIdFromLocation } from "./studioDeepLink";

const ID = "81b265dc-d41c-4ace-ae8f-c05b6debefec";

describe("studioProjectIdFromLocation", () => {
  it("reads /studio/:id", () => {
    expect(studioProjectIdFromLocation(`/studio/${ID}`)).toBe(ID);
    expect(studioProjectIdFromLocation(`/studio/${ID}/`)).toBe(ID);
  });

  it("reads /studio?project=<id> so the query-param leftover opens that project", () => {
    expect(studioProjectIdFromLocation("/studio", `?project=${ID}`)).toBe(ID);
    expect(studioProjectIdFromLocation(`/studio?project=${ID}`)).toBe(ID);
    expect(studioProjectIdFromLocation("/studio", `project=${ID}`)).toBe(ID);
  });

  it("does not treat the bare picker or a junk query as a project", () => {
    expect(studioProjectIdFromLocation("/studio")).toBeNull();
    expect(studioProjectIdFromLocation("/studio", "?project=not-a-uuid")).toBeNull();
    expect(studioProjectIdFromLocation("/p/" + ID, `?project=${ID}`)).toBeNull();
  });

  it("canonical path stays /studio/:id", () => {
    expect(studioCanonicalPath(ID)).toBe(`/studio/${ID}`);
  });
});
