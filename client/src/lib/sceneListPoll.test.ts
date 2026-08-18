import { describe, expect, it } from "vitest";
import {
  sceneListHasPendingWork,
  sceneListRefetchIntervalMs,
  SCENE_LIST_POLL_IDLE_MS,
  SCENE_LIST_POLL_PENDING_MS,
} from "./sceneListPoll";

describe("sceneListHasPendingWork", () => {
  it("is false when the list is empty or idle", () => {
    expect(sceneListHasPendingWork(undefined)).toBe(false);
    expect(sceneListHasPendingWork([])).toBe(false);
    expect(sceneListHasPendingWork([{ pendingGenStatus: "done" }])).toBe(false);
    expect(sceneListHasPendingWork([{ pendingGenStatus: "awaiting_approval" }])).toBe(false);
    expect(sceneListHasPendingWork([{}])).toBe(false);
  });

  it("is true when any shot has queued/running gen, voice, or ambience", () => {
    expect(sceneListHasPendingWork([{ pendingGenStatus: "queued" }])).toBe(true);
    expect(sceneListHasPendingWork([{ pendingGenStatus: "running" }])).toBe(true);
    expect(sceneListHasPendingWork([{ pendingVoiceStatus: "queued" }])).toBe(true);
    expect(sceneListHasPendingWork([{ pendingAmbienceStatus: "running" }])).toBe(true);
  });
});

describe("sceneListRefetchIntervalMs", () => {
  it("polls every 10s only while work is pending", () => {
    expect(sceneListRefetchIntervalMs([{ pendingGenStatus: "running" }])).toBe(SCENE_LIST_POLL_PENDING_MS);
    expect(sceneListRefetchIntervalMs([{ pendingGenStatus: "done" }])).toBe(SCENE_LIST_POLL_IDLE_MS);
    expect(sceneListRefetchIntervalMs([])).toBe(SCENE_LIST_POLL_IDLE_MS);
  });
});
