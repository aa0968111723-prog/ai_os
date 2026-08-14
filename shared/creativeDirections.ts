/**
 * Creative Direction（創作方向）— Visual Creative UX v4 的核心語彙。
 *
 * 為什麼需要這一層：v3 的「產生 3 個變體」是同一份 prompt 送三次，差異只來自模型雜訊。
 * 使用者說「這幕不夠有張力」時，他要的不是三張很像的圖，而是**三個看得懂的不同做法**
 * （更靠近／低機位逆光／廣角孤立感）。方向要能被讀懂、被比較、被單獨採用。
 *
 * 為什麼不新開 schema：一個 Direction 就是「對這一鏡既有 direction 欄位的一份 delta」——
 * camera（ShotCamera）／performance（ShotPerformance）／action，加一句自然語言指示。
 * 這三個欄位 CURRENT 已經有了，`mergeShotDirection` 也已經是既有的合併語意。
 * Direction 只在**生成當下**虛擬套用，永遠不寫回 Shot：提案不等於已修改。
 *
 * Reference Lock（Keep）沿用既有的 continuity／錨點語彙：鎖住的家族本來就由
 * generationCore 的錨點層注入（角色身份、造型、場景、專案 Style），Direction 只動
 * Camera／Lighting／Action／Performance，所以「保持」是**結構上成立**的，
 * 不是靠一句提示詞求模型幫忙。keep 只是把這個事實講給模型與使用者聽。
 */
import { z } from "zod";
import {
  mergeShotDirection,
  formatShotDirection,
  SHOT_DIRECTION_FIELD_LABEL,
  shotCameraSchema,
  shotPerformanceSchema,
  type ShotCamera,
  type ShotPerformance,
} from "./story";
import type { VisualChoicePreview } from "./visualChoiceTypes";

/** 一輪 variants 的方向數上限（與 scenes.generateVariants 的 clientRequestIds 上限同口徑） */
export const MAX_CREATIVE_DIRECTIONS = 4;
export const MIN_CREATIVE_DIRECTIONS = 2;

/**
 * 可被「保持」的家族。
 *
 * 刻意與 visualCreativeSemantics 的 ProjectChoiceFamily 對齊（character/look/scene/prop）
 * 再加 style——那四個是 Shot 上的實體綁定，style 是專案層級。它們的共同點是：
 * **Direction 不會寫到它們**，所以宣告 keep 是誠實的。
 */
export const CREATIVE_KEEP_FAMILIES = ["character", "look", "scene", "prop", "style"] as const;
export type CreativeKeepFamily = (typeof CREATIVE_KEEP_FAMILIES)[number];

export const CREATIVE_KEEP_LABEL: Record<CreativeKeepFamily, string> = {
  character: "角色臉",
  look: "造型 Look",
  scene: "場景",
  prop: "道具",
  style: "專案 Style",
};

/**
 * Direction 唯一允許動的欄位集合。
 *
 * 這不是註解而是**執行期的守門**：compileDirection 會照這份白名單過濾，
 * 所以就算方向來源是 AI 提案或未來的 starter pack，也寫不進 Look／角色／場景。
 * 「這一輪只改 Camera / Lighting / Action / Performance」因此是可驗證的性質。
 */
export const DIRECTION_CAMERA_KEYS = [
  "shotSize",
  "angle",
  "movement",
  "focalLength",
  "lighting",
  "composition",
] as const satisfies readonly (keyof ShotCamera)[];

export const DIRECTION_PERFORMANCE_KEYS = ["emotion", "gaze"] as const satisfies readonly (keyof ShotPerformance)[];

