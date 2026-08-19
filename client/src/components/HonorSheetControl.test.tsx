import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HonorSheetControl } from "./HonorSheetControl";

const XIAOHUA = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "小華",
  referenceAssetId: "22222222-2222-4222-8222-222222222222",
  referenceUrl: "https://example.test/xiaohua-sheet.png",
};
const EMPTY = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "小華",
  referenceAssetId: null,
  referenceUrl: null,
};

describe("HonorSheetControl", () => {
  it("0 own refs stays 已選 0/6 and the checkbox cannot invent a stray", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<HonorSheetControl characters={[EMPTY]} selectedIds={[EMPTY.id]} onToggle={onToggle} />);
    expect(screen.getByText(/生成時帶入 · 已選 0\/6/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /小華/ })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /小華/ }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("own same-project sheet can become 已選 1/6", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<HonorSheetControl characters={[XIAOHUA]} selectedIds={[]} onToggle={onToggle} />);
    expect(screen.getByText(/已選 0\/6/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /小華/ }));
    expect(onToggle).toHaveBeenCalledWith(XIAOHUA.id);
  });
});
