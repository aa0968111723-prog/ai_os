import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorldviewExampleCard } from "./WorldviewExampleCard";
import {
  worldviewSchema,
  worldviewQuickExampleForKind,
  applyWorldviewFullExample,
  chipSoftWarnings,
  isWorldviewReady,
} from "@shared/worldview";

const blank = worldviewSchema.parse({});

describe("WorldviewExampleCard：展示範例", () => {
  it("依專案類型顯示對應範例與類型名", () => {
    render(<WorldviewExampleCard wv={blank} kind="witness" canEdit onApply={() => {}} onDismiss={() => {}} />);
    const ex = worldviewQuickExampleForKind("witness");
    expect(screen.getByText(ex.logline)).toBeTruthy();
    expect(screen.getByText(ex.message)).toBeTruthy();
    expect(screen.getByText(/「見證故事」的範例/)).toBeTruthy();
  });

  it("未知類型掉回通用範例，文案不硬掰類型名", () => {
    render(<WorldviewExampleCard wv={blank} kind={null} canEdit onApply={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/這是一份通用範例/)).toBeTruthy();
  });

  it("附上「套下去 AI 會收到什麼」的預覽——這是化抽象為具體的關鍵", () => {
    render(<WorldviewExampleCard wv={blank} kind="witness" canEdit onApply={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/填下去之後，AI 每次生成會收到這些/)).toBeTruthy();
    const pres = Array.from(document.querySelectorAll("#wv-example-preview pre")).map((p) => p.textContent ?? "");
    expect(pres.some((t) => t.includes("[專案背景]"))).toBe(true);
    // 預覽的是「假想的合併結果」，不是目前這份空世界觀
    expect(pres.some((t) => t.includes("視覺風格"))).toBe(true);
  });
});

describe("WorldviewExampleCard：套用", () => {
  it("無 onApplyAndGoStudio 時主鈕為「整份填進去」，只送一個 patch", async () => {
    const onApply = vi.fn();
    render(<WorldviewExampleCard wv={blank} kind="witness" canEdit onApply={onApply} onDismiss={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "整份填進去" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(applyWorldviewFullExample(blank, "witness", false));
  });

  it("C3.2：有 onApplyAndGoStudio 時主鈕「套用後去創作台」；次要只套用", async () => {
    const onApply = vi.fn();
    const onApplyAndGoStudio = vi.fn();
    render(
      <WorldviewExampleCard
        wv={blank}
        kind="witness"
        canEdit
        onApply={onApply}
        onApplyAndGoStudio={onApplyAndGoStudio}
        onDismiss={() => {}}
      />,
    );
    const patch = applyWorldviewFullExample(blank, "witness", false);
    await userEvent.click(screen.getByTestId("wv-example-apply-studio"));
    expect(onApplyAndGoStudio).toHaveBeenCalledTimes(1);
    expect(onApplyAndGoStudio).toHaveBeenCalledWith(patch);
    expect(onApply).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "只套用、先不生成" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(patch);
  });

  it("送出的 patch 併回去就是就緒狀態，且不觸發軟警告", async () => {
    const onApply = vi.fn();
    render(<WorldviewExampleCard wv={blank} kind="witness" canEdit onApply={onApply} onDismiss={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "整份填進去" }));
    const merged = worldviewSchema.parse({ ...blank, ...onApply.mock.calls[0]![0] });
    expect(isWorldviewReady(merged)).toBe(true);
    expect(chipSoftWarnings(merged)).toEqual([]);
  });

  it("「我自己填」關閉範例卡", async () => {
    const onDismiss = vi.fn();
    render(<WorldviewExampleCard wv={blank} kind="witness" canEdit onApply={() => {}} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: "我自己填" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("WorldviewExampleCard：唯讀", () => {
  it("檢視者看得到範例與預覽，但沒有任何套用按鈕", () => {
    render(
      <WorldviewExampleCard
        wv={blank}
        kind="witness"
        canEdit={false}
        onApply={() => {}}
        onApplyAndGoStudio={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(worldviewQuickExampleForKind("witness").logline)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "整份填進去" })).toBeNull();
    expect(screen.queryByTestId("wv-example-apply-studio")).toBeNull();
    expect(screen.queryByRole("button", { name: "我自己填" })).toBeNull();
  });
});
