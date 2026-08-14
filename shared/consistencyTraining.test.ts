import { describe, expect, it } from "vitest";
import { canPromoteTrainingJob, trainingActionAvailable } from "./consistencyTraining";

describe("consistency training policy", () => {
  it("hides the train action when the provider is missing or unpaid", () => {
    expect(trainingActionAvailable({ providerConfigured: false, paidAuthorized: false })).toBe(false);
    expect(trainingActionAvailable({ providerConfigured: true, paidAuthorized: false })).toBe(false);
    expect(trainingActionAvailable({ providerConfigured: true, paidAuthorized: true })).toBe(true);
  });

  it("never auto-promotes; look drift blocks promote", () => {
    expect(canPromoteTrainingJob("succeeded", false)).toBe(true);
    expect(canPromoteTrainingJob("succeeded", true)).toBe(false);
    expect(canPromoteTrainingJob("training", false)).toBe(false);
    expect(canPromoteTrainingJob("evaluating", false)).toBe(false);
  });
});
