/**
 * 模型分析熱力圖的資料層（純函式，前後端與測試共用）。
 *
 * 熱力圖要回答的是清單回答不了的問題：**同一類模型攤開來，強弱長在哪裡**。
 * 一格一個「模型 × 指標」，顏色深＝這格分數高。
 *
 * 誠實規則（整站一致）：
 * 1. **沒有資料的格子不給顏色**，回 `score: null` 讓 UI 畫成空格——不是 0 分。
 *    「未公開的文字窗口」與「窗口很短」是兩件事，塗成同一種淺色就是說謊。
 * 2. 規格欄（spec）來自目錄與契約快照；實測欄（live）來自使用者自己的生成紀錄。
 *    兩者混在同一張圖時必須標示來源——別人的成功率不是這顆模型的性質。
 * 3. 相對指標（點數、使用量、速度）在**目前顯示的這批模型內**normalize，
 *    所以換一批模型顏色會變。這是刻意的：熱力圖是比較工具，不是絕對評分。
 */

/** 指標資料來源：目錄／契約規格，或使用者自己的實測 */
export type HeatmapSource = "spec" | "live";

export interface HeatmapRow {
  id: string;
  /** 每次生成扣點 */
  points: number;
  verified: boolean;
  /** 契約健康（live_ok／needs_source／openapi_404…） */
  health?: string | null;
  /** 文字窗口（token）；未公開＝null */
  textEncoderLimit?: number | null;
  supportsNegativePrompt?: boolean | null;
  supportsSeed?: boolean | null;
  /** 這位使用者近期在這顆模型上的實測聚合（沒跑過＝null） */
  usage?: {
    submits: number;
    done: number;
    failed: number;
    /** 送出到完成的平均秒數（沒有完成過＝null） */
    avgSeconds: number | null;
  } | null;
}

export interface HeatmapMetric {
  id: string;
  label: string;
  hint: string;
  source: HeatmapSource;
  /** 高分代表什麼（圖例用） */
  highMeans: string;
}

export const HEATMAP_METRICS: readonly HeatmapMetric[] = [
  { id: "cost", label: "省點數", hint: "每次生成扣的點數，與目前這批模型相比", source: "spec", highMeans: "越便宜" },
  { id: "window", label: "文字窗口", hint: "文字塔讀得進去的 token 數；未公開的不給分", source: "spec", highMeans: "讀得進越長的提示詞" },
  { id: "control", label: "可控性", hint: "有沒有負向提示與固定種子這兩顆旋鈕", source: "spec", highMeans: "旋鈕越齊" },
  { id: "health", label: "站內健康", hint: "站內契約探測與實跑結果", source: "spec", highMeans: "越確定跑得動" },
  { id: "verified", label: "已查證", hint: "端點與參數是否人工查證過", source: "spec", highMeans: "已查證" },
  { id: "successRate", label: "我的成功率", hint: "你自己送出的生成有多少完成", source: "live", highMeans: "越少失敗" },
  { id: "speed", label: "我的完成速度", hint: "你自己跑這顆模型的平均完成秒數", source: "live", highMeans: "越快完成" },
  { id: "usage", label: "我的使用量", hint: "你自己近期送出的次數", source: "live", highMeans: "用得越多" },
];

/** 契約健康 → 分數。openapi_404 是 0（真的跑不動），未實測是 null（不知道，不是不好） */
const HEALTH_SCORE: Record<string, number | null> = {
  live_ok: 1,
  needs_source: 0.7,
  nim_no_key: 0.6,
  live_timeout: 0.3,
  live_fail: 0.15,
  openapi_404: 0,
  never_probed: null,
  unknown: null,
};

const HEALTH_DISPLAY: Record<string, string> = {
  live_ok: "實測成功",
  needs_source: "需素材",
  nim_no_key: "走 NIM",
  live_timeout: "曾逾時",
  live_fail: "實測失敗",
  openapi_404: "端點異常",
  never_probed: "未實測",
  unknown: "無資料",
};

export interface HeatmapContext {
  /** 目前這批模型的點數範圍（相對 normalize 用） */
  minPoints: number;
  maxPoints: number;
  maxSubmits: number;
  minSeconds: number;
  maxSeconds: number;
}

