import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/**
 * 全站導覽去重 PR 4：舊路徑必須仍掛真頁，資料中心承接知識地圖／下載入口。
 * 錨點與 route 是跨檔案契約——只看單一元件看不出 404／placeholder 回歸。
 */
describe("destination consolidation contract", () => {
  it("必保路徑仍掛真頁，不是 placeholder", () => {
    const routes = read("client/src/app/AppRoutes.tsx");
    for (const path of [
      "/dashboard",
      "/planner",
      "/databases",
      "/studio",
      "/community",
      "/chat",
      "/help",
      "/models",
      "/downloads",
      "/settings",
    ]) {
      expect(routes).toContain(`path="${path}"`);
    }
    expect(routes).toContain("<CommunityPage");
    expect(routes).toContain("<ModelsPage");
    expect(routes).toContain("<DownloadsPage");
    expect(routes).toContain("<HelpPage");
    expect(routes).not.toMatch(/path="\/community">[\s\S]{0,120}即將推出/);
    expect(routes).not.toMatch(/path="\/models">[\s\S]{0,120}即將推出/);
    expect(routes).not.toMatch(/path="\/downloads">[\s\S]{0,120}即將推出/);
  });

  it("資料中心有知識地圖與下載錨點，且仍用同一份 KnowledgeMapCard", () => {
    const hub = read("client/src/components/DataHubRelatedDestinations.tsx");
    const page = read("client/src/pages/DatabasesPage.tsx");
    expect(page).toContain("DataHubRelatedDestinations");
    expect(hub).toContain('id="knowledge-map"');
    expect(hub).toContain('id="hub-downloads"');
    expect(hub).toContain("KnowledgeMapCard");
    expect(hub).toContain('href="/downloads"');
    expect(hub).toContain('href="/downloads#desktop-app"');
    expect(hub).not.toContain("knowledgeMap.graph.useQuery");
  });

  it("AI 助手首頁有靈感頻道入口，社群頁仍是真頁", () => {
    const copilot = read("client/src/components/AICreativeCopilot.tsx");
    const community = read("client/src/pages/CommunityPage.tsx");
    expect(copilot).toContain('href="/community"');
    expect(copilot).toContain("靈感頻道");
    expect(community).toContain("export function CommunityPage");
    expect(community).toContain("registerAssistantPage");
  });
});
