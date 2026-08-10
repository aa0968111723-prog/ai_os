import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantCapabilityGuide } from "./AssistantCapabilityGuide";
import type { AssistantPageContext } from "../lib/assistantContext";

function ctx(partial: Partial<AssistantPageContext>): AssistantPageContext {
  return { route: "/", pageType: "other", ...partial };
}

beforeEach(() => {
  window.localStorage.clear();
});

/**
 * 這塊存在的唯一理由是「使用者不知道它能做什麼、也不知道怎麼開口」，
 * 所以測試守的是那兩件事：後果講清楚了、按一行就等於問出一句完整的話；
 * 外加一件——它不能退化成一張對誰都一樣的固定清單。
 */
describe("AssistantCapabilityGuide", () => {
  it("預設收合——說明書不能把輸入框推到看不見（sheet 上一次被回報「字太多」就是這樣來的）", () => {
    render(<AssistantCapabilityGuide onPick={vi.fn()} />);
    expect(screen.getByText("能做什麼")).toBeVisible();
    // details 收合時內容仍在 DOM，但不可見
    expect(screen.getByText(/直接用講話的方式/)).not.toBeVisible();
  });

  it("預設只給這一頁相關的幾行，不是二十幾行的字牆", async () => {
    const user = userEvent.setup();
    render(<AssistantCapabilityGuide onPick={vi.fn()} ctx={ctx({ pageType: "database" })} />);
    await user.click(screen.getByText("能做什麼"));
    expect(screen.getByRole("button", { name: /讀取 AI 可見資料庫/ })).toBeVisible();
    // 跟資料庫無關的能力不該出現在預設畫面上
    expect(screen.queryByRole("button", { name: /讀取組員與工作負荷/ })).toBeNull();
  });

  it("正在看某一鏡時，標題與例句都對著它講——不是要人自己代換名詞的樣板", async () => {
    const user = userEvent.setup();
    render(
      <AssistantCapabilityGuide
        onPick={vi.fn()}
        ctx={ctx({ pageType: "storyboard", entityType: "shot", entityId: "s-1", entityLabel: "第 3 鏡" })}
      />,
    );
    await user.click(screen.getByText("能做什麼"));
    expect(screen.getByText(/在「第 3 鏡」上可以叫它做/)).toBeVisible();
    expect(screen.getByText(/幫我生成第 3 鏡的畫面/)).toBeVisible();
  });

  it("建議區的每一行都標出後果——那裡混著四種後果，不標的話「生成影片」看起來跟「讀取分鏡」一樣無害", async () => {
    const user = userEvent.setup();
    render(
      <AssistantCapabilityGuide
        onPick={vi.fn()}
        ctx={ctx({ pageType: "storyboard", entityType: "shot", entityId: "s-1", entityLabel: "第 3 鏡" })}
      />,
    );
    await user.click(screen.getByText("能做什麼"));
    expect(screen.getByRole("button", { name: /生成圖片或影片/ }).textContent).toMatch(/會花點/);
    // 唯讀的不標：每一行都掛徽章等於沒有徽章
    expect(screen.getByRole("button", { name: /^讀取分鏡/ }).textContent).not.toMatch(/會花點|要你確認|直接做/);
  });

  it("「更多可以做什麼」按得到，完整能力使用產品語言分組——縮短的是路徑，不是能力", async () => {
    const user = userEvent.setup();
    render(<AssistantCapabilityGuide onPick={vi.fn()} ctx={ctx({ pageType: "database" })} />);
    await user.click(screen.getByText("能做什麼"));
    await user.click(screen.getByRole("button", { name: /更多可以做什麼/ }));
    for (const title of ["加入資料", "創作影片", "整理專案", "任務與排程", "團隊協作", "生成與外部工具"]) {
      expect(screen.getByText(title)).toBeVisible();
    }
    expect(screen.getByRole("button", { name: /讀取組員與工作負荷/ })).toBeVisible();
  });

  it("按一行就直接送出那句例句——多一步「填進輸入框再自己按送出」只會讓人重新猶豫", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<AssistantCapabilityGuide onPick={onPick} ctx={ctx({ pageType: "notes" })} />);
    await user.click(screen.getByText("能做什麼"));
    await user.click(screen.getByRole("button", { name: /建立內部筆記/ }));
    expect(onPick).toHaveBeenCalledWith(expect.stringContaining("筆記"));
  });

  it("用過的下次浮到最前面——清單會慢慢變成「你的」清單", async () => {
    const user = userEvent.setup();
    const page = ctx({ pageType: "chat" });
    const { unmount } = render(<AssistantCapabilityGuide onPick={vi.fn()} ctx={page} />);
    await user.click(screen.getByText("能做什麼"));
    await user.click(screen.getByRole("button", { name: /傳送私訊/ }));
    unmount();

    render(<AssistantCapabilityGuide onPick={vi.fn()} ctx={ctx({ pageType: "storyboard" })} />);
    await user.click(screen.getByText("能做什麼"));
    // 分鏡頁本來完全不會推「傳送私訊」，是使用紀錄把它帶上來的
    expect(screen.getByRole("button", { name: /傳送私訊/ })).toBeVisible();
  });

  it("助手忙碌或沒選組時每一行都按不下去——送出去也只會被擋，不如當下就講清楚", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<AssistantCapabilityGuide onPick={onPick} ctx={ctx({ pageType: "notes" })} disabled />);
    await user.click(screen.getByText("能做什麼"));
    const row = screen.getByRole("button", { name: /建立內部筆記/ });
    expect(row).toBeDisabled();
    await user.click(row);
    expect(onPick).not.toHaveBeenCalled();
  });
});
