import { describe, expect, it } from "vitest";
import { createInsertAfterQueue } from "./insertAfterQueue";

describe("createInsertAfterQueue", () => {
  it("chains blank inserts so 10 clicks on one row stay in click order", async () => {
    const calls: string[] = [];
    let n = 0;
    const q = createInsertAfterQueue(async ({ sceneId }) => {
      calls.push(sceneId);
      n += 1;
      return { id: `n${n}` };
    });
    for (let i = 0; i < 10; i++) q.enqueue("origin");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual(["origin", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9"]);
  });

  it("does not chain duplicate — each copy still targets the origin row", async () => {
    const calls: Array<{ sceneId: string; duplicate?: boolean }> = [];
    const q = createInsertAfterQueue(async (input) => {
      calls.push(input);
      return { id: `d-${calls.length}` };
    });
    q.enqueue("origin", { duplicate: true });
    q.enqueue("origin", { duplicate: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([
      { sceneId: "origin", duplicate: true },
      { sceneId: "origin", duplicate: true },
    ]);
  });
});
