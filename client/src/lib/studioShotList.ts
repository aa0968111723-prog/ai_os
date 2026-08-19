/**
 * /p/ 產生分鏡 and /studio/:id share scenes.listByProject.
 * After materialize, the project page chip updates from the mutation result,
 * but studio still first-paints a cached empty list (「分鏡 0 鏡 · 0s」)
 * until a full reload — invalidate alone only refetches *active* observers,
 * and studio is not mounted yet. Fetch warms the shared cache so the first
 * studio paint matches.
 */

export type StudioShotListUtils = {
  scenes: {
    listByProject: {
      invalidate: (input: { projectId: string }) => Promise<unknown>;
      fetch: (input: { projectId: string }) => Promise<unknown>;
    };
  };
  story?: {
    scenesList?: {
      invalidate?: (input: { projectId: string }) => Promise<unknown>;
    };
  };
};

export async function refreshStudioShotList(
  utils: StudioShotListUtils,
  projectId: string,
): Promise<void> {
  await Promise.all([
    utils.scenes.listByProject.invalidate({ projectId }),
    utils.story?.scenesList?.invalidate?.({ projectId }) ?? Promise.resolve(),
  ]);
  await utils.scenes.listByProject.fetch({ projectId });
}

/** Cached [] + in-flight refetch must not render「0 鏡 / 還沒有分鏡」. */
export function studioShotListIsLoading(query: {
  isLoading: boolean;
  isFetching: boolean;
  data?: readonly unknown[] | undefined;
}): boolean {
  if (query.isLoading) return true;
  return query.isFetching && (query.data?.length ?? 0) === 0;
}
