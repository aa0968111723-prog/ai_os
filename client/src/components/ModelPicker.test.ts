import { describe, expect, it } from "vitest";
import { pickDefaultModel, type PickedModel } from "./ModelPicker";

function model(
  id: string,
  options: Partial<PickedModel> = {},
): PickedModel {
  return {
    id,
    label: id,
    points: 1,
    needs: null,
    sourceHint: null,
    kind: "image",
    tierLabel: "經濟",
    strengths: "",
    verified: false,
    recommended: false,
    ...options,
  };
}

describe("ModelPicker verified-first default", () => {
  it("does not auto-select an unverified recommendation over a verified model", () => {
    const unverifiedRecommended = model("new", { recommended: true });
    const verified = model("stable", { verified: true });
    expect(pickDefaultModel([unverifiedRecommended, verified])?.id).toBe("stable");
  });

  it("prefers a verified recommendation when one exists", () => {
    const verified = model("stable", { verified: true });
    const verifiedRecommended = model("recommended", { verified: true, recommended: true });
    expect(pickDefaultModel([verified, verifiedRecommended])?.id).toBe("recommended");
  });
});
