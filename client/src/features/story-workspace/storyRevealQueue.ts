import type { StoryInlineSectionId } from "./storyInlineNav";

/**
 * Durable reveal inbox.
 *
 * Chip / deep-link / presenter-follow events can fire before the matching
 * manager has mounted. A one-shot window event is lost in that window.
 * This module keeps the latest request until a subscriber consumes the
 * nested selector, so blank-story AI start and ?focus=generation-* still land.
 */
export type PendingStoryReveal = {
  section: StoryInlineSectionId;
  nestedSelector?: string;
  scroll?: boolean;
};

let pending: PendingStoryReveal | null = null;
const listeners = new Set<(next: PendingStoryReveal) => void>();

export function publishStoryReveal(next: PendingStoryReveal): void {
  pending = next;
  for (const listener of listeners) listener(next);
}

export function peekStoryReveal(): PendingStoryReveal | null {
  return pending;
}

export function peekNestedReveal(): string | undefined {
  return pending?.nestedSelector;
}

export function consumeNestedReveal(): string | undefined {
  if (!pending?.nestedSelector) return undefined;
  const selector = pending.nestedSelector;
  pending = { ...pending, nestedSelector: undefined };
  return selector;
}

export function subscribeStoryReveal(listener: (next: PendingStoryReveal) => void): () => void {
  listeners.add(listener);
  if (pending) listener(pending);
  return () => {
    listeners.delete(listener);
  };
}
