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
    // Empty title is still a create intent (更多「建立專案」). Removing the
    // key here lost the handoff when navigate("/dashboard") remounted
    // MobileHome after the event already fired on /p/:id.
    sessionStorage.setItem(NEW_PROJECT_IDEA_KEY, title);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(NEW_PROJECT_IDEA_EVENT, { detail: { ideaTitle: title } }));
}

/** `null` = no pending open. `""` = open a blank create sheet. */
export function takePendingNewProjectIdea(): string | null {
  try {
    const value = sessionStorage.getItem(NEW_PROJECT_IDEA_KEY);
    if (value == null) return null;
    sessionStorage.removeItem(NEW_PROJECT_IDEA_KEY);
    return value.trim();
  } catch {
    return null;
  }
}
