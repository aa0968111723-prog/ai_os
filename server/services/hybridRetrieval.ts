export interface SemanticRetrievalAdapter {
  name: string;
  score(query: string, documents: string[]): Promise<number[]>;
}

export interface HybridRetrievalResult<T> {
  items: T[];
  semanticApplied: boolean;
}

function normalizedTokens(value: string): string[] {
  const normalized = value.toLocaleLowerCase().normalize("NFKC");
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const han = [...normalized].filter((char) => /\p{Script=Han}/u.test(char));
  return [...new Set([...words, ...han])];
}

function itemText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  const row = value as Record<string, unknown>;
  return [row.title, row.name, row.label, row.kind, row.status, row.summary, row.excerpt, row.content, row.text, row.description]
    .filter((entry): entry is string => typeof entry === "string")
    .join(" ");
}

/** Keyword + metadata today, with a bounded semantic scorer adapter when configured. */
export async function rankHybridItems<T>(
  items: T[], query: string, semanticAdapter?: SemanticRetrievalAdapter, limit = 30,
): Promise<HybridRetrievalResult<T>> {
  if (!query.trim() || items.length <= 1) return { items: items.slice(0, limit), semanticApplied: false };
  const queryTokens = normalizedTokens(query);
  const documents = items.map(itemText);
  const semantic = semanticAdapter ? await semanticAdapter.score(query, documents).catch(() => []) : [];
  const semanticApplied = semantic.length === items.length;
  const scored = items.map((item, index) => {
    const tokens = new Set(normalizedTokens(documents[index] ?? ""));
    const overlap = queryTokens.reduce((sum, token) => sum + (tokens.has(token) ? 1 : 0), 0);
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const title = String(row.title ?? row.name ?? row.label ?? "").toLocaleLowerCase();
    const metadata = queryTokens.some((token) => title.includes(token)) ? 2 : 0;
    return { item, index, score: overlap + metadata + (semanticApplied ? Math.max(0, semantic[index] ?? 0) * 3 : 0) };
  });
  return {
    items: scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map((entry) => entry.item),
    semanticApplied,
  };
}
