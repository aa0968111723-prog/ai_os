import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UI_DENSITY_STORAGE_KEY, readUiDensity, subscribeUiDensity, writeUiDensity } from "./densityPreference";
import { DensityGate } from "../app/DensityGate";
import { Hint } from "../components/ui";

beforeEach(() => {
  window.localStorage.clear();
});

describe("readUiDensity — 讀不到就給新手看說明", () => {
  it("沒存過時回 guide", () => {
    expect(readUiDensity()).toBe("guide");
  });

  it("存了合法值就照讀", () => {
    window.localStorage.setItem(UI_DENSITY_STORAGE_KEY, "concise");
    expect(readUiDensity()).toBe("concise");
  });

  it("值被竄改成不認識的字串時退回 guide，而不是壞掉或藏光說明", () => {
    window.localStorage.setItem(UI_DENSITY_STORAGE_KEY, "ultra-minimal");
    expect(readUiDensity()).toBe("guide");
  });

  it("localStorage 讀取拋例外時仍回 guide", () => {
    const spy = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readUiDensity()).toBe("guide");
    spy.mockRestore();
  });
});

describe("writeUiDensity", () => {
  it("寫入後讀得回來", () => {
    writeUiDensity("concise");
    expect(readUiDensity()).toBe("concise");
  });

  it("儲存被封鎖時不拋例外（隱私模式不該讓點擊爆掉）", () => {
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeUiDensity("concise")).not.toThrow();
    spy.mockRestore();
  });

  it("通知同分頁的訂閱者（storage 事件只跨分頁，同頁改完收不到）", () => {
    const seen: string[] = [];
    const off = subscribeUiDensity((d) => seen.push(d));
    writeUiDensity("concise");
    writeUiDensity("guide");
    off();
    writeUiDensity("concise");
    expect(seen).toEqual(["concise", "guide"]);
  });

  it("解除訂閱後不再收到通知", () => {
    const listener = vi.fn();
    const off = subscribeUiDensity(listener);
    off();
    writeUiDensity("concise");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("subscribeUiDensity — 跨分頁", () => {
  it("其他分頁改了偏好，本分頁跟著更新", () => {
    const listener = vi.fn();
    const off = subscribeUiDensity(listener);
    window.localStorage.setItem(UI_DENSITY_STORAGE_KEY, "concise");
    window.dispatchEvent(new StorageEvent("storage", { key: UI_DENSITY_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledWith("concise");
    off();
  });

  it("其他 key 的 storage 事件不觸發", () => {
    const listener = vi.fn();
    const off = subscribeUiDensity(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: "aios.somethingElse" }));
    expect(listener).not.toHaveBeenCalled();
    off();
  });
});

describe("DensityGate — 把偏好接到 primitives", () => {
  it("初始就讀到已存的偏好，不先閃一次說明牆", () => {
    window.localStorage.setItem(UI_DENSITY_STORAGE_KEY, "concise");
    render(
      <DensityGate>
        <Hint>選好風格後會自動帶入每次生成。</Hint>
      </DensityGate>,
    );
    expect(screen.queryByText("選好風格後會自動帶入每次生成。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "顯示說明" })).toBeInTheDocument();
  });

  it("沒存過時走引導模式，說明常駐", () => {
    render(
      <DensityGate>
        <Hint>選好風格後會自動帶入每次生成。</Hint>
      </DensityGate>,
    );
    expect(screen.getByText("選好風格後會自動帶入每次生成。")).toBeInTheDocument();
  });

  it("偏好變更時整棵子樹即時跟著切換", async () => {
    render(
      <DensityGate>
        <Hint>選好風格後會自動帶入每次生成。</Hint>
        <Hint layer="always">本次將扣 12 點。</Hint>
      </DensityGate>,
    );
    expect(screen.getByText("選好風格後會自動帶入每次生成。")).toBeInTheDocument();

    act(() => writeUiDensity("concise"));
    expect(screen.queryByText("選好風格後會自動帶入每次生成。")).not.toBeInTheDocument();
    // 扣點金額不隨熟練度消失
    expect(screen.getByText("本次將扣 12 點。")).toBeInTheDocument();

    act(() => writeUiDensity("guide"));
    expect(screen.getByText("選好風格後會自動帶入每次生成。")).toBeInTheDocument();
  });

  it("精簡模式下仍可展開個別說明", async () => {
    window.localStorage.setItem(UI_DENSITY_STORAGE_KEY, "concise");
    render(
      <DensityGate>
        <Hint>選好風格後會自動帶入每次生成。</Hint>
      </DensityGate>,
    );
    await userEvent.click(screen.getByRole("button", { name: "顯示說明" }));
    expect(screen.getByText("選好風格後會自動帶入每次生成。")).toBeInTheDocument();
  });
});
