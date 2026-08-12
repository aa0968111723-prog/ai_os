import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DECISION_LIST_LIMIT } from "./decisionCore";

const source = readFileSync(new URL("./decisionCore.ts", import.meta.url), "utf8");

function expectBefore(first: string, second: string): void {
  const firstAt = source.indexOf(first);
  const secondAt = source.indexOf(second);
  expect(firstAt).toBeGreaterThanOrEqual(0);
  expect(secondAt).toBeGreaterThan(firstAt);
}

describe("decision list envelope and reference ACL", () => {
  it("discloses listed/total so a 100-row page cannot be claimed as the whole log", () => {
    expect(DECISION_LIST_LIMIT).toBe(100);
    expect(source).toContain("truncated: total > items.length");
    expect(source).toContain("cap: DECISION_LIST_LIMIT");
    expectBefore("sql<number>`count(*)`", "return {");
  });

  it("refuses a foreign-project scene/asset/generation/note/schedule ref before insert", () => {
    expect(source).toContain("參照對象不存在或不屬於此專案");
    expectBefore("await assertDecisionRef(project, input.refType, input.refId);", ".insert(schema.decisions)");
    expect(source).toContain("row.projectId !== project.id");
    expect(source).toContain("row.groupId !== project.groupId");
  });
});
