import { z } from "zod";

/**
 * AI 白板草圖：繪圖原語 DSL 與確定性展開器（純函式、零相依）。
 *
 * 為什麼不讓 LLM 直接吐筆畫座標：一筆手繪筆畫是上百個取樣點，LLM 的空間推理
 * 撐不起這個粒度——直接吐點陣列的結果是抖動、斷裂、比例失衡的線條，而且
 * token 成本爆炸。這裡把「畫什麼」與「怎麼畫」分開：
 *
 * - LLM 只輸出**高階原語**（構圖框、線、橢圓、箭頭、火柴人……），一張分鏡
 *   草圖約 10–40 個原語，是 LLM 撐得起的抽象層級；
 * - **展開器**把原語變成筆畫（取樣密度、筆壓曲線、手繪抖動），全部確定性
 *   合成——同一份原語永遠展開成同一份筆畫，所以可以單元測試。
 *
 * 座標系刻意用 0–1000 的正規化空間而不是白板像素：LLM 不必知道白板實際
 * 尺寸（16:9 或 9:16 都是同一套提示詞），換比例只是展開器的縮放參數。
 *
 * 輸出形狀與 client 的 BoardDoc（v:1）結構相容，但**這裡刻意不 import client
 * 的型別**——ADR-009 規定 shared 不得反向依賴 client。client 收到後一律過
 * `parseBoard`（那本來就是為不可信輸入設計的防禦入口），型別在那裡收斂。
 *
 * 誠實邊界：這是「分鏡草圖助手」不是「AI 畫師」。原語詞彙表就是天花板——
 * 它畫得出構圖框、主體簡筆與運鏡箭頭，畫不出精緻的人物肖像。分鏡語言
 * 本來就是簡筆畫，這個限制與使用場景契合，但不要對使用者過度承諾。
 */

/* ── 原語 schema（LLM 的輸出契約） ── */

/** 正規化座標：0–1000。小幅超界不丟棄——clamp 進界內（LLM 溢出一點很常見）；
 *  超過 ±4000 就是失控輸出，schema 直接退件——尺寸決定取樣點數，
 *  無上限的半徑會讓伺服器在同步展開迴圈裡卡死。 */
const coord = z.number().finite().min(-4000).max(4000);

const penSchema = z.enum(["pencil", "pen", "marker"]);
/** #rrggbb；壞值不整包退件，由展開器換成預設深灰（草圖容錯優先） */
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const baseFields = {
  /** 筆種，預設 pencil（草圖感） */
  pen: penSchema.optional(),
  /** 線色，預設深灰；強調處（箭頭、重點）LLM 可換色 */
  color: colorSchema.optional(),
};

export const sketchPrimitiveSchema = z.discriminatedUnion("kind", [
  /** 分鏡構圖外框（畫在白板邊緣往內 inset 處） */
  z.object({ kind: z.literal("frame"), inset: z.number().finite().optional(), ...baseFields }),
  z.object({ kind: z.literal("line"), x1: coord, y1: coord, x2: coord, y2: coord, ...baseFields }),
  z.object({
    kind: z.literal("polyline"),
    points: z.array(z.tuple([coord, coord])).min(2).max(64),
    ...baseFields,
  }),
  z.object({ kind: z.literal("rect"), x: coord, y: coord, w: coord, h: coord, ...baseFields }),
  z.object({ kind: z.literal("ellipse"), cx: coord, cy: coord, rx: coord, ry: coord, ...baseFields }),
  /** 運鏡／動線箭頭：桿＋兩撇箭頭，分鏡語言的核心詞彙 */
  z.object({ kind: z.literal("arrow"), x1: coord, y1: coord, x2: coord, y2: coord, ...baseFields }),
  /** 火柴人：cx,cy＝頭心，h＝全身高；pose 決定四肢角度 */
  z.object({
    kind: z.literal("stick_figure"),
    cx: coord,
    cy: coord,
    h: z.number().finite().min(1).max(4000),
    pose: z.enum(["stand", "walk", "run", "sit", "arms_up", "point"]).optional(),
    ...baseFields,
  }),
]);
export type SketchPrimitive = z.infer<typeof sketchPrimitiveSchema>;

