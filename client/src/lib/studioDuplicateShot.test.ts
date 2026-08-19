import { describe, expect, it, vi } from "vitest";
import { mergeDuplicatedShotIntoList, runStudioDuplicateShot } from "./studioDuplicateShot";

const SEVEN = [
  { id: "s1", orderIndex: 1, title: "一" },
  { id: "s2", orderIndex: 2, title: "二" },
  { id: "s3", orderIndex: 3, title: "三" },
  { id: "s4", orderIndex: 4, title: "四" },
  { id: "s5", orderIndex: 5, title: "五" },
  { id: "s6", orderIndex: 6, title: "六" },
  { id: "s7", orderIndex: 7, title: "七" },
];

describe("mergeDuplicatedShotIntoList", () => {
  it("7→8: clone sits after the source (fails if merge is a no-op)", () => {
    const created = { id: "s2-copy", orderIndex: 99, title: "二 複本" };
    const next = mergeDuplicatedShotIntoList(SEVEN, "s2", created);
    expect(next).toHaveLength(8);
    expect(next.map((row) => row.id)).toEqual([
      "s1", "s2", "s2-copy", "s3", "s4", "s5", "s6", "s7",
    ]);
    expect(next[2]?.title).toBe("二 複本");
    expect(next[2]?.orderIndex).toBe(3);
    expect(next[3]?.id).toBe("s3");
    expect(next[3]?.orderIndex).toBe(4);
  });

  it("does not grow the list when the created row is already present", () => {
    const already = [...SEVEN, { id: "s2-copy", orderIndex: 3, title: "二 複本" }];
    const next = mergeDuplicatedShotIntoList(already, "s2", already[7]!);
    expect(next).toHaveLength(8);
  });
});

describe("runStudioDuplicateShot", () => {
  it("calls insertAfter(duplicate) then cache merge + refresh — not a silent no-op", async () => {
    const created = { id: "new", orderIndex: 3, title: "二 複本" };
    const insertAfter = vi.fn(async () => created);
    const mergeIntoCache = vi.fn();
    const refresh = vi.fn(async () => undefined);

    const row = await runStudioDuplicateShot({
      sceneId: "s2",
      insertAfter,
      mergeIntoCache,
      refresh,
    });

    expect(insertAfter).toHaveBeenCalledWith({ sceneId: "s2", duplicate: true });
    expect(mergeIntoCache).toHaveBeenCalledWith("s2", created);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(row.id).toBe("new");
  });

  it("throws when insertAfter returns no id (the live silent no-op)", async () => {
    await expect(runStudioDuplicateShot({
      sceneId: "s2",
      insertAfter: async () => ({ id: "", orderIndex: 0 }),
      mergeIntoCache: () => undefined,
      refresh: async () => undefined,
    })).rejects.toThrow("複製這一鏡沒有寫入新列");
  });
});
