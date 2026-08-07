import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_BRUSHES } from "./brushes";
import type { Stroke } from "./boardDoc";
import { resolveStudioLayout } from "./studioLayout";
import { readBoard, writeBoard } from "./studioStorage";
import { BOARD_AUTOSAVE_MS, useBoardSession } from "./useBoardSession";

const PROJECT = "proj-1";
const SIZE = { w: 1600, h: 900 };
const LAYOUT = resolveStudioLayout({ viewportWidth: 1440 });
const LITE = resolveStudioLayout({ viewportWidth: 390 });

function stroke(id: string): Stroke {
  return { id, brush: BUILTIN_BRUSHES[0]!, points: [{ x: 1, y: 2, p: 0.5 }, { x: 3, y: 4, p: 0.6 }] };
}

function mount(layout = LAYOUT) {
  return renderHook(() => useBoardSession(PROJECT, SIZE, layout));
}

/** 自動存檔是節流的，測試要把時間往前推 */
function flushAutosave() {
  act(() => { vi.advanceTimersByTime(BOARD_AUTOSAVE_MS + 10); });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useBoardSession", () => {
  it("畫完一筆、停筆之後才寫本機（每一筆都寫會在長筆畫時卡頓）", () => {
    const { result } = mount();
    act(() => result.current.pushStroke(stroke("a")));
    expect(readBoard(PROJECT, null)).toBeNull();
    flushAutosave();
    expect(readBoard(PROJECT, null)!.strokes.map((s) => s.id)).toEqual(["a"]);
  });

  it("切換分鏡會把目前這張存回**原本那一鏡**，不會蓋到別鏡", () => {
    const { result } = mount();
    act(() => result.current.switchTo("shot-1"));
    act(() => result.current.pushStroke(stroke("第一鏡的筆")));
    act(() => result.current.switchTo("shot-2"));
    act(() => result.current.pushStroke(stroke("第二鏡的筆")));
    flushAutosave();

    expect(readBoard(PROJECT, "shot-1")!.strokes.map((s) => s.id)).toEqual(["第一鏡的筆"]);
    expect(readBoard(PROJECT, "shot-2")!.strokes.map((s) => s.id)).toEqual(["第二鏡的筆"]);
  });

  it("切回去時讀得回原本那一鏡的手稿", () => {
    const { result } = mount();
    act(() => result.current.switchTo("shot-1"));
    act(() => result.current.pushStroke(stroke("a")));
    act(() => result.current.switchTo("shot-2"));
    expect(result.current.board.doc.strokes).toHaveLength(0);
    act(() => result.current.switchTo("shot-1"));
    expect(result.current.board.doc.strokes.map((s) => s.id)).toEqual(["a"]);
  });

  it("離開創作室時補存一次（節流視窗內關掉分頁不該少一筆）", () => {
    const { result, unmount } = mount();
    act(() => result.current.switchTo("shot-1"));
    act(() => result.current.pushStroke(stroke("最後一筆")));
    unmount();
    expect(readBoard(PROJECT, "shot-1")!.strokes.map((s) => s.id)).toEqual(["最後一筆"]);
  });

  it("進站讀回上次的自由塗鴉", () => {
    writeBoard(PROJECT, null, { v: 1, w: SIZE.w, h: SIZE.h, strokes: [stroke("上次畫的")] });
    const { result } = mount();
    expect(result.current.board.doc.strokes.map((s) => s.id)).toEqual(["上次畫的"]);
  });

  it("有手稿的分鏡列進 draftIds，存成畫面之後就撤掉標記", () => {
    const { result } = mount();
    act(() => result.current.switchTo("shot-1"));
    act(() => result.current.pushStroke(stroke("a")));
    flushAutosave();
    expect(result.current.draftIds.has("shot-1")).toBe(true);
    act(() => result.current.markSaved("shot-1"));
    expect(result.current.draftIds.has("shot-1")).toBe(false);
  });

  it("清空會一併清掉本機那份與草稿標記，但仍可逐筆復原救回", () => {
    const { result } = mount();
    act(() => result.current.switchTo("shot-1"));
    act(() => result.current.pushStroke(stroke("a")));
    flushAutosave();
    act(() => result.current.clear());
    expect(result.current.board.doc.strokes).toHaveLength(0);
    expect(readBoard(PROJECT, "shot-1")).toBeNull();
    expect(result.current.draftIds.has("shot-1")).toBe(false);
    act(() => result.current.redo());
    expect(result.current.board.doc.strokes.map((s) => s.id)).toEqual(["a"]);
  });

  it("復原／重做走同一份歷史", () => {
    const { result } = mount();
    act(() => result.current.pushStroke(stroke("a")));
    act(() => result.current.pushStroke(stroke("b")));
    act(() => result.current.undo());
    expect(result.current.board.doc.strokes.map((s) => s.id)).toEqual(["a"]);
    act(() => result.current.redo());
    expect(result.current.board.doc.strokes.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("輕量版的筆畫上限真的生效（超過就丟最舊的）", () => {
    const { result } = mount(LITE);
    act(() => {
      for (let i = 0; i < LITE.maxStrokes + 5; i += 1) result.current.pushStroke(stroke(`s${i}`));
    });
    expect(result.current.board.doc.strokes).toHaveLength(LITE.maxStrokes);
    expect(result.current.board.doc.strokes[0]!.id).toBe("s5");
  });

  it("重複選同一鏡不做任何事（不會白寫一次本機）", () => {
    const { result } = mount();
    act(() => result.current.switchTo("shot-1"));
    const before = result.current.board;
    act(() => result.current.switchTo("shot-1"));
    expect(result.current.board).toBe(before);
  });

  it("本機空間滿了要說出來，不是默默丟掉", () => {
    const { result } = mount();
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    act(() => result.current.pushStroke(stroke("a")));
    flushAutosave();
    expect(result.current.storageFull).toBe(true);
  });
});
