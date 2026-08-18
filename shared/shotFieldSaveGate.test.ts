import { describe, expect, it } from "vitest";
import { createShotFieldSaveGate } from "./shotFieldSaveGate";

describe("createShotFieldSaveGate", () => {
  it("queues the second field until the first ACK, then sends with the new rev", () => {
    const sent: Array<{ keys: string[]; expectedRev: number }> = [];
    let serverRev = 4;
    const gate = createShotFieldSaveGate({
      send: (req) => sent.push({ keys: Object.keys(req.patch), expectedRev: req.expectedRev }),
      getRev: () => serverRev,
    });
    expect(gate.save({ title: "A" }, { title: "old" })).toBe("dispatched");
    expect(gate.save({ prompt: "B" }, { prompt: "" })).toBe("queued");
    expect(sent).toEqual([{ keys: ["title"], expectedRev: 4 }]);
    gate.onAck(5);
    expect(sent).toEqual([
      { keys: ["title"], expectedRev: 4 },
      { keys: ["prompt"], expectedRev: 5 },
    ]);
  });

  it("merges queued patches into one flush after ACK", () => {
    const sent: Array<{ keys: string[]; expectedRev: number | undefined }> = [];
    const gate = createShotFieldSaveGate({
      send: (req) => sent.push({ keys: Object.keys(req.patch), expectedRev: req.expectedRev }),
      getRev: () => 1,
    });
    expect(gate.save({ title: "A" }, { title: "old" })).toBe("dispatched");
    expect(gate.save({ prompt: "B" }, { prompt: "" })).toBe("queued");
    expect(gate.save({ voiceover: "C" }, { voiceover: "" })).toBe("queued");
    gate.onAck(2);
    expect(sent[1]).toEqual({ keys: ["prompt", "voiceover"], expectedRev: 2 });
  });

  it("reset drops the cached rev so a later shot does not inherit it", () => {
    const sent: Array<{ expectedRev: number | undefined }> = [];
    let serverRev = 4;
    const gate = createShotFieldSaveGate({
      send: (req) => sent.push({ expectedRev: req.expectedRev }),
      getRev: () => serverRev,
    });
    gate.save({ title: "A" }, { title: "old" });
    gate.onAck(9);
    gate.reset();
    serverRev = 2;
    gate.save({ title: "B" }, { title: "x" });
    expect(sent.map((s) => s.expectedRev)).toEqual([4, 2]);
  });
});
