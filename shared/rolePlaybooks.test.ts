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

describe("創作代理短版 playbook（#133 PR-3）", () => {
  it("短版存在且以 playbook id 取用；限制排程與大量人類任務", () => {
    const short = getPlaybook("playbook.creation.short.v1");
    expect(short).toBeDefined();
    expect(short?.roleId).toBe("role.storyboard");
    expect(short?.plannerHint).toContain("不要預設 create_schedule");
    expect(short?.plannerHint).toContain("missingInformation");
    expect(short?.plannerHint).toContain("summary.rationale");
    expect(short?.suggestedKinds).toEqual([
      "split_script", "create_scene", "generate", "voiceover",
    ]);
  });

  it("不影響長版：role.storyboard 仍解析到主 playbook（#133 路徑不受影響）", () => {
    expect(getPlaybook("role.storyboard")?.id).toBe("playbook.storyboard.v1");
  });

  it("短版提示會注入規劃器 role block", () => {
    const block = buildPlannerRoleBlock();
    expect(block).toContain("playbook.creation.short.v1");
    expect(block.length).toBeLessThan(8000);
  });
});
