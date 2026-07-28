import { describe, expect, it } from "vitest";
import {
  PROJECT_DATA_TEMPLATES,
  buildBoundTableFields,
  projectDataAiHint,
} from "./projectDataTemplates";

describe("buildBoundTableFields", () => {
  it("every template includes a project link field", () => {
    for (const t of PROJECT_DATA_TEMPLATES) {
      const { fields, projectFieldKey, sampleData } = buildBoundTableFields(t.id);
      expect(fields.some((f) => f.key === projectFieldKey && f.type === "project")).toBe(true);
      const sample = sampleData("11111111-1111-4111-8111-111111111111");
      expect(sample[projectFieldKey]).toBe("11111111-1111-4111-8111-111111111111");
    }
  });
});

describe("projectDataAiHint", () => {
  it("empty when nothing", () => {
    expect(projectDataAiHint({ knowledgeCount: 0, assetCount: 0, linkedRowCount: 0 }).tone).toBe("empty");
  });
  it("partial when only media", () => {
    expect(projectDataAiHint({ knowledgeCount: 0, assetCount: 3, linkedRowCount: 0 }).tone).toBe("partial");
  });
  it("ok when text or linked rows", () => {
    expect(projectDataAiHint({ knowledgeCount: 2, assetCount: 0, linkedRowCount: 0 }).tone).toBe("ok");
    expect(projectDataAiHint({ knowledgeCount: 0, assetCount: 0, linkedRowCount: 5 }).tone).toBe("ok");
  });
});
