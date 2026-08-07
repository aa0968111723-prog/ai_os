/**
 * 靈感牆單格的行為契約。
 *
 * 這裡守的是這個頻道唯一不可退讓的事：**不點開就看得到 prompt**。
 * 只要有人為了版面整潔把字幕層拿掉，這幾條就會紅。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FlowTile } from "../FlowTile";
import { hueFromId, type InspirationPost } from "../types";

const basePost: InspirationPost = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "孤獨城市夜景",
  promptText: "有點孤獨的城市夜景，畫面偏冷色，偶爾有霓虹",
  mediaKind: "image",
  mediaUrl: "/api/assets/x/file",
  sourceType: "generation",
  useCount: 3,
  likeCount: 2,
  publishedAt: "2026-08-04T00:00:00.000Z",
  autoTags: ["modality:image", "subject:city", "light:night"],
  category: "subject:city",
};

describe("FlowTile", () => {
  it("renders the prompt on the tile itself, not behind a click", () => {
    render(<FlowTile post={basePost} onOpen={vi.fn()} />);
    expect(screen.getByText(basePost.promptText!)).toBeInTheDocument();
  });

  it("shows the auto category as the primary badge plus one secondary facet", () => {
    render(<FlowTile post={basePost} onOpen={vi.fn()} />);
    expect(screen.getByText("城市建築")).toBeInTheDocument();
    // 主分類之外只再露一個，避免一格塞滿標籤反而看不到作品
    expect(screen.getByText("夜景")).toBeInTheDocument();
    expect(screen.queryByText("圖片")).not.toBeInTheDocument();
  });

  it("falls back to a coloured prompt poster when there is no visual media", () => {
    const { container } = render(
      <FlowTile post={{ ...basePost, mediaKind: "text", mediaUrl: null }} onOpen={vi.fn()} />,
    );
    const poster = container.querySelector(".flow-tile__poster");
    expect(poster).not.toBeNull();
    expect(poster).toHaveTextContent("有點孤獨的城市夜景");
    // 色相由 id 推出：同一則永遠同一色
    expect(container.querySelector<HTMLElement>(".flow-tile")!.style.getPropertyValue("--flow-hue")).toBe(
      String(hueFromId(basePost.id)),
    );
  });

  it("gives the text poster a flow-layout caption instead of an overlaid scrim", () => {
    // scrim 是絕對定位的：疊在沒有圖的卡面上會跟引文直接壓成疊字（實測過）
    const { container } = render(
      <FlowTile post={{ ...basePost, mediaKind: "card", mediaUrl: null }} onOpen={vi.fn()} />,
    );
    expect(container.querySelector(".flow-tile__caption")).not.toBeNull();
    expect(container.querySelector(".flow-tile__scrim")).toBeNull();

    // 有圖時反過來：字幕必須是疊在畫面上的 scrim
    const withMedia = render(<FlowTile post={basePost} onOpen={vi.fn()} />);
    expect(withMedia.container.querySelector(".flow-tile__scrim")).not.toBeNull();
    expect(withMedia.container.querySelector(".flow-tile__caption")).toBeNull();
  });

  it("renders video posts as a muted looping preview with a play affordance", () => {
    const { container } = render(<FlowTile post={{ ...basePost, mediaKind: "video" }} onOpen={vi.fn()} />);
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("src", basePost.mediaUrl);
    expect(video.muted || video.hasAttribute("muted")).toBe(true);
    expect(container.querySelector(".flow-tile__play")).not.toBeNull();
  });

  it("opens the detail overlay on click", async () => {
    const onOpen = vi.fn();
    render(<FlowTile post={basePost} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /孤獨城市夜景/ }));
    expect(onOpen).toHaveBeenCalledWith(basePost);
  });

  it("shows counts only when they are non-zero", () => {
    const { rerender } = render(<FlowTile post={basePost} onOpen={vi.fn()} />);
    expect(screen.getByText("讚 2")).toBeInTheDocument();
    expect(screen.getByText("再用 3")).toBeInTheDocument();
    rerender(<FlowTile post={{ ...basePost, likeCount: 0, useCount: 0 }} onOpen={vi.fn()} />);
    expect(screen.queryByText(/^讚/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^再用/)).not.toBeInTheDocument();
  });
});

describe("hueFromId", () => {
  it("is stable per id and stays inside the hue circle", () => {
    expect(hueFromId("abc")).toBe(hueFromId("abc"));
    for (const id of ["a", "post-1", "11111111-1111-4111-8111-111111111111", ""]) {
      const hue = hueFromId(id);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