/** 一張草圖的完整計畫。80 個原語已遠超一張分鏡草稿的需要，超過通常是 LLM 失控。 */
export const sketchPlanSchema = z.object({
  primitives: z.array(sketchPrimitiveSchema).min(1).max(80),
});
export type SketchPlan = z.infer<typeof sketchPlanSchema>;

/** 給 LLM 的 DSL 說明。與 schema 放同一檔：兩者分居兩檔遲早漂移。 */
export function sketchDslPromptBlock(): string {
  return `座標系：x,y 皆 0-1000（左上角 0,0），會等比映射到白板。
可用原語（每個是一個 JSON 物件，放進 "primitives" 陣列）：
- {"kind":"frame"}：分鏡構圖外框，通常放第一個
- {"kind":"line","x1":…,"y1":…,"x2":…,"y2":…}：直線（地平線、牆線）
- {"kind":"polyline","points":[[x,y],…]}：折線（山稜、道路、輪廓），2-64 個點
- {"kind":"rect","x":…,"y":…,"w":…,"h":…}：矩形（建築、窗、桌）
- {"kind":"ellipse","cx":…,"cy":…,"rx":…,"ry":…}：橢圓（太陽、頭、湖）
- {"kind":"arrow","x1":…,"y1":…,"x2":…,"y2":…}：箭頭（運鏡方向、人物動線）
- {"kind":"stick_figure","cx":…,"cy":…,"h":…,"pose":"stand|walk|run|sit|arms_up|point"}：火柴人，cx,cy 是頭的中心、h 是全身高
每個原語可加 "pen":"pencil|pen|marker"（預設 pencil）與 "color":"#rrggbb"（預設深灰；強調處才換色，整張最多兩色）。
畫法要求：這是分鏡草稿，不是插畫——先 frame 定構圖，再用最少的原語表達「誰、在哪、往哪動」；主體用 stick_figure 與簡單形狀，運鏡與動線用 arrow；原語總數 10-40 個。`;
}

/* ── 展開器（原語 → 筆畫） ── */

/** 與 client BoardDoc 結構相容的輸出形狀（刻意不 import client 型別，見檔頭） */
export interface SketchStrokePoint { x: number; y: number; p: number }
export interface SketchStroke {
  id: string;
  brush: {
    id: string; name: string; engine: "pencil" | "pen" | "marker";
    size: number; opacity: number; pressure: number; speed: number;
    grain: number; taper: number; color: string;
  };
  points: SketchStrokePoint[];
}
export interface SketchBoardDoc { v: 1; w: number; h: number; strokes: SketchStroke[] }

export interface ExpandSketchResult {
  doc: SketchBoardDoc;
  /** 超過 maxStrokes 被丟棄的筆畫數（>0 時 UI 要誠實顯示，不能默默少畫） */
  droppedStrokes: number;
  primitiveCount: number;
}

const DEFAULT_COLOR = "#2b2b30";
/** 單筆點數上限：超過就放寬取樣間距重算。2000 點已是貼著白板繞三圈的量。 */
const MAX_POINTS_PER_STROKE = 2000;

/**
 * 確定性偽隨機（mulberry32）。手繪抖動必須是「同輸入同輸出」——
 * 用 Math.random 的話同一份計畫每次展開長得都不一樣，測試無從斷言，
 * 使用者重看歷史也對不上當時畫的東西。
 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 筆刷樣板：尺寸按白板寬縮放（1600 寬時鉛筆 3px），换比例線不會忽粗忽細 */
