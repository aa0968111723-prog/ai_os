/**
 * knowledge.update has no `rev` column. Title/content writes must fail-closed
 * on a content baseline (CAS), not last-write-wins.
 *
 * Same reason persistStoryDoc refuses an omitted expectedRev: a missing token
 * must not fall back to "whatever is on the row now" and silent-LWW.
 */

export type KnowledgeContentBaseline = {
  title: string;
  content: string;
};

export function knowledgeUpdateTouchesBody(input: {
  title?: string;
  content?: string;
}): boolean {
  return input.title !== undefined || input.content !== undefined;
}

export type KnowledgeBaselineGate = "ok" | "omitted" | "incomplete";

export function knowledgeUpdateBaselineGate(
  baseline?: { title?: string; content?: string } | null,
): KnowledgeBaselineGate {
  if (!baseline) return "omitted";
  if (typeof baseline.title !== "string" || typeof baseline.content !== "string") {
    return "incomplete";
  }
  return "ok";
}

export function knowledgeBaselineMatches(
  row: KnowledgeContentBaseline,
  baseline: KnowledgeContentBaseline,
): boolean {
  return row.title === baseline.title && row.content === baseline.content;
}

export function knowledgeUpdateOmitMessage(gate: Exclude<KnowledgeBaselineGate, "ok">): string {
  return gate === "omitted"
    ? "omitted knowledge baseline — refuse silent LWW over knowledge title/content"
    : "incomplete knowledge baseline — refuse silent LWW over knowledge title/content";
}

export function knowledgeUpdateConflictMessage(): string {
  return "這筆知識已被更新，請重新載入後再存";
}

/**
 * Client save baseline: only `knowledge.get` (or the excerpt fallback after get
 * failure). Never the live edit draft — that would always match and become LWW.
 */
export function knowledgeSaveBaseline(input: {
  getTitle?: string;
  getContent?: string;
  fallbackTitle?: string;
  fallbackExcerpt?: string;
  getFailed?: boolean;
}): KnowledgeContentBaseline | null {
  if (typeof input.getTitle === "string" && typeof input.getContent === "string") {
    return { title: input.getTitle, content: input.getContent };
  }
  if (input.getFailed && typeof input.fallbackTitle === "string" && typeof input.fallbackExcerpt === "string") {
    return { title: input.fallbackTitle, content: input.fallbackExcerpt };
  }
  return null;
}
