#!/usr/bin/env node
/**
 * Spike：NVIDIA NIM 是否支援原生 tool calling（WP1 的唯一未知數）。
 *
 * 為什麼需要這支腳本：
 *   `server/routers/assistant.ts` 目前用貪婪 regex `raw.match(/\{[\s\S]*\}/)` 從模型回覆
 *   裡撈 JSON 當工具呼叫，因為 `server/services/nvidia-nim.ts:chatCompletion` 的 request
 *   body 從來沒有帶過 `tools`。但預設模型是 `meta/llama-3.1-70b-instruct`，端點是
 *   OpenAI 相容的 integrate.api.nvidia.com/v1——Llama 3.1 這個模型家族本來就支援原生
 *   tool calling，能力可能一直都在，只是沒接。
 *
 *   關鍵風險是「模型家族支援 ≠ 該部署啟用」：NVIDIA 自架 NIM 容器要同時給
 *   `--enable-auto-tool-choice` 與 `--tool-call-parser` 才會開啟 tool calling，而 NVIDIA
 *   託管端點是否對每顆模型都開了，官方文件沒有逐一列表。這只能實測。
 *
 *   在這支腳本回答之前，不要動 WP1（原生 tool calling 與共用迴圈）——如果 NIM 不支援，
 *   WP1 要改走「JSON schema 約束 + repair round」的降級路線，形狀完全不同。
 *
 * 用法：
 *   NVIDIA_NIM_API_KEY=nvapi-xxx node scripts/spike-nim-tool-calling.mjs
 *   NVIDIA_NIM_API_KEY=nvapi-xxx node scripts/spike-nim-tool-calling.mjs --model meta/llama-3.1-405b-instruct
 *   NVIDIA_NIM_API_KEY=nvapi-xxx node scripts/spike-nim-tool-calling.mjs --all   # 掃 NVIDIA_MODELS 全部
 *
 * 退出碼：
 *   0 = 至少受測的預設模型支援原生 tool calling（WP1 走原生路線）
 *   1 = 不支援或被端點拒絕（WP1 走降級路線）
 *   2 = 設定問題（沒金鑰、網路不通），結論未知
 *
 * 這支腳本刻意不 import 專案任何模組：它要能在還沒裝依賴、還沒起服務的機器上單獨跑。
 */

const ENDPOINT =
  process.env.NVIDIA_NIM_ENDPOINT?.trim().replace(/\/$/, "") || "https://integrate.api.nvidia.com/v1";
const API_KEY = process.env.NVIDIA_NIM_API_KEY?.trim();

/** 與 server/services/nvidia-nim.ts 的 NVIDIA_MODELS 同源（手抄，因為本腳本不 import 專案模組） */
const MODELS = {
  llama3_70b: "meta/llama-3.1-70b-instruct",
  llama3_405b: "meta/llama-3.1-405b-instruct",
  llama3_8b: "meta/llama-3.1-8b-instruct",
  mistralLarge: "mistralai/mistral-large-2-instruct",
  qwen2_5_72b: "qwen/qwen2.5-72b-instruct",
  nemotron: "nvidia/nemotron-4-340b-instruct",
  deepseekR1: "deepseek-ai/deepseek-r1",
};
const DEFAULT_MODEL = process.env.NVIDIA_NIM_MODEL?.trim() || MODELS.llama3_70b;

/**
 * 受測工具刻意抄站內助手真正在用的兩個唯讀工具（server/routers/assistant.ts:222），
 * 而不是文件範例常見的 get_weather——參數形狀（可選 enum、可選字串）貼近真實用法，
 * 才測得出「模型會不會亂填必填欄位」這種真實會踩到的問題。
 */
const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_assets",
      description: "列出這個專案素材庫裡的素材。被問到素材名稱或某素材是否存在時必須先呼叫。",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["image", "video", "audio", "doc"], description: "只列某一類素材；省略＝全部" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_scene",
      description: "讀某一鏡的完整內容（提示詞與旁白全文）。",
      parameters: {
        type: "object",
        properties: { sceneNo: { type: "integer", description: "分鏡編號，第 3 鏡＝3" } },
        required: ["sceneNo"],
      },
    },
  },
];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const optionValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function log(...parts) {
  console.log(...parts);
}

