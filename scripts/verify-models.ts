/**
 * 模型清查工具(盲點:「多數模型 verified=false 未實測」的安全清查)
 *
 * 模式一(預設,零成本,不碰網路):
 *   npx tsx scripts/verify-models.ts
 *   → 產出 docs/模型清查清單.md:列出所有 verified=false 的模型
 *     (類別/label/id/點數/來源需求/fal 模型頁連結/建議探測指令),供人工逐一查證。
 *
 * 模式二(單模型真實探測,會花錢,必須明確 opt-in):
 *   npx tsx scripts/verify-models.ts --probe "<模型id>" --yes
 *   → 用該模型的最小中性輸入真實呼叫 fal 一次,輪詢至完成並印結果。
 *
 * 金錢安全設計(防呆鏈,缺一即退出):
 *   1. --probe 的 id 必須存在於 shared/models.ts 的 MODELS(白名單,擋亂打端點);
 *   2. 需要來源素材的模型(needs 有值)一律拒絕探測——請在站內以素材實測;
 *   3. 環境必須有 FAL_KEY 且未設 FAL_MOCK(isMockMode() 為 false),否則探測無意義;
 *   4. 沒帶 --yes 只印「估 N 點(約 NT$N)」的費用預告,絕不送出請求;
 *   5. 一次只能探測一個模型(--probe 重複即拒),絕不批次——防連環扣費;
 *   6. 本腳本不改任何檔案內容(只寫報告),verified 改 true 一律由人工確認後手動改。
 */
import { writeFileSync } from "node:fs";
import {
  CATEGORIES,
  MODELS,
  endpointOf,
  tierLabel,
  type ModelCategory,
  type ModelEntry,
  type SourceKind,
} from "../shared/models";
import { falStatus, falSubmit, isMockMode } from "../server/services/fal";

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 120_000;

const NEEDS_LABEL: Record<SourceKind, string> = { image: "圖片", audio: "音訊", video: "影片", zip: "素材 zip" };

/** 各類別的最小中性探測輸入(只為驗證端點存在且能出貨,刻意極短省錢) */
const PROBE_PROMPTS: Partial<Record<ModelCategory, string>> = {
  "text-to-image": "一盞溫暖的燈,極簡水彩",
  "text-to-video": "一盞溫暖的燈,極簡水彩,鏡頭緩慢推近",
  llm: "回覆:OK",
  "text-to-speech": "測試",
  "text-to-audio": "溫暖平靜的鋼琴旋律,慢板",
};

/** fal 模型頁:實測規則為 https://fal.ai/models/<完整 app id>(含 fal-ai/ 前綴);
 *  any-llm 系列的 #子型號共用同一端點頁。另附站內搜尋連結,防日後改版連結失效。 */
function modelPageUrl(m: ModelEntry): string {
  return `https://fal.ai/models/${endpointOf(m)}`;
}
function modelSearchUrl(m: ModelEntry): string {
  const q = endpointOf(m).split("/").slice(1).join(" "); // 去 owner 段,其餘當關鍵字
  return `https://fal.ai/models?q=${encodeURIComponent(q)}`;
}

