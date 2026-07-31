import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MenuSurface } from "./MenuSurface";

/** 讓 useMatchMedia 回報「手機」或「桌機」——jsdom 內建的 matchMedia 一律回 false（桌機） */
function stubMatchMedia(matches: boolean) {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  return () => Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
}

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

function Harness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="menu-wrap" data-testid="wrap">
      <button ref={triggerRef} onClick={() => setOpen((v) => !v)}>開選單</button>
      <MenuSurface open={open} onClose={() => setOpen(false)} label="測試選單" triggerRef={triggerRef}>
        <button className="menu-item" role="menuitem">第一項</button>
        <button className="menu-item" role="menuitem">第二項</button>
      </MenuSurface>
    </div>
  );
}

describe("MenuSurface", () => {
  it("桌機留在 menu-wrap 內當下拉，沒有遮罩", async () => {
    restore = stubMatchMedia(false);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "開選單" }));

    const menu = await screen.findByRole("menu", { name: "測試選單" });
    expect(menu.className).toContain("menu-surface");
    expect(menu.className).not.toContain("is-sheet");
    // 桌機定位靠 .menu-wrap 的 relative——一旦被 portal 出去，absolute 下拉就會飄到頁面左上
    expect(screen.getByTestId("wrap")).toContainElement(menu);
    expect(document.querySelector(".menu-surface__scrim")).toBeNull();
  });

  it("手機 portal 到 body 並帶遮罩，點遮罩關閉", async () => {
    restore = stubMatchMedia(true);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "開選單" }));

    const menu = await screen.findByRole("menu", { name: "測試選單" });
    expect(menu.className).toContain("is-sheet");
    // topbar 的 backdrop-filter 會成為 fixed 後代的包含區塊，sheet 必須離開它才貼得到螢幕底
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByTestId("wrap")).not.toContainElement(menu);

    const scrim = document.querySelector(".menu-surface__scrim");
    expect(scrim).not.toBeNull();
    await user.click(scrim as HTMLElement);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("點選單本身不會關閉——portal 出去後仍要算在「裡面」", async () => {
    restore = stubMatchMedia(true);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "開選單" }));
    await screen.findByRole("menu", { name: "測試選單" });

    await user.click(screen.getByRole("menuitem", { name: "第二項" }));
    expect(screen.getByRole("menu", { name: "測試選單" })).toBeInTheDocument();
  });

  it("開啟聚焦首項、方向鍵漫遊、Esc 關閉並把焦點還給觸發器", async () => {
    restore = stubMatchMedia(false);
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "開選單" });
    await user.click(trigger);

    expect(screen.getByRole("menuitem", { name: "第一項" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "第二項" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "第一項" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "第二項" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
