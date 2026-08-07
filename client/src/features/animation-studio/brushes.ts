/**
 * 筆刷模型與筆跡數學（純函式，不碰 DOM／canvas）。
 *
 * 為什麼把這一層抽出來：手繪的手感全在「壓力→線寬」「速度→收筆」「取樣間距」
 * 這幾條曲線上。它們寫在 pointermove 事件處理器裡就永遠測不到——手感壞掉只能
 * 用手指在真機上試。抽成純函式後，每一條曲線都有斷言守著（見 brushes.test.ts），
 * 而 `WhiteboardCanvas` 只負責「把算好的點畫出來」。
 *
 * 另一個理由是**筆刷可收藏**：使用者調過的參數要能存進 localStorage、之後再讀回來。
 * 從儲存讀回的東西一律不可信（手改、舊版格式、寫壞的 JSON），所以 `sanitizeBrush`
 * 是這一層的公開入口——任何外部來源的筆刷都要先過它。
 */

/** 筆尖種類：決定畫的時候用哪種筆跡渲染（見 boardRender.ts） */
export type BrushEngine = "pen" | "pencil" | "marker" | "ink" | "spray" | "eraser";

export interface BrushSpec {
  id: string;
  name: string;
  engine: BrushEngine;
  /** 基準線寬（px，100% 縮放下的直徑） */
  size: number;
  /** 不透明度 0.02–1 */
  opacity: number;
  /** 壓力對線寬的影響 0（完全不受壓力影響）–1（幾乎全由壓力決定） */
  pressure: number;
  /** 速度對線寬的影響 0–1：毛筆快揮要變細，麥克筆不該變 */
  speed: number;
  /** 顆粒抖動 0–1：鉛筆／粉筆的紙紋感 */
  grain: number;
  /** 收筆漸細 0–1：一筆最後幾個取樣點的縮率 */
  taper: number;
  /** #rrggbb；橡皮擦忽略此值 */
  color: string;
  /** 內建筆刷不可刪改，只能「調過之後另存成自己的」 */
  builtin?: boolean;
}

export const BRUSH_ENGINE_LABEL: Record<BrushEngine, string> = {
  pen: "原子筆",
  pencil: "鉛筆",
  marker: "麥克筆",
  ink: "毛筆",
  spray: "噴槍",
  eraser: "橡皮擦",
};

/** 參數範圍：sanitize 與 UI 滑桿共用同一份上下限，不各寫一套 */
export const BRUSH_LIMITS = {
  size: { min: 1, max: 160 },
  opacity: { min: 0.02, max: 1 },
  unit: { min: 0, max: 1 },
} as const;

/**
 * 內建筆刷櫃。刻意只有六支：每一支解決一種畫法，
 * 再多就變成「挑筆刷比畫圖久」。要更多變化靠調參數後收藏成自己的。
 */
export const BUILTIN_BRUSHES: readonly BrushSpec[] = Object.freeze([
  { id: "builtin.pencil", name: "鉛筆", engine: "pencil", size: 3, opacity: 0.72, pressure: 0.7, speed: 0.2, grain: 0.55, taper: 0.3, color: "#2b2b30", builtin: true },
  { id: "builtin.pen", name: "簽字筆", engine: "pen", size: 4, opacity: 1, pressure: 0.35, speed: 0.15, grain: 0, taper: 0.45, color: "#16223b", builtin: true },
  { id: "builtin.ink", name: "毛筆", engine: "ink", size: 14, opacity: 0.95, pressure: 0.85, speed: 0.6, grain: 0.1, taper: 0.9, color: "#101014", builtin: true },
  { id: "builtin.marker", name: "麥克筆", engine: "marker", size: 22, opacity: 0.42, pressure: 0.1, speed: 0, grain: 0, taper: 0, color: "#f2b24a", builtin: true },
  { id: "builtin.spray", name: "噴槍", engine: "spray", size: 34, opacity: 0.3, pressure: 0.5, speed: 0.1, grain: 0.8, taper: 0.1, color: "#ef6a4e", builtin: true },
  { id: "builtin.eraser", name: "橡皮擦", engine: "eraser", size: 26, opacity: 1, pressure: 0.3, speed: 0, grain: 0, taper: 0, color: "#000000", builtin: true },
]);

