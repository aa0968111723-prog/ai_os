import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoryContextStatusBlock } from "./StoryContextStatusBlock";
import { revealStoryInlineSection } from "./storyInlineNav";

vi.mock("./storyInlineNav", () => ({
  revealStoryInlineSection: vi.fn(),
}));

const pinCanon = vi.fn();
const generateSheetMutate = vi.fn();

const scorecard = [
  {
    dimension: "style",
    status: "warning",
    affectedShotIds: [] as string[],
    reason: "尚未固定視覺風格設定——各鏡風格靠即時世界觀，跨腳本重用時可能漂移",
  },
  {
    dimension: "sound_world",
    status: "warning",
    affectedShotIds: [] as string[],
    reason: "尚未設定聲音世界——各鏡環境音各自為政",
  },
  {
    dimension: "identity",
    status: "warning",
    affectedShotIds: ["s1"],
    reason: "1 位角色沒有定裝參考圖——身份一致性只剩文字錨點",
  },
  {
    dimension: "delivery",
    status: "blocker",
    affectedShotIds: [] as string[],
    reason: "還有鏡頭沒有已採用畫面；有鏡頭尚未核准",
  },
];

vi.mock("../../api", () => ({
  trpc: {
    useUtils: () => ({
      canon: { projectPins: { invalidate: () => Promise.resolve() } },
      creativeContext: { workspace: { invalidate: () => Promise.resolve() } },
      characters: { list: { invalidate: () => Promise.resolve() } },
    }),
    story: {
      get: {
        useQuery: () => ({
          data: {
            story: { lastParsedAt: "2026-08-15T00:00:00Z" },
            pending: [{ id: "p1" }],
            summary: { characters: 2, looks: 1, locations: 2, props: 1 },
          },
        }),
      },
    },
    characters: {
      list: {
        useQuery: () => ({
          data: [
            { id: "c1", name: "小華", referenceAssetId: null, referenceUrl: null },
            { id: "c2", name: "禪定龜龜", referenceAssetId: "sheet-2", referenceUrl: "https://example.test/turtle.png" },
          ],
        }),
      },
      generateSheet: { useMutation: () => ({ isPending: false, mutate: generateSheetMutate, error: null }) },
      honorGeneratedSheet: { useMutation: () => ({ isPending: false, mutate: vi.fn(), error: null }) },
    },
    generation: {
      status: { useQuery: () => ({ data: null }) },
    },
    scenePresets: { list: { useQuery: () => ({ data: [{ id: "s1" }] }) } },
    props: { list: { useQuery: () => ({ data: [] }) } },
    knowledge: { list: { useQuery: () => ({ data: [] }) } },
    projects: {
      assets: { useQuery: () => ({ data: [] }) },
      get: { useQuery: () => ({ data: { worldview: { styles: ["2D 手繪動畫"] } } }) },
    },
    scenes: {
      listByProject: {
        useQuery: () => ({ data: [{ id: "a", ambience: "淡大校門口日間人聲與車流", music: "" }] }),
      },
      review: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
    canon: {
      createProjectCanon: { useMutation: () => ({ isPending: false, mutate: pinCanon }) },
    },
    creativeContext: {
      workspace: {
        useQuery: () => ({
          data: {
            compactStatus: "人物已套用 · 1 個場景",
            nextAction: "產生分鏡",
            canonPins: [
              { pinId: "p", canonId: "c", kind: "character", name: "魯夫", state: "UPDATE_AVAILABLE", pinnedVersionNumber: 7, productionVersionNumber: 8, localEntityKind: "character", localEntityId: "c1" },
            ],
            scorecard,
          },
        }),
      },
      trainingAvailability: { useQuery: () => ({ data: { available: false } }) },
      animationBoard: { useQuery: () => ({ data: { rows: [], primaryAction: null }, isLoading: false }) },
      animationRepairPlan: { useQuery: () => ({ data: null }) },
    },
  },
}));

describe("StoryContextStatusBlock", () => {
  it("renders server compact truth plus the canon summary line", () => {
    render(<StoryContextStatusBlock projectId="p1" />);
    expect(screen.getByText("人物已套用 · 1 個場景")).toBeInTheDocument();
    expect(screen.getByText("下一步：產生分鏡")).toBeInTheDocument();
    expect(screen.getByText("1 個團隊設定引用 · 1 個有新版")).toBeInTheDocument();
    expect(screen.getByText("有 1 項需要確認")).toBeInTheDocument();
    expect(screen.queryByText("可加強一致性")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "固定目前畫風" })).not.toBeInTheDocument();
  });

  it("pins style and sound world from the scorecard empty-state CTAs", () => {
    render(<StoryContextStatusBlock projectId="p1" canEdit onRepairShots={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "固定目前畫風" }));
    expect(pinCanon).toHaveBeenCalledWith({
      projectId: "p1",
      kind: "style",
      name: "專案視覺風格",
      descriptor: { styles: ["2D 手繪動畫"] },
      confirmRights: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "固定聲音世界" }));
    expect(pinCanon).toHaveBeenCalledWith({
      projectId: "p1",
      kind: "sound_world",
      name: "專案聲音世界",
      descriptor: { ambience: "淡大校門口日間人聲與車流" },
      confirmRights: true,
    });
  });

  it("identity missing sheets kicks cheap 生成定裝 for 小華, not 修復鏡頭", () => {
    render(<StoryContextStatusBlock projectId="p1" canEdit onRepairShots={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /修復/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成定裝" }));
    expect(generateSheetMutate).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: "c1" }),
      expect.anything(),
    );
    expect(JSON.stringify(generateSheetMutate.mock.calls[0]![0])).not.toMatch(/veo/i);
  });

  it("delivery blocker opens 交付, not 修復鏡頭 or 未分場", () => {
    render(<StoryContextStatusBlock projectId="p1" canEdit onRepairShots={vi.fn()} />);
    expect(screen.getByText("交付・擋交付")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /修復/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打開交付" }));
    expect(revealStoryInlineSection).toHaveBeenCalledWith("delivery", { projectId: "p1", scroll: true });
  });
});
