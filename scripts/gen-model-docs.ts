/**
 * 從 shared/models.ts(單一真相)生成 docs/模型目錄.md
 * 用法:npx tsx scripts/gen-model-docs.ts
 */
import { writeFileSync } from "node:fs";
import { CATEGORIES, MODELS, WORKFLOW_PRESETS, tierLabel } from "../shared/models";

const lines: string[] = [
  "# 模型目錄(自動生成,單一真相在 shared/models.ts)",
  "",
  `> ${MODELS.length} 個模型 + ${WORKFLOW_PRESETS.length} 條工作流|11 類,每類 旗艦3+經濟3+最低成本1`,
  "> 1 點 ≈ NT$1;「成本」為 fal 官方約略價,實際帳單以 fal.ai/pricing 為準。",
  "> ⚠︎ = 模型 ID 依官方資料合理推定,真實模式首跑確認;失敗自動退點。",
  "",
];

for (const cat of CATEGORIES) {
  const models = MODELS.filter((m) => m.category === cat.id);
  if (cat.id === "workflow") continue;
  lines.push(`## ${cat.label}(${cat.id})`, "", cat.hint, "");
  lines.push("| 級別 | 模型 | 點數 | 官方約略價 | 特性 | 擅長 | 來源輸入 |");
  lines.push("|---|---|---|---|---|---|---|");
  const order = { flagship: 0, economy: 1, budget: 2 } as const;
  for (const m of [...models].sort((a, b) => order[a.tier] - order[b.tier])) {
    lines.push(
      `| ${tierLabel(m.tier)} | ${m.label}${m.verified ? "" : " ⚠︎"}<br/>\`${m.id}\` | ${m.points} | ${m.cost} | ${m.strengths} | ${m.bestFor} | ${m.sourceHint ?? "—"} |`,
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
lines.push("", "## 挑選心法", "",
  "1. **先用最低成本試方向**(1–3 點),對了再用旗艦重做成品。",
  "2. **中文字要出現在畫面上** → Seedream 4.5 / Ideogram v3 / Qwen。",
  "3. **中文旁白** → MiniMax 02 HD(頂級)/ ElevenLabs v3(情感)/ Kokoro 中文(草稿)。",
  "4. **成本大戶是影片**:Veo 3.1 一支 5 秒 ≈ 32 點;先用 Wan 2.2(8 點)或 LTX(3 點)驗證腳本。",
  "5. **代理找模型**:MCP 工具 `find_model`、tRPC `models.search`、或直接查 `model_catalog` 資料表。",
  "");

writeFileSync(new URL("../docs/模型目錄.md", import.meta.url), lines.join("\n"));
console.log(`✓ docs/模型目錄.md(${MODELS.length} 模型 + ${WORKFLOW_PRESETS.length} 工作流)`);
