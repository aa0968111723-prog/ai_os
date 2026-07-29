import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { endpointOf, getModel } from "../../shared/models";
import { reloadLiveModelCache } from "./modelResolve";

function falTargets(modelIds: string[]): string[] {
  const targets = new Set<string>();
  for (const id of modelIds) {
    if (!id.startsWith("fal-ai/")) continue;
    targets.add(id);
    const model = getModel(id);
    if (model) targets.add(endpointOf(model));
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
 * A model is certified only after a real Fal queue request has completed with a
 * parseable result. Mock and provider-discovery checks must not call this.
 */
export async function certifySuccessfulFalModel(
  modelId: string,
  opts: { reloadCache?: boolean } = {},
): Promise<number> {
  const changed = await markTargetsVerified(falTargets([modelId]));
  if (changed > 0 && opts.reloadCache !== false) await reloadLiveModelCache();
  return changed;
}

/**
 * Rebuild certification from durable production evidence. This upgrades models
 * that completed before automatic certification existed, while explicitly
 * excluding E2E mock and NVIDIA NIM jobs.
 */
export async function certifyFalModelsFromHistory(
  opts: { reloadCache?: boolean } = {},
): Promise<{ successfulModels: number; newlyCertified: number }> {
  const rows = await db
    .selectDistinct({ modelId: schema.generations.modelId })
    .from(schema.generations)
    .where(and(
      eq(schema.generations.status, "done"),
      like(schema.generations.modelId, "fal-ai/%"),
      sql`${schema.generations.requestId} is not null`,
      sql`${schema.generations.requestId} not like 'mock\_%' escape '\'`,
      sql`${schema.generations.requestId} not like 'nim\_%' escape '\'`,
    ));
  const targets = falTargets(rows.map((row) => row.modelId));
  const newlyCertified = await markTargetsVerified(targets);
  if (newlyCertified > 0 && opts.reloadCache !== false) await reloadLiveModelCache();
  return { successfulModels: rows.length, newlyCertified };
}
