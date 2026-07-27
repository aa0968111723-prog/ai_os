import { describe, expect, it } from "vitest";
import { databaseDetailTabForKey } from "./databaseTabs";

describe("database detail tab keyboard navigation", () => {
  it("cycles with left and right arrows", () => {
    expect(databaseDetailTabForKey("rows", "ArrowRight")).toBe("files");
    expect(databaseDetailTabForKey("connect", "ArrowRight")).toBe("rows");
    expect(databaseDetailTabForKey("rows", "ArrowLeft")).toBe("connect");
  });

  it("supports Home/End and ignores unrelated keys", () => {
    expect(databaseDetailTabForKey("files", "Home")).toBe("rows");
    expect(databaseDetailTabForKey("files", "End")).toBe("connect");
    expect(databaseDetailTabForKey("files", "Enter")).toBeNull();
  });
});
