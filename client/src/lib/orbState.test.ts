import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installOrbState, setOrbState } from "./orbState";

const attr = () => document.documentElement.getAttribute("data-orb-state");

describe("orb state machine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.removeAttribute("data-orb-state");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("installs idle as the default without clobbering an existing state", () => {
    installOrbState();
    expect(attr()).toBe("idle");
    setOrbState("thinking");
    installOrbState();
    expect(attr()).toBe("thinking");
  });

  it("keeps thinking until told otherwise", () => {
    setOrbState("thinking");
    vi.advanceTimersByTime(10_000);
    expect(attr()).toBe("thinking");
  });

  // speaking/error 是一次性回饋：短暫後自動回 idle，
  // 否則使用者離開頁面後球會一直搖或一直紅
  it("auto-reverts transient states to idle", () => {
    setOrbState("speaking");
    expect(attr()).toBe("speaking");
    vi.advanceTimersByTime(2700);
    expect(attr()).toBe("idle");

    setOrbState("error");
    vi.advanceTimersByTime(1700);
    expect(attr()).toBe("idle");
  });

  it("cancels a pending revert when a new state arrives", () => {
    setOrbState("speaking");
    vi.advanceTimersByTime(1000);
    setOrbState("thinking");
    vi.advanceTimersByTime(5000);
    expect(attr()).toBe("thinking");
  });
});