export const DEFAULT_BRUSH_ID = "builtin.pencil";

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** 顏色一律收斂成 #rrggbb：canvas 的 fillStyle 吃得下 `url(...)`／CSS 變數等奇怪值，
 *  但那些東西存進收藏再讀回來就變成無法預期的畫面（甚至外連資源）。 */
export function sanitizeColor(value: unknown, fallback = "#16223b"): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (HEX_COLOR.test(trimmed)) return trimmed.toLowerCase();
  // #abc 短寫也接受，展開成六位
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function isEngine(value: unknown): value is BrushEngine {
  return typeof value === "string" && value in BRUSH_ENGINE_LABEL;
}

/**
 * 把任何外部來源（localStorage、匯入、舊版）的物件收斂成合法筆刷。
 * 缺欄位補預設、超範圍夾回範圍——絕不丟例外，否則一筆壞資料會讓整個筆刷櫃打不開。
 */
export function sanitizeBrush(input: unknown, fallbackId = "brush"): BrushSpec {
  const raw = (input ?? {}) as Partial<BrushSpec>;
  const engine = isEngine(raw.engine) ? raw.engine : "pen";
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 24) : BRUSH_ENGINE_LABEL[engine];
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 64) : fallbackId;
  return {
    id,
    name,
    engine,
    size: Math.round(clampNumber(raw.size, BRUSH_LIMITS.size.min, BRUSH_LIMITS.size.max, 4)),
    opacity: clampNumber(raw.opacity, BRUSH_LIMITS.opacity.min, BRUSH_LIMITS.opacity.max, 1),
    pressure: clampNumber(raw.pressure, 0, 1, 0.4),
    speed: clampNumber(raw.speed, 0, 1, 0.2),
    grain: clampNumber(raw.grain, 0, 1, 0),
    taper: clampNumber(raw.taper, 0, 1, 0.3),
    color: sanitizeColor(raw.color),
    ...(raw.builtin ? { builtin: true as const } : {}),
  };
}

/** 依 id 取筆刷；找不到回內建預設（不回 undefined——呼叫端沒有「沒有筆」這個狀態） */
export function findBrush(brushes: readonly BrushSpec[], id: string | null | undefined): BrushSpec {
  return (
    brushes.find((b) => b.id === id) ??
    brushes.find((b) => b.id === DEFAULT_BRUSH_ID) ??
    brushes[0] ??
    sanitizeBrush({ id: DEFAULT_BRUSH_ID, name: "鉛筆", engine: "pencil" })
  );
}

/** 收藏時給新筆刷一個不會撞到的 id（不用亂數：同一秒連存兩支也要能分開） */
export function nextBrushId(existing: readonly BrushSpec[], seed = "my"): string {
  let n = existing.length + 1;
  let id = `${seed}.${n}`;
  while (existing.some((b) => b.id === id)) {
    n += 1;
    id = `${seed}.${n}`;
  }
  return id;
}

export interface StrokePoint {
  x: number;
  y: number;
  /** 筆壓 0–1；沒有壓感的裝置一律給 0.5（見 normalizePressure） */
  p: number;
}

/**
 * 筆壓正規化。滑鼠／不支援壓感的觸控回報 pressure=0（未按）或 0.5（PointerEvent 規格
 * 對無壓感裝置的預設）。直接拿 0 去乘線寬會畫出「看不見的一筆」——這是最常見的
 * 「我畫了但沒東西」災情，所以在入口就把 0 視為「沒有壓感資訊」。
 */
