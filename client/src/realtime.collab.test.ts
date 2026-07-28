import { describe, expect, it } from "vitest";
import { followablePeers, zoneOfPeer, type CollabPeer } from "./realtime";

const peers: CollabPeer[] = [
  { userId: "a", name: "安", color: "#c2613f" },
  { userId: "b", name: "哲", color: "#6e8b62" },
  { userId: "c", name: "晴", color: "#b58a3e" },
];

describe("zoneOfPeer", () => {
  it("finds zone containing the user", () => {
    const zones = {
      世界觀: [peers[0]],
      分鏡: [peers[1], peers[2]],
    };
    expect(zoneOfPeer("b", zones)).toBe("分鏡");
    expect(zoneOfPeer("a", zones)).toBe("世界觀");
    expect(zoneOfPeer("nobody", zones)).toBeNull();
  });
});

describe("followablePeers", () => {
  it("excludes self", () => {
    expect(followablePeers(peers, "b").map((p) => p.userId)).toEqual(["a", "c"]);
  });
  it("returns all when self unknown", () => {
    expect(followablePeers(peers, null)).toHaveLength(3);
  });
});
