/**
 * canOwnProject 單元測試（轉移專案負責人的資格純規則）：
 * 新負責人必須是「該組成員」或「該團隊管理員」——負責人有封存/還原等裁決權，
 * 不能移交給組外看不到專案的人。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canOwnProject } from "./projects";

const members = ["u-leader", "u-member-1", "u-member-2"];
const admins = ["u-team-admin"];

describe("canOwnProject（專案負責人資格）", () => {
  it("該組成員（組長或組員）可接任負責人", () => {
    expect(canOwnProject(members, admins, "u-leader")).toBe(true);
    expect(canOwnProject(members, admins, "u-member-2")).toBe(true);
  });

  it("團隊管理員即使不在組員列，也可接任（有效成員規則與 listMemberRoles 一致）", () => {
    expect(canOwnProject(members, admins, "u-team-admin")).toBe(true);
  });

  it("組外的人一律擋下——不能把專案交給看不到它的人", () => {
    expect(canOwnProject(members, admins, "u-outsider")).toBe(false);
    expect(canOwnProject([], [], "u-anyone")).toBe(false);
  });
});

describe("continuity reference deletion guard", () => {
  it("protects locked references from both soft delete and permanent purge", () => {
    const source = readFileSync(new URL("./projects.ts", import.meta.url), "utf8");
    expect(source.match(/findRunningWorkflowUsingReferenceAsset\(asset\.projectId, asset\.id\)/g)).toHaveLength(2);
    expect(source).toContain("正被執行中的一致性工作流鎖定");
  });
});
