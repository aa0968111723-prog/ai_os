/**
 * scenes.character_ids / scene_preset_ids / prop_ids / look_ids are JSONB,
 * not FK. A deleted card must not stay on a shot, and a write must not persist
 * an id that is already gone.
 */

export function livingIdList(
  requested: readonly string[] | null | undefined,
  existing: ReadonlySet<string>,
): string[] {
  return [...new Set(requested ?? [])].filter((id) => existing.has(id));
}

/** Empty after filter → null (same as sceneCardColumns). */
export function livingCardIds(
  requested: readonly string[] | null | undefined,
  existing: ReadonlySet<string>,
): string[] | null {
  const next = livingIdList(requested, existing);
  return next.length ? next : null;
}

export function danglingIdList(
  requested: readonly string[] | null | undefined,
  existing: ReadonlySet<string>,
): string[] {
  return [...new Set(requested ?? [])].filter((id) => !existing.has(id));
}

/** Empty after strip → null (same as sceneCardColumns). */
export function sceneCardIdsWithout(
  current: readonly string[] | null | undefined,
  removedId: string,
): string[] | null {
  return sceneCardIdsWithoutMany(current, new Set([removedId]));
}

export function sceneCardIdsWithoutMany(
  current: readonly string[] | null | undefined,
  removedIds: ReadonlySet<string>,
): string[] | null {
  const next = (current ?? []).filter((id) => !removedIds.has(id));
  return next.length ? next : null;
}

export function nullableLivingId(
  id: string | null | undefined,
  existing: ReadonlySet<string>,
): string | null {
  if (!id) return null;
  return existing.has(id) ? id : null;
}
