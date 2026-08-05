/**
 * 模型契約同步（變動對應自動化 · 零成本預設）
 * ─────────────────────────────────────────────
 * 讀取：
 *   - shared/models.ts（MODELS）
 *   - docs/model-audit/budget.json（可選 live 歷史）
 *   - docs/model-audit/openapi-zero-cost.json（可選；無則可 --openapi 重抓）
 *   - docs/model-audit/contracts/snapshot.json（上一版）
 *
 * 寫出：
 *   - docs/model-audit/contracts/current.json   ← MCP／生成／指南讀這個
 *   - docs/model-audit/contracts/snapshot.json  ← 下次 diff 基準
 *   - docs/model-audit/contracts/changelog.md   ← 人類可讀變動
 *   - docs/model-audit/contracts/README.md
 *
 * 用法：
 *   npx tsx scripts/sync-model-contracts.ts
 *   npx tsx scripts/sync-model-contracts.ts --openapi   # 需 FAL_KEY，重抓 OpenAPI（不生成）
 *   npx tsx scripts/sync-model-contracts.ts --no-budget # 忽略 budget live 歷史
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildModelContractSnapshot,
  diffModelContractSnapshots,
  type LiveHint,
  type ModelContractSnapshot,
  type OpenApiHint,
} from "../shared/modelContract";
import { MODELS, endpointOf } from "../shared/models";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "docs/model-audit/contracts");
const CURRENT = join(OUT_DIR, "current.json");
const SNAPSHOT = join(OUT_DIR, "snapshot.json");
const CHANGELOG = join(OUT_DIR, "changelog.md");
const README = join(OUT_DIR, "README.md");
const BUDGET = join(ROOT, "docs/model-audit/budget.json");
const OPENAPI_CACHE = join(ROOT, "docs/model-audit/openapi-zero-cost.json");

function loadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function loadLiveHints(useBudget: boolean): Record<string, LiveHint> {
  if (!useBudget) return {};
  const b = loadJson<{ entries?: Array<{ modelId?: string; status?: string; error?: string; note?: string }> }>(BUDGET);
  if (!b?.entries?.length) return {};
  const last: Record<string, LiveHint> = {};
  for (const e of b.entries) {
    if (!e.modelId || !e.status) continue;
    last[e.modelId] = {
      status: e.status,
      note: e.note || e.error?.slice(0, 160),
    };
  }
  return last;
}

function loadOpenApiHintsFromCache(): Record<string, OpenApiHint> {
  const cache = loadJson<{
    notFound?: Array<{ endpoint: string }>;
    requiredHints?: Record<string, string[]>;
    statusCounts?: Record<string, number>;
  }>(OPENAPI_CACHE);
  if (!cache) return {};
  const out: Record<string, OpenApiHint> = {};
  const required = cache.requiredHints ?? {};
  for (const [ep, req] of Object.entries(required)) {
    out[ep] = { status: "ok", required: req };
  }
  for (const row of cache.notFound ?? []) {
    out[row.endpoint] = { status: "http_404" };
  }
  // endpoints only in MODELS not in cache → unchecked later
  return out;
}

async function fetchOpenApiHints(): Promise<Record<string, OpenApiHint>> {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    console.warn("⚠ --openapi 需要 FAL_KEY，改用快取／unchecked");
    return loadOpenApiHintsFromCache();
  }
  const endpoints = [...new Set(MODELS.filter((m) => !m.id.startsWith("nvidia-nim")).map((m) => endpointOf(m)))];
  console.log(`OpenAPI 檢查 ${endpoints.length} 端點…`);
  const out: Record<string, OpenApiHint> = {};
  const concurrency = 10;
  let i = 0;
  async function one(ep: string) {
    const u = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(ep)}`;
    try {
      const res = await fetch(u, {
        headers: { Authorization: `Key ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 404) {
        out[ep] = { status: "http_404" };
        return;
      }
      if (!res.ok) {
        out[ep] = { status: "error" };
        return;
      }
      const d = (await res.json()) as {
        components?: { schemas?: Record<string, { required?: string[] }> };
      };
      let required: string[] | undefined;
      for (const [k, v] of Object.entries(d.components?.schemas ?? {})) {
        if (k.includes("Input") && v?.required?.length) {
          required = v.required;
          break;
        }
      }
      out[ep] = { status: "ok", required };
    } catch {
      out[ep] = { status: "error" };
    }
  }
  const queue = [...endpoints];
  async function worker() {
    while (queue.length) {
      const ep = queue.shift()!;
      i++;
      if (i % 50 === 0) console.log(`  …${i}/${endpoints.length}`);
      await one(ep);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // refresh openapi-zero-cost.json for reuse
  const notFound = Object.entries(out)
    .filter(([, v]) => v.status === "http_404")
    .map(([endpoint]) => ({ endpoint, modelIds: MODELS.filter((m) => endpointOf(m) === endpoint).map((m) => m.id) }));
  const requiredHints: Record<string, string[]> = {};
  for (const [ep, v] of Object.entries(out)) {
    if (v.status === "ok" && v.required?.length) requiredHints[ep] = v.required;
  }
  const statusCounts: Record<string, number> = {};
  for (const v of Object.values(out)) {
    statusCounts[v.status] = (statusCounts[v.status] ?? 0) + 1;
  }
  writeFileSync(
    OPENAPI_CACHE,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        uniqueEndpoints: endpoints.length,
        statusCounts,
        notFound,
        requiredHints,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("✓ 更新 docs/model-audit/openapi-zero-cost.json", statusCounts);
  return out;
}

function fillUnchecked(hints: Record<string, OpenApiHint>): Record<string, OpenApiHint> {
  const out = { ...hints };
  for (const m of MODELS) {
    if (m.id.startsWith("nvidia-nim")) continue;
    const ep = endpointOf(m);
    if (!out[ep]) out[ep] = { status: "unchecked" };
  }
  return out;
}

function writeChangelog(
  diff: ReturnType<typeof diffModelContractSnapshots>,
  next: ModelContractSnapshot,
): void {
  const prev = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : "# 模型契約變更日誌\n\n";
  const lines = [
    `## ${diff.generatedAt}`,
    "",
    `- 摘要：**${diff.summary}**`,
    `- 模型數：${next.modelCount}`,
    `- 健康分布：\`${JSON.stringify(next.counts)}\``,
    "",
  ];
  if (diff.changes.length && diff.changes[0]?.id !== "*") {
    lines.push("| 模型 | 變動 | before | after |", "|---|---|---|---|");
    for (const c of diff.changes.slice(0, 80)) {
      lines.push(`| \`${c.id}\` | ${c.kind} | ${fmt(c.before)} | ${fmt(c.after)} |`);
    }
    if (diff.changes.length > 80) lines.push(`| … | 另 ${diff.changes.length - 80} 筆 | | |`);
    lines.push("");
  }
  writeFileSync(CHANGELOG, prev.trimEnd() + "\n\n" + lines.join("\n") + "\n");
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "—";
  return String(v).replace(/\|/g, "\\|").slice(0, 60);
}

function writeReadme(): void {
  writeFileSync(
    README,
    `# 模型契約（contracts）

> 由 \`npx tsx scripts/sync-model-contracts.ts\` 自動維護。  
> **單一機器可讀真相**：模型指南、MCP、生成系統都讀 \`current.json\`。

## 檔案

| 檔 | 用途 |
|----|------|
| \`current.json\` | 最新完整契約（266 列 + capabilities + health） |
| \`snapshot.json\` | 上次已確認基準（diff 用） |
| \`changelog.md\` | 人類可讀變動史 |

## 何時跑

1. 改了 \`shared/models.ts\`（點數、needs、endpoint、verified）
2. 跑完零成本 OpenAPI / live 審計想回寫健康狀態
3. CI 或排程（建議每日 --openapi 一次，有 FAL_KEY）

\`\`\`bash
npx tsx scripts/sync-model-contracts.ts
FAL_KEY=… npx tsx scripts/sync-model-contracts.ts --openapi
\`\`\`

## 消費端

- **MCP** \`find_model\` / \`get_model_contract\`：回 health、capabilities
- **generationCore**：openapi_404 / live_fail 軟警告
- **gen-model-docs**：目錄附健康摘要
- **工作台**：capabilities 與站內 supportsNegativePrompt／分詞器同源

## 不會做的事

- 不自動把 \`verified\` 改 true
- 不自動 \`--yes\` 燒點 live
- 不猜測未知 OpenAPI 欄位
`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const doOpenapi = args.includes("--openapi");
  const useBudget = !args.includes("--no-budget");

  mkdirSync(OUT_DIR, { recursive: true });

  const live = loadLiveHints(useBudget);
  let openapi = doOpenapi ? await fetchOpenApiHints() : loadOpenApiHintsFromCache();
  openapi = fillUnchecked(openapi);

  let softStopNote = "live 另受 budget softStop 約束；本契約預設零成本更新";
  const budget = loadJson<{ softStop?: number; spentTwd?: number }>(BUDGET);
  if (budget?.softStop != null) {
    softStopNote = `budget softStop=${budget.softStop} spentTwd=${budget.spentTwd ?? "?"}；契約同步不扣點`;
  }

  const next = buildModelContractSnapshot(live, openapi, { softStopNote });
  const prev = loadJson<ModelContractSnapshot>(SNAPSHOT);
  const diff = diffModelContractSnapshots(prev, next);

  writeFileSync(CURRENT, JSON.stringify(next, null, 2) + "\n");
  writeFileSync(SNAPSHOT, JSON.stringify(next, null, 2) + "\n");
  writeChangelog(diff, next);
  writeReadme();

  console.log(`✓ contracts ${next.modelCount} 模型`);
  console.log(`  health: ${JSON.stringify(next.counts)}`);
  console.log(`  diff: ${diff.summary}`);
  console.log(`  → ${CURRENT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
