import { describe, expect, it } from "vitest";
import {
  composeGoalFromSkills,
  getAgentSkill,
  listAgentSkills,
  resolveModeFromSkills,
} from "./agentSkills";

describe("agentSkills catalog", () => {
  it("lists mode + role skills with stable ids and creator-facing titles", () => {
    const skills = listAgentSkills();
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("ask");
    expect(ids).toContain("plan");
    expect(ids).toContain("role.storyboard");
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of skills) {
      expect(s.title).not.toMatch(/^role\./);
      expect(s.icon).toBeTruthy();
      expect(s.scene.length).toBeGreaterThan(0);
    }
  });

  it("resolveModeFromSkills prefers role → plan over bare generate", () => {
    expect(resolveModeFromSkills(["generate", "role.storyboard"])).toBe("plan");
    expect(resolveModeFromSkills(["ask"])).toBe("ask");
    expect(resolveModeFromSkills([])).toBeUndefined();
  });

  it("composeGoalFromSkills fills empty goal from skill hints", () => {
    const filled = composeGoalFromSkills(["role.storyboard"], "");
    expect(filled.length).toBeGreaterThanOrEqual(5);
    expect(getAgentSkill("role.storyboard")?.goalHint).toBe(filled);

    const multi = composeGoalFromSkills(["role.storyboard", "role.voice"], "  ");
    expect(multi).toMatch(/^請/);
    expect(multi).toContain("、");
  });

  it("composeGoalFromSkills keeps an existing substantial goal", () => {
    const g = "請幫我把腳本拆成六鏡並出圖";
    expect(composeGoalFromSkills(["role.generate"], g)).toBe(g);
  });
});
