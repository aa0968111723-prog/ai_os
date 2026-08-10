import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { LEGACY_MODELS, MODELS, endpointOf, getModel } from "../../shared/models";
import { reloadLiveModelCache } from "./modelResolve";

/**
 * 把「真實成功生成的 modelId」展開成認證目標（catalog 的 id 與唯一 endpoint）。
 *
 * - modelId 本身一定加入：生成成功是該 id 的證據。新發現模型（id==endpoint）由 id 加入即涵蓋。
 * - endpoint 只在「全表只有這一個 model 用它」時加入——共用 endpoint（openrouter/router 掛整排
 *   LLM、fal-ai/any-llm/vision 多變體共用、nvidia-nim 統一入口）加了會把同 endpoint 的姊妹模型
 *   一起標 verified：一支生成成功只能證明那一個 id，不能證明整排。
 * - fal 模型大多 id 即 endpoint 且唯一，展開行為與舊版一致。
 */
export function certificationTargets(modelIds: string[]): string[] {
  const targets = new Set<string>();
  for (const id of modelIds) {
    targets.add(id);
    const model = getModel(id);
    if (model) {
      const ep = endpointOf(model);
      const shared = [...MODELS, ...LEGACY_MODELS].some((m) => m.id !== id && endpointOf(m) === ep);
      if (!shared) targets.add(ep);
    }
  }
  return [...targets];
}

async function markTargetsVerified(targets: string[]): Promise<number> {
  if (!targets.length) return 0;
  return db.transaction(async (tx) => {
    const changed = await tx
      .update(schema.modelLiveCatalog)
      .set({ verified: true, updatedAt: new Date() })
      .where(and(
        eq(schema.modelLiveCatalog.verified, false),
        or(
          inArray(schema.modelLiveCatalog.id, targets),
          inArray(schema.modelLiveCatalog.endpoint, targets),
        ),
      ))
      .returning({ id: schema.modelLiveCatalog.id });
    await tx
      .update(schema.modelCatalog)
      .set({ verified: true, updatedAt: new Date() })
      .where(and(
        eq(schema.modelCatalog.verified, false),
        or(
          inArray(schema.modelCatalog.id, targets),
          inArray(schema.modelCatalog.endpoint, targets),
        ),
      ));
    return changed.length;
  });
}

/**
 * A model is certified only after a real queue request (fal-ai/* or
 * openrouter/router#* LLM) has completed with a parseable result. Mock and
 * provider-discovery checks must not call this.
 */
export async function certifySuccessfulModel(
  modelId: string,
  opts: { reloadCache?: boolean } = {},
): Promise<number> {
  const changed = await markTargetsVerified(certificationTargets([modelId]));
  if (changed > 0 && opts.reloadCache !== false) await reloadLiveModelCache();
  return changed;
}

/**
 * Rebuild certification from durable production evidence. This upgrades models
 * that completed before automatic certification existed, while explicitly
 * excluding E2E mock and NVIDIA NIM jobs.
 */
export async function certifyModelsFromHistory(
  opts: { reloadCache?: boolean } = {},
): Promise<{ successfulModels: number; newlyCertified: number }> {
  const rows = await db
    .selectDistinct({ modelId: schema.generations.modelId })
    .from(schema.generations)
    .where(and(
      eq(schema.generations.status, "done"),
      or(
        like(schema.generations.modelId, "fal-ai/%"),
        like(schema.generations.modelId, "openrouter/router#%"),
      ),
      sql`${schema.generations.requestId} is not null`,
      sql`${schema.generations.requestId} not like 'mock\_%' escape '\'`,
      sql`${schema.generations.requestId} not like 'nim\_%' escape '\'`,
    ));
  const targets = certificationTargets(rows.map((row) => row.modelId));
  const newlyCertified = await markTargetsVerified(targets);
  if (newlyCertified > 0 && opts.reloadCache !== false) await reloadLiveModelCache();
  return { successfulModels: rows.length, newlyCertified };
}
