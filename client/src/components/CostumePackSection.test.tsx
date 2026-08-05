import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CostumePackSection, costumeTabFromTarget } from "./CostumePackSection";

describe("costumeTabFromTarget", () => {
  it("maps deep-link anchors to costume tabs", () => {
    expect(costumeTabFromTarget("#sec-characters")).toBe("characters");
    expect(costumeTabFromTarget("#sec-scenes")).toBe("scenes");
    expect(costumeTabFromTarget("#sec-props")).toBe("props");
    expect(costumeTabFromTarget("#sec-knowledge")).toBeNull();
  });
});

describe("CostumePackSection", () => {
  const panels = {
    characters: <div>角色內容</div>,
    scenes: <div>場景內容</div>,
    props: <div>道具內容</div>,
  };

  it("keeps stable panel ids for deep links and shows one panel at a time", () => {
    render(
      <CostumePackSection
        tab="characters"
        onTabChange={() => {}}
        counts={{ characters: 2, scenes: 1, props: 0 }}
        panels={panels}
      />,
    );

    expect(document.getElementById("sec-characters")).toBeTruthy();
    expect(document.getElementById("sec-scenes")).toBeTruthy();
    expect(document.getElementById("sec-props")).toBeTruthy();

    expect(screen.getByTestId("costume-panel-characters")).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("costume-panel-scenes")).toHaveAttribute("hidden");
    expect(screen.getByTestId("costume-panel-props")).toHaveAttribute("hidden");

    expect(screen.getByText("共：角色 2 · 場景 1 · 道具 0")).toBeTruthy();
  });

  it("switches tab and calls onTabChange", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(
      <CostumePackSection
        tab="characters"
        onTabChange={onTabChange}
        counts={{ characters: 0, scenes: 3, props: 1 }}
        carriedHint="自動帶入說明"
        panels={panels}
      />,
    );

    expect(screen.getByText("自動帶入說明")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /場景/ }));
    expect(onTabChange).toHaveBeenCalledWith("scenes");
  });

  it("arrow keys move focus across tabs", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(
      <CostumePackSection
        tab="characters"
        onTabChange={onTabChange}
        counts={{}}
        panels={panels}
      />,
    );

    const charTab = screen.getByRole("tab", { name: /角色/ });
    charTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(onTabChange).toHaveBeenCalledWith("scenes");
    expect(screen.getByRole("tab", { name: /場景/ })).toHaveFocus();
  });
});