async function post(body, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ENDPOINT}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 保留 raw text 供診斷 */
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/** 單一模型的完整判定：能不能收 tools、會不會回 tool_calls、參數對不對、平行呼叫支不支援。 */
async function probe(model) {
  const result = {
    model,
    reachable: false,
    inconclusive: false,
    inconclusiveReason: null,
    acceptsToolsParam: false,
    returnsToolCalls: false,
    argumentsParseable: false,
    respectsRequiredArg: false,
    supportsParallel: false,
    finishReason: null,
    httpStatus: null,
    error: null,
  };

  // 探測 0（baseline）：**不帶 tools** 的最小請求。
  //
  // 這一步是 2026-08-07 實測踩出來的：在有出站白名單的環境裡，帶 tools 的請求收到 403
  // 「Host not in allowlist」，腳本卻把它判成「這個部署不支援 tools」——完全的假陰性，
  // 而且會直接害 WP1 走錯路線。任何在公司代理後面跑這支腳本的人都會踩到同一個坑。
  //
  // 所以：先確認「不帶 tools 都通不通」。baseline 就失敗＝連線／金鑰／政策問題，結論一律
  // 未知（exit 2）；只有 baseline 成功、帶 tools 才失敗，才能斷定是這個部署不吃 tools。
  const baseline = await post({
    model,
    messages: [{ role: "user", content: "回一個字：好" }],
    temperature: 0,
    max_tokens: 16,
  });
  if (!baseline.ok) {
    result.httpStatus = baseline.status;
    const body = baseline.json?.detail ?? baseline.json?.message ?? baseline.text?.slice(0, 400) ?? "";
    result.inconclusive = true;
    result.error = body;
    // 代理／出站政策擋下（403「not in allowlist」、407）與 NVIDIA 自己的 401 金鑰問題要分開講，
    // 因為兩者的下一步完全不同：前者找管理員開白名單，後者換金鑰。
    if (/allowlist|egress|not allowed|proxy/i.test(String(body)) || baseline.status === 407) {
      result.inconclusiveReason = `出站政策擋住 ${new URL(ENDPOINT).host}——不是 NIM 的答案。請把這個主機加進網路白名單，或改在能直連的機器上跑。`;
    } else if (baseline.status === 401 || baseline.status === 402) {
      result.inconclusiveReason = "金鑰無效或額度用完——換一把金鑰再跑。";
    } else if (baseline.status === 429) {
      result.inconclusiveReason = "被限流（NIM 免費層約每分鐘 40 次）——等一分鐘再跑。";
    } else {
      result.inconclusiveReason = `連 baseline（不帶 tools）都失敗，HTTP ${baseline.status}——先確認端點與金鑰能通，再談 tool calling。`;
    }
    return result;
  }
  result.reachable = true;

  // 探測 1：送 tools + 一個明顯該呼叫 list_assets 的問題。
  const single = await post({
    model,
    messages: [
      { role: "system", content: "你是專案助手。需要專案實際資料時一律呼叫工具，不要憑空回答。" },
      { role: "user", content: "素材庫裡有哪些圖片？" },
    ],
    tools: TOOLS,
    tool_choice: "auto",
    temperature: 0.2,
    max_tokens: 512,
  });
  result.httpStatus = single.status;

  if (!single.ok) {
    // baseline 已經通過，所以這裡的失敗才真的歸因於 tools 參數本身。
    // 400 通常就是「這個部署不吃 tools」——與 nvidia-nim.ts 對 logprobs 的 400 降級同一種訊號。
    result.error = single.json?.detail ?? single.json?.message ?? single.text?.slice(0, 400);
    return result;
  }
  result.acceptsToolsParam = true;

  const choice = single.json?.choices?.[0];
  result.finishReason = choice?.finish_reason ?? null;
  const calls = choice?.message?.tool_calls;
  if (Array.isArray(calls) && calls.length > 0) {
    result.returnsToolCalls = true;
    const first = calls[0];
    try {
      const parsed = JSON.parse(first?.function?.arguments ?? "{}");
      result.argumentsParseable = true;
      // list_assets 的 kind 是可選的；模型填了 image 是加分，沒填也算正確
      result.calledTool = first?.function?.name ?? null;
      result.calledArgs = parsed;
    } catch {
      result.argumentsParseable = false;
      result.calledRawArguments = first?.function?.arguments;
    }
  }

  // 探測 2：必填參數。問「第 3 鏡在講什麼」應呼叫 read_scene 且帶 sceneNo:3。
  //  模型漏填必填欄位是原生 tool calling 最常見的坑，值得單獨測。
  const required = await post({
    model,
    messages: [
      { role: "system", content: "你是專案助手。需要專案實際資料時一律呼叫工具。" },
      { role: "user", content: "第 3 鏡在講什麼？" },
    ],
    tools: TOOLS,
    tool_choice: "auto",
    temperature: 0.2,
    max_tokens: 512,
  });
  const reqCall = required.json?.choices?.[0]?.message?.tool_calls?.[0];
  if (reqCall?.function?.name === "read_scene") {
    try {
      const parsed = JSON.parse(reqCall.function.arguments ?? "{}");
      result.respectsRequiredArg = typeof parsed.sceneNo === "number";
      result.requiredArgs = parsed;
    } catch {
      result.respectsRequiredArg = false;
    }
  }

  // 探測 3：平行工具呼叫。WP1 的迴圈要不要支援同一輪多工具，取決於這題。
  const parallel = await post({
    model,
    messages: [
      { role: "system", content: "你是專案助手。需要專案實際資料時一律呼叫工具，可一次呼叫多個。" },
      { role: "user", content: "素材庫有哪些影片？另外第 2 鏡的內容是什麼？" },
    ],
    tools: TOOLS,
    tool_choice: "auto",
    temperature: 0.2,
    max_tokens: 512,
  });
  const parallelCalls = parallel.json?.choices?.[0]?.message?.tool_calls;
  result.supportsParallel = Array.isArray(parallelCalls) && parallelCalls.length > 1;
  result.parallelCallCount = Array.isArray(parallelCalls) ? parallelCalls.length : 0;

  return result;
}

