import { describe, expect, it } from "vitest";
import {
  AI_PROJECT_ROLES,
  formatRoleRosterForPrompt,
  getAiProjectRole,
  listAiProjectRoles,
} from "./aiProjectRoles";

const STABLE_IDS = [
  "role.director",
  "role.storyboard",
  "role.generate",
  "role.continuity",
  "role.voice",
  "role.qa",
] as const;

describe("aiProjectRoles", () => {
  it("catalog ids are stable and complete", () => {
    const ids = listAiProjectRoles().map((r) => r.id);
    expect(ids).toEqual([...STABLE_IDS]);
    expect(new Set(ids).size).toBe(STABLE_IDS.length);
  });

  it("getAiProjectRole returns known roles and undefined for unknown", () => {
    const storyboard = getAiProjectRole("role.storyboard");
    expect(storyboard?.title).toBe("分鏡助理");
    expect(storyboard?.kindHints).toContain("generate");
    expect(getAiProjectRole("role.unknown")).toBeUndefined();
  });

  it("every role has title, summary, primary, humanKeeps, defaultGoalHint", () => {
    for (const role of AI_PROJECT_ROLES) {
      expect(role.title.length).toBeGreaterThan(0);
      expect(role.summary.length).toBeGreaterThan(0);
      expect(["llm", "runner", "fal", "human", "rules"]).toContain(role.primary);
      expect(role.humanKeeps.length).toBeGreaterThan(0);
      expect(role.defaultGoalHint.length).toBeGreaterThan(4);
    }
  });

  it("formatRoleRosterForPrompt includes all roles and anti-fake-member note", () => {
    const text = formatRoleRosterForPrompt();
    for (const id of STABLE_IDS) expect(text).toContain(id);
    expect(text).toContain("不是真人成員");
    expect(text).toContain("agent_run");
    // 提示詞預算守門
    expect(text.length).toBeLessThan(2500);
  });
});
