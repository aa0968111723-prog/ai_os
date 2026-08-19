import { describe, expect, it } from "vitest";
import {
  knowledgeBaselineMatches,
  knowledgeSaveBaseline,
  knowledgeUpdateBaselineGate,
  knowledgeUpdateOmitMessage,
  knowledgeUpdateTouchesBody,
} from "./knowledgeUpdate";

describe("knowledgeUpdateTouchesBody", () => {
  it("pin-only does not require a content baseline", () => {
    expect(knowledgeUpdateTouchesBody({ })).toBe(false);
    expect(knowledgeUpdateTouchesBody({ title: "新標題" })).toBe(true);
    expect(knowledgeUpdateTouchesBody({ content: "新全文" })).toBe(true);
  });
});

describe("knowledgeUpdateBaselineGate", () => {
  it("omitted / incomplete refuse silent LWW", () => {
    expect(knowledgeUpdateBaselineGate(undefined)).toBe("omitted");
    expect(knowledgeUpdateBaselineGate(null)).toBe("omitted");
    expect(knowledgeUpdateBaselineGate({ title: "有標題" })).toBe("incomplete");
    expect(knowledgeUpdateBaselineGate({ content: "有全文" })).toBe("incomplete");
    expect(knowledgeUpdateBaselineGate({ title: "有標題", content: "有全文" })).toBe("ok");
    expect(knowledgeUpdateOmitMessage("omitted")).toContain("omitted knowledge baseline");
    expect(knowledgeUpdateOmitMessage("incomplete")).toContain("incomplete knowledge baseline");
  });
});

describe("knowledgeBaselineMatches", () => {
  it("stale title or content is a conflict", () => {
    const row = { title: "原稿", content: "夥伴較新" };
    expect(knowledgeBaselineMatches(row, { title: "原稿", content: "夥伴較新" })).toBe(true);
    expect(knowledgeBaselineMatches(row, { title: "原稿", content: "失焦舊稿" })).toBe(false);
    expect(knowledgeBaselineMatches(row, { title: "舊標題", content: "夥伴較新" })).toBe(false);
  });
});

describe("knowledgeSaveBaseline", () => {
  it("uses knowledge.get, never the live edit draft", () => {
    expect(
      knowledgeSaveBaseline({
        getTitle: "原稿",
        getContent: "全文",
        fallbackTitle: "清單標題",
        fallbackExcerpt: "摘要",
      }),
    ).toEqual({ title: "原稿", content: "全文" });
  });

  it("get-failed excerpt fallback is fail-closed (excerpt ≠ transcript)", () => {
    expect(
      knowledgeSaveBaseline({
        getFailed: true,
        fallbackTitle: "清單標題",
        fallbackExcerpt: "摘要前 120 字",
      }),
    ).toEqual({ title: "清單標題", content: "摘要前 120 字" });
    expect(knowledgeSaveBaseline({ getFailed: false, fallbackTitle: "x", fallbackExcerpt: "y" })).toBeNull();
  });
});
