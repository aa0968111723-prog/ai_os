import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoryScorecardRepair } from "./StoryScorecardRepair";
import type { ScorecardRow } from "@shared/projectConsistencyGraph";

const styleRow: ScorecardRow = {
  dimension: "style",
  status: "warning",
  affectedShotIds: [],
  reason: "尚未固定視覺風格設定——各鏡風格靠即時世界觀，跨腳本重用時可能漂移",
};

const soundRow: ScorecardRow = {
  dimension: "sound_world",
  status: "warning",
  affectedShotIds: [],
  reason: "尚未設定聲音世界——各鏡環境音各自為政",
};

const identityRow: ScorecardRow = {
  dimension: "identity",
  status: "warning",
  affectedShotIds: ["s1"],
  reason: "1 位角色沒有定裝參考圖——身份一致性只剩文字錨點",
};

const staleRow: ScorecardRow = {
  dimension: "continuity",
  status: "stale",
  affectedShotIds: ["s1", "s2"],
  reason: "2 鏡因上游變更而過期——只重做這幾鏡即可",
};

describe("StoryScorecardRepair", () => {
  it("style/sound empty-state offers setup, not 修復 0 鏡", () => {
    const onSetupDimension = vi.fn();
    const onRepairShots = vi.fn();
    render(
      <StoryScorecardRepair
        rows={[styleRow, soundRow]}
        canEdit
        onRepairShots={onRepairShots}
        onSetupDimension={onSetupDimension}
        hasWorldviewStyles
      />,
    );
    expect(screen.queryByRole("button", { name: /修復/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "固定目前畫風" }));
    expect(onSetupDimension).toHaveBeenCalledWith(styleRow);
    expect(onRepairShots).not.toHaveBeenCalled();
  });

  it("style without worldview styles sends the user to pick a look", () => {
    const onSetupDimension = vi.fn();
    render(
      <StoryScorecardRepair
        rows={[styleRow]}
        canEdit
        onSetupDimension={onSetupDimension}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "去選畫風" }));
    expect(onSetupDimension).toHaveBeenCalledWith(styleRow);
  });

  it("sound world without shot ambience pins from the A–F campus field", () => {
    const onSetupDimension = vi.fn();
    render(
      <StoryScorecardRepair
        rows={[soundRow]}
        canEdit
        onSetupDimension={onSetupDimension}
      />,
    );
    const field = screen.getByLabelText("環境音");
    expect(field).toHaveAttribute("placeholder", "淡大校門口日間人聲與車流");
    fireEvent.change(field, { target: { value: "淡大校門口日間人聲與車流" } });
    fireEvent.click(screen.getByRole("button", { name: "固定聲音世界" }));
    expect(onSetupDimension).toHaveBeenCalledWith(soundRow, { ambience: "淡大校門口日間人聲與車流" });
  });

  it("sound world with shot ambience one-click pins that line", () => {
    const onSetupDimension = vi.fn();
    render(
      <StoryScorecardRepair
        rows={[soundRow]}
        canEdit
        onSetupDimension={onSetupDimension}
        suggestedSound={{ ambience: "校門口暖色光、遠處車流" }}
      />,
    );
    expect(screen.queryByLabelText("環境音")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "固定聲音世界" }));
    expect(onSetupDimension).toHaveBeenCalledWith(soundRow, { ambience: "校門口暖色光、遠處車流" });
  });

  it("identity missing sheets offers 生成定裝, not 修復 N 鏡", () => {
    const onRepairShots = vi.fn();
    const onGenerateSheets = vi.fn();
    render(
      <StoryScorecardRepair
        rows={[identityRow]}
        canEdit
        onRepairShots={onRepairShots}
        onGenerateSheets={onGenerateSheets}
      />,
    );
    expect(screen.queryByRole("button", { name: /修復/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成定裝" }));
    expect(onGenerateSheets).toHaveBeenCalledWith(identityRow);
    expect(onRepairShots).not.toHaveBeenCalled();
  });

  it("repair CTA still fires for stale shots", () => {
    const onRepairShots = vi.fn();
    render(
      <StoryScorecardRepair
        rows={[staleRow]}
        canEdit
        onRepairShots={onRepairShots}
        onSetupDimension={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "修復 2 鏡" }));
    expect(onRepairShots).toHaveBeenCalledWith(staleRow);
  });

  it("read-only members see the warning and no setup buttons", () => {
    render(
      <StoryScorecardRepair
        rows={[styleRow, soundRow]}
        canEdit={false}
        onRepairShots={vi.fn()}
        onSetupDimension={vi.fn()}
        hasWorldviewStyles
      />,
    );
    expect(screen.getByText(/風格・可加強/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "固定目前畫風" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "固定聲音世界" })).not.toBeInTheDocument();
  });
});
