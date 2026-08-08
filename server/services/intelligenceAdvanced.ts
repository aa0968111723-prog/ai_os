import { cosineSimilarity } from "./intelligenceCore";

export const FACE_CLUSTER_MODEL = "provider-face-embedding-v1";

export interface FaceObservation {
  intelligenceId: string;
  faceIndex: number;
  embedding: number[];
  quality?: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface FaceObservationCluster {
  members: FaceObservation[];
  centroid: number[];
  confidence: number;
}

function normalizedCentroid(vectors: number[][]): number[] {
  if (!vectors.length) return [];
  const dimensions = Math.max(...vectors.map((vector) => vector.length));
  const centroid = Array.from({ length: dimensions }, (_, dimension) => (
    vectors.reduce((sum, vector) => sum + (vector[dimension] ?? 0), 0) / vectors.length
  ));
  const norm = Math.sqrt(centroid.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? centroid.map((value) => value / norm) : centroid;
}

/**
 * Deterministic single-link clustering. It never names a real person: its
 * output is only evidence for an anonymous cluster and review workflow.
 */
export function clusterFaceObservations(
  observations: readonly FaceObservation[],
  similarityThreshold = Number(process.env.INTELLIGENCE_FACE_SIMILARITY ?? 0.86),
): FaceObservationCluster[] {
  const threshold = Number.isFinite(similarityThreshold)
    ? Math.min(0.999, Math.max(0.5, similarityThreshold))
    : 0.86;
  const parents = observations.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parents[cursor] !== cursor) cursor = parents[cursor]!;
    while (parents[index] !== index) {
      const next = parents[index]!;
      parents[index] = cursor;
      index = next;
    }
    return cursor;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  for (let left = 0; left < observations.length; left += 1) {
    for (let right = left + 1; right < observations.length; right += 1) {
      if (cosineSimilarity(observations[left]!.embedding, observations[right]!.embedding) >= threshold) {
        union(left, right);
      }
    }
  }
  const groups = new Map<number, FaceObservation[]>();
  observations.forEach((observation, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), observation]);
  });
  return [...groups.values()].map((members) => {
    const centroid = normalizedCentroid(members.map((member) => member.embedding));
    const similarities = members.map((member) => cosineSimilarity(centroid, member.embedding));
    return {
      members,
      centroid,
      confidence: similarities.reduce((sum, value) => sum + value, 0) / Math.max(1, similarities.length),
    };
  }).sort((left, right) => right.members.length - left.members.length);
}

export type LibraryQueryIntent = "similar" | "unassigned" | "unclassified" | "unused" | "entity" | "general";

export interface ParsedLibraryQuery {
  raw: string;
  positive: string;
  excludedTerms: string[];
  intent: LibraryQueryIntent;
}

export function parseLibraryQuery(raw: string): ParsedLibraryQuery {
  const normalized = raw.normalize("NFKC").trim();
  const excludedTerms: string[] = [];
  const positive = normalized.replace(/(?:但|且)?(?:沒有|不含|排除)\s*([^，。,.\s]+)/g, (_match, term: string) => {
    if (term.trim()) excludedTerms.push(term.trim().toLocaleLowerCase("zh-TW"));
    return " ";
  }).replace(/\s+/g, " ").trim();
  let intent: LibraryQueryIntent = "general";
  if (/相似|類似|similar/i.test(normalized)) intent = "similar";
  else if (/沒有用在|未使用|unused/i.test(normalized)) intent = "unused";
  else if (/未歸屬|沒有.*專案|無專案/.test(normalized)) intent = "unassigned";
  else if (/未分類|還沒有被分類|待分類/.test(normalized)) intent = "unclassified";
  else if (/人物|場景|專案|角色|地點|主題|組織|事件/.test(normalized)) intent = "entity";
  return { raw: normalized, positive: positive || normalized, excludedTerms, intent };
}

export function normalizeEntityName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-TW").replace(/\s+/g, " ");
}

export interface ExtractedEntityCandidate {
  type: "LOCATION" | "ORGANIZATION" | "EVENT" | "TOPIC" | "WEATHER" | "TIME";
  name: string;
  confidence: number;
}

/** Conservative canonical extraction. Named people are intentionally omitted. */
export function extractEntityCandidates(text: string): ExtractedEntityCandidate[] {
  const candidates: ExtractedEntityCandidate[] = [];
  const rules: Array<[ExtractedEntityCandidate["type"], RegExp, string, number]> = [
    ["WEATHER", /下雨|雨天|雨中|rain(?:y|ing)?/i, "Rain", 0.96],
    ["WEATHER", /晴天|sunny/i, "Sunny", 0.92],
    ["TIME", /黃昏|傍晚|evening|sunset/i, "Evening", 0.91],
    ["TIME", /夜晚|深夜|night/i, "Night", 0.91],
    ["TIME", /清晨|早晨|morning|dawn/i, "Morning", 0.91],
  ];
  for (const [type, pattern, name, confidence] of rules) {
    if (pattern.test(text)) candidates.push({ type, name, confidence });
  }
  const topicMatches = text.matchAll(/(?:主題|關於|topic)[:：\s]+([^，。,.\n]{2,30})/gi);
  for (const match of topicMatches) candidates.push({ type: "TOPIC", name: match[1]!.trim(), confidence: 0.78 });
  return candidates;
}

