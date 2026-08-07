import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShotStrip, type StudioShot } from "./ShotStrip";
import { resolveStudioLayout } from "./studioLayout";

const DESKTOP = resolveStudioLayout({ viewportWidth: 1440 });
const LITE = resolveStudioLayout({ viewportWidth: 390 });

const SHOTS: StudioShot[] = [
  { id: "a", title: "開場", orderIndex: 0, durationSec: 4 },
  { id: "b", title: "轉場", orderIndex: 1, durationSec: 6, assetUrl: "/assets/b.png", assetKind: "image" },
  { id: "c", title: "收尾", orderIndex: 2, durationSec: 5 },
];

function setup(overrides: Partial<React.ComponentProps<typeof ShotStrip>> = {}) {
  const props = {
    layout: DESKTOP,
    shots: SHOTS,
    activeId: "b",
    draftIds: new Set<string>(["c"]),
    canEdit: true,
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onMove: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof ShotStrip>;
  render(<ShotStrip {...props} />);
  return props;
}

describe("ShotStrip", () => {
  it("依順序列出每一鏡並顯示總長度", () => {
    setup();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("開場");
    expect(items[2]).toHaveTextContent("收尾");
    expect(screen.getByText(/3 鏡・約 15 秒/)).toBeInTheDocument();
  });

  it("選中的那一鏡標記 aria-current，點別鏡會回報 id", async () => {
    const props = setup();
    expect(screen.getByRole("button", { name: "第 2 鏡：轉場" })).toHaveAttribute("aria-current", "true");
    await userEvent.click(screen.getByRole("button", { name: "第 1 鏡：開場" }));
    expect(props.onSelect).toHaveBeenCalledWith("a");
  });

  it("每一格都有往前／往後按鈕——鍵盤與手機不能只靠拖曳", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText("把「轉場」往前移"));
    expect(props.onMove).toHaveBeenCalledWith("b", "up");
    await userEvent.click(screen.getByLabelText("把「轉場」往後移"));
    expect(props.onMove).toHaveBeenCalledWith("b", "down");
  });

  it("頭尾的越界按鈕停用", () => {
    setup();
    expect(screen.getByLabelText("把「開場」往前移")).toBeDisabled();
    expect(screen.getByLabelText("把「收尾」往後移")).toBeDisabled();
  });

  it("有未存手稿的分鏡帶標記", () => {
    setup();
    expect(screen.getByTitle("這一鏡有還沒存起來的手稿")).toBeInTheDocument();
  });

  it("拖曳重排送出的是整串新順序", () => {
    const props = setup();
    const items = screen.getAllByRole("listitem");
    // 把第 1 鏡拖到第 3 鏡的位置
    fireEvent.dragStart(items[0]);
    fireEvent.dragOver(items[2]);
    fireEvent.drop(items[2]);
    expect(props.onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
  });

  it("手機輕量版不開放拖曳（會與白板的平移手勢打架）", () => {
    setup({ layout: LITE });
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).not.toHaveAttribute("draggable", "true");
    }
  });

  it("唯讀（專案檢視者）看得到順序，但沒有任何寫入入口", () => {
    setup({ canEdit: false });
    expect(screen.queryByRole("button", { name: /加一鏡/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/往前移/)).not.toBeInTheDocument();
  });

  it("沒有分鏡時講清楚下一步", () => {
    setup({ shots: [] });
    expect(screen.getByText(/還沒有分鏡/)).toBeInTheDocument();
  });
});