export interface CreativeDirection {
  /** 批次內穩定 id（也是 Compare／版本清單上的標籤鍵）；不重命名 */
  id: string;
  /** 給人看的方向名，例如「更靠近人物」 */
  label: string;
  /** 一句話說明為什麼這樣做（創作者看得懂的理由，不是參數清單） */
  rationale?: string;
  /** 結構化變更：鏡頭語言 */
  camera?: Partial<ShotCamera>;
  /** 結構化變更：表演 */
  performance?: Partial<ShotPerformance>;
  /** 結構化變更：動作走位（空字串＝清掉這一鏡的走位） */
  action?: string;
  /** 自然語言補充指示，與結構化變更一起進生成 context */
  instruction?: string;
  /** 這個方向承諾不動的家族 */
  keep?: CreativeKeepFamily[];
  /**
   * 可替換的預覽資源（Tier 1 起手包用；缺圖時 VisualChoicePreview 走 SVG fallback）。
   * 純顯示欄位——sanitizeDirection 會把它丟掉，永遠不進生成 context 也不入庫。
   */
  previewResource?: VisualChoicePreview;
  /**
   * 這一鏡已經是這個樣子時，這個方向就沒有意義（提案不要再建議它）。
   *
   * 為什麼不能只看「結構化有沒有差」：一個方向通常同時設景別＋運鏡＋構圖，
   * 所以就算這一鏡已經是特寫，「更靠近人物」仍然會因為多帶了運鏡與構圖而
   * 被算成「有差」——提案於是每一鏡都給同樣三張卡。這裡讓起手包直接講明
   * 「什麼情況下我是多餘的」，用資料表達，不寫死判斷式。
   *
   * 語意：列出的欄位**全部**都已符合 → 視為多餘。值可以是多個候選（任一符合即算）。
   */
  redundantWhen?: {
    camera?: Partial<Record<keyof ShotCamera, string | readonly string[]>>;
    performance?: Partial<Record<keyof ShotPerformance, string | readonly string[]>>;
  };
}

/** 這一鏡是不是已經滿足了某個方向的「多餘條件」 */
export function directionIsRedundant(base: DirectionBaseShot, direction: CreativeDirection): boolean {
  const rule = direction.redundantWhen;
  if (!rule) return false;
  const check = (
    spec: Partial<Record<string, string | readonly string[]>> | undefined,
    actual: Record<string, string | undefined> | null | undefined,
  ): boolean => {
    if (!spec) return true;
    for (const [key, expected] of Object.entries(spec)) {
      if (expected === undefined) continue;
      const value = (actual?.[key] ?? "").trim();
      const candidates = typeof expected === "string" ? [expected] : [...expected];
      if (!candidates.includes(value)) return false;
    }
    return true;
  };
  return check(rule.camera, base.camera as Record<string, string | undefined> | null)
    && check(rule.performance, base.performance as Record<string, string | undefined> | null);
}

/**
 * 傳輸用 schema（tRPC 入口驗證）。
 *
 * camera/performance 直接沿用 shotCameraSchema／shotPerformanceSchema——
 * 這保證「方向能寫的欄位」與「Shot 本來就有的欄位」是同一組，長度上限也是同一份，
 * 不會出現「方向可以塞 500 字的光線，但同一欄位在 Shot 上限 60 字」這種分岔。
 * `.strict()` 讓越權欄位在**入口**就被拒，sanitizeDirection 則是第二道（AI 提案、
 * 起手包等不經 tRPC 的來源也要被濾）。
 */
export const creativeDirectionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(40),
  rationale: z.string().trim().max(120).optional(),
  camera: shotCameraSchema.strict().partial().optional(),
  performance: shotPerformanceSchema.strict().partial().optional(),
  action: z.string().trim().max(500).optional(),
  instruction: z.string().trim().max(500).optional(),
  keep: z.array(z.enum(CREATIVE_KEEP_FAMILIES)).max(CREATIVE_KEEP_FAMILIES.length).optional(),
}).strict();

/** 只留白名單內的鍵；值 trim 後為空＝「清掉這個欄位」（與 mergeShotDirection 同語意，保留 ""） */
function pickAllowed<T extends Record<string, string | undefined>>(
  patch: Partial<T> | undefined,
  allowed: readonly string[],
): Partial<T> | undefined {
  if (!patch) return undefined;
  const out: Record<string, string> = {};
  for (const key of allowed) {
    const value = patch[key as keyof T];
    if (value === undefined) continue;
    out[key] = typeof value === "string" ? value : "";
  }
  return Object.keys(out).length ? (out as Partial<T>) : undefined;
}

/**
 * 把一個 Direction 收斂成「可安全套用」的形狀。
 * 越權欄位（例如有人塞 lookIds）在這裡被丟掉，而不是靠呼叫端自律。
 */
