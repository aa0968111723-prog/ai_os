import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoryContextStatus } from "./StoryContextStatus";

describe("StoryContextStatus", () => {
  it("renders the compact first-screen states", () => {
    render(
      <StoryContextStatus
        applied
        trainingAvailable={false}
        counts={{ characters: 3, looks: 1, scenes: 2, props: 0, assets: 0, knowledge: 0, pending: 1 }}
      />,
    );
    expect(screen.getByText("已套用專案設定")).toBeInTheDocument();
    expect(screen.getByText("有 1 項需要確認")).toBeInTheDocument();
    expect(screen.queryByText("可加強一致性")).not.toBeInTheDocument();
  });
});
