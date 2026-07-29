/**
 * fal 端點「連通性」批次探測(管道通就好,不實際生成)
 * ─────────────────────────────────────────────────────────────────────────
 * 需求:確認站上每個 fal 模型「叫得動」——端點 id 正確、金鑰有權限、請求能被受理,
 *       但**不需要真的生成**(不花算力/不扣費)。做法是對每個端點送一個「空輸入 `{}`」,
 *       絕大多數端點會在**進算力之前**就以 422/400 擋下(缺必填欄位)——這代表:
 *         端點存在 ✓、金鑰有效 ✓、路由通 ✓,但沒有真的生成 ✓(fal 不對驗證失敗計費)。
 *       這正是「管道通就好、可以生成就好」的最省驗證法。
 *
 * 狀態判讀:
 *   422 / 400              → ✅ 連通(空輸入被驗證擋下,端點存在、金鑰通、未生成)
 *   200 / 202              → ⚠️ 端點竟接受空輸入並排入佇列 → 立即用回傳的 cancel_url 取消,避免計費
 *   401                    → ❌ 金鑰無效/過期
 *   403                    → ❌ 金鑰無此模型權限(部分模型需在 fal 後台開通)
 *   404                    → ❌ 端點不存在(id 可能打錯/已改名——最該修的一類)
 *   429                    → ⏳ 被限流,稍後重試
 *   5xx / 逾時 / 網路錯    → ⏳ 暫時性,稍後重試
 *
 * 金錢/安全設計:
 *   ‧ 只送空輸入 `{}`,永不送合法生成輸入——這是「不生成」的根本保證。
 *   ‧ 萬一某端點接受空輸入排入佇列(少數無必填欄位者),立刻呼叫 cancel_url 取消。
 *   ‧ 不帶 --yes 只印「將測試 N 個端點、不會生成」的計畫並退出,絕不呼叫 fal。
 *   ‧ 需要 FAL_KEY 且未設 E2E_MOCK,否則真實探測無意義。
 *   ‧ nvidia-nim(LLM 文字類)不走 fal,略過——那批請用 scripts/check-nim.ts。
 *   ‧ 多模型共用同一端點(如 any-llm/vision 的 # 子型號)只測一次,省請求。
 *
 * 用法:
 *   npx tsx scripts/probe-fal-endpoints.ts                 # 乾跑:只列計畫,不連網、不花錢
 *   FAL_KEY=... npx tsx scripts/probe-fal-endpoints.ts --yes            # 真實批次探測(不生成)
 *   FAL_KEY=... npx tsx scripts/probe-fal-endpoints.ts --yes --only text-to-image   # 只測某類別
 *   FAL_KEY=... npx tsx scripts/probe-fal-endpoints.ts --yes --concurrency 4        # 調併發
 *   產出:docs/fal端點連通報告.md
 */
import { writeFileSync } from "node:fs";
import { CATEGORIES, MODELS, endpointOf, isNimModel, tierLabel, type ModelEntry } from "../shared/models";
import { proxyFetch } from "../server/services/http";
import { isMockMode } from "../server/services/fal";

type ProbeCode =
  | "OK_VALIDATED"
  | "OK_QUEUED_CANCELLED"
  | "CANCEL_UNCONFIRMED"
  | "AUTH"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE"
  | "TRANSIENT";

interface ProbeResult {
  endpoint: string;
  modelIds: string[];
  category: string;
  httpStatus: number | null;
  code: ProbeCode;
  detail: string;
}

