/**
 * Project-scoped suggestion aggregation (true PostgreSQL).
 *
 * Run: RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/services/shotAssetSuggestions.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { buildShotSearchTerms, suggestAssetsForShot } from "../../shared/story";
import { expandShotSuggestions } from "../../shared/shotAssetSuggestions";
import { loadShotAssetSuggestionsForProject } from "./shotAssetSuggestions";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;

async function seedProject(title: string) {
  const userId = randomUUID();
  const groupId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    name: title,
    email: `${userId}@example.test`,
    passwordHash: "test-only",
  });
  const [project] = await db
    .insert(schema.projects)
    .values({ groupId, ownerId: userId, title, kind: "video", platform: "test", format: "16:9" })
    .returning();
  return { ...project!, userId };
}

type Seeded = Awaited<ReturnType<typeof seedProject>>;

const mkChar = async (p: Seeded, name: string) =>
  (
    await db
      .insert(schema.characters)
      .values({ projectId: p.id, groupId: p.groupId, createdBy: p.userId, name, appearance: "—" })
      .returning()
  )[0]!;

const mkPreset = async (p: Seeded, name: string) =>
  (
    await db
      .insert(schema.scenePresets)
      .values({ projectId: p.id, groupId: p.groupId, createdBy: p.userId, name, palette: "—" })
      .returning()
  )[0]!;

const mkProp = async (p: Seeded, name: string) =>
  (
    await db
      .insert(schema.props)
      .values({ projectId: p.id, groupId: p.groupId, createdBy: p.userId, name, appearance: "—" })
      .returning()
  )[0]!;

const mkAsset = async (p: Seeded, title: string, over: { isAiGenerated?: boolean; deleted?: boolean } = {}) =>
  (
    await db
      .insert(schema.assets)
      .values({
        projectId: p.id,
        groupId: p.groupId,
        kind: "image",
        title,
        url: `/fixtures/${title}.jpg`,
        tags: [title],
        isAiGenerated: over.isAiGenerated ?? false,
        uploadedBy: p.userId,
        deletedAt: over.deleted ? new Date() : null,
      })
      .returning()
  )[0]!;

async function mkShots(
  p: Seeded,
  count: number,
  binding: { characterIds?: string[]; scenePresetIds?: string[]; propIds?: string[] },
) {
  const rows = Array.from({ length: count }, (_, i) => ({
    projectId: p.id,
    orderIndex: i,
    title: `SHOT ${String(i + 1).padStart(3, "0")}`,
    characterIds: binding.characterIds ?? null,
    scenePresetIds: binding.scenePresetIds ?? null,
    propIds: binding.propIds ?? null,
  }));
  return db.insert(schema.scenes).values(rows).returning();
}

d("shotAssetSuggestions batch aggregation (PostgreSQL)", () => {
  it("matches single-shot semantics and stays at a bounded query count for 100/200/300 shots", async () => {
    const project = await seedProject("large board");
    const anjie = await mkChar(project, "安倢");
    const slope = await mkPreset(project, "克難坡");
    const umbrella = await mkProp(project, "紅傘");
    const hit = await mkAsset(project, "安倢紅傘克難坡");
    await mkAsset(project, "安倢紅傘克難坡-ai", { isAiGenerated: true });
    await mkAsset(project, "安倢紅傘克難坡-deleted", { deleted: true });

    const shots = await mkShots(project, 300, {
      characterIds: [anjie.id],
      scenePresetIds: [slope.id],
      propIds: [umbrella.id],
    });
    const first = shots[0]!;

    const [oneShotAssets] = await Promise.all([
      db
        .select({
          id: schema.assets.id,
          title: schema.assets.title,
          tags: schema.assets.tags,
          kind: schema.assets.kind,
          url: schema.assets.url,
        })
        .from(schema.assets)
        .where(
          and(
            eq(schema.assets.projectId, project.id),
            isNull(schema.assets.deletedAt),
            eq(schema.assets.isAiGenerated, false),
          ),
        ),
    ]);
    const terms = buildShotSearchTerms({
      characterNames: ["安倢"],
      locationNames: ["克難坡"],
      propNames: ["紅傘"],
    });
    const expected = suggestAssetsForShot(terms, oneShotAssets);

    const results: Record<string, { dbQueries: number; shotCount: number; assetCount: number; payloadBytes: number }> = {};
    for (const n of [100, 200, 300] as const) {
      const slice = shots.slice(0, n).map((s) => s.id);
      const batch = await loadShotAssetSuggestionsForProject({ projectId: project.id, shotIds: slice });
      expect(batch.stats.dbQueries).toBeLessThanOrEqual(5);
      expect(batch.stats.shotCount).toBe(n);
      const items = expandShotSuggestions(batch, first.id);
      expect(items.map((i) => i.id)).toEqual(expected.map((s) => s.assetId));
      expect(items[0]?.matched.sort()).toEqual(["安倢", "克難坡", "紅傘"].sort());
      expect(batch.assets[hit.id]).toBeTruthy();
      results[String(n)] = {
        dbQueries: batch.stats.dbQueries,
        shotCount: batch.stats.shotCount,
        assetCount: batch.stats.assetCount,
        payloadBytes: Buffer.byteLength(JSON.stringify(batch)),
      };
    }

    const whole = await loadShotAssetSuggestionsForProject({ projectId: project.id });
    expect(whole.stats.shotCount).toBe(300);
    expect(whole.stats.dbQueries).toBeLessThanOrEqual(5);

    const out = join(process.cwd(), "docs/evidence/large-storyboard-scaling/pg-query-counts.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ after: results, projectScoped: whole.stats }, null, 2)}\n`);
  });

  it("does not leak another project's shots or assets", async () => {
    const mine = await seedProject("mine");
    const theirs = await seedProject("theirs");
    const myChar = await mkChar(mine, "安倢");
    const theirChar = await mkChar(theirs, "安倢");
    await mkAsset(mine, "安倢本專案");
    const theirAsset = await mkAsset(theirs, "安倢別專案");
    const [myShot] = await mkShots(mine, 1, { characterIds: [myChar.id] });
    const [theirShot] = await mkShots(theirs, 1, { characterIds: [theirChar.id] });

    const mixed = await loadShotAssetSuggestionsForProject({
      projectId: mine.id,
      shotIds: [myShot!.id, theirShot!.id],
    });
    expect(expandShotSuggestions(mixed, myShot!.id).map((i) => i.id)).not.toContain(theirAsset.id);
    expect(expandShotSuggestions(mixed, theirShot!.id)).toEqual([]);
    expect(mixed.assets[theirAsset.id]).toBeUndefined();
    expect(JSON.stringify(mixed)).not.toContain(theirAsset.url);
  });

  it("treats deleted and unknown shot ids as empty, not an error", async () => {
    const project = await seedProject("missing shots");
    const ghost = randomUUID();
    const [live] = await mkShots(project, 1, {});
    await db.update(schema.scenes).set({ deletedAt: new Date() }).where(eq(schema.scenes.id, live!.id));
    const batch = await loadShotAssetSuggestionsForProject({
      projectId: project.id,
      shotIds: [live!.id, ghost],
    });
    expect(batch.byShotId[live!.id]).toEqual({ terms: [], items: [] });
    expect(batch.byShotId[ghost]).toEqual({ terms: [], items: [] });
    expect(batch.stats.shotCount).toBe(0);
  });
});
