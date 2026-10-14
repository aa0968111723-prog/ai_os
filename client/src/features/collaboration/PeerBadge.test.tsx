/**
 * Header 夥伴小卡（Phase 3）：驗收場景 1——
 * 「Bruce 點韋澔 → 看到『正在 Shot 08』→ 按跟隨畫面」。
 * 測的是這條路徑真的走得通，而不是元件有沒有渲染。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ViewState } from "@shared/viewState";
import type { PeerView } from "../../realtime";
import { PeerBadge, latestViewForUser, sceneLabelOf } from "./PeerBadge";

const wei = { userId: "u-wei", name: "韋澔", color: "#7a6ea8" };

function pv(connId: string, userId: string, view: ViewState): [string, PeerView] {
  return [connId, { connId, userId, name: userId, view }];
}

describe("latestViewForUser", () => {
  it("同一人多分頁時取資訊最多的那一份——「正在 Shot 08」比「正在分鏡」有用", () => {
    const views = new Map([
      pv("c-1", "u-wei", { section: "storyboard" }),
      pv("c-2", "u-wei", { section: "storyboard", sceneId: "11111111-1111-1111-1111-111111111111", tab: "visual" }),
    ]);
    expect(latestViewForUser(views, "u-wei")?.sceneId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("別人的分頁不算他的位置", () => {
    const views = new Map([pv("c-1", "u-other", { section: "story" })]);
    expect(latestViewForUser(views, "u-wei")).toBeNull();
  });
});

describe("sceneLabelOf", () => {
  const scenes = [{ id: "11111111-1111-1111-1111-111111111111", title: "SHOT 08" }];
  it("由 sceneId 查得出給人看的鏡標題", () => {
    expect(sceneLabelOf(scenes, { sceneId: "11111111-1111-1111-1111-111111111111" })).toBe("SHOT 08");
  });
  it("查不到就回 null——絕不顯示裸 UUID", () => {
    expect(sceneLabelOf(scenes, { sceneId: "22222222-2222-2222-2222-222222222222" })).toBeNull();
    expect(sceneLabelOf(undefined, { sceneId: "11111111-1111-1111-1111-111111111111" })).toBeNull();
    expect(sceneLabelOf(scenes, null)).toBeNull();
  });
});

describe("PeerBadge", () => {
  const view: ViewState = { section: "storyboard", sceneId: "11111111-1111-1111-1111-111111111111", tab: "visual" };

  it("場景 1：點韋澔 → 看到「正在：分鏡 · SHOT 08」→ 按「跟隨畫面」", async () => {
    const user = userEvent.setup();
    const onToggleFollow = vi.fn();
    render(
      <PeerBadge peer={wei} isMe={false} view={view} sceneLabel="SHOT 08" following={false} onToggleFollow={onToggleFollow} />,
    );
    await user.click(screen.getByRole("button", { name: /韋澔/ }));
    const card = screen.getByTestId("peer-card");
    expect(card).toHaveTextContent("在線");
    expect(card).toHaveTextContent("正在：分鏡 · SHOT 08");
    await user.click(screen.getByRole("button", { name: "跟隨畫面" }));
    expect(onToggleFollow).toHaveBeenCalledTimes(1);
  });

  it("已在跟隨時提供「停止跟隨」——跟隨永遠有出口", async () => {
    const user = userEvent.setup();
    render(<PeerBadge peer={wei} isMe={false} view={view} sceneLabel={null} following onToggleFollow={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /韋澔/ }));
    expect(screen.getByRole("button", { name: "停止跟隨" })).toBeInTheDocument();
  });

  it("還沒回報位置的人退回「在這個專案裡」，不留空、不猜", async () => {
    const user = userEvent.setup();
    render(<PeerBadge peer={wei} isMe={false} view={null} sceneLabel={null} following={false} onToggleFollow={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /韋澔/ }));
    expect(screen.getByTestId("peer-card")).toHaveTextContent("正在：在這個專案裡");
  });

  it("自己的 chip 不開卡（沒有「跟隨自己」這種事）", () => {
    render(<PeerBadge peer={wei} isMe view={view} sceneLabel={null} following={false} onToggleFollow={vi.fn()} />);
    expect(screen.getByRole("button", { name: /你/ })).toBeDisabled();
  });

  it("小卡主要操作 touch target >= 44px（手機是一級公民）", async () => {
    const user = userEvent.setup();
    render(<PeerBadge peer={wei} isMe={false} view={view} sceneLabel={null} following={false} onToggleFollow={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /韋澔/ }));
    // 「跟隨畫面」是動作按鈕；「傳訊息」是通往聊天的連結——兩者 touch target 都要 ≥44px
    expect((screen.getByRole("button", { name: "跟隨畫面" }) as HTMLElement).style.minHeight).toBe("44px");
    expect((screen.getByRole("link", { name: "傳訊息" }) as HTMLElement).style.minHeight).toBe("44px");
  });
});
