import { describe, expect, it, vi } from "vitest";
import { refreshStudioShotList, studioShotListIsLoading } from "./studioShotList";

describe("refreshStudioShotList", () => {
  it("invalidates listByProject + scenesList then fetches so studio cache is warm", async () => {
    const invalidateList = vi.fn(async () => undefined);
    const fetchList = vi.fn(async () => [{ id: "shot-1" }]);
    const invalidateScenes = vi.fn(async () => undefined);
    const order: string[] = [];
    invalidateList.mockImplementation(async () => { order.push("invalidate-list"); });
    invalidateScenes.mockImplementation(async () => { order.push("invalidate-scenes"); });
    fetchList.mockImplementation(async () => { order.push("fetch"); return [{ id: "shot-1" }]; });

    await refreshStudioShotList({
      scenes: { listByProject: { invalidate: invalidateList, fetch: fetchList } },
      story: { scenesList: { invalidate: invalidateScenes } },
    }, "proj-1");

    expect(invalidateList).toHaveBeenCalledWith({ projectId: "proj-1" });
    expect(invalidateScenes).toHaveBeenCalledWith({ projectId: "proj-1" });
    expect(fetchList).toHaveBeenCalledWith({ projectId: "proj-1" });
    expect(order.indexOf("fetch")).toBeGreaterThan(order.indexOf("invalidate-list"));
  });
});

describe("studioShotListIsLoading", () => {
  it("treats stale empty + fetching as loading (not 0 鏡)", () => {
    expect(studioShotListIsLoading({ isLoading: false, isFetching: true, data: [] })).toBe(true);
    expect(studioShotListIsLoading({ isLoading: false, isFetching: true, data: undefined })).toBe(true);
  });

  it("does not flash loading when shots are already in cache", () => {
    expect(studioShotListIsLoading({ isLoading: false, isFetching: true, data: [{ id: "s1" }] })).toBe(false);
    expect(studioShotListIsLoading({ isLoading: false, isFetching: false, data: [] })).toBe(false);
  });

  it("keeps the first-load spinner", () => {
    expect(studioShotListIsLoading({ isLoading: true, isFetching: true, data: undefined })).toBe(true);
  });
});
