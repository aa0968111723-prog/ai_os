import { describe, expect, it } from "vitest";
import {
  buildSceneNavigationHint,
  isAgentTheaterCursorEnabled,
  isAgentTheaterV1Enabled,
  isSafeAgentTheaterAnchor,
  isSafeAgentTheaterPath,
  sanitizeNavigationHint,
} from "./agentTheater";

const pid = "11111111-1111-4111-8111-111111111111";
const sid = "22222222-2222-4222-8222-222222222222";
const rid = "33333333-3333-4333-8333-333333333333";

describe("theater flags", () => {
  it("defaults off", () => {
    expect(isAgentTheaterV1Enabled({})).toBe(false);
    expect(isAgentTheaterCursorEnabled({})).toBe(false);
    expect(isAgentTheaterV1Enabled({ AGENT_THEATER_V1: "1" })).toBe(true);
    expect(isAgentTheaterCursorEnabled({ AGENT_THEATER_V1: "1", AGENT_THEATER_CURSOR: "1" })).toBe(true);
    expect(isAgentTheaterCursorEnabled({ AGENT_THEATER_CURSOR: "1" })).toBe(false);
  });
});

describe("safe path / anchor", () => {
  it("accepts project paths and semantic anchors only", () => {
    expect(isSafeAgentTheaterPath(`/p/${pid}`)).toBe(true);
    expect(isSafeAgentTheaterPath(`/p/${pid}?focus=x`)).toBe(true);
    expect(isSafeAgentTheaterPath("https://evil.com")).toBe(false);
    expect(isSafeAgentTheaterPath("//evil.com")).toBe(false);
    expect(isSafeAgentTheaterAnchor(`scene-${sid}`)).toBe(true);
    expect(isSafeAgentTheaterAnchor(`agent-run-${rid}`)).toBe(true);
    expect(isSafeAgentTheaterAnchor("sec-agent")).toBe(true);
    expect(isSafeAgentTheaterAnchor(".evil")).toBe(false);
    expect(isSafeAgentTheaterAnchor("div > span")).toBe(false);
  });
});

describe("sanitizeNavigationHint", () => {
  it("rejects invalid path or missing targets", () => {
    expect(sanitizeNavigationHint({ schemaVersion: 1, runId: rid, stepId: "s1", projectId: pid })).toBeNull();
    expect(sanitizeNavigationHint({
      schemaVersion: 1, runId: rid, stepId: "s1", projectId: pid, path: "https://x.com",
    })).toBeNull();
  });

  it("accepts whitelist path + anchor", () => {
    const h = sanitizeNavigationHint({
      schemaVersion: 1,
      runId: rid,
      stepId: "s1",
      projectId: pid,
      path: `/p/${pid}`,
      anchor: `scene-${sid}`,
      mode: "auto_if_idle",
      sequence: 3,
    });
    expect(h?.path).toContain(pid);
    expect(h?.anchor).toBe(`scene-${sid}`);
    expect(h?.sequence).toBe(3);
  });
});

describe("buildSceneNavigationHint", () => {
  it("builds a reveal-to-scene hint", () => {
    const h = buildSceneNavigationHint({
      runId: rid, stepId: "step-1", projectId: pid, sceneId: sid,
    });
    expect(h?.anchor).toBe(`scene-${sid}`);
    expect(h?.reveal).toBe(true);
  });
});
