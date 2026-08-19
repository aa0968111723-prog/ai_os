import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoryContextStatusBlock } from "./StoryContextStatusBlock";

const pinCanon = vi.fn();

vi.mock("../../api", () => ({
  trpc: {
    useUtils: () => ({
      canon: { projectPins: { invalidate: () => Promise.resolve() } },
      creativeContext: { workspace: { invalidate: () => Promise.resolve() } },
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
    characters: { list: { useQuery: () => ({ data: [{ id: "c1" }, { id: "c2" }] }) } },
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
            scorecard: [
              {
                dimension: "style",
                status: "warning",
                affectedShotIds: [],
                reason: "尚未固定視覺風格設定——各鏡風格靠即時世界觀，跨腳本重用時可能漂移",
              },
              {
                dimension: "sound_world",
                status: "warning",
                affectedShotIds: [],
                reason: "尚未設定聲音世界——各鏡環境音各自為政",
              },
            ],
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
    // provider 未設定時絕不假稱可加強一致性
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
});
