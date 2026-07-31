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
import {
  CATEGORIES,
  MODELS,
  PRICE_AUDIO_MINUTES,
  PRICE_MUSIC_MINUTES,
  PRICE_V2V_MINUTES,
  PRICE_VIDEO_SECONDS,
  parseRealCost,
  tierLabel,
  type ModelEntry,
  type ParsedRealCost,
} from "../shared/models";

/* 解析與用量假設改為 import shared/models 的 parseRealCost——與「實價計點」同一支函式，
   報告永遠對得上實際扣點；匯率仍可用 TWD_PER_USD 覆寫（僅影響本報告的 NT$ 估值欄）。 */
const RATE = Number(process.env.TWD_PER_USD ?? 31);
const VIDEO_SECONDS = PRICE_VIDEO_SECONDS;
const AUDIO_MINUTES = PRICE_AUDIO_MINUTES;
const MUSIC_MINUTES = PRICE_MUSIC_MINUTES;
const V2V_MINUTES = PRICE_V2V_MINUTES;

interface Row {
  model: ModelEntry;
  parsed: ParsedRealCost;
  /** 換算後單次 NT$ 估值；null＝無法機械換算 */
  twd: number | null;
  /** points − twd（正＝點數收太多、負＝點數低於成本） */
  delta: number | null;
}

const rows: Row[] = MODELS.map((model) => {
  const parsed = parseRealCost(model.cost, model.category);
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