function report(r) {
  const mark = (ok) => (ok ? "✅" : "❌");
  log(`\n── ${r.model} ──`);
  log(`  HTTP 狀態                 ${r.httpStatus ?? "—"}`);
  // 結論未知時**不要**印那五格勾叉：全叉會被讀成「測過了，不支援」，
  // 但實際上連 baseline 都沒通過，什麼都還沒測到。
  if (r.inconclusive) {
    log(`  ⚠ 結論未知——${r.inconclusiveReason}`);
    if (r.error) log(`  原始錯誤                   ${r.error}`);
    return;
  }
  log(`  ${mark(r.acceptsToolsParam)} 端點接受 tools 參數`);
  log(`  ${mark(r.returnsToolCalls)} 回傳 message.tool_calls${r.calledTool ? `（呼叫了 ${r.calledTool}）` : ""}`);
  log(`  ${mark(r.argumentsParseable)} arguments 是合法 JSON${r.calledArgs ? `：${JSON.stringify(r.calledArgs)}` : ""}`);
  log(`  ${mark(r.respectsRequiredArg)} 必填參數有填${r.requiredArgs ? `：${JSON.stringify(r.requiredArgs)}` : ""}`);
  log(`  ${mark(r.supportsParallel)} 平行工具呼叫（本次 ${r.parallelCallCount ?? 0} 個）`);
  if (r.finishReason) log(`  finish_reason             ${r.finishReason}`);
  if (r.error) log(`  錯誤                       ${r.error}`);
}

async function main() {
  if (!API_KEY) {
    log("✗ 沒有 NVIDIA_NIM_API_KEY——無法實測，結論未知。");
    log("  到 build.nvidia.com 申請免費金鑰後：");
    log("  NVIDIA_NIM_API_KEY=nvapi-xxx node scripts/spike-nim-tool-calling.mjs");
    process.exit(2);
  }

  log(`端點：${ENDPOINT}`);
  const targets = flag("--all")
    ? Object.values(MODELS)
    : [optionValue("--model") || DEFAULT_MODEL];
  log(`受測模型：${targets.join(", ")}`);

  const results = [];
  for (const model of targets) {
    try {
      const r = await probe(model);
      results.push(r);
      report(r);
    } catch (err) {
      log(`\n── ${model} ──`);
      log(`  ✗ 連線失敗：${err instanceof Error ? err.message : String(err)}`);
      results.push({ model, acceptsToolsParam: false, returnsToolCalls: false, error: String(err), transportFailure: true });
    }
  }

  if (flag("--json")) log(`\n${JSON.stringify(results, null, 2)}`);

  const primary = results[0];
  log("\n── 對 WP1 的結論 ──");
  if (primary?.transportFailure) {
    log("  網路或設定問題，結論未知——不要據此決定 WP1 路線。");
    process.exit(2);
  }
  if (primary?.inconclusive) {
    log("  ⚠ 結論未知，**不要**據此決定 WP1 路線。");
    log(`     ${primary.inconclusiveReason}`);
    log("     baseline（不帶 tools 的最小請求）都沒通過，代表這次根本還沒測到 tool calling。");
    process.exit(2);
  }
  if (primary?.returnsToolCalls && primary?.argumentsParseable) {
    log("  ✅ 走原生路線：nvidia-nim.ts 的 body 加 tools/tool_choice，回應讀 message.tool_calls，");
    log("     刪掉 assistant.ts 的 regex 撈 JSON 與 coerceActionToolCall。");
    if (!primary.supportsParallel) {
      log("  ⚠ 但平行工具呼叫沒觀察到——toolLoop 先做序列，平行留成設定開關。");
    }
    if (!primary.respectsRequiredArg) {
      log("  ⚠ 但必填參數漏填——repair round（把 schema 錯誤回饋給模型再試一次）不可省略。");
    }
    process.exit(0);
  }
  if (primary?.acceptsToolsParam) {
    log("  ⚠ 端點收下了 tools 但沒回 tool_calls。可能是提示詞不夠明確，也可能是該部署沒開 tool parser。");
    log("     建議：先換一顆模型再測（--all），全部都這樣才判定降級。");
    process.exit(1);
  }
  log("  ❌ 走降級路線：保留提示詞式工具呼叫，但補上 JSON schema 約束與 repair round。");
  log("     可沿用 nvidia-nim.ts 既有的 logprobs 400 降級模式（同一個位置、同一種處理）。");
  process.exit(1);
}

main().catch((err) => {
  log(`✗ 未預期錯誤：${err instanceof Error ? err.stack : String(err)}`);
  process.exit(2);
});
