/**
 * Project-scoped shot asset suggestions (#755).
 *
 * One request → a bounded number of SQL queries (shots + up to 3 name lists +
 * one asset scan) → group by shotId. Not Promise.all of the old per-shot path.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { buildShotSearchTerms, suggestAssetsForShot } from "../../shared/story";
import {
  EMPTY_SHOT_SUGGESTIONS,
  SHOT_ASSET_SUGGESTIONS_ASSET_LIMIT,
  SHOT_ASSET_SUGGESTIONS_PER_SHOT_LIMIT,
  type CompactShotSuggestions,
  type CompactSuggestedAsset,
  type ShotAssetSuggestionsBatchPayload,
  normalizeBatchShotIds,
} from "../../shared/shotAssetSuggestions";

export type SuggestionShotRow = {
  id: string;
  characterIds: string[] | null;
  scenePresetIds: string[] | null;
  propIds: string[] | null;
};

export type SuggestionAssetRow = {
  id: string;
  title: string;
  tags: unknown;
  kind: string;
  url: string;
};

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Bounded SQL count for one project-scoped batch: shots + 0–3 name lists + assets. */
export function countSuggestionDbQueries(shots: SuggestionShotRow[]): number {
  const needChars = shots.some((s) => (s.characterIds ?? []).length > 0);
  const needLocs = shots.some((s) => (s.scenePresetIds ?? []).length > 0);
  const needProps = shots.some((s) => (s.propIds ?? []).length > 0);
  return 1 + (needChars ? 1 : 0) + (needLocs ? 1 : 0) + (needProps ? 1 : 0) + 1;
}

export function assembleShotAssetSuggestions(input: {
  shots: SuggestionShotRow[];
  names: Map<string, string>;
  assets: SuggestionAssetRow[];
  requestedShotIds?: string[];
}): Omit<ShotAssetSuggestionsBatchPayload, "stats"> {
  const assetById = new Map(input.assets.map((a) => [a.id, a]));
  const usedAssets = new Map<string, CompactSuggestedAsset>();
  const byShotId: Record<string, CompactShotSuggestions> = {};

  for (const shot of input.shots) {
    const terms = buildShotSearchTerms({
      characterNames: (shot.characterIds ?? []).map((id) => input.names.get(id)).filter((n): n is string => Boolean(n)),
      locationNames: (shot.scenePresetIds ?? []).map((id) => input.names.get(id)).filter((n): n is string => Boolean(n)),
      propNames: (shot.propIds ?? []).map((id) => input.names.get(id)).filter((n): n is string => Boolean(n)),
    });
    if (!terms.length) {
      byShotId[shot.id] = EMPTY_SHOT_SUGGESTIONS;
      continue;
    }
    const suggestions = suggestAssetsForShot(terms, input.assets, SHOT_ASSET_SUGGESTIONS_PER_SHOT_LIMIT);
    const items = suggestions.flatMap((s) => {
      const asset = assetById.get(s.assetId);
      if (!asset) return [];
      usedAssets.set(asset.id, { id: asset.id, title: asset.title, kind: asset.kind, url: asset.url });
      return [{ id: asset.id, matched: s.matched }];
    });
    byShotId[shot.id] = { terms, items };
  }

  if (input.requestedShotIds) {
    for (const id of input.requestedShotIds) {
      if (!byShotId[id]) byShotId[id] = EMPTY_SHOT_SUGGESTIONS;
    }
  }

  return { byShotId, assets: Object.fromEntries(usedAssets) };
}

export async function loadShotAssetSuggestionsForProject(input: {
  projectId: string;
  shotIds?: string[];
}): Promise<ShotAssetSuggestionsBatchPayload> {
  const requested = normalizeBatchShotIds(input.shotIds);
  if (requested && requested.length === 0) {
    return { byShotId: {}, assets: {}, stats: { shotCount: 0, assetCount: 0, dbQueries: 0 } };
  }

  let dbQueries = 0;
  const shotWhere = [
    eq(schema.scenes.projectId, input.projectId),
    isNull(schema.scenes.deletedAt),
    ...(requested ? [inArray(schema.scenes.id, requested)] : []),
  ];

  const shots = await db
    .select({
      id: schema.scenes.id,
      characterIds: schema.scenes.characterIds,
      scenePresetIds: schema.scenes.scenePresetIds,
      propIds: schema.scenes.propIds,
    })
    .from(schema.scenes)
    .where(and(...shotWhere))
    .orderBy(asc(schema.scenes.orderIndex), asc(schema.scenes.createdAt));
  dbQueries += 1;

  const charIds = uniqueIds(shots.flatMap((s) => s.characterIds ?? []));
  const locIds = uniqueIds(shots.flatMap((s) => s.scenePresetIds ?? []));
  const propIds = uniqueIds(shots.flatMap((s) => s.propIds ?? []));

  const nameLoads: Array<Promise<Array<{ id: string; name: string }>>> = [];
  if (charIds.length) {
    nameLoads.push(
      db
        .select({ id: schema.characters.id, name: schema.characters.name })
        .from(schema.characters)
        .where(and(eq(schema.characters.projectId, input.projectId), inArray(schema.characters.id, charIds))),
    );
  }
  if (locIds.length) {
    nameLoads.push(
      db
        .select({ id: schema.scenePresets.id, name: schema.scenePresets.name })
        .from(schema.scenePresets)
        .where(and(eq(schema.scenePresets.projectId, input.projectId), inArray(schema.scenePresets.id, locIds))),
    );
  }
  if (propIds.length) {
    nameLoads.push(
      db
        .select({ id: schema.props.id, name: schema.props.name })
        .from(schema.props)
        .where(and(eq(schema.props.projectId, input.projectId), inArray(schema.props.id, propIds))),
    );
  }
  const nameRows = nameLoads.length ? await Promise.all(nameLoads) : [];
  dbQueries += nameLoads.length;

  const names = new Map<string, string>();
  for (const rows of nameRows) {
    for (const row of rows) names.set(row.id, row.name);
  }

  const assets = await db
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
        eq(schema.assets.projectId, input.projectId),
        isNull(schema.assets.deletedAt),
        eq(schema.assets.isAiGenerated, false),
      ),
    )
    .orderBy(desc(schema.assets.createdAt))
    .limit(SHOT_ASSET_SUGGESTIONS_ASSET_LIMIT);
  dbQueries += 1;

  const assembled = assembleShotAssetSuggestions({
    shots,
    names,
    assets,
    requestedShotIds: requested,
  });

  return {
    ...assembled,
    stats: {
      shotCount: shots.length,
      assetCount: Object.keys(assembled.assets).length,
      dbQueries,
    },
  };
}
