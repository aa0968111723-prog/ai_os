import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetTheaterForTests,
  applyTheaterHint,
  cancelTheaterForRun,
  getPendingTheaterSuggest,
  isHumanBusy,
  recordHumanActivity,
} from "./agentTheater";

const pid = "11111111-1111-4111-8111-111111111111";
const sid = "22222222-2222-4222-8222-222222222222";
const rid = "33333333-3333-4333-8333-333333333333";

vi.mock("../discuss", () => ({
  flashAnchor: vi.fn(() => true),
  highlightAnchor: vi.fn(() => true),
}));

describe("agentTheater controller", () => {
  beforeEach(() => {
    __resetTheaterForTests();
    vi.stubEnv("VITE_AGENT_THEATER_V1", "1");
  });
  afterEach(() => {
    __resetTheaterForTests();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("is disabled when flag off", () => {
    vi.stubEnv("VITE_AGENT_THEATER_V1", "0");
    const navigate = vi.fn();
    expect(applyTheaterHint({
      schemaVersion: 1, runId: rid, stepId: "s1", projectId: pid, path: `/p/${pid}`,
    }, { navigate })).toBe("disabled");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("drops stale sequences", () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const base = {
      schemaVersion: 1 as const,
      runId: rid,
      stepId: "s1",
      projectId: pid,
      path: `/p/${pid}`,
      anchor: `scene-${sid}`,
    };
    applyTheaterHint({ ...base, sequence: 5 }, { navigate });
    vi.runAllTimers();
    expect(applyTheaterHint({ ...base, sequence: 3 }, { navigate })).toBe("stale");
  });

  it("suppresses auto nav when human recently active", () => {
    recordHumanActivity();
    const navigate = vi.fn();
    const r = applyTheaterHint({
      schemaVersion: 1,
      runId: rid,
      stepId: "s1",
      projectId: pid,
      path: `/p/${pid}`,
      mode: "auto_if_idle",
    }, { navigate });
    expect(r).toBe("suppressed_by_human");
    expect(getPendingTheaterSuggest()?.runId).toBe(rid);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("force go-to ignores human busy", () => {
    recordHumanActivity();
    const navigate = vi.fn();
    const r = applyTheaterHint({
      schemaVersion: 1,
      runId: rid,
      stepId: "s1",
      projectId: pid,
      path: `/p/${pid}`,
    }, { navigate, force: true });
    expect(r).toBe("executed");
    expect(navigate).toHaveBeenCalled();
  });

  it("cancelTheaterForRun stops further auto hints", () => {
    vi.useFakeTimers();
    cancelTheaterForRun(rid);
    const navigate = vi.fn();
    expect(applyTheaterHint({
      schemaVersion: 1,
      runId: rid,
      stepId: "s1",
      projectId: pid,
      path: `/p/${pid}`,
      sequence: 1,
    }, { navigate })).toBe("cancelled");
  });

  it("isHumanBusy detects focused input", () => {
    document.body.innerHTML = `<input id="t" />`;
    const input = document.getElementById("t") as HTMLInputElement;
    input.focus();
    expect(isHumanBusy(Date.now() + 10_000)).toBe(true);
    document.body.innerHTML = "";
  });
});
