import { describe, expect, it } from "vitest";
import { BUILTIN_BRUSHES, sanitizeBrush, type BrushSpec } from "./brushes";
import {
  collectBrush,
  isTuned,
  removeSavedBrush,
  renameSavedBrush,
  updateSavedBrush,
  workingCopy,
} from "./brushCollection";
import { MAX_SAVED_BRUSHES } from "./studioStorage";

const builtin = BUILTIN_BRUSHES[0]!;

describe("collectBrush", () => {
  it("把調好的參數存成一支屬於自己的筆（可刪可改）", () => {
    const draft: BrushSpec = { ...builtin, size: 18, color: "#ef6a4e" };
    const result = collectBrush([], draft, "我的粗鉛筆");
    const mine = result.saved[0]!;
    expect(result.id).toBe(mine.id);
    expect(mine.name).toBe("我的粗鉛筆");
    expect(mine.size).toBe(18);
    expect(mine.color).toBe("#ef6a4e");
    expect(mine.builtin).toBeUndefined();
    expect(mine.id).not.toBe(builtin.id);
  });

  it("沒取名字就沿用原本的筆刷名", () => {
    expect(collectBrush([], { ...builtin }, "   ").saved[0]!.name).toBe(builtin.name);
  });

  it("達到收藏上限時不新增，並回一句能照做的說明", () => {
    const full = Array.from({ length: MAX_SAVED_BRUSHES }, (_, i) => sanitizeBrush({ id: `my.${i}` }));
    const result = collectBrush(full, { ...builtin }, "再一支");
    expect(result.id).toBeNull();
    expect(result.saved).toHaveLength(MAX_SAVED_BRUSHES);
    expect(result.error).toContain("收藏已滿");
  });

  it("連收兩支不會撞 id", () => {
    const first = collectBrush([], { ...builtin }, "A");
    const second = collectBrush(first.saved, { ...builtin }, "B");
    expect(second.saved.map((b) => b.id)).toEqual([...new Set(second.saved.map((b) => b.id))]);
  });
});

describe("updateSavedBrush", () => {
  it("改自己的筆會直接記住", () => {
    const saved = collectBrush([], { ...builtin }, "我的筆").saved;
    const next = updateSavedBrush(saved, { ...saved[0]!, size: 40 });
    expect(next[0]!.size).toBe(40);
  });

  it("內建筆刷改不動——調整只影響這次落筆", () => {
    const saved = collectBrush([], { ...builtin }, "我的筆").saved;
    const next = updateSavedBrush(saved, { ...builtin, size: 99 });
    expect(next).toEqual(saved);
    expect(BUILTIN_BRUSHES[0]!.size).toBe(builtin.size);
  });

  it("不在櫃子裡的 id 不會被偷偷加進去", () => {
    expect(updateSavedBrush([], { ...builtin, id: "幽靈", builtin: undefined })).toEqual([]);
  });
});

describe("removeSavedBrush / renameSavedBrush", () => {
  it("刪掉指定的一支", () => {
    const saved = collectBrush([], { ...builtin }, "A").saved;
    expect(removeSavedBrush(saved, saved[0]!.id)).toEqual([]);
    expect(removeSavedBrush(saved, "不存在")).toEqual(saved);
  });

  it("改名去頭尾空白並限長；空名字不動", () => {
    const saved = collectBrush([], { ...builtin }, "A").saved;
    expect(renameSavedBrush(saved, saved[0]!.id, "  新名字  ")[0]!.name).toBe("新名字");
    expect(renameSavedBrush(saved, saved[0]!.id, "   ")[0]!.name).toBe("A");
    expect(renameSavedBrush(saved, saved[0]!.id, "字".repeat(50))[0]!.name).toHaveLength(24);
  });
});

describe("workingCopy", () => {
  it("是複本——調整不會就地改到內建筆刷（凍結物件會丟例外）", () => {
    const copy = workingCopy(builtin);
    copy.size = 99;
    expect(builtin.size).not.toBe(99);
  });
});

describe("isTuned", () => {
  it("任何一項參數不同就算調過", () => {
    expect(isTuned(builtin, { ...builtin })).toBe(false);
    expect(isTuned(builtin, { ...builtin, size: builtin.size + 1 })).toBe(true);
    expect(isTuned(builtin, { ...builtin, color: "#123456" })).toBe(true);
    expect(isTuned(builtin, { ...builtin, taper: 0.99 })).toBe(true);
  });

  it("只改名字不算調參數", () => {
    expect(isTuned(builtin, { ...builtin, name: "改個名" })).toBe(false);
  });
});
