/**
 * 點數校準（需求 #7：1 點 = NT$1，逐一比對官方成本）
 * 從 shared/models.ts 讀每個模型的 points（實際扣點）與 cost（官方約略價字串），
 * 解析出 USD 單價 → 依「典型用量假設」換算成單次生成的 NT$ 估值 → 與 points 比偏差，
 * 輸出 docs/點數校準報告.md（偏差大者列入建議調整清單）。
 *
 * 用法：npx tsx scripts/audit-model-pricing.ts
 * 可調：TWD_PER_USD（預設 31，對齊 models.ts 的「USD×31 估」）、
 *       VIDEO_SECONDS（影片單次秒數，預設 5）、AUDIO_MINUTES（轉錄單檔分鐘，預設 10）、
 *       MUSIC_MINUTES（配樂單首分鐘，預設 3）、V2V_MINUTES（對嘴/影片處理單支分鐘，預設 1）。
 *
 * 誠實原則：cost 是自由文字，按「單位」能機械換算的才算數；換算不了的列入「需人工比對」
 * 而不是硬給一個看似精確的數字。實際帳單以 fal.ai/pricing 與月帳單為準。
 */
import { writeFileSync } from "node:fs";
import { CATEGORIES, MODELS, tierLabel, type ModelEntry } from "../shared/models";

const RATE = Number(process.env.TWD_PER_USD ?? 31);
const VIDEO_SECONDS = Number(process.env.VIDEO_SECONDS ?? 5);
const AUDIO_MINUTES = Number(process.env.AUDIO_MINUTES ?? 10);
const MUSIC_MINUTES = Number(process.env.MUSIC_MINUTES ?? 3);
const V2V_MINUTES = Number(process.env.V2V_MINUTES ?? 1);

/** 「/分」的典型用量因類別而異：轉錄整檔開示、配樂一首、對嘴一支短片，長度天差地遠 */
function minutesFor(category: ModelEntry["category"]): { mul: number; note: string } {
  if (category === "speech-to-text") return { mul: AUDIO_MINUTES, note: `×${AUDIO_MINUTES} 分鐘（單檔轉錄假設）` };
  if (category === "text-to-audio") return { mul: MUSIC_MINUTES, note: `×${MUSIC_MINUTES} 分鐘（單首配樂假設）` };
  if (category === "video-to-video") return { mul: V2V_MINUTES, note: `×${V2V_MINUTES} 分鐘（單支短片假設）` };
  return { mul: 1, note: "×1 分鐘（保守假設）" };
}

/** 單位 → 單次生成的用量倍數與說明；不在表內＝無法機械換算 */
const UNIT_ASSUMPTIONS: Array<{ match: RegExp; multiplier: (m: ModelEntry) => { mul: number; note: string } }> = [
  { match: /^(張|圖|次|支|首|段|call)/i, multiplier: () => ({ mul: 1, note: "×1（每次一件）" }) },
  { match: /^MP/i, multiplier: () => ({ mul: 1, note: "×1MP（16:9 標準輸出 ≈ 1MP）" }) },
  { match: /^秒/, multiplier: () => ({ mul: VIDEO_SECONDS, note: `×${VIDEO_SECONDS} 秒（單鏡假設）` }) },
  { match: /^分(鐘)?/, multiplier: (m) => minutesFor(m.category) },
];

interface ParsedCost {
  /** 解析出的 USD 中值（範圍取中點）；null＝解析不了 */
  usdMid: number | null;
  /** 單位換算倍數；null＝單位不明 */
  multiplier: number | null;
  unitNote: string;
}