/** 從目前顯示的這批模型算出相對比較的基準 */
export function buildHeatmapContext(rows: readonly HeatmapRow[]): HeatmapContext {
  const points = rows.map((r) => r.points).filter((n) => Number.isFinite(n) && n > 0);
  const submits = rows.map((r) => r.usage?.submits ?? 0);
  const seconds = rows
    .map((r) => r.usage?.avgSeconds)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);
  return {
    minPoints: points.length ? Math.min(...points) : 0,
    maxPoints: points.length ? Math.max(...points) : 0,
    maxSubmits: submits.length ? Math.max(...submits) : 0,
    minSeconds: seconds.length ? Math.min(...seconds) : 0,
    maxSeconds: seconds.length ? Math.max(...seconds) : 0,
  };
}

export interface HeatmapCell {
  /** 0–1；null＝這格沒有資料（UI 必須畫成空格，不是 0 分） */
  score: number | null;
  /** 這格的原始值（滑過看得到的那行字） */
  display: string;
}

/** 點數／時間這種長尾量用對數 normalize：$0.003 與 $3 差三個數量級，線性會把整排壓成同一色 */
function logNormalize(value: number, min: number, max: number): number {
  if (!(value > 0) || !(min > 0) || !(max > 0) || max <= min) return 0.5;
  const t = (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return Math.min(1, Math.max(0, t));
}

/** 文字窗口 77（CLIP）→ 512（T5／umT5）是實際的兩端，超過就滿分 */
function windowScore(limit: number): number {
  return Math.min(1, Math.max(0, (Math.log(limit) - Math.log(77)) / (Math.log(512) - Math.log(77))));
}

export function heatmapCell(metricId: string, row: HeatmapRow, ctx: HeatmapContext): HeatmapCell {
  switch (metricId) {
    case "cost": {
      if (!(row.points > 0)) return { score: null, display: "無報價" };
      // 便宜＝高分，所以取反
      return { score: 1 - logNormalize(row.points, ctx.minPoints, ctx.maxPoints), display: `${row.points} 點/次` };
    }
    case "window": {
      if (row.textEncoderLimit == null) return { score: null, display: "窗口未公開" };
      return { score: windowScore(row.textEncoderLimit), display: `${row.textEncoderLimit} tok` };
    }
    case "control": {
      const neg = row.supportsNegativePrompt;
      const seed = row.supportsSeed;
      if (neg == null && seed == null) return { score: null, display: "無契約資料" };
      const score = (neg ? 0.5 : 0) + (seed ? 0.5 : 0);
      const parts = [neg ? "負向提示" : null, seed ? "固定種子" : null].filter(Boolean);
      return { score, display: parts.length ? parts.join("＋") : "兩顆旋鈕都沒有" };
    }
    case "health": {
      const key = row.health && row.health in HEALTH_SCORE ? row.health : "unknown";
      return { score: HEALTH_SCORE[key] ?? null, display: HEALTH_DISPLAY[key] ?? "無資料" };
    }
    case "verified":
      return { score: row.verified ? 1 : 0, display: row.verified ? "已查證" : "待首跑確認" };
    case "successRate": {
      const u = row.usage;
      if (!u || u.submits <= 0) return { score: null, display: "你還沒跑過" };
      return { score: u.done / u.submits, display: `${Math.round((u.done / u.submits) * 100)}%（${u.done}/${u.submits}）` };
    }
    case "speed": {
      const s = row.usage?.avgSeconds;
      if (s == null || !(s > 0)) return { score: null, display: "你還沒跑完過" };
      // 快＝高分
      return { score: 1 - logNormalize(s, ctx.minSeconds, ctx.maxSeconds), display: `平均 ${Math.round(s)} 秒` };
    }
    case "usage": {
      const n = row.usage?.submits ?? 0;
      if (n <= 0) return { score: null, display: "你還沒跑過" };
      return { score: ctx.maxSubmits > 0 ? n / ctx.maxSubmits : null, display: `${n} 次` };
    }
    default:
      return { score: null, display: "—" };
  }
}

/**
 * 一列的綜合分：只把**有資料**的格子平均，缺資料不算 0。
 * 用途是排序（強的排前面），不是拿來當「這顆模型幾分」的宣稱——
 * 指標怎麼選就決定誰贏，這件事 UI 要講清楚。
 */
export function rowAverage(row: HeatmapRow, metricIds: readonly string[], ctx: HeatmapContext): number | null {
  const scores = metricIds
    .map((id) => heatmapCell(id, row, ctx).score)
    .filter((s): s is number => typeof s === "number");
  if (!scores.length) return null;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}