const OK_CODES: ProbeCode[] = ["OK_VALIDATED", "OK_QUEUED_CANCELLED"];
const LABEL: Record<ProbeCode, string> = {
  OK_VALIDATED: "✅ 連通(驗證擋下,未生成)",
  OK_QUEUED_CANCELLED: "✅ 連通(誤排佇列已取消)",
  CANCEL_UNCONFIRMED: "❗ 空輸入已入列但取消未確認",
  AUTH: "❌ 金鑰無效(401)",
  FORBIDDEN: "❌ 無權限(403,需後台開通)",
  NOT_FOUND: "❌ 端點不存在(404,該修 id)",
  RATE: "⏳ 被限流(429)",
  TRANSIENT: "⏳ 暫時性(5xx/逾時)",
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 去重:多模型共用同一 fal 端點只測一次(略過 nvidia-nim) */
function uniqueEndpoints(models: ModelEntry[]): Array<{ endpoint: string; category: string; modelIds: string[] }> {
  const map = new Map<string, { endpoint: string; category: string; modelIds: string[] }>();
  for (const m of models) {
    if (isNimModel(m)) continue; // 走 NVIDIA NIM,不是 fal,用 check-nim.ts 驗
    const ep = endpointOf(m);
    const cur = map.get(ep);
    if (cur) cur.modelIds.push(m.id);
    else map.set(ep, { endpoint: ep, category: m.category, modelIds: [m.id] });
  }
  return [...map.values()];
}

/** 對單一端點送空輸入探測連通性;200/202 立即取消,絕不留下生成任務 */
async function probeEndpoint(endpoint: string, key: string): Promise<{ httpStatus: number | null; code: ProbeCode; detail: string }> {
  let res: Response;
  try {
    res = await proxyFetch(`https://queue.fal.run/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: "{}", // 刻意空輸入:靠驗證失敗擋下,不進算力
      timeoutMs: 30_000,
    });
  } catch (err) {
    return { httpStatus: null, code: "TRANSIENT", detail: err instanceof Error ? err.message : String(err) };
  }
  const status = res.status;

  if (status === 200 || status === 202) {
    // 端點接受了空輸入並排入佇列——立刻取消,避免計費
    let cancelNote = "未取回 cancel_url";
    let cancelConfirmed = false;
    try {
      const data = (await res.json()) as { request_id?: string; cancel_url?: string };
      const queueApp = endpoint.split("/").slice(0, 2).join("/");
      const cancelUrl = data.cancel_url ?? (data.request_id ? `https://queue.fal.run/${queueApp}/requests/${data.request_id}/cancel` : null);
      if (cancelUrl) {
        const c = await proxyFetch(cancelUrl, { method: "PUT", headers: { Authorization: `Key ${key}` }, timeoutMs: 15_000 });
        const cancelBody = c.ok ? "" : (await c.text().catch(() => "")).slice(0, 120);
        cancelNote = `cancel → HTTP ${c.status}${cancelBody ? `:${cancelBody}` : ""}`;
        if (!c.ok) {
          return {
            httpStatus: status,
            code: "CANCEL_UNCONFIRMED",
            detail: `空輸入已被受理,但取消未確認(${cancelNote});需到 Fal request history 核對`,
          };
        }
        cancelConfirmed = true;
      }
    } catch (err) {
      cancelNote = `取消時出錯:${err instanceof Error ? err.message : String(err)}`;
    }
    if (!cancelConfirmed) {
      return {
        httpStatus: status,
        code: "CANCEL_UNCONFIRMED",
        detail: `空輸入已被受理,但取消未確認(${cancelNote});需到 Fal request history 核對`,
      };
    }
    return { httpStatus: status, code: "OK_QUEUED_CANCELLED", detail: `空輸入被受理,已嘗試取消(${cancelNote})` };
  }
  if (status === 400 || status === 422) return { httpStatus: status, code: "OK_VALIDATED", detail: "空輸入被驗證擋下(端點存在、金鑰通)" };
  if (status === 401) return { httpStatus: status, code: "AUTH", detail: "金鑰無效或過期" };
  if (status === 403) return { httpStatus: status, code: "FORBIDDEN", detail: "金鑰無此模型權限" };
  if (status === 404) return { httpStatus: status, code: "NOT_FOUND", detail: "端點不存在(id 可能打錯/已改名)" };
  if (status === 429) return { httpStatus: status, code: "RATE", detail: "被限流,稍後重試" };
  const body = await res.text().catch(() => "");
  return { httpStatus: status, code: "TRANSIENT", detail: `非預期 HTTP ${status}${body ? `:${body.slice(0, 120)}` : ""}` };
}

/** 簡易併發池 */
async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => lane()));
  return results;
}

