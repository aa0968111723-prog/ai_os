import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { projectIdFromRoute } from "./GlobalAssistantSheet";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "GlobalAssistantSheet.tsx"), "utf8");

const UUID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";

describe("projectIdFromRoute（scope 路由是 deterministic 的：route 說了算，不靠猜）", () => {
  it("專案頁與創作室路徑 → 專案 id", () => {
    expect(projectIdFromRoute(`/p/${UUID}`)).toBe(UUID);
    expect(projectIdFromRoute(`/studio/${UUID}`)).toBe(UUID);
    expect(projectIdFromRoute(`/p/${UUID}/anything`)).toBe(UUID);
    expect(projectIdFromRoute("/studio", `?project=${UUID}`)).toBe(UUID);
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

describe("onUseIdeaForNewProject phone handoff", () => {
  it("keeps aios:new-project-idea and does not send the phone to Launchpad #projects", () => {
    const idea = src.slice(src.indexOf("onUseIdeaForNewProject"), src.indexOf("</AICreativeCopilot>"));
    expect(idea).toContain("publishNewProjectIdea");
    expect(src).toContain("const isPhone = useIsPhone()");
    expect(idea).toContain("if (isPhone)");
    expect(idea).toContain('navigate("/dashboard")');
    const phoneBranch = idea.slice(idea.indexOf("if (isPhone)"), idea.indexOf("navigate(`/dashboard#projects`)"));
    expect(phoneBranch).toContain("return");
    expect(phoneBranch).toContain('navigate("/dashboard")');
    expect(phoneBranch).not.toContain("navigate(`/dashboard#projects`)");
  });
});