function brushFor(pen: "pencil" | "pen" | "marker", color: string, boardW: number, index: number): SketchStroke["brush"] {
  const scale = boardW / 1600;
  const base = pen === "marker"
    ? { size: 10, opacity: 0.85, grain: 0.1, taper: 0.15 }
    : pen === "pen"
      ? { size: 4, opacity: 0.9, grain: 0.15, taper: 0.35 }
      : { size: 3, opacity: 0.72, grain: 0.55, taper: 0.3 };
  return {
    id: `ai.${pen}.${index}`,
    name: pen === "marker" ? "麥克筆" : pen === "pen" ? "原子筆" : "鉛筆",
    engine: pen,
    size: Math.max(1, Math.round(base.size * scale)),
    opacity: base.opacity,
    pressure: 0.6,
    speed: 0.2,
    grain: base.grain,
    taper: base.taper,
    color,
  };
}

/**
 * 折線頂點 → 手繪感筆畫點列。
 * 取樣間距與白板尺寸成比例；抖動幅度壓在線寬以下（要的是「手畫的」不是「畫壞的」）。
 * 筆壓兩端收細（taper 曲線），中段穩定 0.55–0.65。
 */
function verticesToPoints(
  vertices: Array<{ x: number; y: number }>,
  boardW: number,
  boardH: number,
  rand: () => number,
): SketchStrokePoint[] {
  let spacing = Math.max(3, (boardW / 1600) * 6);
  const jitter = Math.max(0.6, (boardW / 1600) * 1.4);

  const cl = (pt: { x: number; y: number }) => ({
    x: clamp(pt.x, 0, boardW),
    y: clamp(pt.y, 0, boardH),
  });

  for (;;) {
    const out: SketchStrokePoint[] = [];
    for (let i = 0; i < vertices.length - 1; i += 1) {
      const a = cl(vertices[i]!);
      const b = cl(vertices[i + 1]!);
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.round(dist / spacing));
      for (let s = i === 0 ? 0 : 1; s <= steps; s += 1) {
        const t = s / steps;
        out.push({
          x: clamp(a.x + (b.x - a.x) * t + (rand() - 0.5) * jitter * 2, 0, boardW),
          y: clamp(a.y + (b.y - a.y) * t + (rand() - 0.5) * jitter * 2, 0, boardH),
          p: 0.5,
        });
      }
    }
    if (out.length <= MAX_POINTS_PER_STROKE) {
      // 筆壓曲線：頭尾各 15% 漸入漸出，中段帶一點確定性起伏
      const n = out.length;
      for (let i = 0; i < n; i += 1) {
        const edge = Math.min(i, n - 1 - i) / Math.max(1, Math.floor(n * 0.15));
        const eased = Math.min(1, edge);
        out[i]!.p = clamp(0.25 + eased * 0.35 + (rand() - 0.5) * 0.06, 0.15, 0.75);
      }
      return out;
    }
    spacing *= 2; // 超長筆畫：放寬間距重算，而不是硬截斷讓線畫到一半消失
  }
}

