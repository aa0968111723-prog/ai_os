import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_CONTEXT_REVEAL_EVENT,
  contextTargetFromSelector,
  formatBringInSummary,
  revealProjectContext,
  revealProjectContextFromSelector,
  returnFromContext,
  selectorForContextTarget,
  type ProjectContextRevealDetail,
} from "./projectContextNav";

describe("selectorForContextTarget / contextTargetFromSelector", () => {
  it("round-trips stable anchors", () => {
    expect(selectorForContextTarget("characters")).toBe("#sec-characters");
    expect(selectorForContextTarget("worldview")).toBe("#onboard-worldview");
    expect(contextTargetFromSelector("#sec-props")).toBe("props");
    expect(contextTargetFromSelector("#onboard-worldview-card")).toBe("worldview");
    expect(contextTargetFromSelector("#stage-deliver")).toBeNull();
  });
});

describe("formatBringInSummary", () => {
  it("formats ready + counts in one line", () => {
    expect(
      formatBringInSummary({
        wvReady: true,
        characterCount: 2,
        sceneCount: 1,
        propCount: 0,
      }),
    ).toBe("本次生成會帶入：設定✓ · 角色 2 · 場景 1 · 道具 0");
    expect(
      formatBringInSummary({
        wvReady: false,
        characterCount: 0,
        sceneCount: 0,
        propCount: 0,
      }),
    ).toContain("設定（待設）");
  });
});

describe("revealProjectContext", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches aios:project-context-reveal with returnTo", () => {
    const seen: ProjectContextRevealDetail[] = [];
    const handler = (e: Event) => {
      seen.push((e as CustomEvent<ProjectContextRevealDetail>).detail);
    };
    window.addEventListener(PROJECT_CONTEXT_REVEAL_EVENT, handler);
    revealProjectContext("characters", {
      projectId: "p1",
      returnTo: "studio",
      scroll: false,
      highlight: false,
    });
    window.removeEventListener(PROJECT_CONTEXT_REVEAL_EVENT, handler);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      projectId: "p1",
      target: "characters",
      returnTo: "studio",
      scroll: false,
      highlight: false,
    });
  });

  it("revealProjectContextFromSelector maps chip targets", () => {
    const seen: ProjectContextRevealDetail[] = [];
    const handler = (e: Event) => {
      seen.push((e as CustomEvent<ProjectContextRevealDetail>).detail);
    };
    window.addEventListener(PROJECT_CONTEXT_REVEAL_EVENT, handler);
    revealProjectContextFromSelector("#sec-scenes", {
      projectId: "p1",
      returnTo: "scenes",
      scroll: false,
    });
    window.removeEventListener(PROJECT_CONTEXT_REVEAL_EVENT, handler);
    expect(seen[0]?.target).toBe("scenes");
    expect(seen[0]?.returnTo).toBe("scenes");
  });
});

describe("returnFromContext", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.getElementById("stage-deliver")?.remove();
  });

  it("dispatches workbench reveal for studio return", () => {
    const seen: unknown[] = [];
    const handler = (e: Event) => {
      seen.push((e as CustomEvent).detail);
    };
    window.addEventListener("aios:workbench-reveal", handler);
    returnFromContext("studio", { projectId: "p1" });
    window.removeEventListener("aios:workbench-reveal", handler);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatchObject({ projectId: "p1", anchor: "sec-studio" });
  });

  it("scrolls and flashes #stage-deliver for scenes return", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const el = document.createElement("div");
    el.id = "stage-deliver";
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;
    document.body.appendChild(el);

    returnFromContext("scenes", { projectId: "p1" });

    expect(scrollIntoView).toHaveBeenCalled();
    expect(el.classList.contains("flash-target")).toBe(true);
  });
});