function writeReport(results: ProbeResult[], meta: { key: boolean }): void {
  const byCode = (c: ProbeCode) => results.filter((r) => r.code === c);
  const ok = results.filter((r) => OK_CODES.includes(r.code));
  const notFound = byCode("NOT_FOUND");
  const forbidden = byCode("FORBIDDEN");
  const transient = [...byCode("TRANSIENT"), ...byCode("RATE")];
  const cancelUnconfirmed = byCode("CANCEL_UNCONFIRMED");

  const lines: string[] = [
    "# fal 端點連通報告(管道通就好,不實際生成)",
    "",
    `> 產生方式:\`FAL_KEY=... npx tsx scripts/probe-fal-endpoints.ts --yes\``,
    "> 方法:對每個端點送空輸入 `{}`,靠 422/400 驗證失敗確認「端點存在＋金鑰通＋未生成」;200/202 會立即取消。",
    `> 唯一端點數:**${results.length}**|連通:**${ok.length}**|取消未確認:**${cancelUnconfirmed.length}**|404 不存在:**${notFound.length}**|403 無權限:**${forbidden.length}**|暫時性:**${transient.length}**`,
    "",
    "## ❗ 需要處理:端點不存在(404,該修 shared/models.ts 的 id/endpoint)",
    "",
  ];
  if (notFound.length) {
    lines.push("| 端點 | 影響的模型 | 說明 |", "|---|---|---|");
    for (const r of notFound) lines.push(`| \`${r.endpoint}\` | ${r.modelIds.join("、")} | ${r.detail} |`);
  } else {
    lines.push("(無——所有端點都存在)");
  }
  lines.push("", "## ⚠️ 需要開通:無權限(403,請在 fal 後台為金鑰開通該模型)", "");
  if (forbidden.length) {
    lines.push("| 端點 | 影響的模型 |", "|---|---|");
    for (const r of forbidden) lines.push(`| \`${r.endpoint}\` | ${r.modelIds.join("、")} |`);
  } else {
    lines.push("(無)");
  }
  lines.push("", "## ❗ 需核對:空輸入已入列但取消未確認", "");
  if (cancelUnconfirmed.length) {
    lines.push("| 端點 | HTTP | 說明 |", "|---|---|---|");
    for (const r of cancelUnconfirmed) lines.push(`| \`${r.endpoint}\` | ${r.httpStatus ?? "—"} | ${r.detail} |`);
  } else {
    lines.push("(無)");
  }

  lines.push("", "## 全部結果(依類別)", "");
  for (const cat of CATEGORIES) {
    const rows = results.filter((r) => r.category === cat.id);
    if (!rows.length) continue;
    lines.push(`### ${cat.label}`, "", "| 端點 | 狀態 | HTTP | 影響的模型 |", "|---|---|---|---|");
    for (const r of rows) lines.push(`| \`${r.endpoint}\` | ${LABEL[r.code]} | ${r.httpStatus ?? "—"} | ${r.modelIds.join("、")} |`);
    lines.push("");
  }

  lines.push(
    "## 下一步",
    "",
    "1. **404** 的端點:到 fal.ai/models 搜現行名稱,修 `shared/models.ts` 的 `id`/`endpoint`,再重跑本腳本。",
    "2. **403** 的端點:到 fal 後台為金鑰開通,或改用同類替代模型。",
    "3. **連通但 `verified:false`** 的模型:連通只證明「叫得動」;要標 `verified:true` 仍需一次真實生成確認輸出正常" +
      "(用 `npx tsx scripts/verify-models.ts --probe \"<id>\" --yes`,會扣費)。",
    "4. **暫時性/限流**:稍後重試;必要時調低 `--concurrency`。",
    "",
    meta.key ? "" : "> ⚠️ 本次為乾跑(未提供 FAL_KEY / 未加 --yes),以上為計畫非實測結果。",
  );
  writeFileSync(new URL("../docs/fal端點連通報告.md", import.meta.url), lines.join("\n"));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("用法:");
    console.log("  npx tsx scripts/probe-fal-endpoints.ts                 # 乾跑:只列計畫,不連網");
    console.log("  FAL_KEY=... npx tsx scripts/probe-fal-endpoints.ts --yes            # 真實批次探測(不生成)");
    console.log("  ... --yes --only <category>   # 只測某類別   ... --yes --concurrency 4   # 調併發");
    return;
  }
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const concIdx = args.indexOf("--concurrency");
  const concurrency = concIdx >= 0 ? Math.max(1, Number(args[concIdx + 1]) || 6) : 6;

  const models = only ? MODELS.filter((m) => m.category === only) : MODELS;
  const targets = uniqueEndpoints(models);
  const nimCount = models.filter(isNimModel).length;

  console.log(`模型:${models.length}${only ? `(只看 ${only})` : ""}|fal 唯一端點:${targets.length}|略過 nvidia-nim:${nimCount}(請用 scripts/check-nim.ts)`);

  const yes = args.includes("--yes");
  if (!yes) {
    console.log("");
    console.log("這是乾跑——不會連網、不會生成、不會扣費。將測試以下端點(送空輸入,靠驗證失敗確認連通):");
    for (const t of targets.slice(0, 12)) console.log(`  - ${t.endpoint}  (${t.modelIds.length} 個模型)`);
    if (targets.length > 12) console.log(`  … 其餘 ${targets.length - 12} 個`);
    console.log("");
    console.log(`真的執行請加 --yes,並提供 FAL_KEY:`);
    console.log(`  FAL_KEY=... npx tsx scripts/probe-fal-endpoints.ts --yes`);
    writeReport(targets.map((t) => ({ ...t, httpStatus: null, code: "TRANSIENT" as ProbeCode, detail: "(乾跑未實測)" })), { key: false });
    console.log("(已寫出計畫版 docs/fal端點連通報告.md;實測後會覆蓋為真實結果)");
    return;
  }

  if (isMockMode() || !process.env.FAL_KEY) {
    const reason = isMockMode() ? "環境設了 E2E_MOCK=1(測試假生成模式)" : "環境未設定 FAL_KEY";
    console.error(`✗ 無法真實探測(${reason})。連通探測需要真實金鑰與網路。`);
    console.error("  請在有 FAL_KEY、未設 E2E_MOCK、且能連到 queue.fal.run 的環境執行。");
    process.exit(1);
  }
  const key = process.env.FAL_KEY;

  console.log(`▶ 開始探測 ${targets.length} 個端點(併發 ${concurrency};只送空輸入,不生成)…`);
  let done = 0;
  const results = await runPool(targets, concurrency, async (t) => {
    const r = await probeEndpoint(t.endpoint, key);
    done++;
    const mark = OK_CODES.includes(r.code) ? "ok" : r.code === "NOT_FOUND" ? "404" : r.code.toLowerCase();
    console.log(`  [${done}/${targets.length}] ${mark.padEnd(4)} ${t.endpoint}`);
    await sleep(120); // 禮貌節流
    return { ...t, ...r } satisfies ProbeResult;
  });

  const ok = results.filter((r) => OK_CODES.includes(r.code)).length;
  const notFound = results.filter((r) => r.code === "NOT_FOUND");
  console.log("");
  console.log(`完成:連通 ${ok}/${results.length}|404 不存在 ${notFound.length}|其餘見報告。`);
  if (notFound.length) {
    console.log("需修 id 的端點:");
    for (const r of notFound) console.log(`  - ${r.endpoint}(${r.modelIds.join("、")})`);
  }
  writeReport(results, { key: true });
  console.log("✓ 已寫出 docs/fal端點連通報告.md");
}

main().catch((err) => {
  console.error("✗ 執行中斷:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