export function normalizePressure(raw: number | undefined, hasPressure: boolean): number {
  if (!hasPressure || typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return 0.5;
  return Math.min(1, raw);
}

/**
 * 單點線寬：基準寬 × 壓力項 × 速度項。
 *
 * - 壓力項：`1 - pressure*(1 - p)`——pressure=0 時恆為 1（完全不受壓力影響）。
 * - 速度項：速度越快越細（毛筆的飛白）；speed=0 時恆為 1。
 * - 結果夾在 0.35px 以上，避免高解析度下算出小於一個像素的「隱形筆畫」。
 */
export function strokeWidthAt(brush: BrushSpec, pressure: number, speedPxPerMs = 0): number {
  const p = Math.min(1, Math.max(0, pressure));
  const pressureTerm = 1 - brush.pressure * (1 - p);
  // 2px/ms（≈120px/幀）視為「很快」；再快也只收到 speed 設定的下限
  const fast = Math.min(1, Math.max(0, speedPxPerMs) / 2);
  const speedTerm = 1 - brush.speed * 0.75 * fast;
  return Math.max(0.35, brush.size * pressureTerm * speedTerm);
}

/**
 * 收筆漸細係數：一筆的最後 `tailRatio` 段落線性縮到 (1-taper)。
 * index/total 用「已走過的比例」而非固定點數——短筆畫也要有收尾，不然只有長線條看起來像筆。
 */
export function taperFactor(brush: BrushSpec, index: number, total: number): number {
  if (brush.taper <= 0 || total < 2) return 1;
  const tailRatio = 0.25;
  const progress = index / (total - 1);
  if (progress <= 1 - tailRatio) return 1;
  const intoTail = (progress - (1 - tailRatio)) / tailRatio;
  return 1 - brush.taper * intoTail;
}

/**
 * 移動平均平滑（視窗 3）。頭尾點保持原位——把端點也平均掉，
 * 會讓每一筆的起點微微飄離手指按下的位置，畫細節時特別明顯。
 */
export function smoothPoints(points: readonly StrokePoint[]): StrokePoint[] {
  if (points.length < 3) return points.map((pt) => ({ ...pt }));
  const out: StrokePoint[] = [{ ...points[0]! }];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    out.push({
      x: (a.x + b.x + c.x) / 3,
      y: (a.y + b.y + c.y) / 3,
      p: (a.p + b.p + c.p) / 3,
    });
  }
  out.push({ ...points[points.length - 1]! });
  return out;
}

/**
 * 依間距重新取樣：噴槍／顆粒筆是「沿著路徑蓋章」，章與章的間距必須固定，
 * 否則畫慢的地方糊成一團、畫快的地方變虛線。
 */
export function resamplePath(points: readonly StrokePoint[], spacing: number): StrokePoint[] {
  const step = Math.max(0.5, spacing);
  if (points.length === 0) return [];
  const out: StrokePoint[] = [{ ...points[0]! }];
  let carry = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) continue;
    let travelled = step - carry;
    while (travelled <= dist) {
      const t = travelled / dist;
      out.push({
        x: prev.x + dx * t,
        y: prev.y + dy * t,
        p: prev.p + (cur.p - prev.p) * t,
      });
      travelled += step;
    }
    carry = (carry + dist) % step;
  }
  return out;
}

/**
 * 落筆取樣抽稀（Ramer–Douglas–Peucker）。
 *
 * pointermove 給的點極度冗餘——手停在原地、或畫一條直線時，一秒可以收到上百個
 * 幾乎共線的點。它們對畫面毫無貢獻，卻要付三份成本：重畫時的線段數、
 * 記憶體、以及存進本機時的 JSON 體積（實測佔一半以上）。
 *
 * 只在**落筆結束時**抽一次：畫的當下不動（手感要跟著每一個取樣點走），
 * 存進文件的才是抽稀後的版本。容差 0.75px 在肉眼下看不出差別。
 *
 * 壓力跟著保留點走——壓力是決定線寬的來源，不能在抽稀時被平均掉。
 */
export function simplifyStroke(points: readonly StrokePoint[], tolerance = 0.75): StrokePoint[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  // 迭代式（不遞迴）：長筆畫有上萬個點，遞迴會爆堆疊
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;
    const a = points[first]!;
    const b = points[last]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let worstIndex = -1;
    for (let i = first + 1; i < last; i += 1) {
      const p = points[i]!;
      // 起訖同點時退化成「離起點多遠」
      const dist = len === 0
        ? Math.hypot(p.x - a.x, p.y - a.y)
        : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
      if (dist > worst) {
        worst = dist;
        worstIndex = i;
      }
    }
    if (worst > tolerance && worstIndex > 0) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }
  const out: StrokePoint[] = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push({ ...points[i]! });
  return out;
}

/** 兩點間的速度（px/ms）；時間差為 0 或負值時回 0（不是無限大） */
export function speedBetween(a: { x: number; y: number; t: number }, b: { x: number; y: number; t: number }): number {
  const dt = b.t - a.t;
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y) / dt;
}
