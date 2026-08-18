/**
 * Assistant → create-project handoff.
 *
 * GlobalAssistantSheet only carries the idea; it must not confirm the write.
 * Phone mounts MobileHome (not Launchpad), so the event can fire before the
 * home listener exists. Persist to sessionStorage so the next home/launchpad
 * mount still opens the form.
 */

export const NEW_PROJECT_IDEA_EVENT = "aios:new-project-idea";
export const NEW_PROJECT_IDEA_KEY = "aios.pendingNewProjectIdea";

export function publishNewProjectIdea(ideaTitle: string): void {
  const title = ideaTitle.trim();
  try {
    if (title) sessionStorage.setItem(NEW_PROJECT_IDEA_KEY, title);
    else sessionStorage.removeItem(NEW_PROJECT_IDEA_KEY);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(NEW_PROJECT_IDEA_EVENT, { detail: { ideaTitle: title } }));
}

export function takePendingNewProjectIdea(): string | null {
  try {
    const value = sessionStorage.getItem(NEW_PROJECT_IDEA_KEY);
    if (value != null) sessionStorage.removeItem(NEW_PROJECT_IDEA_KEY);
    const title = value?.trim() ?? "";
    return title || null;
  } catch {
    return null;
  }
}
