import { afterEach, describe, expect, it } from "vitest";
import { NEW_PROJECT_IDEA_EVENT, publishNewProjectIdea, takePendingNewProjectIdea } from "./newProjectIdea";

afterEach(() => {
  sessionStorage.clear();
});

describe("newProjectIdea handoff", () => {
  it("persists the title so a late MobileHome mount can still open the form", () => {
    const seen: string[] = [];
    const onIdea = (event: Event) => {
      seen.push((event as CustomEvent<{ ideaTitle?: string }>).detail?.ideaTitle ?? "");
    };
    window.addEventListener(NEW_PROJECT_IDEA_EVENT, onIdea);
    publishNewProjectIdea("  淡江禪學社  ");
    window.removeEventListener(NEW_PROJECT_IDEA_EVENT, onIdea);
    expect(seen).toEqual(["淡江禪學社"]);
    expect(takePendingNewProjectIdea()).toBe("淡江禪學社");
    expect(takePendingNewProjectIdea()).toBeNull();
  });
});
