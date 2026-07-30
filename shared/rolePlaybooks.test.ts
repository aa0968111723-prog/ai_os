import { describe, expect, it } from "vitest";
import { listAiProjectRoles } from "./aiProjectRoles";
import {
  buildPlannerRoleBlock,
  getPlaybook,
  listPlaybooks,
  playbookGoalHint,
  ROLE_PLAYBOOKS,
} from "./rolePlaybooks";

describe("rolePlaybooks", () => {
  it("lists versioned playbooks with stable roleId linkage", () => {
    const books = listPlaybooks();
    expect(books.length).toBeGreaterThanOrEqual(3);
    for (const pb of books) {
      expect(pb.id).toMatch(/^playbook\./);
      expect(pb.version.length).toBeGreaterThan(0);
      expect(pb.suggestedKinds.length).toBeGreaterThan(0);
      expect(listAiProjectRoles().some((r) => r.id === pb.roleId)).toBe(true);
    }
  });

  it("getPlaybook resolves by roleId and by playbook id", () => {
    const byRole = getPlaybook("role.storyboard");
    expect(byRole?.id).toBe("playbook.storyboard.v1");
    expect(byRole?.suggestedKinds).toEqual(
      expect.arrayContaining(["split_script", "create_scene", "generate"]),
    );
    expect(getPlaybook("playbook.generate.v1")?.roleId).toBe("role.generate");
    expect(getPlaybook("role.missing")).toBeUndefined();
  });

  it("storyboard / generate / voice playbooks exist as required L1 set", () => {
    expect(getPlaybook("role.storyboard")).toBeDefined();
    expect(getPlaybook("role.generate")).toBeDefined();
    expect(getPlaybook("role.voice")).toBeDefined();
  });

  it("buildPlannerRoleBlock covers roster + playbook hints and stays compact", () => {
    const block = buildPlannerRoleBlock();
    for (const role of listAiProjectRoles()) {
      expect(block).toContain(role.id);
    }
    for (const pb of ROLE_PLAYBOOKS) {
      expect(block).toContain(pb.id);
    }
    expect(block).toContain("非假成員");
    expect(block).toContain("generate");
    // 與 knowledge 預算共存：粗略上限 8KB
    expect(block.length).toBeLessThan(8000);
  });

  it("playbookGoalHint falls back to role default", () => {
    expect(playbookGoalHint("role.voice")).toMatch(/旁白/);
    expect(playbookGoalHint("role.nope")).toBeUndefined();
  });
});