function probeCommand(m: ModelEntry): string {
  return `npx tsx scripts/verify-models.ts --probe "${m.id}"`; // id 可能含 #,必須加引號防 shell 當註解
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ═══ 模式一:產出清查清單(零成本) ═══ */

function runChecklist(): void {
  const unverified = MODELS.filter((m) => !m.verified);
  const probeable = unverified.filter((m) => !m.needs);
  const needsSource = unverified.filter((m) => m.needs);

  const lines: string[] = [
    "# 模型清查清單(未驗證模型,自動生成)",
    "",
    "> 產生方式:`npx tsx scripts/verify-models.ts`(單一真相:shared/models.ts)",
    "> verified=false = 模型 ID 依官方資料合理推定、尚未實測;失敗會自動退點,但上線前仍應逐一查證。",
    "> 查證方式:點「模型頁」人工核對 ID 與輸入欄位;或用「建議探測指令」花最小成本實測一次。",
    "",
    "## 未驗證模型清單",
    "",
    "| 類別 | 級別 | 模型 | 點數 | 需來源 | fal 模型頁 | 建議探測指令 |",
    "|---|---|---|---|---|---|---|",
  ];

  const order = { flagship: 0, economy: 1, budget: 2 } as const;
  for (const cat of CATEGORIES) {
    const rows = unverified
      .filter((m) => m.category === cat.id)
      .sort((a, b) => order[a.tier] - order[b.tier]);
    for (const m of rows) {
      const needs = m.needs ? NEEDS_LABEL[m.needs] : "—";
      const links = `[模型頁](${modelPageUrl(m)})<br/>[搜尋](${modelSearchUrl(m)})`;
      const suggest = m.needs
        ? `站內以素材實測(需${NEEDS_LABEL[m.needs]},探測模式不受理)`
        : `\`${probeCommand(m)}\``;
      lines.push(
        `| ${cat.label} | ${tierLabel(m.tier)} | ${m.label}<br/>\`${m.id}\` | ${m.points} | ${needs} | ${links} | ${suggest} |`,
      );
    }
  }

  const byCat = CATEGORIES.map((c) => ({ label: c.label, n: unverified.filter((m) => m.category === c.id).length }))
    .filter((c) => c.n > 0)
    .map((c) => `${c.label} ${c.n}`)
    .join("、");

  lines.push(
    "",
    "## 統計",
    "",
    `- 未驗證:**${unverified.length} / ${MODELS.length}**(${((unverified.length / MODELS.length) * 100).toFixed(0)}%);已驗證:${MODELS.length - unverified.length}`,
    `- 未驗證中:可直接探測(純提示詞輸入)**${probeable.length}** 個;需來源素材、請站內實測 **${needsSource.length}** 個`,
    `- 各類別未驗證:${byCat || "(無)"}`,
    "",
    "## 探測模式使用說明(單模型實測,會真實扣費)",
    "",
    "1. 先跑 `npx tsx scripts/verify-models.ts --probe \"<模型id>\"`(不加 `--yes`):只顯示估點與費用預告,**不會**呼叫 fal。",
    "2. 確認金額後補上 `--yes` 才真的送出:`npx tsx scripts/verify-models.ts --probe \"<模型id>\" --yes`。",
    "3. 防呆鏈(缺一即退出):id 必須在 shared/models.ts 白名單;需來源素材的模型一律拒絕;環境需 FAL_KEY 且未設 FAL_MOCK;必須帶 `--yes`。",
    "4. 一次只探測一個模型,絕不批次——防連環扣費。",
    "5. 探測用各類別的最小中性輸入(如「測試」「回覆:OK」),輪詢至多 120 秒;影片/音樂類較慢,逾時不代表失敗,可至 fal.ai 後台的 requests 查看。",
    "6. 探測成功後,**人工**把 shared/models.ts 該模型的 `verified` 改 `true`,再重跑本腳本與 `npx tsx scripts/gen-model-docs.ts` 同步文件(本腳本不代改程式碼)。",
    "",
  );

  writeFileSync(new URL("../docs/模型清查清單.md", import.meta.url), lines.join("\n"));
  console.log(
    `✓ docs/模型清查清單.md(總 ${MODELS.length} 模型|未驗證 ${unverified.length}|其中可探測 ${probeable.length}、需站內實測 ${needsSource.length})`,
  );
  console.log(`  探測單一模型:npx tsx scripts/verify-models.ts --probe "<模型id>"(先看估點,加 --yes 才會真的花錢)`);
}

/* ═══ 模式二:單模型真實探測(明確 opt-in 才花錢) ═══ */

/** 依錯誤原文給人話的可能原因 */
function explainFailure(error: string): string[] {
  const hints: string[] = [];
  if (/404|not\s*found/i.test(error)) hints.push("模型 ID 可能不存在或已改名——請到 fal.ai/models 搜尋現行名稱,並修正 shared/models.ts 的 id/endpoint。");
  if (/401|unauthorized/i.test(error)) hints.push("FAL_KEY 無效或過期——請確認金鑰。");
  if (/403|forbidden/i.test(error)) hints.push("金鑰無此模型權限(部分模型需在 fal 後台開通)。");
  if (/400|422|validation|unprocessable|schema/i.test(error)) hints.push("輸入欄位與模型 schema 不符——請對照模型頁的 API 文件,修正 shared/models.ts 的 input() 組裝。");
  if (/timeout|abort|network|fetch/i.test(error)) hints.push("網路逾時或佇列壅塞——可稍後重試(重試會再次扣費,請斟酌)。");
  if (!hints.length) hints.push("原因不明——請帶上面錯誤原文到 fal 模型頁/後台 requests 對照。");
  return hints;
}

async function runProbe(probeId: string, yes: boolean): Promise<void> {
  // 防呆 ①:白名單——id 必須在 MODELS(擋手滑打錯端點而對未知服務扣費)
  const model = MODELS.find((m) => m.id === probeId);
  if (!model) {
    console.error(`✗ 找不到模型:「${probeId}」不在 shared/models.ts 的 MODELS 白名單,不予探測。`);
    const near = MODELS.filter((m) => m.id.includes(probeId) || probeId.includes(m.id)).slice(0, 5);
    if (near.length) {
      console.error("  你是不是要找:");
      for (const m of near) console.error(`   - ${m.id}(${m.label})`);
    } else {
      console.error("  可先跑 npx tsx scripts/verify-models.ts 產出清單,從中複製正確 id。");
    }
    process.exit(1);
  }

  // 防呆 ②:需要來源素材的模型不受理(探測給不出合法來源,失敗也照樣進佇列風險)
  if (model.needs) {
    console.error(`✗ ${model.label}(${model.id})需要來源輸入(${NEEDS_LABEL[model.needs]})。`);
    console.error("  此模型需要來源輸入,請在站內以素材實測(生成失敗會自動退點,不會白扣)。");
    process.exit(1);
  }

  // 防呆 ③:必須是真實模式(有 FAL_KEY 且未設 FAL_MOCK)——假生成模式下探測驗證不了任何事
  if (isMockMode()) {
    const reason = !process.env.FAL_KEY ? "環境未設定 FAL_KEY" : "環境設了 FAL_MOCK=1(假生成模式)";
    console.error(`✗ 目前為假生成模式(${reason}),探測需要真實呼叫 fal 才有意義,已退出。`);
    console.error("  請在有 FAL_KEY、未設 FAL_MOCK 的環境執行。");
    process.exit(1);
  }

  const prompt = PROBE_PROMPTS[model.category];
  if (!prompt) {
    console.error(`✗ 類別「${model.category}」尚未定義安全探測輸入,為避免亂扣費不予探測;請人工於模型頁查證。`);
    process.exit(1);
  }

  if (model.verified) {
    console.log(`ℹ 注意:${model.label} 已標 verified=true,以下為重新實測。`);
  }

  // 防呆 ④:沒帶 --yes 只報價不送出
  if (!yes) {
    console.log(`模型:${model.label}(${model.id})|類別:${model.category}|端點:${endpointOf(model)}`);
    console.log(`探測輸入:「${prompt}」`);
    console.log("");
    console.log(`這會真實呼叫 fal,估 ${model.points} 點(約 NT$${model.points}),確認請加 --yes:`);
    console.log(`  ${probeCommand(model)} --yes`);
    console.log("(尚未呼叫 fal,未扣任何費用)");
    process.exit(0);
  }

  console.log(`▶ 探測 ${model.label}(${model.id})|估 ${model.points} 點(約 NT$${model.points})`);
  console.log(`  端點:${endpointOf(model)}|輸入:「${prompt}」`);

  const { requestId } = await falSubmit(endpointOf(model), model.kind, model.input(prompt, "16:9"));
  console.log(`  已送出,requestId=${requestId};每 ${POLL_INTERVAL_MS / 1000} 秒輪詢,上限 ${POLL_TIMEOUT_MS / 1000} 秒。`);

  const startedAt = Date.now();
  const STATUS_LABEL = { queued: "佇列中", running: "執行中", done: "完成", failed: "失敗" } as const;
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const st = await falStatus(endpointOf(model), model.kind, requestId);
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`  (${elapsed}s)${STATUS_LABEL[st.status]}`);

    if (st.status === "done") {
      console.log("");
      console.log("✓ 探測成功——端點存在、輸入合法、能取回成品:");
      if (st.resultUrl) console.log(`  成品 URL:${st.resultUrl}`);
      if (st.resultText) {
        const head = st.resultText.slice(0, 80);
        console.log(`  文字輸出(前 80 字):${head}${st.resultText.length > 80 ? "…" : ""}`);
      }
      console.log("");
      console.log(`→ 請人工確認成品無誤後,把 shared/models.ts 此模型(${model.id})的 verified 改 true,`);
      console.log("  並重跑 npx tsx scripts/verify-models.ts 與 npx tsx scripts/gen-model-docs.ts 同步文件。");
      process.exit(0);
    }
    if (st.status === "failed") {
      console.log("");
      console.error(`✗ 探測失敗。錯誤原文:${st.error ?? "(無錯誤訊息)"}`);
      console.error("  可能原因:");
      for (const h of explainFailure(st.error ?? "")) console.error(`   - ${h}`);
      console.error(`  模型頁:${modelPageUrl(model)}(查不到就搜:${modelSearchUrl(model)})`);
      process.exit(1);
    }
  }

  console.log("");
  console.log(`⚠ 已達輪詢上限 ${POLL_TIMEOUT_MS / 1000} 秒,任務仍在執行(影片/音樂類本來就慢,不代表失敗)。`);
  console.log(`  點數可能已消耗;請稍後至 fal.ai 後台的 requests 用 requestId=${requestId} 查看結果。`);
  console.log("  (請勿為了「看結果」重跑探測——重跑會再次扣費。)");
  process.exit(0);
}

