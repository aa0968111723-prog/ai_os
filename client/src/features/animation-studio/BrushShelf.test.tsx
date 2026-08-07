import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BrushShelf } from "./BrushShelf";
import { BUILTIN_BRUSHES, sanitizeBrush, type BrushSpec } from "./brushes";
import { resolveStudioLayout } from "./studioLayout";

const DESKTOP = resolveStudioLayout({ viewportWidth: 1440 });
const LITE = resolveStudioLayout({ viewportWidth: 390 });
const pencil = BUILTIN_BRUSHES[0]!;

function setup(overrides: Partial<React.ComponentProps<typeof BrushShelf>> = {}) {
  const props = {
    layout: DESKTOP,
    brushes: BUILTIN_BRUSHES,
    activeId: pencil.id,
    brush: { ...pencil } as BrushSpec,
    onSelect: vi.fn(),
    onBrushChange: vi.fn(),
    onCollect: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof BrushShelf>;
  const view = render(<BrushShelf {...props} />);
  return { ...props, view };
}

describe("BrushShelf", () => {
  it("內建筆刷全部列出，選中的那支標記 aria-checked", () => {
    setup();
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(BUILTIN_BRUSHES.length);
    expect(screen.getByRole("radio", { checked: true })).toHaveTextContent(pencil.name);
  });

  it("點另一支筆回報 id", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("radio", { name: /毛筆/ }));
    expect(props.onSelect).toHaveBeenCalledWith("builtin.ink");
  });

  it("調粗細會把新的規格整份回報出去", () => {
    const props = setup();
    // range 直接送 change（userEvent 對 range 是逐格拖曳；這裡要驗的是回報的形狀）
    fireEvent.change(screen.getByLabelText(/粗細/), { target: { value: "20" } });
    expect(props.onBrushChange).toHaveBeenCalledWith(expect.objectContaining({ id: pencil.id, size: 20 }));
  });

  it("收錄流程：命名後回報名稱", async () => {
    const props = setup({ brush: { ...pencil, size: 20 } });
    await userEvent.click(screen.getByRole("button", { name: /收錄成我的筆刷/ }));
    await userEvent.type(screen.getByLabelText("筆刷名稱"), "我的粗鉛筆");
    await userEvent.click(screen.getByRole("button", { name: "收錄" }));
    expect(props.onCollect).toHaveBeenCalledWith("我的粗鉛筆");
  });

  it("內建筆刷調過參數時說明「不收錄就不會記住」", () => {
    setup({ brush: { ...pencil, size: 40 } });
    expect(screen.getByText(/收錄之後才會記住/)).toBeInTheDocument();
  });

  it("自己收錄的筆刷可以刪，內建的不行", async () => {
    const mine = sanitizeBrush({ id: "my.1", name: "我的筆", engine: "pen" });
    const props = setup({ brushes: [...BUILTIN_BRUSHES, mine], activeId: mine.id, brush: mine });
    expect(screen.queryByLabelText(`刪除筆刷 ${pencil.name}`)).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("刪除筆刷 我的筆"));
    expect(props.onRemove).toHaveBeenCalledWith("my.1");
  });

  it("桌機才有手感微調；手機輕量版只留粗細／濃度／顏色", () => {
    const { view } = setup();
    expect(screen.getByText("手感微調")).toBeInTheDocument();
    view.rerender(
      <BrushShelf
        layout={LITE}
        brushes={BUILTIN_BRUSHES}
        activeId={pencil.id}
        brush={{ ...pencil }}
        onSelect={vi.fn()}
        onBrushChange={vi.fn()}
        onCollect={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByText("手感微調")).not.toBeInTheDocument();
  });

  it("橡皮擦不顯示顏色（擦掉就是擦掉，沒有顏色可選）", () => {
    const eraser = BUILTIN_BRUSHES.find((b) => b.engine === "eraser")!;
    setup({ activeId: eraser.id, brush: { ...eraser } });
    expect(screen.queryByRole("group", { name: "顏色" })).not.toBeInTheDocument();
  });

  it("手機 dock 預設收起參數區，白板才拿得到高度；展開鈕顯示目前的顏色與粗細", async () => {
    render(
      <BrushShelf
        layout={LITE}
        brushes={BUILTIN_BRUSHES}
        activeId={pencil.id}
        brush={{ ...pencil, size: 12 }}
        onSelect={vi.fn()}
        onBrushChange={vi.fn()}
        onCollect={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    // 用 role 查詢：hidden 的內容不在無障礙樹裡，讀屏也讀不到（不是只有視覺藏起來）
    expect(screen.queryByRole("slider", { name: /粗細/ })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "展開筆刷設定" });
    expect(toggle).toHaveTextContent("12");
    await userEvent.click(toggle);
    expect(screen.getByRole("slider", { name: /粗細/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起筆刷設定" })).toBeInTheDocument();
  });

  it("桌機沒有收合鈕（空間夠，一律攤開）", () => {
    setup();
    expect(screen.queryByRole("button", { name: /筆刷設定/ })).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /粗細/ })).toBeInTheDocument();
  });

  it("手機上還沒調參數就不顯示「收錄」——它會整列吃掉白板的高度", () => {
    const { view } = setup();
    view.rerender(
      <BrushShelf
        layout={LITE}
        brushes={BUILTIN_BRUSHES}
        activeId={pencil.id}
        brush={{ ...pencil }}
        onSelect={vi.fn()}
        onBrushChange={vi.fn()}
        onCollect={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /收錄成我的筆刷/ })).not.toBeInTheDocument();
  });

  it("收錄失敗的原因直接顯示出來", () => {
    setup({ notice: "收藏已滿（最多 24 支），先刪掉不用的再收" });
    expect(screen.getByRole("alert")).toHaveTextContent("收藏已滿");
  });
});
