import { describe, expect, it, vi } from "vitest";
import {
  executeResourceReads,
  routeAssistantResources,
  type ResourceReader,
} from "./assistantResourceResolver";

function reader(
  source: ResourceReader["source"],
  read: ResourceReader["read"],
): ResourceReader {
  return { source, label: source, retrieval: "structured", read };
}

describe("assistant resource resolver", () => {
  it("routes project status questions to cross-source evidence", () => {
    const routed = routeAssistantResources("這個專案做到哪？現在卡在哪？");
    expect(routed).toEqual(expect.arrayContaining([
      "project_status", "tasks", "schedule", "storyboard", "generations", "agent_runs", "collaboration",
    ]));
  });

  it("routes 清單 / 資料表 questions onto the custom database source", () => {
    expect(routeAssistantResources("素材清單有什麼？")).toContain("database");
    expect(routeAssistantResources("搜尋所有資料庫裡面的書法")).toContain("database");
  });

  it("project / studio / story pages include knowledge so saved 故事 can be read", () => {
    expect(routeAssistantResources("依儲存的故事拆分鏡", { pageType: "project" }))
      .toEqual(expect.arrayContaining(["project_status", "knowledge", "storyboard"]));
    expect(routeAssistantResources("依儲存的故事拆分鏡", { pageType: "studio" }))
      .toEqual(expect.arrayContaining(["project_status", "knowledge", "storyboard"]));
    expect(routeAssistantResources("依儲存的故事拆分鏡", { pageType: "story" }))
      .toEqual(expect.arrayContaining(["knowledge", "storyboard"]));
  });

  it("uses page/entity context to expose only relevant capabilities", () => {
    const routed = routeAssistantResources("改善這三鏡", {
      pageType: "storyboard",
      entityType: "shot",
      selectedEntityIds: ["00000000-0000-4000-8000-000000000001"],
    });
    expect(routed).toContain("storyboard");
    expect(routed).toContain("assets");
    expect(routed).not.toContain("database");
  });

  it("routes remembered decisions and persistent monitoring to their real sources", () => {
    expect(routeAssistantResources("之前討論過角色衣服嗎？")).toEqual(expect.arrayContaining([
      "decisions", "knowledge", "notes",
    ]));
    expect(routeAssistantResources("持續監看生成失敗並提醒我")).toEqual(expect.arrayContaining([
      "watches", "generations",
    ]));
  });

  it("distinguishes EMPTY from an error and preserves fallback evidence", async () => {
    const results = await executeResourceReads([
      reader("knowledge", async () => []),
      reader("notes", async () => [{ title: "角色衣服定案" }]),
    ], { retryTransientReads: 0 });
    expect(results.map((result) => result.outcome)).toEqual(["EMPTY", "OK"]);
    expect(results[1]?.text).toContain("角色衣服定案");
  });

  it("distinguishes timeout, auth denial, unavailable and tool failure", async () => {
    vi.useFakeTimers();
    const pending = new Promise<never>(() => undefined);
    const promise = executeResourceReads([
      reader("knowledge", () => pending),
      reader("notes", async () => { throw Object.assign(new Error("denied"), { code: "FORBIDDEN" }); }),
      reader("database", async () => { throw Object.assign(new Error("missing"), { code: "NOT_FOUND" }); }),
      reader("assets", async () => { throw new Error("boom"); }),
    ], { timeoutMs: 50, retryTransientReads: 0 });
    await vi.advanceTimersByTimeAsync(51);
    const results = await promise;
    vi.useRealTimers();
    expect(results.map((result) => result.outcome)).toEqual([
      "TIMEOUT", "AUTH_DENIED", "NOT_AVAILABLE", "TOOL_ERROR",
    ]);
  });

  it("runs independent reads in parallel", async () => {
    vi.useFakeTimers();
    let active = 0;
    let peak = 0;
    const delayed = () => new Promise<unknown[]>((resolve) => {
      active += 1;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active -= 1;
        resolve([{ ok: true }]);
      }, 100);
    });
    const promise = executeResourceReads([
      reader("tasks", delayed),
      reader("notes", delayed),
      reader("knowledge", delayed),
      reader("database", delayed),
    ], { timeoutMs: 500, retryTransientReads: 0 });
    await vi.advanceTimersByTimeAsync(101);
    const results = await promise;
    vi.useRealTimers();
    expect(peak).toBe(4);
    expect(results.every((result) => result.outcome === "OK")).toBe(true);
    expect(Math.max(...results.map((result) => result.durationMs))).toBeLessThan(200);
  });

  it("retries a safe read once without retrying a successful source", async () => {
    const flaky = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce([{ id: "recovered" }]);
    const stable = vi.fn().mockResolvedValue([{ id: "stable" }]);
    const results = await executeResourceReads([
      reader("tasks", flaky),
      reader("notes", stable),
    ], { retryTransientReads: 1 });
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(stable).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ outcome: "OK", attempts: 2 });
  });
});