/* ═══ CLI 入口 ═══ */

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log("用法:");
    console.log("  npx tsx scripts/verify-models.ts                      # 產出 docs/模型清查清單.md(零成本)");
    console.log('  npx tsx scripts/verify-models.ts --probe "<id>"        # 單模型費用預告(仍零成本)');
    console.log('  npx tsx scripts/verify-models.ts --probe "<id>" --yes  # 真實探測一次(會扣費)');
    return;
  }

  // 防呆 ⑤:絕不批次——--probe 只允許出現一次
  const probeFlags = args.filter((a) => a === "--probe");
  if (probeFlags.length > 1) {
    console.error("✗ 一次只能探測一個模型(--probe 只能出現一次)——防連環扣費。");
    process.exit(1);
  }

  const probeIdx = args.indexOf("--probe");
  if (probeIdx >= 0) {
    const probeId = args[probeIdx + 1];
    if (!probeId || probeId.startsWith("--")) {
      console.error('✗ --probe 後面要接模型 id,例如:--probe "fal-ai/flux-2/pro"(id 含 # 時必須加引號)。');
      process.exit(1);
    }
    await runProbe(probeId, args.includes("--yes"));
    return;
  }

  if (args.includes("--yes")) console.log("ℹ --yes 只在 --probe 模式有效,以下照常產出清查清單(零成本)。");
  runChecklist();
}

main().catch((err) => {
  console.error("✗ 執行中斷,發生未預期的錯誤(未完成的探測不會重試,不會連環扣費):");
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  console.error("  常見原因:網路/代理不通、FAL_KEY 權限、或模型端點回了非預期格式。");
  process.exit(1);
});
