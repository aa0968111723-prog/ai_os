import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import {
  certifyModelsFromHistory,
  certifySuccessfulModel,
} from "./modelCertification";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("Model certification (real PostgreSQL)", () => {
  const modelIds: string[] = [];
  const generationIds: string[] = [];

  afterAll(async () => {
    if (generationIds.length) {
      await db.delete(schema.generations).where(inArray(schema.generations.id, generationIds));
    }
    if (modelIds.length) {
      await db.delete(schema.modelCatalog).where(inArray(schema.modelCatalog.id, modelIds));
      await db.delete(schema.modelLiveCatalog).where(inArray(schema.modelLiveCatalog.id, modelIds));
    }
  });

  async function insertCatalog(modelId: string): Promise<void> {
    modelIds.push(modelId);
    await db.insert(schema.modelLiveCatalog).values({
      id: modelId,
      endpoint: modelId,
      label: modelId,
      category: "text-to-image",
      tier: "budget",
      kind: "image",
      source: "fal_discovered",
      points: 1,
      cost: "$0.01/image",
      estTwd: 1,
      strengths: "test",
      bestFor: "test",
      verified: false,
    });
    await db.insert(schema.modelCatalog).values({
      id: modelId,
      endpoint: modelId,
      category: "text-to-image",
      tier: "budget",
      kind: "image",
      points: 1,
      strengths: "test",
      bestFor: "test",
      cost: "$0.01/image",
      verified: false,
    });
  }

  it("certifies both catalogs after a real successful Fal result", async () => {
    const modelId = `fal-ai/cert-${randomUUID()}`;
    await insertCatalog(modelId);

    expect(await certifySuccessfulModel(modelId, { reloadCache: false })).toBe(1);
    const [live] = await db.select().from(schema.modelLiveCatalog)
      .where(inArray(schema.modelLiveCatalog.id, [modelId]));
    const [catalog] = await db.select().from(schema.modelCatalog)
      .where(inArray(schema.modelCatalog.id, [modelId]));
    expect(live.verified).toBe(true);
    expect(catalog.verified).toBe(true);
    expect(await certifySuccessfulModel(modelId, { reloadCache: false })).toBe(0);
  });

  it("certifies an OpenRouter LLM id without bulk-certifying its shared router endpoint", async () => {
    const modelId = `openrouter/router#llm-cert-${randomUUID()}`;
    const sharedEndpoint = "openrouter/router";
    modelIds.push(modelId);
    await db.insert(schema.modelLiveCatalog).values({
      id: modelId,
      endpoint: sharedEndpoint,
      label: modelId,
      category: "llm",
      tier: "budget",
      kind: "text",
      source: "static",
      points: 1,
      cost: "$0.14/$0.28 per M tokens",
      estTwd: 1,
      strengths: "test",
      bestFor: "test",
      verified: false,
    });
    await db.insert(schema.modelCatalog).values({
      id: modelId,
      endpoint: sharedEndpoint,
      category: "llm",
      tier: "budget",
      kind: "text",
      points: 1,
      strengths: "test",
      bestFor: "test",
      cost: "$0.14/$0.28 per M tokens",
      verified: false,
    });

    expect(await certifySuccessfulModel(modelId, { reloadCache: false })).toBe(1);
    const rows = await db.select().from(schema.modelLiveCatalog)
      .where(inArray(schema.modelLiveCatalog.id, [modelId]));
    expect(rows[0].verified).toBe(true);
  });

  it("backfills real historical success but excludes E2E mock evidence", async () => {
    const realModelId = `fal-ai/history-${randomUUID()}`;
    const mockModelId = `fal-ai/mock-${randomUUID()}`;
    await insertCatalog(realModelId);
    await insertCatalog(mockModelId);
    const realGenerationId = randomUUID();
    const mockGenerationId = randomUUID();
    generationIds.push(realGenerationId, mockGenerationId);
    const base = {
      projectId: randomUUID(),
      groupId: randomUUID(),
      userId: randomUUID(),
      kind: "image",
      prompt: "certification evidence",
      status: "done" as const,
      resultUrl: "https://fal.media/result.png",
    };
    await db.insert(schema.generations).values([
      {
        ...base,
        id: realGenerationId,
        modelId: realModelId,
        requestId: randomUUID(),
      },
      {
        ...base,
        id: mockGenerationId,
        modelId: mockModelId,
        requestId: `mock_${randomUUID()}`,
      },
    ]);

    const result = await certifyModelsFromHistory({ reloadCache: false });
    expect(result.newlyCertified).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(schema.modelLiveCatalog)
      .where(inArray(schema.modelLiveCatalog.id, [realModelId, mockModelId]));
    expect(rows.find((row) => row.id === realModelId)?.verified).toBe(true);
    expect(rows.find((row) => row.id === mockModelId)?.verified).toBe(false);
  });
});