export function sanitizeDirection(direction: CreativeDirection): CreativeDirection {
  const keep = [...new Set(direction.keep ?? [])].filter((family): family is CreativeKeepFamily =>
    (CREATIVE_KEEP_FAMILIES as readonly string[]).includes(family),
  );
  return {
    id: direction.id,
    label: direction.label,
    ...(direction.rationale ? { rationale: direction.rationale } : {}),
    ...(pickAllowed<ShotCamera>(direction.camera, DIRECTION_CAMERA_KEYS) ? { camera: pickAllowed<ShotCamera>(direction.camera, DIRECTION_CAMERA_KEYS) } : {}),
    ...(pickAllowed<ShotPerformance>(direction.performance, DIRECTION_PERFORMANCE_KEYS)
      ? { performance: pickAllowed<ShotPerformance>(direction.performance, DIRECTION_PERFORMANCE_KEYS) }
      : {}),
    ...(direction.action !== undefined ? { action: direction.action } : {}),
    ...(direction.instruction?.trim() ? { instruction: direction.instruction.trim() } : {}),
    ...(keep.length ? { keep } : {}),
  };
}

/** 一個 Shot 上「Direction 看得到」的欄位（虛擬套用的左手邊） */
export interface DirectionBaseShot {
  camera?: ShotCamera | null;
  performance?: ShotPerformance | null;
  action?: string | null;
}

export interface CompiledDirection {
  direction: CreativeDirection;
  /** 虛擬套用後的欄位；**不寫回 Shot**，只餵給這一次生成 */
  camera: ShotCamera | null;
  performance: ShotPerformance | null;
  action: string | null;
  /** 人話變更清單（Compare／確認卡用）；空＝這個方向對這一鏡其實沒有結構化差異 */
  changes: string[];
  /** 這個方向與基準相比是否真的有差（結構化或自然語言任一有內容） */
  differs: boolean;
  /**
   * 只看結構化欄位有沒有差。
   *
   * 與 differs 分開的理由：起手包的每個方向都帶一句不同的 instruction，
   * 如果把它算進「有沒有差」，那麼「這一鏡已經是特寫了，再選『更靠近人物』」
   * 永遠會被判定成有差——多樣性守門形同虛設，使用者照樣為一張幾乎一樣的圖付錢。
   */
  structurallyDiffers: boolean;
}

/**
 * 虛擬套用一個 Direction。
 *
 * 刻意回傳「新的欄位值」而不是就地改 scene：呼叫端拿它組一份 virtual scene 餵
 * buildShotContextPrompt，DB 的 Shot 一個位元組都不動。這是「提案 ≠ 已修改」的實作保證。
 */
export function compileDirection(base: DirectionBaseShot, raw: CreativeDirection): CompiledDirection {
  const direction = sanitizeDirection(raw);
  const camera = mergeShotDirection(base.camera ?? null, direction.camera ?? null);
  const performance = mergeShotDirection(base.performance ?? null, direction.performance ?? null);
  const action = direction.action !== undefined ? (direction.action.trim() || null) : (base.action ?? null);

  const changes: string[] = [];
  for (const key of [...DIRECTION_CAMERA_KEYS, ...DIRECTION_PERFORMANCE_KEYS]) {
    const before = ((base.camera as Record<string, string | undefined> | null | undefined)?.[key]
      ?? (base.performance as Record<string, string | undefined> | null | undefined)?.[key] ?? "").trim();
    const after = ((camera as Record<string, string | undefined> | null)?.[key]
      ?? (performance as Record<string, string | undefined> | null)?.[key] ?? "").trim();
    if (before === after) continue;
    changes.push(`${SHOT_DIRECTION_FIELD_LABEL[key] ?? key} ${before || "－"}→${after || "－"}`);
  }
  const baseAction = (base.action ?? "").trim();
  if (baseAction !== (action ?? "").trim()) changes.push(`動作 ${baseAction || "－"}→${action || "－"}`);

  return {
    direction,
    camera,
    performance,
    action,
    changes,
    differs: changes.length > 0 || !!direction.instruction,
    structurallyDiffers: changes.length > 0,
  };
}

