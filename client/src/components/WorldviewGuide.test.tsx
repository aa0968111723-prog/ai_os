import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorldviewGuide } from "./WorldviewGuide";
import { worldviewSchema } from "@shared/worldview";

const blank = worldviewSchema.parse({ taboos: [] });
const partial = worldviewSchema.parse({ logline: "一位訪客在晨光禪堂點香", taboos: [] });
const ready = worldviewSchema.parse({
  logline: "一位訪客在晨光禪堂點香",
  tones: ["溫暖"],
  styles: ["手繪插畫"],
  taboos: [],
});

describe("WorldviewGuide：下一步指引", () => {
  it("全空時第一步是「這支片在講什麼」", () => {
    render(<WorldviewGuide wv={blank} onJump={() => {}} />);
    expect(screen.getByText(/下一步：/).textContent).toContain("這支片在講什麼");
  });

  it("填了一句話後推進到「想要什麼感覺」", () => {
    render(<WorldviewGuide wv={partial} onJump={() => {}} />);
    expect(screen.getByText(/下一步：/).textContent).toContain("想要什麼感覺");
  });

  it("必填三步齊了就說可以出圖，下一步改建議那個可略過的第四步", () => {
    render(<WorldviewGuide wv={ready} onJump={() => {}} />);
    expect(screen.getByText(/已經可以出圖了/)).toBeTruthy();
    expect(screen.getByText(/下一步：/).textContent).toContain("給誰看、怎麼講");
  });

  it("四步全填完就不再顯示下一步", () => {
    const all = worldviewSchema.parse({ ...ready, audience: "初次接觸禪修的人" });
    render(<WorldviewGuide wv={all} onJump={() => {}} />);
    expect(screen.queryByText(/下一步：/)).toBeNull();
    expect(screen.getByText(/已經可以出圖了/)).toBeTruthy();
  });

  it("未就緒時說明前三步填完就能出圖", () => {
    render(<WorldviewGuide wv={partial} onJump={() => {}} />);
    expect(screen.getByText(/就能開始出圖/)).toBeTruthy();
  });
});

describe("WorldviewGuide：跳轉", () => {
  it("點步驟帶出對應錨點與步驟 id", async () => {
    const onJump = vi.fn();
    render(<WorldviewGuide wv={blank} onJump={onJump} />);
    await userEvent.click(screen.getByRole("button", { name: /畫面長什麼樣/ }));
    expect(onJump).toHaveBeenCalledWith("#wv-styles", "look");
  });

  it("第四步（進階層裡的）帶 narrative，呼叫端據此撐開摺疊層", async () => {
    const onJump = vi.fn();
    render(<WorldviewGuide wv={blank} onJump={onJump} />);
    await userEvent.click(screen.getByRole("button", { name: /給誰看、怎麼講/ }));
    expect(onJump).toHaveBeenCalledWith("#wv-audience", "narrative");
  });
});

describe("WorldviewGuide：步驟狀態", () => {
  it("已填的標 done、當前標 current", () => {
    render(<WorldviewGuide wv={partial} onJump={() => {}} />);
    const items = document.querySelectorAll(".visual-journey__item");
    expect(items[0]!.className).toContain("is-done");
    expect(items[1]!.className).toContain("is-current");
    expect(items[1]!.getAttribute("aria-current")).toBe("step");
    expect(items[2]!.className).toContain("is-upcoming");
  });
});