export function semanticDuplicateThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.INTELLIGENCE_NEAR_DUPLICATE_SIMILARITY ?? 0.985);
  return Number.isFinite(value) ? Math.min(0.9999, Math.max(0.8, value)) : 0.985;
}

export function applyCategoryFeedback<T extends { category: string; categoryConfidence: number; rationale: string }>(
  result: T,
  events: ReadonlyArray<{ action: string; prediction: unknown; correction: unknown }>,
): T {
  const corrections = new Map<string, number>();
  let confirmations = 0;
  for (const event of events) {
    const prediction = event.prediction && typeof event.prediction === "object" ? event.prediction as Record<string, unknown> : {};
    if (prediction.category !== result.category) continue;
    const correction = event.correction && typeof event.correction === "object" ? event.correction as Record<string, unknown> : {};
    if (event.action === "confirm") confirmations += 1;
    if (typeof correction.category === "string" && correction.category !== result.category) {
      corrections.set(correction.category, (corrections.get(correction.category) ?? 0) + 1);
    }
  }
  const learned = [...corrections.entries()].sort((left, right) => right[1] - left[1])[0];
  if (learned && learned[1] >= 2) return {
    ...result,
    category: learned[0],
    categoryConfidence: Math.max(0.96, result.categoryConfidence),
    rationale: `${result.rationale}；套用團隊已確認的分類修正`,
  };
  if (confirmations >= 2) return {
    ...result,
    categoryConfidence: Math.max(0.95, result.categoryConfidence),
    rationale: `${result.rationale}；套用團隊已確認的分類偏好`,
  };
  return result;
}

export interface RetrievalFeedbackEvent {
  action: string;
  prediction: unknown;
  correction: unknown;
  createdBy?: string | null;
}

function feedbackValues(event: RetrievalFeedbackEvent): { categories: string[]; tags: string[]; polarity: number } {
  const prediction = event.prediction && typeof event.prediction === "object" ? event.prediction as Record<string, unknown> : {};
  const correction = event.correction && typeof event.correction === "object" ? event.correction as Record<string, unknown> : {};
  const category = typeof correction.category === "string" ? correction.category
    : typeof prediction.category === "string" ? prediction.category : null;
  const rawTags = Array.isArray(correction.tags) ? correction.tags : Array.isArray(prediction.tags) ? prediction.tags : [];
  const tags = rawTags.filter((tag): tag is string => typeof tag === "string");
  const polarity = ["reject", "remove", "ignore"].includes(event.action) ? -1 : 1;
  return { categories: category ? [category] : [], tags, polarity };
}

/** Small bounded boost only; feedback can refine a result but never bypass retrieval or ACL. */
export function feedbackRerankBoost(input: {
  query: string;
  category?: string | null;
  tags?: readonly string[];
  events: readonly RetrievalFeedbackEvent[];
  userId?: string;
}): number {
  const query = input.query.normalize("NFKC").toLocaleLowerCase("zh-TW");
  const category = input.category?.normalize("NFKC").toLocaleLowerCase("zh-TW") ?? "";
  const tags = new Set((input.tags ?? []).map((tag) => tag.normalize("NFKC").toLocaleLowerCase("zh-TW")));
  let weighted = 0; let possible = 0;
  for (const event of input.events) {
    const values = feedbackValues(event);
    const weight = event.createdBy && event.createdBy === input.userId ? 2 : 1;
    for (const value of values.categories) {
      const normalized = value.normalize("NFKC").toLocaleLowerCase("zh-TW");
      if (!query.includes(normalized) && normalized !== category) continue;
      possible += weight;
      if (normalized === category) weighted += weight * values.polarity;
    }
    for (const value of values.tags) {
      const normalized = value.normalize("NFKC").toLocaleLowerCase("zh-TW");
      const label = normalized.includes(":") ? normalized.split(":").slice(1).join(":").replace(/-/g, " ") : normalized;
      if (!query.includes(label) && !tags.has(normalized)) continue;
      possible += weight;
      if (tags.has(normalized)) weighted += weight * values.polarity;
    }
  }
  if (!possible) return 0;
  return Math.max(-1, Math.min(1, weighted / possible));
}
