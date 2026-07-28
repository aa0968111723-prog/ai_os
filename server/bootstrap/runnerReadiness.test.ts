import { describe, expect, it } from "vitest";
import { evaluateRunnerReadiness } from "./runnerReadiness";

describe("evaluateRunnerReadiness (TD-07)", () => {
  const now = 1_000_000;

  it("web never requires runner (boot ready or not)", () => {
    expect(
      evaluateRunnerReadiness("web", false, { started: false, lastTickAt: null }, now),
    ).toEqual({
      ok: true,
      note: "skipped（PROCESS_ROLE=web，本實例不跑背景執行器）",
    });
    expect(
      evaluateRunnerReadiness("web", true, { started: false, lastTickAt: null }, now),
    ).toMatchObject({ ok: true });
  });

  it("worker/all pending while boot not ready", () => {
    for (const role of ["worker", "all"] as const) {
      expect(
        evaluateRunnerReadiness(role, false, { started: false, lastTickAt: null }, now),
      ).toMatchObject({ ok: true, note: expect.stringContaining("pending") });
    }
  });

  it("worker/all fail when boot ready but runner not started", () => {
    for (const role of ["worker", "all"] as const) {
      expect(
        evaluateRunnerReadiness(role, true, { started: false, lastTickAt: null }, now),
      ).toMatchObject({ ok: false, note: expect.stringContaining("not_started") });
    }
  });

  it("worker/all fail when heartbeat stalled", () => {
    expect(
      evaluateRunnerReadiness(
        "worker",
        true,
        { started: true, lastTickAt: now - 61_000 },
        now,
      ),
    ).toMatchObject({ ok: false, note: expect.stringContaining("stalled") });
  });

  it("worker/all ok when started with fresh or null tick", () => {
    expect(
      evaluateRunnerReadiness("all", true, { started: true, lastTickAt: now - 1_000 }, now),
    ).toMatchObject({ ok: true, note: expect.stringContaining("ok") });
    // null lastTickAt：剛啟動、第一輪 tick 尚未完成
    expect(
      evaluateRunnerReadiness("worker", true, { started: true, lastTickAt: null }, now),
    ).toMatchObject({ ok: true });
  });
});
