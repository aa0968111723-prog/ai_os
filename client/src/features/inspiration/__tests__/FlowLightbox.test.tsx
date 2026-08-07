/**
 * 細節浮層：點開一格之後要能一次做完所有事（看／複製／分享／帶走），
 * 以及一定要有出口（Esc、點背景、關閉鈕）。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FlowLightbox } from "../FlowLightbox";
import type { InspirationPost } from "../types";

const post: InspirationPost = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "霓虹街角",
  promptText: "neon city street at night, cinematic",
  modelId: "fal-ai/flux/dev",
  mediaKind: "image",
  mediaUrl: "/api/assets/y/file",
  sourceType: "generation",
  useCount: 0,
  likeCount: 5,
  likedByMe: true,
  publishedAt: "2026-08-04T00:00:00.000Z",
  autoTags: ["modality:image", "subject:city", "light:neon"],
  category: "subject:city",
  status: "published",
};

function renderLightbox(overrides: Partial<React.ComponentProps<typeof FlowLightbox>> = {}) {
  const props = {
    post,
    onClose: vi.fn(),
    onCopyPrompt: vi.fn(),
    onShare: vi.fn(),
    ...overrides,
  };
  render(<FlowLightbox {...props} />);
  return props;
}

describe("FlowLightbox", () => {
  it("shows the full prompt and every auto facet with its facet name", () => {
    renderLightbox();
    expect(screen.getByText(post.promptText!)).toBeInTheDocument();
    expect(screen.getByText("題材·城市建築")).toBeInTheDocument();
    expect(screen.getByText("光線色調·霓虹螢光")).toBeInTheDocument();
    expect(screen.getByText(/模型 fal-ai\/flux\/dev/)).toBeInTheDocument();
  });

  it("copies and shares through the callbacks", async () => {
    const props = renderLightbox();
    await userEvent.click(screen.getByRole("button", { name: /複製 Prompt/ }));
    expect(props.onCopyPrompt).toHaveBeenCalledWith(post);
    await userEvent.click(screen.getByRole("button", { name: /分享/ }));
    expect(props.onShare).toHaveBeenCalledWith(post);
  });

  it("surfaces the share result in place of the button label", () => {
    renderLightbox({ shareNote: "已複製連結" });
    expect(screen.getByRole("button", { name: /已複製連結/ })).toBeInTheDocument();
  });

  it("closes on Escape and on a backdrop click, but not on a panel click", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <FlowLightbox post={post} onClose={onClose} onCopyPrompt={vi.fn()} onShare={vi.fn()} />,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(container.querySelector(".flow-lightbox__panel")!);
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(container.querySelector(".flow-lightbox")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("only offers reuse once a project is chosen", async () => {
    const onReuse = vi.fn();
    renderLightbox({ onReuse, projects: [{ id: "p1", title: "弘法短片" }] });
    await userEvent.click(screen.getByRole("button", { name: /一鍵再用/ }));
    await userEvent.click(screen.getByRole("button", { name: "弘法短片" }));
    expect(onReuse).toHaveBeenCalledWith(post, "p1");
  });

  it("shows 下架 only for a published post and 重新上架 only for a hidden one", () => {
    const onUnpublish = vi.fn();
    const onRepublish = vi.fn();
    const { rerender } = render(
      <FlowLightbox
        post={post}
        onClose={vi.fn()}
        onCopyPrompt={vi.fn()}
        onShare={vi.fn()}
        onUnpublish={onUnpublish}
        onRepublish={onRepublish}
      />,
    );
    expect(screen.getByRole("button", { name: "下架" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新上架" })).not.toBeInTheDocument();

    rerender(
      <FlowLightbox
        post={{ ...post, status: "hidden" }}
        onClose={vi.fn()}
        onCopyPrompt={vi.fn()}
        onShare={vi.fn()}
        onUnpublish={onUnpublish}
        onRepublish={onRepublish}
      />,
    );
    expect(screen.getByRole("button", { name: "重新上架" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下架" })).not.toBeInTheDocument();
  });

  it("tells the author when a post has no prompt to reuse", () => {
    renderLightbox({ post: { ...post, promptText: null }, onReuse: vi.fn() });
    expect(screen.getByText(/這則沒有附提示詞/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /一鍵再用/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /複製 Prompt/ })).not.toBeInTheDocument();
  });

  it("is a labelled modal dialog for screen readers", () => {
    renderLightbox();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", post.title);
  });
});
