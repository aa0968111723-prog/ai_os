import { describe, expect, it } from "vitest";
import { createWorldviewSaveGate } from "./worldviewSaveGate";

describe("createWorldviewSaveGate", () => {
  it("queues a chip until the first ACK, then sends with the new rev", () => {
    const sent: Array<{ keys: string[]; expectedRev: number | undefined }> = [];
    let serverRev = 3;
    const gate = createWorldviewSaveGate({
      send: (req) => sent.push({ keys: Object.keys(req.worldview), expectedRev: req.expectedRev }),
      getRev: () => serverRev,
    });
    expect(gate.save({ tones: ["療癒"] })).toBe("dispatched");
    expect(gate.save({ logline: "小華醒來" })).toBe("queued");
    expect(sent).toEqual([{ keys: ["tones"], expectedRev: 3 }]);
    gate.onAck(4);
    expect(sent).toEqual([
      { keys: ["tones"], expectedRev: 3 },
      { keys: ["logline"], expectedRev: 4 },
    ]);
  });

  it("merges queued chip patches into one flush after ACK", () => {
    const sent: Array<{ keys: string[]; expectedRev: number | undefined }> = [];
    const gate = createWorldviewSaveGate({
      send: (req) => sent.push({ keys: Object.keys(req.worldview), expectedRev: req.expectedRev }),
      getRev: () => 1,
    });
    expect(gate.save({ tones: ["療癒"] })).toBe("dispatched");
    expect(gate.save({ themes: ["校園"] })).toBe("queued");
    expect(gate.save({ styles: ["寫實攝影"] })).toBe("queued");
    gate.onAck(2);
    expect(sent[1]).toEqual({ keys: ["themes", "styles"], expectedRev: 2 });
  });

  it("reset drops the cached rev so a later project does not inherit it", () => {
    const sent: Array<{ expectedRev: number | undefined }> = [];
    let serverRev = 8;
    const gate = createWorldviewSaveGate({
      send: (req) => sent.push({ expectedRev: req.expectedRev }),
      getRev: () => serverRev,
    });
    gate.save({ tones: ["療癒"] });
    gate.onAck(9);
    gate.reset();
    serverRev = 0;
    gate.save({ logline: "新專案" });
    expect(sent.map((s) => s.expectedRev)).toEqual([8, 0]);
  });
});
