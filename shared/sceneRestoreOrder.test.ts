import { describe, expect, it } from "vitest";
import { restoreOrderPlan } from "./sceneRestoreOrder";

describe("restoreOrderPlan", () => {
  it("restores into the vacant original slot (delete first, remaining keep 1..n)", () => {
    expect(restoreOrderPlan({ originalOrderIndex: 0, activeOrderIndexes: [1, 2] })).toEqual({
      orderIndex: 0,
      shiftFrom: null,
    });
  });

  it("shifts from the original index when that slot is now occupied", () => {
    expect(restoreOrderPlan({ originalOrderIndex: 1, activeOrderIndexes: [0, 1, 3] })).toEqual({
      orderIndex: 1,
      shiftFrom: 1,
    });
  });
});