/** 火柴人各 pose 的四肢端點（相對頭心、以全身高 h 為單位的比例座標） */
function stickFigureVertices(
  cx: number, cy: number, h: number,
  pose: "stand" | "walk" | "run" | "sit" | "arms_up" | "point",
): Array<Array<{ x: number; y: number }>> {
  const headR = h * 0.11;
  const neckY = cy + headR;
  const hipY = neckY + h * 0.34;
  const shoulderY = neckY + h * 0.06;
  const legLen = h * 0.36;
  const armLen = h * 0.26;
  const seg = (x1: number, y1: number, x2: number, y2: number) => [{ x: x1, y: y1 }, { x: x2, y: y2 }];

  // 軀幹（sit 時縮短、hip 前移）
  const hip = pose === "sit" ? { x: cx + h * 0.06, y: neckY + h * 0.26 } : { x: cx, y: hipY };
  const lines: Array<Array<{ x: number; y: number }>> = [seg(cx, neckY, hip.x, hip.y)];

  // 手臂
  if (pose === "arms_up") {
    lines.push(seg(cx, shoulderY, cx - armLen * 0.8, shoulderY - armLen * 0.85));
    lines.push(seg(cx, shoulderY, cx + armLen * 0.8, shoulderY - armLen * 0.85));
  } else if (pose === "point") {
    lines.push(seg(cx, shoulderY, cx + armLen * 1.05, shoulderY - armLen * 0.15));
    lines.push(seg(cx, shoulderY, cx - armLen * 0.5, shoulderY + armLen * 0.7));
  } else if (pose === "run") {
    lines.push(seg(cx, shoulderY, cx + armLen * 0.9, shoulderY - armLen * 0.4));
    lines.push(seg(cx, shoulderY, cx - armLen * 0.9, shoulderY + armLen * 0.35));
  } else if (pose === "walk") {
    lines.push(seg(cx, shoulderY, cx + armLen * 0.6, shoulderY + armLen * 0.5));
    lines.push(seg(cx, shoulderY, cx - armLen * 0.6, shoulderY + armLen * 0.55));
  } else {
    lines.push(seg(cx, shoulderY, cx - armLen * 0.4, shoulderY + armLen * 0.8));
    lines.push(seg(cx, shoulderY, cx + armLen * 0.4, shoulderY + armLen * 0.8));
  }

  // 腿
  if (pose === "sit") {
    lines.push([{ x: hip.x, y: hip.y }, { x: hip.x + legLen * 0.55, y: hip.y }, { x: hip.x + legLen * 0.55, y: hip.y + legLen * 0.55 }]);
    lines.push([{ x: hip.x, y: hip.y }, { x: hip.x + legLen * 0.4, y: hip.y }, { x: hip.x + legLen * 0.4, y: hip.y + legLen * 0.55 }]);
  } else if (pose === "run") {
    lines.push(seg(hip.x, hip.y, hip.x + legLen * 0.75, hip.y + legLen * 0.6));
    lines.push([{ x: hip.x, y: hip.y }, { x: hip.x - legLen * 0.5, y: hip.y + legLen * 0.5 }, { x: hip.x - legLen * 0.75, y: hip.y + legLen * 0.2 }]);
  } else if (pose === "walk") {
    lines.push(seg(hip.x, hip.y, hip.x + legLen * 0.45, hip.y + legLen * 0.9));
    lines.push(seg(hip.x, hip.y, hip.x - legLen * 0.45, hip.y + legLen * 0.9));
  } else {
    lines.push(seg(hip.x, hip.y, hip.x - legLen * 0.25, hip.y + legLen));
    lines.push(seg(hip.x, hip.y, hip.x + legLen * 0.25, hip.y + legLen));
  }
  return lines;
}

/** 橢圓取樣（含微幅起筆／收筆重疊，畫圓不留缺口的手繪慣性） */
function ellipseVertices(cx: number, cy: number, rx: number, ry: number): Array<{ x: number; y: number }> {
  // 取樣數雙界：下限 12 畫得圓，上限 720 擋住巨大半徑——展開是同步迴圈，
  // 這裡失控就是整個 event loop 卡死，不能只靠 schema 層擋
  const per = Math.min(720, Math.max(12, Math.round((Math.PI * (rx + ry)) / 14)));
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= per + 2; i += 1) {
    const t = (i / per) * Math.PI * 2 - Math.PI / 2;
    out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
  }
  return out;
}

/**
 * 原語計畫 → 白板文件。確定性：同一份 (plan, w, h) 永遠得到同一份筆畫。
 *
 * maxStrokes 到頂時**丟棄後面的原語**而不是丟最舊的筆畫（與手繪的 addStroke
 * 相反）：AI 的畫是一次成形的作品，畫到一半開始擦掉開頭比少畫結尾更糟。
 * 丟了多少要回報（droppedStrokes），UI 不准默默吞掉。
 */
