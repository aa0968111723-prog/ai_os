import { describe, expect, it } from "vitest";
import { projectIdFromRoute } from "./GlobalAssistantSheet";

const UUID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";

describe("projectIdFromRoute（scope 路由是 deterministic 的：route 說了算，不靠猜）", () => {
  it("專案頁與創作室路徑 → 專案 id", () => {
    expect(projectIdFromRoute(`/p/${UUID}`)).toBe(UUID);
    expect(projectIdFromRoute(`/studio/${UUID}`)).toBe(UUID);
    expect(projectIdFromRoute(`/p/${UUID}/anything`)).toBe(UUID);
  });

  it("非專案頁 → null（組級視野）", () => {
    expect(projectIdFromRoute("/dashboard")).toBeNull();
    expect(projectIdFromRoute("/planner")).toBeNull();
    expect(projectIdFromRoute("/")).toBeNull();
    expect(projectIdFromRoute("/chat")).toBeNull();
  });

  it("長得像但不是 uuid 的段不亂認（防把 /p/new 之類的頁面誤判成專案）", () => {
    expect(projectIdFromRoute("/p/new")).toBeNull();
    expect(projectIdFromRoute("/p/12345")).toBeNull();
    expect(projectIdFromRoute("/preview/abc")).toBeNull();
  });
});
