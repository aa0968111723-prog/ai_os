import type { SceneVersion } from "./sceneVersions";

export interface VisualVariantBatchRef {
  requested: number;
  generationIds: readonly string[];
  launchFailures: number;
}

/** Transient UI projection over real scene versions; generations remain truth. */
export function summarizeVisualVariantBatch(batch: VisualVariantBatchRef, versions: readonly SceneVersion[]) {
  const matched = versions.filter((version) => version.generationId && batch.generationIds.includes(version.generationId));
  const successes = matched.filter((version) => !!version.assetId && version.state !== "failed");
  const failures = batch.launchFailures + matched.filter((version) => version.state === "failed").length;
  const awaitingApproval = matched.some((version) => version.state === "awaiting_approval");
  const settled = matched.length + batch.launchFailures >= batch.requested
    && matched.every((version) => version.state !== "generating" && version.state !== "awaiting_approval");
  return {
    matched,
    successes,
    failures,
    awaitingApproval,
    settled,
    actualPoints: matched.reduce((sum, version) => sum + version.points, 0),
    compareAssetIds: successes.map((version) => version.assetId!).slice(0, 3),
  };
}
