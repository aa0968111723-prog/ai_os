import { describe, expect, it } from "vitest";
import {
  ASSISTANT_ASK_TIMEOUT_MESSAGE,
  ASSISTANT_ASK_WALL_MS,
  assistantAskTimedOut,
  bindAssistantAskDeadline,
} from "./assistantAskBudget";

describe("assistant ask wall-clock budget", () => {
  it("is 120s — under the 150s gateway, same as client parse abort", () => {
    expect(ASSISTANT_ASK_WALL_MS).toBe(120_000);
    expect(ASSISTANT_ASK_TIMEOUT_MESSAGE).toContain("兩分鐘");
    expect(ASSISTANT_ASK_TIMEOUT_MESSAGE).toContain("閘道");
  });

  it("deadline abort is a timeout only when the client did not disconnect", () => {
    const deadline = new AbortController();
    const client = new AbortController();
    expect(assistantAskTimedOut(deadline.signal, client.signal)).toBe(false);
    deadline.abort();
    expect(assistantAskTimedOut(deadline.signal, client.signal)).toBe(true);
    const hungUp = new AbortController();
    hungUp.abort();
    expect(assistantAskTimedOut(deadline.signal, hungUp.signal)).toBe(false);
  });

  it("bindAssistantAskDeadline aborts when the client hangs up", () => {
    const client = new AbortController();
    const { signal } = bindAssistantAskDeadline(client.signal);
    expect(signal.aborted).toBe(false);
    client.abort();
    expect(signal.aborted).toBe(true);
  });
});
