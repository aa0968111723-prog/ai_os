import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const home = readFileSync(resolve(process.cwd(), "client/src/mobile/MobileHome.tsx"), "utf8");
const project = readFileSync(resolve(process.cwd(), "client/src/mobile/MobileProjectPage.tsx"), "utf8");
const assets = readFileSync(resolve(process.cwd(), "client/src/mobile/MobileAssetSheet.tsx"), "utf8");
const sheet = readFileSync(resolve(process.cwd(), "client/src/app/components/GlobalAssistantSheet.tsx"), "utf8");
const launchpad = readFileSync(resolve(process.cwd(), "client/src/pages/Launchpad.tsx"), "utf8");
const css = readFileSync(resolve(process.cwd(), "client/src/styles.mobile.css"), "utf8");

describe("phone animation P0/P1 wiring", () => {
  it("phone home listens for the assistant create-project idea", () => {
    expect(home).toContain("NEW_PROJECT_IDEA_EVENT");
    expect(home).toContain("MobileCreateProjectSheet");
    expect(home).toContain("trpc.projects.create.useMutation");
    expect(home).toContain("跟 Aios 說它會建起來");
    expect(home).toContain("建立專案");
    expect(sheet).toContain("publishNewProjectIdea");
    expect(sheet).toContain("useIsPhone");
    expect(sheet).toContain("if (isPhone)");
    expect(sheet).not.toContain("真正的建立仍在 Launchpad");
    const idea = sheet.slice(sheet.indexOf("onUseIdeaForNewProject"), sheet.indexOf("</AICreativeCopilot>"));
    expect(idea).toContain("if (isPhone)");
    expect(idea.indexOf("if (isPhone)")).toBeLessThan(idea.indexOf("navigate(`/dashboard#projects`)"));
    expect(idea).toMatch(/if \(isPhone\) \{[\s\S]*return;/);
    expect(idea).not.toMatch(/if \(isPhone\) \{[\s\S]*navigate\(`\/dashboard#projects`\)/);
    expect(launchpad).toContain("NEW_PROJECT_IDEA_EVENT");
  });

  it("project page has a 場景 entry and openFull reveals the inline section", () => {
    expect(project).toContain('label: "場景"');
    expect(project).toContain('anchorForSection("scenes")');
    expect(project).not.toContain('label: "知識"');
    expect(project).toContain("revealStoryInlineSection");
    expect(project).toContain("writeInlineHash");
  });

  it("phone asset sheet mounts AddDataSheet for upload", () => {
    expect(assets).toContain("AddDataSheet");
    expect(assets).toContain("加入素材");
  });

  it("AI quick chips meet the 44px touch floor", () => {
    expect(css).toMatch(/\.m-ai__chip \{[^}]*min-height: 44px/);
    expect(css).not.toMatch(/\.m-ai__chip \{[^}]*min-height: 36px/);
  });
});
