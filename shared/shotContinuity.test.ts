/**
 * 連戲承接（§8）。這支會直接改使用者已經調過的鏡——
 * 多接一個面向＝把他的設定蓋掉，少接一個＝連戲斷掉。逐項釘住。
 */
import { describe, it, expect } from "vitest";
import { buildContinuityPatch, CAMERA_CONTINUITY_FIELDS, type ContinuityShot } from "./shotContinuity";

const shot = (o: Partial<ContinuityShot> = {}): ContinuityShot => ({
  characterIds: null,
  lookIds: null,
  scenePresetIds: null,
  camera: null,
  ...o,
});

describe("buildContinuityPatch", () => {
  it("只承接被指名的面向，其他一律不動", () => {
    const prev = shot({ characterIds: ["c1"], lookIds: ["l1"], scenePresetIds: ["s1"] });
    const cur = shot();
    const { patch } = buildContinuityPatch(prev, cur, ["characters"]);
    expect(patch).toEqual({ characterIds: ["c1"] });
    expect(patch.lookIds).toBeUndefined();
    expect(patch.scenePresetIds).toBeUndefined();
  });

  it("沒有差異的面向不進 patch——呼叫端據此知道「其實沒東西要承接」", () => {
    const same = shot({ characterIds: ["c1"], scenePresetIds: ["s1"] });
    const { patch, changes } = buildContinuityPatch(same, shot({ characterIds: ["c1"], scenePresetIds: ["s1"] }), [
      "characters",
      "location",
    ]);
    expect(patch).toEqual({});
    expect(changes).toEqual([]);
  });

  it("id 比較不受順序影響（同一組 id 換順序不算差異）", () => {
    const { patch } = buildContinuityPatch(
      shot({ characterIds: ["a", "b"] }),
      shot({ characterIds: ["b", "a"] }),
      ["characters"],
    );
    expect(patch).toEqual({});
  });

  it("攝影風格只接光線／構圖／焦段——鏡別與運鏡正是每鏡該不同的地方", () => {
    const prev = shot({ camera: { lighting: "逆光", composition: "留白", shotSize: "大遠景", movement: "跟拍" } });
    const cur = shot({ camera: { shotSize: "特寫", movement: "固定" } });
    const { patch, changes } = buildContinuityPatch(prev, cur, ["camera"]);
    // 本鏡自己的鏡別／運鏡保留
    expect(patch.camera).toMatchObject({ shotSize: "特寫", movement: "固定", lighting: "逆光", composition: "留白" });
    expect(changes.join()).not.toContain("鏡別");
    expect(changes.join()).not.toContain("運鏡");
  });

  it("承接的清單就是「該一致」的那幾欄，不會偷偷變多", () => {
    expect([...CAMERA_CONTINUITY_FIELDS]).toEqual(["lighting", "composition", "focalLength"]);
  });

  it("上一鏡沒填的風格欄位＝清掉本鏡的（承接就是變得跟它一樣）", () => {
    const { patch, changes } = buildContinuityPatch(
      shot({ camera: { shotSize: "全景" } }),
      shot({ camera: { lighting: "頂光" } }),
      ["camera"],
    );
    expect(patch.camera?.lighting).toBeUndefined();
    expect(changes.some((c) => c.includes("光線"))).toBe(true);
  });

  it("全部清空後 camera 存 null，不留空物件（與 environment 存法一致）", () => {
    const { patch } = buildContinuityPatch(shot({ camera: null }), shot({ camera: { lighting: "頂光" } }), ["camera"]);
    expect(patch.camera).toBeNull();
  });

  it("差異句人看得懂，且數量對得上", () => {
    const { changes } = buildContinuityPatch(
      shot({ characterIds: ["c1", "c2"], lookIds: ["l1"] }),
      shot({ characterIds: ["c1"] }),
      ["characters", "looks"],
    );
    expect(changes).toEqual(["角色：1 → 2 位", "造型：0 → 1 套"]);
  });
});
