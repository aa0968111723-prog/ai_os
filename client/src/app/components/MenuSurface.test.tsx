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

  it("點由選單開出的 portal 對話框不會把父 sheet 一起關掉", async () => {
    restore = stubMatchMedia(true);
    const user = userEvent.setup();
    render(<><Harness /><div className="modal-scrim"><button>子對話框操作</button></div></>);
    await user.click(screen.getByRole("button", { name: "開選單" }));
    await screen.findByRole("menu", { name: "測試選單" });

    await user.click(screen.getByRole("button", { name: "子對話框操作" }));
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

/** 假的觸發器矩形：只有 bottom 會被 MenuSurface 讀到 */
function rectWithBottom(bottom: number): DOMRect {
  return { x: 0, y: bottom - 40, top: bottom - 40, bottom, left: 0, right: 100, width: 100, height: 40, toJSON: () => ({}) };
}

/** 桌機下拉的高度上限：長清單被切在視窗外、又因 sticky 頂欄捲不出來（見 MenuSurface 檔頭） */
describe("MenuSurface 桌機高度上限", () => {
  const originalInnerHeight = window.innerHeight;
  function setViewportHeight(px: number) {
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: px });
  }
  afterEach(() => setViewportHeight(originalInnerHeight));

  async function openWithTriggerBottom(bottom: number) {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "開選單" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(rectWithBottom(bottom));
    await user.click(trigger);
    return screen.getByRole("menu", { name: "測試選單" });
  }

  it("依觸發器到視窗下緣的實距寫入 --menu-avail-h", async () => {
    restore = stubMatchMedia(false);
    setViewportHeight(800);
    const menu = await openWithTriggerBottom(120);
    // 800 −（120 觸發器下緣 + 8 間距）− 12 視窗下緣留白
    expect(menu.style.getPropertyValue("--menu-avail-h")).toBe("660px");
  });

  it("觸發器貼近視窗下緣時不再壓縮，守住 160px 下限", async () => {
    restore = stubMatchMedia(false);
    setViewportHeight(800);
    const menu = await openWithTriggerBottom(780);
    expect(menu.style.getPropertyValue("--menu-avail-h")).toBe("160px");
  });

  it("縮視窗會重算——開著選單改變視窗高度，上限要跟著變", async () => {
    restore = stubMatchMedia(false);
    setViewportHeight(800);
    const menu = await openWithTriggerBottom(120);
    setViewportHeight(600);
    window.dispatchEvent(new Event("resize"));
    expect(menu.style.getPropertyValue("--menu-avail-h")).toBe("460px");
  });

  it("手機貼底 sheet 不套這條——高度由 .is-sheet 的 max-height 決定", async () => {
    restore = stubMatchMedia(true);
    setViewportHeight(800);
    const menu = await openWithTriggerBottom(120);
    expect(menu.style.getPropertyValue("--menu-avail-h")).toBe("");
  });
});

describe("MenuSurface 角色與桌機幾何", () => {
  function Dialogish() {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    return (
      <div className="menu-wrap">
        <button ref={triggerRef} onClick={() => setOpen((v) => !v)}>開面板</button>
        <MenuSurface
          open={open}
          onClose={() => setOpen(false)}
          label="請誰來幫忙"
          triggerRef={triggerRef}
          surfaceRole="dialog"
          placement="stretch"
          roving={false}
          id="skill-menu"
        >
          <button aria-pressed="false">卡片一</button>
          <button aria-pressed="false">卡片二</button>
        </MenuSurface>
      </div>
    );
  }

  it("surfaceRole=dialog 時對讀屏是對話框，不是選單", async () => {
    restore = stubMatchMedia(false);
    const user = userEvent.setup();
    render(<Dialogish />);
    await user.click(screen.getByRole("button", { name: "開面板" }));

    expect(screen.getByRole("dialog", { name: "請誰來幫忙" })).toBeInTheDocument();
    // 內容不是 menuitem，就不該宣稱自己是 menu（等於承諾了沒實作的方向鍵模型）
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("roving=false 時不搶走焦點——焦點留在觸發器", async () => {
    restore = stubMatchMedia(false);
    const user = userEvent.setup();
    render(<Dialogish />);
    const trigger = screen.getByRole("button", { name: "開面板" });
    await user.click(trigger);

    expect(trigger).toHaveFocus();
    expect(screen.getByRole("button", { name: "卡片一" })).not.toHaveFocus();
  });

  it("placement=stretch 掛上與觸發器同寬的幾何，並透傳 id 供 aria-controls", async () => {
    restore = stubMatchMedia(false);
    const user = userEvent.setup();
    render(<Dialogish />);
    await user.click(screen.getByRole("button", { name: "開面板" }));

    const surface = screen.getByRole("dialog", { name: "請誰來幫忙" });
    expect(surface.className).toContain("menu-surface--stretch");
    expect(surface).toHaveAttribute("id", "skill-menu");
  });

  it("dialog 版本在手機一樣變貼底 sheet 並可用遮罩關閉", async () => {
    restore = stubMatchMedia(true);
    const user = userEvent.setup();
    render(<Dialogish />);
    await user.click(screen.getByRole("button", { name: "開面板" }));

    const surface = screen.getByRole("dialog", { name: "請誰來幫忙" });
    expect(surface.className).toContain("is-sheet");
    expect(surface.parentElement).toBe(document.body);

    await user.click(document.querySelector(".menu-surface__scrim") as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
