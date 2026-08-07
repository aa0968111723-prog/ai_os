import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_BRUSHES, sanitizeBrush } from "./brushes";
import { addStroke, emptyBoardState, estimateBoardBytes, type Stroke } from "./boardDoc";
import {
  allBrushes,
  boardStorageKey,
  BRUSH_LIBRARY_KEY,
  clearStoredBoard,
  MAX_BOARD_BYTES,
  MAX_SAVED_BRUSHES,
  readBoard,
  readSavedBrushes,
  shotsWithDraft,
  writeBoard,
  writeSavedBrushes,
} from "./studioStorage";

const PROJECT = "proj-1";
const brush = BUILTIN_BRUSHES[0]!;

function stroke(id: string): Stroke {
  return { id, brush, points: [{ x: 5, y: 6, p: 0.7 }] };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("筆刷收藏", () => {
  it("存了再讀是同一批", () => {
    const mine = [sanitizeBrush({ id: "my.1", name: "我的粗簽字筆", engine: "pen", size: 12 })];
    writeSavedBrushes(mine);
    expect(readSavedBrushes()).toEqual(mine);
  });

  it("內建在前、收藏在後", () => {
    const mine = [sanitizeBrush({ id: "my.1", name: "我的筆" })];
    const all = allBrushes(mine);
    expect(all.slice(0, BUILTIN_BRUSHES.length)).toEqual([...BUILTIN_BRUSHES]);
    expect(all[all.length - 1].id).toBe("my.1");
  });

  it("手改儲存內容偽造 builtin 旗標無效——不會生出刪不掉的假內建筆刷", () => {
    window.localStorage.setItem(BRUSH_LIBRARY_KEY, JSON.stringify([{ id: "假內建", engine: "pen", builtin: true }]));
    expect(readSavedBrushes()[0].builtin).toBeUndefined();
  });

  it("壞掉的儲存內容回空陣列，不讓筆刷櫃整個打不開", () => {
    window.localStorage.setItem(BRUSH_LIBRARY_KEY, "{不是陣列");
    expect(readSavedBrushes()).toEqual([]);
    window.localStorage.setItem(BRUSH_LIBRARY_KEY, JSON.stringify({ nope: true }));
    expect(readSavedBrushes()).toEqual([]);
  });

  it("超過收藏上限只留前 N 支", () => {
    const many = Array.from({ length: MAX_SAVED_BRUSHES + 6 }, (_, i) => sanitizeBrush({ id: `my.${i}` }));
    writeSavedBrushes(many);
    expect(readSavedBrushes()).toHaveLength(MAX_SAVED_BRUSHES);
  });

  it("儲存被封鎖（隱私模式）時不丟例外", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeSavedBrushes([sanitizeBrush({ id: "my.1" })])).not.toThrow();
  });
});

describe("白板草稿", () => {
  it("每一鏡各存一份，互不覆蓋", () => {
    const a = addStroke(emptyBoardState(), stroke("a"), 10).doc;
    const b = addStroke(emptyBoardState(), stroke("b"), 10).doc;
    writeBoard(PROJECT, "shot-1", a);
    writeBoard(PROJECT, "shot-2", b);
    expect(readBoard(PROJECT, "shot-1")!.strokes[0].id).toBe("a");
    expect(readBoard(PROJECT, "shot-2")!.strokes[0].id).toBe("b");
  });

  it("沒選分鏡的自由塗鴉有自己的位置，選了分鏡也不會蓋掉", () => {
    expect(boardStorageKey(PROJECT, null)).toContain("_free");
    expect(boardStorageKey(PROJECT, null)).not.toBe(boardStorageKey(PROJECT, "shot-1"));
  });

  it("不同專案不互通", () => {
    writeBoard(PROJECT, "shot-1", addStroke(emptyBoardState(), stroke("a"), 10).doc);
    expect(readBoard("proj-2", "shot-1")).toBeNull();
  });

  it("清掉之後讀回 null", () => {
    writeBoard(PROJECT, "shot-1", addStroke(emptyBoardState(), stroke("a"), 10).doc);
    clearStoredBoard(PROJECT, "shot-1");
    expect(readBoard(PROJECT, "shot-1")).toBeNull();
  });

  it("有草稿的分鏡清單不含自由塗鴉，也不含別的專案", () => {
    writeBoard(PROJECT, "shot-1", addStroke(emptyBoardState(), stroke("a"), 10).doc);
    writeBoard(PROJECT, null, addStroke(emptyBoardState(), stroke("free"), 10).doc);
    writeBoard("proj-2", "shot-9", addStroke(emptyBoardState(), stroke("x"), 10).doc);
    expect([...shotsWithDraft(PROJECT)]).toEqual(["shot-1"]);
  });

  it("配額滿時只犧牲自由塗鴉，**絕不**動其他鏡的草稿", () => {
    writeBoard(PROJECT, "shot-old", addStroke(emptyBoardState(), stroke("old"), 10).doc);
    writeBoard(PROJECT, null, addStroke(emptyBoardState(), stroke("塗鴉"), 10).doc);
    let failures = 1;
    const real = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(window.localStorage, "setItem").mockImplementation((key: string, value: string) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("QuotaExceededError");
      }
      real(key, value);
    });
    expect(writeBoard(PROJECT, "shot-new", addStroke(emptyBoardState(), stroke("new"), 10).doc)).toBe(true);
    // 讓位的是暫存區
    expect(readBoard(PROJECT, null)).toBeNull();
    // 別鏡畫好的東西必須完好——為了存這一鏡而刪掉它，是把資料遺失偽裝成復原
    expect(readBoard(PROJECT, "shot-old")!.strokes.map((s) => s.id)).toEqual(["old"]);
  });

  it("超過單張白板的存檔預算時直接回 false，不做那一次卡住主執行緒的序列化", () => {
    const serialize = vi.spyOn(window.localStorage, "setItem");
    const huge = {
      v: 1 as const,
      w: 1600,
      h: 900,
      strokes: Array.from({ length: 500 }, (_, i) => ({
        id: `s${i}`,
        brush,
        points: Array.from({ length: 400 }, (_, j) => ({ x: j, y: j, p: 0.5 })),
      })),
    };
    expect(estimateBoardBytes(huge)).toBeGreaterThan(MAX_BOARD_BYTES);
    expect(writeBoard(PROJECT, "shot-1", huge)).toBe(false);
    expect(serialize).not.toHaveBeenCalled();
  });

  it("清乾淨仍寫不進去時回 false，讓 UI 有辦法講實話", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(writeBoard(PROJECT, "shot-1", emptyBoardState().doc)).toBe(false);
  });
});
