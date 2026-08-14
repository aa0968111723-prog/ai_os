import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoryContextStatusBlock } from "./StoryContextStatusBlock";

vi.mock("../../api", () => ({
  trpc: {
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
    projects: { assets: { useQuery: () => ({ data: [] }) } },
    creativeContext: {
      workspace: {
        useQuery: () => ({
          data: {
            compactStatus: "人物已套用 · 1 個場景",
            nextAction: "產生分鏡",
            canonPins: [
              { pinId: "p", canonId: "c", kind: "character", name: "魯夫", state: "UPDATE_AVAILABLE", pinnedVersionNumber: 7, productionVersionNumber: 8, localEntityKind: "character", localEntityId: "c1" },
            ],
          },
        }),
      },
      trainingAvailability: { useQuery: () => ({ data: { available: false } }) },
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
  });
});
