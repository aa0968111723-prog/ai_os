/**
 * scenes.character_ids / scene_preset_ids / prop_ids / look_ids are JSONB, not FK.
 * Writes must not persist an id whose target is already gone; deleting a card must
 * strip that id from every shot in the project (including recycle-bin rows).
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import {
  livingCardIds,
  nullableLivingId,
  sceneCardIdsWithoutMany,
} from "../../shared/sceneEntityIds";

type Exec = Pick<typeof db, "select" | "update">;

export type SceneRefIds = {
  characterIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
  lookIds?: string[] | null;
  storySceneId?: string | null;
  assetId?: string | null;
};

export type LivingEntityIdSets = {
  characters: ReadonlySet<string>;
  scenePresets: ReadonlySet<string>;
  props: ReadonlySet<string>;
  looks: ReadonlySet<string>;
  storyScenes: ReadonlySet<string>;
  assets: ReadonlySet<string>;
};

export type LivingSceneRefs = {
  characterIds: string[] | null;
  scenePresetIds: string[] | null;
  propIds: string[] | null;
  lookIds: string[] | null;
  storySceneId: string | null;
  assetId: string | null;
};

export function applyLivingSceneRefs(refs: SceneRefIds, living: LivingEntityIdSets): LivingSceneRefs {
  return {
    characterIds: livingCardIds(refs.characterIds, living.characters),
    scenePresetIds: livingCardIds(refs.scenePresetIds, living.scenePresets),
    propIds: livingCardIds(refs.propIds, living.props),
    lookIds: livingCardIds(refs.lookIds, living.looks),
    storySceneId: nullableLivingId(refs.storySceneId, living.storyScenes),
    assetId: nullableLivingId(refs.assetId, living.assets),
  };
}

async function livingIds(
  exec: Pick<typeof db, "select">,
  table: typeof schema.characters | typeof schema.scenePresets | typeof schema.props | typeof schema.characterLooks | typeof schema.storyScenes,
  projectId: string,
  requested: readonly string[] | null | undefined,
): Promise<Set<string>> {
  const ids = [...new Set((requested ?? []).filter(Boolean))];
  if (ids.length === 0) return new Set();
  const rows = await exec
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.projectId, projectId), inArray(table.id, ids)));
  return new Set(rows.map((row) => row.id));
}

export async function loadLivingEntityIdSets(
  exec: Pick<typeof db, "select">,
  projectId: string,
  refs: SceneRefIds,
): Promise<LivingEntityIdSets> {
  const assetIds = [...new Set([refs.assetId].filter((id): id is string => Boolean(id)))];
  const [characters, scenePresets, props, looks, storyScenes, assets] = await Promise.all([
    livingIds(exec, schema.characters, projectId, refs.characterIds),
    livingIds(exec, schema.scenePresets, projectId, refs.scenePresetIds),
    livingIds(exec, schema.props, projectId, refs.propIds),
    livingIds(exec, schema.characterLooks, projectId, refs.lookIds),
    livingIds(exec, schema.storyScenes, projectId, refs.storySceneId ? [refs.storySceneId] : []),
    (async () => {
      if (assetIds.length === 0) return new Set<string>();
      const rows = await exec
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(
          and(
            eq(schema.assets.projectId, projectId),
            inArray(schema.assets.id, assetIds),
            isNull(schema.assets.deletedAt),
          ),
        );
      return new Set(rows.map((row) => row.id));
    })(),
  ]);
  return { characters, scenePresets, props, looks, storyScenes, assets };
}

/** Copy / persist only ids whose targets still exist. Ghosts drop; do not throw. */
export async function keepLivingSceneRefs(
  exec: Pick<typeof db, "select">,
  projectId: string,
  refs: SceneRefIds,
): Promise<LivingSceneRefs> {
  return applyLivingSceneRefs(refs, await loadLivingEntityIdSets(exec, projectId, refs));
}

export async function stripCardIdsFromProjectScenes(
  exec: Exec,
  projectId: string,
  removed: {
    characterIds?: readonly string[];
    scenePresetIds?: readonly string[];
    propIds?: readonly string[];
    lookIds?: readonly string[];
  },
): Promise<number> {
  const dropCharacters = new Set(removed.characterIds ?? []);
  const dropPresets = new Set(removed.scenePresetIds ?? []);
  const dropProps = new Set(removed.propIds ?? []);
  const dropLooks = new Set(removed.lookIds ?? []);
  if (dropCharacters.size + dropPresets.size + dropProps.size + dropLooks.size === 0) return 0;

  const rows = await exec
    .select({
      id: schema.scenes.id,
      characterIds: schema.scenes.characterIds,
      scenePresetIds: schema.scenes.scenePresetIds,
      propIds: schema.scenes.propIds,
      lookIds: schema.scenes.lookIds,
    })
    .from(schema.scenes)
    .where(eq(schema.scenes.projectId, projectId));

  let updated = 0;
  for (const row of rows) {
    const hitCharacters = (row.characterIds ?? []).some((id) => dropCharacters.has(id));
    const hitPresets = (row.scenePresetIds ?? []).some((id) => dropPresets.has(id));
    const hitProps = (row.propIds ?? []).some((id) => dropProps.has(id));
    const hitLooks = (row.lookIds ?? []).some((id) => dropLooks.has(id));
    if (!hitCharacters && !hitPresets && !hitProps && !hitLooks) continue;
    const next = {
      characterIds: hitCharacters ? sceneCardIdsWithoutMany(row.characterIds, dropCharacters) : row.characterIds,
      scenePresetIds: hitPresets ? sceneCardIdsWithoutMany(row.scenePresetIds, dropPresets) : row.scenePresetIds,
      propIds: hitProps ? sceneCardIdsWithoutMany(row.propIds, dropProps) : row.propIds,
      lookIds: hitLooks ? sceneCardIdsWithoutMany(row.lookIds, dropLooks) : row.lookIds,
    };
    await exec
      .update(schema.scenes)
      .set({
        characterIds: next.characterIds,
        scenePresetIds: next.scenePresetIds,
        propIds: next.propIds,
        lookIds: next.lookIds,
        rev: sql`${schema.scenes.rev} + 1`,
      })
      .where(eq(schema.scenes.id, row.id));
    updated += 1;
  }
  return updated;
}
