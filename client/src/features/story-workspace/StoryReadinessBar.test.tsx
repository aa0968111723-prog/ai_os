import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoryReadinessBar } from "./StoryReadinessBar";

const ready = {
  kind: "ready_to_produce" as const,
  label: "可製作",
  detail: "已有分鏡。",
};

describe("StoryReadinessBar", () => {
  it("renders oneClick.error as alert even without onOpenLatest", () => {
    render(
      <StoryReadinessBar
        readiness={ready}
        canEdit
        primaryLabel="生成畫面"
        onPrimary={vi.fn()}
        error="沒有可以批次生成的鏡頭"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("沒有可以批次生成的鏡頭");
    expect(screen.queryByRole("button", { name: "沒有可以批次生成的鏡頭" })).not.toBeInTheDocument();
  });

  it("does not hide the latest link when there is no error", () => {
    const onOpenLatest = vi.fn();
    render(
      <StoryReadinessBar
        readiness={ready}
        canEdit
        primaryLabel="生成畫面"
        onPrimary={vi.fn()}
        latestLabel="已完成 2 次生成"
        onOpenLatest={onOpenLatest}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已完成 2 次生成" })).toBeInTheDocument();
  });

  it("disables 0-shot CTA with title 先解析出分鏡", () => {
    render(
      <StoryReadinessBar
        readiness={{ kind: "ready_for_board", label: "可產生分鏡", detail: "解析已完成。" }}
        canEdit
        primaryLabel="先解析出分鏡"
        primaryDisabled
        onPrimary={vi.fn()}
      />,
    );
    const cta = screen.getByRole("button", { name: "先解析出分鏡" });
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute("title", "先解析出分鏡");
  });
});
