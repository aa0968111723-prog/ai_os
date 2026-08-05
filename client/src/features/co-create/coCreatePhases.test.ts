import { describe, expect, it } from "vitest";
import {
  CO_CREATE_PHASES,
  coCreateJourneyStates,
  coCreatePhaseById,
  coCreatePhaseIndex,
  isCoCreatePhaseId,
} from "./coCreatePhases";

describe("coCreatePhases", () => {
  it("has four guided phases in product order", () => {
    expect(CO_CREATE_PHASES.map((p) => p.id)).toEqual([
      "theme",
      "structure",
      "visuals",
      "wrap",
    ]);
  });

  it("gives each phase short chips (anti-fixation D1)", () => {
    for (const phase of CO_CREATE_PHASES) {
      expect(phase.chips.length).toBeGreaterThanOrEqual(2);
      expect(phase.chips.length).toBeLessThanOrEqual(4);
      expect(phase.focus).toMatch(/本步/);
    }
  });

  it("validates phase ids", () => {
    expect(isCoCreatePhaseId("theme")).toBe(true);
    expect(isCoCreatePhaseId("nope")).toBe(false);
    expect(coCreatePhaseIndex("visuals")).toBe(2);
    expect(coCreatePhaseById("wrap").label).toBe("收斂");
  });

  it("marks journey states relative to current phase", () => {
    expect(coCreateJourneyStates("structure")).toEqual([
      "done",
      "current",
      "upcoming",
      "upcoming",
    ]);
  });
});
