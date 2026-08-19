import { describe, expect, it } from "vitest";
import { assertOptionalReferenceImage } from "./referenceAsset";

describe("assertOptionalReferenceImage", () => {
  it("empty / blank sheet skips assert and does not 500", async () => {
    await expect(assertOptionalReferenceImage(undefined, "g", "p")).resolves.toBeUndefined();
    await expect(assertOptionalReferenceImage("", "g", "p")).resolves.toBeUndefined();
    await expect(assertOptionalReferenceImage("   ", "g", "p")).resolves.toBeUndefined();
  });
});
