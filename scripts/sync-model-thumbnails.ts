/**
 * 從 Fal Platform 拉 metadata.thumbnail_url，寫入 docs/model-audit/model-thumbnails.json
 *
 *   FAL_KEY=… npx tsx scripts/sync-model-thumbnails.ts
 *
 * 零成本（只讀目錄 API，不生成）。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MODELS, endpointOf, isGeminiModel, isNimModel } from "../shared/models";

async function main() {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    console.error("需要 FAL_KEY");
    process.exit(1);
  }

  const byEndpoint: Record<string, string> = {};
  let cursor: string | null = null;
  let pages = 0;
  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`https://api.fal.ai/v1/models?${params}`, {
      headers: { Authorization: `Key ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Fal models ${res.status}`);
    const data = (await res.json()) as {
      models?: Array<{ endpoint_id?: string; metadata?: { thumbnail_url?: string } }>;
      next_cursor?: string | null;
      has_more?: boolean;
    };
    for (const m of data.models ?? []) {
      const ep = m.endpoint_id?.trim();
      const th = m.metadata?.thumbnail_url?.trim();
      if (ep && th?.startsWith("https://")) byEndpoint[ep] = th;
    }
    cursor = data.has_more ? (data.next_cursor ?? null) : null;
    pages++;
    console.log(`page ${pages}: endpoints with thumb ${Object.keys(byEndpoint).length}`);
  } while (cursor && pages < 40);

  const byModelId: Record<string, string> = {};
  for (const m of MODELS) {
    if (isNimModel(m) || isGeminiModel(m)) continue;
    const ep = endpointOf(m);
    const url =
      byEndpoint[m.id] ??
      byEndpoint[ep] ??
      (m.id.includes("#") ? byEndpoint[m.id.split("#")[0]!] : undefined) ??
      (ep.includes("#") ? byEndpoint[ep.split("#")[0]!] : undefined);
    if (url) byModelId[m.id] = url;
  }

  const outDir = join(process.cwd(), "docs/model-audit");
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "model-thumbnails.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "fal api.fal.ai/v1/models metadata.thumbnail_url",
        falEndpointCount: Object.keys(byEndpoint).length,
        mappedModelCount: Object.keys(byModelId).length,
        byModelId,
        byEndpoint,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`✓ ${path}`);
  console.log(`  fal endpoints: ${Object.keys(byEndpoint).length}`);
  console.log(`  MODELS mapped: ${Object.keys(byModelId).length} / ${MODELS.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
