/**
 * 從 shared/models.ts(單一真相)生成 docs/模型目錄.md
 * 用法:npx tsx scripts/gen-model-docs.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  CATEGORIES,
  MODELS,
  SCENARIO_GROUPS,
  SCENARIO_RECIPES,
  STYLE_SHOWDOWNS,
  WORKFLOW_PRESETS,
  getModel,
  tierLabel,
} from "../shared/models";
import type { ModelContractSnapshot } from "../shared/modelContract";

/** 決策層用:把模型 id 顯示成「名稱(級別・N 點)」;查無則原樣印出 id 方便抓錯 */
const refModel = (id: string): string => {
  const m = getModel(id);
  return m ? `${m.label}(${tierLabel(m.tier)}・${m.points} 點)` : `⚠︎查無:${id}`;
};

const lines: string[] = [
  "# 模型目錄(自動生成,單一真相在 shared/models.ts)",
  "",
  `> ${MODELS.length} 個模型 + ${WORKFLOW_PRESETS.length} 條工作流|${CATEGORIES.filter((c) => c.id !== "workflow").length} 類,每類至少 旗艦3+經濟3+最低成本1`,
  "> 1 點 ≈ NT$1;「成本」為 fal 官方約略價,實際帳單以 fal.ai/pricing 為準。",
  "> ⚠︎ = 模型 ID 依官方資料合理推定,正式模式首跑確認;失敗自動退點。",
  "> 契約健康見 `docs/model-audit/contracts/current.json`（`npx tsx scripts/sync-model-contracts.ts`）。",
  "",
];

/** 契約健康（有檔才填；避免腳本強相依） */
let healthById = new Map<string, string>();
try {
  const cpath = new URL("../docs/model-audit/contracts/current.json", import.meta.url);
  if (existsSync(cpath)) {
    const snap = JSON.parse(readFileSync(cpath, "utf8")) as ModelContractSnapshot;
    healthById = new Map(snap.models.map((m) => [m.id, m.health]));
    lines.push(
      "## 契約健康摘要（自動）",
      "",
      `> 產生於 ${snap.generatedAt}｜${snap.softStopNote}`,
      "",
      "```",
      JSON.stringify(snap.counts),
      "```",
      "",
      "| 健康 | 意義 |",
      "|---|---|",
      "| live_ok | 曾合法生成成功 |",
      "| live_timeout / live_fail | 曾 live 逾時或失敗 |",
      "| openapi_404 | OpenAPI 端點不存在 |",
      "| needs_source | 需素材，禁止空 live |",
      "| nim_no_key | NIM 分流 |",
      "| gemini_no_key | Gemini 原生 |",
      "| never_probed | 尚未 live |",
      "",
    );
  }
} catch {
  /* 無契約檔則略過 */
}

for (const cat of CATEGORIES) {
  const models = MODELS.filter((m) => m.category === cat.id);
  if (cat.id === "workflow") continue;
  lines.push(`## ${cat.label}(${cat.id})`, "", cat.hint, "");
  lines.push("| 級別 | 模型 | 點數 | 健康 | 官方約略價 | 特性 | 擅長 | 來源輸入 |");
  lines.push("|---|---|---|---|---|---|---|---|");
  const order = { flagship: 0, economy: 1, budget: 2 } as const;
  for (const m of [...models].sort((a, b) => order[a.tier] - order[b.tier])) {
    const health = healthById.get(m.id) ?? "—";
    lines.push(
      `| ${tierLabel(m.tier)} | ${m.label}${m.verified ? "" : " ⚠︎"}<br/>\`${m.id}\` | ${m.points} | ${health} | ${m.cost} | ${m.strengths} | ${m.bestFor} | ${m.sourceHint ?? "—"} |`,
    );
  }
  lines.push("");
}

lines.push("## 工作流(workflow,一鍵串鏈)", "", "在專案頁「工作流」卡執行;每步各自扣點、成品全部進生成紀錄。", "");
lines.push("| 級別 | 流程 | 估點 | 步驟 | 適合 |");
lines.push("|---|---|---|---|---|");
for (const w of WORKFLOW_PRESETS) {
  lines.push(`| ${tierLabel(w.tier)} | ${w.label} | ${w.points} | ${w.steps.map((s) => s.note).join(" → ")} | ${w.bestFor} |`);
}
/* ── 決策層:情境速查(對應模型指南頁「看情境」) ── */
lines.push("", "## 情境速查(看情境選模型)", "",
  "用「我要做什麼」直接查首選,不必先懂 11 類分法。首選 = 建議先用的模型;替代 = 同情境的備選。", "");
for (const g of SCENARIO_GROUPS) {
  const recipes = SCENARIO_RECIPES.filter((r) => r.group === g.id);
  if (!recipes.length) continue;
  lines.push(`### ${g.label}(${g.hint})`, "");
  lines.push("| 情境 | 首選 | 替代 | 為什麼 |");
  lines.push("|---|---|---|---|");
  for (const r of recipes) {
    const primary = refModel(r.pickIds[0]);
    const alts = r.pickIds.slice(1).map(refModel).join("、") || "—";
    lines.push(`| ${r.scene}<br/><span>${r.intent}</span> | ${primary} | ${alts} | ${r.why} |`);
  }
  lines.push("");
}

/* ── 決策層:風格 PK(對應模型指南頁「比風格」) ── */
lines.push("## 風格 PK(比風格:哪個風格用哪個模型)", "");
for (const s of STYLE_SHOWDOWNS) {
  lines.push(`### ${s.title}`, "", s.subtitle, "");
  lines.push("| 風格 / 需求 | 首選 | 次選 |");
  lines.push("|---|---|---|");
  for (const a of s.axes) {
    lines.push(`| ${a.axis}(${a.note}) | ${refModel(a.winnerId)} | ${a.runnerUpId ? refModel(a.runnerUpId) : "—"} |`);
  }
  lines.push("");
}

lines.push("## 挑選心法", "",
  "1. **不知道用哪個** → 先看上面「情境速查」照你要做的事查首選;要比同類風格看「風格 PK」。",
  "2. **先用最低成本試方向**(1–3 點),對了再用旗艦重做成品。",
  "3. **中文字要出現在畫面上** → Qwen Image 2.0(第一主力)/ Seedream 4.5 / Ideogram v3(英文)。",
  "4. **中文旁白** → MiniMax 2.6 HD(頂級)/ Qwen 3 TTS(量產省)/ Kokoro 中文(草稿)。",
  "5. **成本大戶是影片**:Veo 3.1 一支 5 秒 ≈ 32 點;先用 Wan 2.2 或 LTX 驗證腳本。",
  "6. **代理找模型**:MCP 工具 `find_model` / `get_model_contract`、tRPC `models.search`、或 `model_catalog` 表。",
  "7. **怕變動**：改 models 或審計後跑 `npx tsx scripts/sync-model-contracts.ts`，指南／MCP／生成共用 `contracts/current.json`。",
  "");

writeFileSync(new URL("../docs/模型目錄.md", import.meta.url), lines.join("\n"));
console.log(`✓ docs/模型目錄.md(${MODELS.length} 模型 + ${WORKFLOW_PRESETS.length} 工作流)`);
