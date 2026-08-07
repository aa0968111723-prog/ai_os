import { describe, expect, it } from "vitest";
import {
  addStroke,
  boardSizeForFormat,
  estimateBoardBytes,
  clearBoard,
  emptyBoard,
  emptyBoardState,
  isBoardEmpty,
  nextStrokeId,
  parseBoard,
  redoBoard,
  serializeBoard,
  undoBoard,
  type Stroke,
} from "./boardDoc";
import { BUILTIN_BRUSHES } from "./brushes";

const brush = BUILTIN_BRUSHES[0]!;

function stroke(id: string): Stroke {
  return { id, brush, points: [{ x: 1, y: 1, p: 0.5 }, { x: 2, y: 2, p: 0.6 }] };
}

describe("編輯歷史", () => {
  it("復原把最後一筆搬進重做堆疊，重做再放回來", () => {
    let state = emptyBoardState();
    state = addStroke(state, stroke("a"), 100);
    state = addStroke(state, stroke("b"), 100);
    state = undoBoard(state);
    expect(state.doc.strokes.map((s) => s.id)).toEqual(["a"]);
    state = redoBoard(state, 100);
    expect(state.doc.strokes.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("復原後再畫新的一筆會清掉重做——分岔的歷史沒有正確答案", () => {
    let state = emptyBoardState();
    state = addStroke(state, stroke("a"), 100);
    state = undoBoard(state);
    state = addStroke(state, stroke("c"), 100);
    expect(state.redo).toEqual([]);
    expect(redoBoard(state, 100)).toBe(state);
  });

  it("空白板復原、無事可重做時原樣回傳（同一個參考，不觸發重繪）", () => {
    const state = emptyBoardState();
    expect(undoBoard(state)).toBe(state);
    expect(redoBoard(state, 100)).toBe(state);
    expect(clearBoard(state)).toBe(state);
  });

  it("清空之後仍能逐筆復原救回", () => {
    let state = emptyBoardState();
    state = addStroke(state, stroke("a"), 100);
    state = addStroke(state, stroke("b"), 100);
    state = clearBoard(state);
    expect(isBoardEmpty(state.doc)).toBe(true);
    state = redoBoard(state, 100);
    expect(state.doc.strokes.map((s) => s.id)).toEqual(["b"]);
  });
});

describe("筆畫上限（輕量版記憶體預算）", () => {
  it("超過上限時丟掉最舊的一筆", () => {
    let state = emptyBoardState();
    for (const id of ["a", "b", "c", "d"]) state = addStroke(state, stroke(id), 3);
    expect(state.doc.strokes.map((s) => s.id)).toEqual(["b", "c", "d"]);
  });

  it("上限為 0 或負值時仍至少留一筆（不會畫了等於沒畫）", () => {
    const state = addStroke(emptyBoardState(), stroke("a"), 0);
    expect(state.doc.strokes).toHaveLength(1);
  });
});

describe("序列化", () => {
  it("存檔再讀回是同一份白板", () => {
    let state = emptyBoardState(1200, 800);
    state = addStroke(state, stroke("a"), 100);
    const restored = parseBoard(serializeBoard(state.doc));
    expect(restored).toEqual(state.doc);
  });

  it("點存成扁平三元組並取整——體積與 stringify 成本直接決定會不會卡頓", () => {
    const doc = {
      ...emptyBoard(100, 50),
      strokes: [{ id: "a", brush, points: [{ x: 12.3456789, y: 98.7654321, p: 0.123456 }] }],
    };
    const json = serializeBoard(doc);
    expect(JSON.parse(json).s[0].p).toEqual([12.3, 98.8, 0.12]);
    // 物件形狀（{"x":…,"y":…,"p":…}）會大上數倍
    expect(json.length).toBeLessThan(JSON.stringify(doc).length);
    const back = parseBoard(json)!;
    expect(back.strokes[0].points[0]).toEqual({ x: 12.3, y: 98.8, p: 0.12 });
  });

  it("壞掉、空的、版本不符的一律回 null（不猜舊格式）", () => {
    expect(parseBoard(null)).toBeNull();
    expect(parseBoard("")).toBeNull();
    expect(parseBoard("{壞掉的 JSON")).toBeNull();
    expect(parseBoard(JSON.stringify({ v: 99, w: 1, h: 1, s: [] }))).toBeNull();
    expect(parseBoard(JSON.stringify({ v: 1, w: 1, h: 1 }))).toBeNull();
  });

  it("個別壞掉的筆畫被跳過，其餘照常還原", () => {
    const raw = JSON.stringify({
      v: 1,
      w: 100,
      h: 50,
      s: [
        { i: "ok", b: brush, p: [1, 1, 0.5] },
        { i: "沒有點", b: brush, p: [] },
        { i: "座標壞掉", b: brush, p: ["左邊", null, 1] },
        null,
      ],
    });
    const doc = parseBoard(raw)!;
    expect(doc.strokes.map((s) => s.id)).toEqual(["ok"]);
  });

  it("長度不是三的倍數（檔案被截斷）時只忽略殘餘，不炸掉整張白板", () => {
    const doc = parseBoard(JSON.stringify({ v: 1, w: 100, h: 50, s: [{ i: "a", b: brush, p: [1, 2, 0.5, 3, 4] }] }))!;
    expect(doc.strokes[0].points).toEqual([{ x: 1, y: 2, p: 0.5 }]);
  });

  it("筆刷欄位被竄改時收斂成合法筆刷，不讓壞資料進到渲染層", () => {
    const raw = JSON.stringify({
      v: 1,
      w: 100,
      h: 50,
      s: [{ i: "x", b: { engine: "雷射", size: 1e9, color: "url(http://evil)" }, p: [0, 0, 1] }],
    });
    const doc = parseBoard(raw)!;
    expect(doc.strokes[0].brush.engine).toBe("pen");
    expect(doc.strokes[0].brush.size).toBe(160);
    expect(doc.strokes[0].brush.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("尺寸不合法時退回預設，不會產生 0 或負的白板", () => {
    const doc = parseBoard(JSON.stringify({ v: 1, w: -5, h: "高", s: [] }))!;
    expect(doc.w).toBeGreaterThan(0);
    expect(doc.h).toBeGreaterThan(0);
  });
});

describe("estimateBoardBytes", () => {
  it("不必序列化就估得出大小（先 stringify 再嫌太大＝白卡主執行緒一次）", () => {
    const doc = {
      ...emptyBoard(),
      strokes: Array.from({ length: 20 }, (_, i) => ({
        id: `s${i}`,
        brush,
        points: Array.from({ length: 50 }, (_, j) => ({ x: j, y: j, p: 0.5 })),
      })),
    };
    const actual = serializeBoard(doc).length;
    const estimate = estimateBoardBytes(doc);
    // 只要同一個數量級、且不低估（低估會讓超大白板溜過守門）
    expect(estimate).toBeGreaterThanOrEqual(actual * 0.8);
    expect(estimate).toBeLessThan(actual * 3);
  });

  it("空白板估出來是很小的正數", () => {
    expect(estimateBoardBytes(emptyBoard())).toBeGreaterThan(0);
    expect(estimateBoardBytes(emptyBoard())).toBeLessThan(1000);
  });
});

describe("白板尺寸", () => {
  it("比例跟著專案比例走（單一真相在 @shared/models）", () => {
    const wide = boardSizeForFormat("16:9");
    expect(wide.w / wide.h).toBeCloseTo(16 / 9, 2);
    const tall = boardSizeForFormat("9:16");
    expect(tall.h).toBeGreaterThan(tall.w);
    expect(boardSizeForFormat("1:1").w).toBe(boardSizeForFormat("1:1").h);
  });

  it("認不得的比例退回 16:9，長邊不超過上限", () => {
    const unknown = boardSizeForFormat("香蕉");
    expect(unknown.w / unknown.h).toBeCloseTo(16 / 9, 2);
    expect(Math.max(unknown.w, unknown.h)).toBeLessThanOrEqual(1600);
  });
});

describe("emptyBoard", () => {
  it("是空的，且尺寸至少為 1（避免 0 尺寸 canvas）", () => {
    expect(isBoardEmpty(emptyBoard())).toBe(true);
    expect(emptyBoard(0, -3).w).toBeGreaterThan(0);
  });
});

describe("nextStrokeId", () => {
  it("同一毫秒連叫也不重複", () => {
    const ids = new Set(Array.from({ length: 50 }, () => nextStrokeId()));
    expect(ids.size).toBe(50);
  });
});