/**
 * 生成 context 的 Direction 段落。
 *
 * 只回「Shot 層獨有」的補充；結構化的 camera/performance/action 已經由呼叫端塞進
 * virtual scene，會走既有的 buildShotContextPrompt／sceneVisualPrompt 出現在
 * `[鏡頭語言]`。這裡只加「這是哪個方向」與「保持什麼」與那句自然語言，
 * 不重複寫一遍鏡別——同一件事講兩遍對擴散模型是雜訊（同 buildShotContextPrompt 對 Look 的處理）。
 */
export function formatDirectionContext(compiled: CompiledDirection): string {
  const { direction } = compiled;
  const parts: string[] = [`[創作方向] ${direction.label}`];
  if (direction.keep?.length) {
    parts.push(`[保持不變] ${direction.keep.map((family) => CREATIVE_KEEP_LABEL[family]).join("、")}`);
  }
  if (direction.instruction) parts.push(`[方向指示] ${direction.instruction}`);
  return parts.join("\n\n");
}

/** Compare／版本列上的一行摘要：方向名＋實際結構化差異 */
export function summarizeDirection(compiled: CompiledDirection): string {
  const detail = compiled.changes.join("・");
  return detail ? `${compiled.direction.label}（${detail}）` : compiled.direction.label;
}

/**
 * 方向多樣性：兩個方向是不是真的不同。
 *
 * 存在的理由是這一輪的核心承諾——「三個變體必須是三個看得懂的不同方向」。
 * 若兩個方向套用到同一鏡後產生一樣的結構化結果、又沒有不同的自然語言指示，
 * 使用者付了三次點數卻只拿到同一題的三張抽卡。這支讓那件事在測試裡是可斷言的。
 */
export function directionsAreDistinct(a: CompiledDirection, b: CompiledDirection): boolean {
  /*
   * 逐鍵排序後再比。
   *
   * mergeShotDirection 是「先鋪 base 的鍵、再鋪 patch 的鍵」，所以兩個設了**相同值**
   * 但宣告順序不同的方向，合併出來的物件鍵序不同 ⇒ JSON.stringify 產生不同字串 ⇒
   * 會被判成「不同方向」。多樣性守門因此漏放，使用者為同一張圖付兩次錢。
   */
  const stable = (obj: Record<string, string | undefined> | null | undefined) =>
    obj ? Object.entries(obj).filter(([, v]) => v !== undefined).sort(([x], [y]) => (x < y ? -1 : 1)) : null;
  const key = (compiled: CompiledDirection) => JSON.stringify([
    stable(compiled.camera as Record<string, string | undefined> | null),
    stable(compiled.performance as Record<string, string | undefined> | null),
    compiled.action ?? null,
    compiled.direction.instruction ?? "",
  ]);
  return key(a) !== key(b);
}

/**
 * 一批方向的診斷：哪些方向對這一鏡其實沒差、哪些彼此重複。
 * 回空陣列＝這批方向對這一鏡真的是 N 個不同做法。
 */
export function diagnoseDirectionBatch(base: DirectionBaseShot, directions: readonly CreativeDirection[]): {
  compiled: CompiledDirection[];
  noop: string[];
  duplicates: Array<[string, string]>;
} {
  const compiled = directions.map((direction) => compileDirection(base, direction));
  // 用 structurallyDiffers 而不是 differs：起手包每個方向都帶一句自己的 instruction，
  // 拿 differs 判斷等於「永遠有差」，這道守門就永遠不會亮。
  const noop = compiled.filter((item) => !item.structurallyDiffers).map((item) => item.direction.id);
  const duplicates: Array<[string, string]> = [];
  for (let i = 0; i < compiled.length; i += 1) {
    for (let j = i + 1; j < compiled.length; j += 1) {
      if (!directionsAreDistinct(compiled[i]!, compiled[j]!)) {
        duplicates.push([compiled[i]!.direction.id, compiled[j]!.direction.id]);
      }
    }
  }
  return { compiled, noop, duplicates };
}

/** 直接看得到的鏡頭語言（Compare 面板的 Reference vs Candidate 對照用） */
export function formatCompiledDirectionLine(compiled: CompiledDirection): string {
  return formatShotDirection(compiled.camera, compiled.performance);
}