export function expandSketch(
  plan: SketchPlan,
  opts: { w: number; h: number; maxStrokes: number },
): ExpandSketchResult {
  const w = Math.max(1, Math.round(opts.w));
  const h = Math.max(1, Math.round(opts.h));
  const maxStrokes = Math.max(1, Math.floor(opts.maxStrokes));
  const sx = w / 1000;
  const sy = h / 1000;

  const strokes: SketchStroke[] = [];
  let dropped = 0;
  let strokeIndex = 0;

  const pushVertexStroke = (
    vertices: Array<{ x: number; y: number }>,
    pen: "pencil" | "pen" | "marker",
    color: string,
  ) => {
    if (strokes.length >= maxStrokes) { dropped += 1; return; }
    const rand = seededRandom(0x51ec7 + strokeIndex * 7919);
    const points = verticesToPoints(vertices, w, h, rand);
    if (points.length < 2) return;
    strokes.push({
      id: `ai-s${strokeIndex}`,
      brush: brushFor(pen, color, w, strokeIndex),
      points,
    });
    strokeIndex += 1;
  };

  for (const prim of plan.primitives) {
    const pen = prim.pen ?? "pencil";
    const color = prim.color && /^#[0-9a-fA-F]{6}$/.test(prim.color) ? prim.color.toLowerCase() : DEFAULT_COLOR;
    const X = (v: number) => v * sx;
    const Y = (v: number) => v * sy;

    switch (prim.kind) {
      case "frame": {
        const inset = clamp(prim.inset ?? 24, 4, 200) * sx;
        pushVertexStroke(
          [
            { x: inset, y: inset }, { x: w - inset, y: inset },
            { x: w - inset, y: h - inset }, { x: inset, y: h - inset },
            { x: inset, y: inset },
          ],
          pen, color,
        );
        break;
      }
      case "line":
        pushVertexStroke([{ x: X(prim.x1), y: Y(prim.y1) }, { x: X(prim.x2), y: Y(prim.y2) }], pen, color);
        break;
      case "polyline":
        pushVertexStroke(prim.points.map(([px, py]) => ({ x: X(px), y: Y(py) })), pen, color);
        break;
      case "rect": {
        const x = X(prim.x); const y = Y(prim.y);
        const rw = X(prim.w); const rh = Y(prim.h);
        pushVertexStroke(
          [{ x, y }, { x: x + rw, y }, { x: x + rw, y: y + rh }, { x, y: y + rh }, { x, y }],
          pen, color,
        );
        break;
      }
      case "ellipse":
        // 半徑 clamp 到白板尺度：schema 已擋失控值，這裡把「大一點」收斂成「貼著板邊」
        pushVertexStroke(
          ellipseVertices(X(prim.cx), Y(prim.cy), Math.min(Math.abs(X(prim.rx)), w), Math.min(Math.abs(Y(prim.ry)), h)),
          pen, color,
        );
        break;
      case "arrow": {
        const x1 = X(prim.x1); const y1 = Y(prim.y1);
        const x2 = X(prim.x2); const y2 = Y(prim.y2);
        pushVertexStroke([{ x: x1, y: y1 }, { x: x2, y: y2 }], pen, color);
        // 箭頭兩撇：長度取桿長 22%（有上限），角度 ±150°
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = Math.min(Math.hypot(x2 - x1, y2 - y1) * 0.22, 46 * sx);
        for (const side of [-1, 1]) {
          const a = angle + side * (Math.PI * 5 / 6);
          pushVertexStroke(
            [{ x: x2, y: y2 }, { x: x2 + Math.cos(a) * head, y: y2 + Math.sin(a) * head }],
            pen, color,
          );
        }
        break;
      }
      case "stick_figure": {
        const cx = X(prim.cx); const cy = Y(prim.cy);
        const fh = Math.min(Math.abs(Y(prim.h)), h * 1.5);
        // 頭
        pushVertexStroke(ellipseVertices(cx, cy, fh * 0.11, fh * 0.11), pen, color);
        for (const limb of stickFigureVertices(cx, cy, fh, prim.pose ?? "stand")) {
          pushVertexStroke(limb, pen, color);
        }
        break;
      }
    }
  }

  return {
    doc: { v: 1, w, h, strokes },
    droppedStrokes: dropped,
    primitiveCount: plan.primitives.length,
  };
}