/** 從 "$0.06–0.16/張(依解析度)" 這類字串解析 USD 中值與單位倍數 */
function parseCost(cost: string, model: ModelEntry): ParsedCost {
  // 金額：$a 或 $a–b（同時容忍 - 與 ~ 當範圍號）
  const m = cost.match(/\$\s*([0-9]+(?:\.[0-9]+)?)(?:\s*[–\-~]\s*([0-9]+(?:\.[0-9]+)?))?/);
  if (!m) return { usdMid: null, multiplier: null, unitNote: "無 $ 金額" };
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  const usdMid = (lo + hi) / 2;

  const unitMatch = cost.match(/\/\s*([^\s（(]+)/);
  if (!unitMatch) return { usdMid, multiplier: 1, unitNote: "×1（未標單位，視為每次）" };
  const unit = unitMatch[1];
  for (const u of UNIT_ASSUMPTIONS) {
    if (u.match.test(unit)) {
      const r = u.multiplier(model);
      return { usdMid, multiplier: r.mul, unitNote: r.note };
    }
  }
  return { usdMid, multiplier: null, unitNote: `單位「/${unit}」需人工換算` };
}

interface Row {
  model: ModelEntry;
  parsed: ParsedCost;
  /** 換算後單次 NT$ 估值；null＝無法機械換算 */
  twd: number | null;
  /** points − twd（正＝點數收太多、負＝點數低於成本） */
  delta: number | null;
}

const rows: Row[] = MODELS.map((model) => {
  const parsed = parseCost(model.cost, model);
  const twd = parsed.usdMid !== null && parsed.multiplier !== null ? parsed.usdMid * parsed.multiplier * RATE : null;
  return { model, parsed, twd, delta: twd !== null ? model.points - twd : null };
});

/** 偏差判定：估值與點數差 ≥1 點且 ≥40% 才點名（cost 本身是約略價，小差不追） */
function verdict(r: Row): { flag: "ok" | "high" | "low" | "manual"; label: string } {
  if (r.twd === null) return { flag: "manual", label: "需人工" };
  const d = r.delta ?? 0;
  const base = Math.max(r.twd, 0.0001);
  if (Math.abs(d) >= 1 && Math.abs(d) / base >= 0.4) {
    return d > 0 ? { flag: "high", label: `偏高 +${d.toFixed(1)}` } : { flag: "low", label: `偏低 ${d.toFixed(1)}` };
  }
  return { flag: "ok", label: "≈" };
}

const fmt = (n: number | null, digits = 1): string => (n === null ? "—" : n.toFixed(digits));

const lines: string[] = [
  "# 點數 × 官方成本校準報告（自動生成）",
  "",
  `> 產生方式：\`npx tsx scripts/audit-model-pricing.ts\`（單一真相：shared/models.ts）`,
  `> 匯率假設 US$1 = NT$${RATE}；影片單次 ${VIDEO_SECONDS} 秒、轉錄單檔 ${AUDIO_MINUTES} 分鐘、配樂單首 ${MUSIC_MINUTES} 分鐘、影片處理單支 ${V2V_MINUTES} 分鐘。`,
  "> cost 為官方「約略價」字串，本表為機械換算的粗校準——**實際請以 fal.ai/pricing 與月帳單對帳**；",
  "> 「需人工」＝計價單位（tokens／訓練步數等）無法從單次生成推算，請人工比對。",
  "",
];

const flagged = rows.filter((r) => ["high", "low"].includes(verdict(r).flag));
const manual = rows.filter((r) => verdict(r).flag === "manual");

lines.push("## 總覽", "");
lines.push(`- 模型總數：${rows.length}`);
lines.push(`- 可機械換算：${rows.length - manual.length}；其中偏差 ≥1 點且 ≥40%：**${flagged.length}**`);
lines.push(`- 需人工比對（單位不可機械換算）：${manual.length}`);
lines.push("");

if (flagged.length) {
  lines.push("## 建議優先校準（偏差大）", "");
  lines.push("| 模型 | 類別 | 級別 | 點數 | 官方價 | 估值 NT$ | 判定 |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const r of [...flagged].sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))) {
    const v = verdict(r);
    lines.push(
      `| ${r.model.label}<br/>\`${r.model.id}\` | ${r.model.category} | ${tierLabel(r.model.tier)} | ${r.model.points} | ${r.model.cost} | ${fmt(r.twd)} | ${v.label} |`,
    );
  }
  lines.push("", "「偏高」＝向使用者收的點數高於估算成本（有緩衝，未必要降）；「偏低」＝**低於成本，長期會虧**，優先處理。", "");
}

lines.push("## 全表（依類別）", "");
for (const cat of CATEGORIES) {
  const catRows = rows.filter((r) => r.model.category === cat.id);
  if (!catRows.length) continue;
  lines.push(`### ${cat.label}（${cat.id}）`, "");
  lines.push("| 級別 | 模型 | 點數 | 官方價 | USD 中值 | 用量假設 | 估值 NT$ | 判定 |");
  lines.push("|---|---|---|---|---|---|---|---|");
  const order = { flagship: 0, economy: 1, budget: 2 } as const;
  for (const r of [...catRows].sort((a, b) => order[a.model.tier] - order[b.model.tier])) {
    const v = verdict(r);
    lines.push(
      `| ${tierLabel(r.model.tier)} | ${r.model.label}${r.model.verified ? "" : " ⚠︎"} | ${r.model.points} | ${r.model.cost} | ${fmt(r.parsed.usdMid, 3)} | ${r.parsed.unitNote} | ${fmt(r.twd)} | ${v.label} |`,
    );
  }
  lines.push("");
}

lines.push(
  "## 持續校準機制建議",
  "",
  "1. **實跑對帳**：每月把 fal 帳單總額（USD×匯率）與 `cost_ledger` 當月扣點總和比——整體毛差一眼可見。",
  "2. **改點數**：直接改 `shared/models.ts` 的 `points`，重新部署即生效（啟動時 `syncCatalog()` 會同步進 DB，工作流總點數自動重算）。",
  "3. **改完重跑本腳本**與 `npx tsx scripts/gen-model-docs.ts`，兩份文件保持同步。",
  "",
);

writeFileSync(new URL("../docs/點數校準報告.md", import.meta.url), lines.join("\n"));
console.log(`✓ docs/點數校準報告.md（${rows.length} 模型｜偏差 ${flagged.length}｜需人工 ${manual.length}）`);
