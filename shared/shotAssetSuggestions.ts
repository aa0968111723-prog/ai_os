/**
 * Large-storyboard shot asset suggestion contract (#755).
 *
 * Matching semantics stay in shared/story.ts (name/tag overlap, not embeddings).
 * This module is the batch transport/cache identity: bounded shotIds, compact
 * payload, GET URL size estimates, and per-shot expansion for ShotCard.
 */
import { z } from "zod";

/** Optional shotIds on the batch read — never put 300 UUIDs on a GET URL. */
export const SHOT_ASSET_SUGGESTIONS_BATCH_SHOT_ID_MAX = 80;
/** Same asset pool the single-shot endpoint already used. */
export const SHOT_ASSET_SUGGESTIONS_ASSET_LIMIT = 300;
/** Same per-shot suggestion cap as suggestAssetsForShot default. */
export const SHOT_ASSET_SUGGESTIONS_PER_SHOT_LIMIT = 6;
/** Node default max-http-header-size; #726 P1-11 overflow target. */
export const NODE_MAX_HTTP_HEADER_BYTES = 16 * 1024;
/** GET line framing + Host + a small session cookie. Node counts the whole header block. */
export const TYPICAL_GET_HEADER_OVERHEAD_BYTES = 400;

export const shotAssetSuggestionsBatchInputSchema = z.object({
  projectId: z.string().uuid(),
  /**
   * Optional filter. Omit to load every live shot in the project (preferred:
   * one small GET). If provided, hard-capped so a GET cannot explode headers.
   */
  shotIds: z.array(z.string().uuid()).max(SHOT_ASSET_SUGGESTIONS_BATCH_SHOT_ID_MAX).optional(),
});

export type ShotAssetSuggestionsBatchInput = z.infer<typeof shotAssetSuggestionsBatchInputSchema>;

export type CompactSuggestedAsset = {
  id: string;
  title: string;
  kind: string;
  url: string;
};

export type CompactShotSuggestionRef = {
  id: string;
  matched: string[];
};

export type CompactShotSuggestions = {
  terms: string[];
  items: CompactShotSuggestionRef[];
};

export type ShotAssetSuggestionItem = CompactSuggestedAsset & {
  matched: string[];
};

export type ShotAssetSuggestionsBatchStats = {
  shotCount: number;
  assetCount: number;
  dbQueries: number;
};

export type ShotAssetSuggestionsBatchPayload = {
  byShotId: Record<string, CompactShotSuggestions>;
  assets: Record<string, CompactSuggestedAsset>;
  stats: ShotAssetSuggestionsBatchStats;
};

export const EMPTY_SHOT_SUGGESTIONS: CompactShotSuggestions = { terms: [], items: [] };
export const EMPTY_SHOT_SUGGESTION_ITEMS: ShotAssetSuggestionItem[] = [];

export function normalizeBatchShotIds(shotIds: string[] | undefined): string[] | undefined {
  if (!shotIds) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of shotIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function chunkShotIds(
  shotIds: string[],
  size = SHOT_ASSET_SUGGESTIONS_BATCH_SHOT_ID_MAX,
): string[][] {
  if (size <= 0) return [shotIds];
  const chunks: string[][] = [];
  for (let i = 0; i < shotIds.length; i += size) chunks.push(shotIds.slice(i, i + size));
  return chunks.length ? chunks : [[]];
}

/** Expand the compact batch map into the existing ShotCard chip shape. */
export function expandShotSuggestions(
  payload: Pick<ShotAssetSuggestionsBatchPayload, "byShotId" | "assets">,
  shotId: string,
): ShotAssetSuggestionItem[] {
  const entry = payload.byShotId[shotId];
  if (!entry?.items.length) return [];
  const out: ShotAssetSuggestionItem[] = [];
  for (const item of entry.items) {
    const asset = payload.assets[item.id];
    if (!asset) continue;
    out.push({ ...asset, matched: item.matched });
  }
  return out;
}

/**
 * tRPC httpBatchLink GET size for N independent queries of the same procedure.
 * This is the #726 header-explosion model: path repeats + JSON `input` query.
 */
export function estimateTrpcGetUrlBytes(procedure: string, inputs: unknown[]): number {
  const path = `/api/trpc/${inputs.map(() => procedure).join(",")}`;
  const batchInput: Record<string, { json: unknown }> = {};
  inputs.forEach((value, i) => {
    batchInput[String(i)] = { json: value };
  });
  const query = `batch=1&input=${encodeURIComponent(JSON.stringify(batchInput))}`;
  return path.length + 1 + query.length;
}

export function exceedsNodeHeaderLimit(bytes: number): boolean {
  return bytes >= NODE_MAX_HTTP_HEADER_BYTES;
}

export function estimateIncomingGetHeaderBytes(urlBytes: number): number {
  return urlBytes + TYPICAL_GET_HEADER_OVERHEAD_BYTES;
}

/**
 * Pre-#755 per-shot endpoint: 1 shot row + 0–3 name lookups + 1 project asset scan.
 * Assets were re-downloaded identically for every card.
 */
export function countLegacyPerShotDbQueries(opts: {
  hasCharacters: boolean;
  hasLocations: boolean;
  hasProps: boolean;
}): number {
  return 1 + (opts.hasCharacters ? 1 : 0) + (opts.hasLocations ? 1 : 0) + (opts.hasProps ? 1 : 0) + 1;
}

export function measureSuggestionFanout(shotCount: number): {
  shotCount: number;
  before: {
    suggestionRequests: number;
    dbQueries: number;
    getUrlBytes: number;
    headerBytes: number;
    headerOverflow: boolean;
  };
  after: {
    suggestionRequests: number;
    dbQueriesMax: number;
    getUrlBytes: number;
    headerBytes: number;
    headerOverflow: boolean;
  };
} {
  const sceneIds = Array.from({ length: shotCount }, (_, i) => {
    const n = String(i + 1).padStart(12, "0");
    return `00000000-0000-4000-8000-${n}`;
  });
  const projectId = "00000000-0000-4000-8000-000000000001";
  const beforeUrl = estimateTrpcGetUrlBytes(
    "story.shotAssetSuggestions",
    sceneIds.map((sceneId) => ({ sceneId })),
  );
  const afterUrl = estimateTrpcGetUrlBytes("story.shotAssetSuggestionsBatch", [{ projectId }]);
  const beforeHeader = estimateIncomingGetHeaderBytes(beforeUrl);
  const afterHeader = estimateIncomingGetHeaderBytes(afterUrl);
  const perShot = countLegacyPerShotDbQueries({
    hasCharacters: true,
    hasLocations: true,
    hasProps: true,
  });
  return {
    shotCount,
    before: {
      suggestionRequests: shotCount,
      dbQueries: shotCount * perShot,
      getUrlBytes: beforeUrl,
      headerBytes: beforeHeader,
      headerOverflow: exceedsNodeHeaderLimit(beforeHeader),
    },
    after: {
      suggestionRequests: 1,
      dbQueriesMax: 5,
      getUrlBytes: afterUrl,
      headerBytes: afterHeader,
      headerOverflow: exceedsNodeHeaderLimit(afterHeader),
    },
  };
}
