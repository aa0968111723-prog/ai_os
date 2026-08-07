import { describe, expect, it } from "vitest";
import {
  PROJECT_DATA_TEMPLATE_IDS,
  PROJECT_DATA_TEMPLATES,
  buildBoundTableFields,
  projectDataAiHint,
} from "./projectDataTemplates";
import { validateFields, validateRowData } from "./databaseFields";

describe("buildBoundTableFields", () => {
  it("covers every registered template id", () => {
    expect(PROJECT_DATA_TEMPLATES.map((t) => t.id).sort()).toEqual([...PROJECT_DATA_TEMPLATE_IDS].sort());
  });

  it("every template includes a project link field and valid sample row", () => {
    for (const t of PROJECT_DATA_TEMPLATES) {
      const { fields, projectFieldKey, sampleData } = buildBoundTableFields(t.id);
      expect(validateFields(fields)).toBeNull();
      expect(fields.some((f) => f.key === projectFieldKey && f.type === "project")).toBe(true);
      const sample = sampleData("11111111-1111-4111-8111-111111111111");
      expect(sample[projectFieldKey]).toBe("11111111-1111-4111-8111-111111111111");
      expect(validateRowData(fields, sample).ok).toBe(true);
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
  it("ok when text or AI-readable linked rows", () => {
    expect(projectDataAiHint({ knowledgeCount: 2, assetCount: 0, linkedRowCount: 0 }).tone).toBe("ok");
    expect(projectDataAiHint({ knowledgeCount: 0, assetCount: 0, linkedRowCount: 5 }).tone).toBe("ok");
    expect(
      projectDataAiHint({ knowledgeCount: 0, assetCount: 0, linkedRowCount: 5, linkedAiReadableRowCount: 5 }).tone,
    ).toBe("ok");
  });
  it("partial when linked rows exist but none are AI-readable", () => {
    const h = projectDataAiHint({
      knowledgeCount: 0,
      assetCount: 0,
      linkedRowCount: 4,
      linkedAiReadableRowCount: 0,
    });
    expect(h.tone).toBe("partial");
    expect(h.label).toMatch(/AI 目前看不到/);
  });

  it("user-facing: detail mentions hidden AI rows when mixed", () => {
    const h = projectDataAiHint({
      knowledgeCount: 1,
      assetCount: 0,
      linkedRowCount: 5,
      linkedAiReadableRowCount: 2,
    });
    expect(h.tone).toBe("ok");
    expect(h.detail).toMatch(/資料表 AI 可讀 2 列/);
    expect(h.detail).toMatch(/另有 3 列不提供 AI/);
  });
});

describe("templates multi-role coverage (user lens)", () => {
  it("includes social publish, media list, roster, quotes, checklist, blank", () => {
    const ids = PROJECT_DATA_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["roster", "quotes", "media", "publish", "checklist", "blank"]));
  });

  it("labels stay neutral (no film-only jargon)", () => {
    for (const t of PROJECT_DATA_TEMPLATES) {
      expect(t.label + t.defaultName + t.hint).not.toMatch(/本片|場次|金句|哪支片|開示/);
    }
  });

  it("publish template has channel + date for social editors", () => {
    const { fields } = buildBoundTableFields("publish");
    expect(fields.some((f) => f.label === "渠道" && f.type === "select")).toBe(true);
    expect(fields.some((f) => f.label === "預計日" && f.type === "date")).toBe(true);
  });

  it("media template has type options for edit/animation assets", () => {
    const { fields } = buildBoundTableFields("media");
    const type = fields.find((f) => f.label === "類型");
    expect(type?.options).toEqual(expect.arrayContaining(["影片", "圖片", "音訊", "動畫"]));
  });
});
