import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantLauncher } from "./AssistantLauncher";

/** 助手面板（問答＋調度）都是 lazy 載入的真元件，會打 trpc——整支 api 換成假的（站內慣例） */
vi.mock("../../api", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, reset: vi.fn(), error: null, data: undefined });
  const query = () => ({ data: undefined, isLoading: false, isPending: false, error: null, refetch: vi.fn() });
  return {
    trpc: {
      useUtils: () => ({}),
      teamAssistant: {
        ask: { useMutation: mutation },
        commandLevel: { useQuery: query },
        campaigns: { useQuery: query },
        planCampaign: { useMutation: mutation },
        approveCampaign: { useMutation: mutation },
        discardCampaign: { useMutation: mutation },
        stopCampaign: { useMutation: mutation },
        resumeCampaign: { useMutation: mutation },
      },
    },
  };
});

/** jsdom 沒有 matchMedia，useMatchMedia 會直接回 false（＝桌機）。
 *  要測手機分支就得自己種一個，測完拆掉，免得洩漏到同檔其他案例。 */
function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

describe("AssistantLauncher", () => {
  afterEach(() => {
    // @ts-expect-error 測試專用：把 jsdom 還原成沒有 matchMedia 的原狀
    delete window.matchMedia;
  });

  it("桌機：頂欄按鈕叫得出助手——這是 >820 唯一的入口（底部導覽那顆球被 display:none）", async () => {
    const user = userEvent.setup();
    render(<AssistantLauncher groupId="11111111-1111-4111-8111-111111111111" />);

    const trigger = screen.getByRole("button", { name: "AI 助手" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls", "global-assistant-sheet");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("dialog", { name: "AI 助手" })).toBeInTheDocument();
    // 面板上沒有可見標題，助手的入口身分由輸入框自己的 aria-label 承擔
    expect(await screen.findByLabelText("向 AI 助手提問")).toBeVisible();
  });

  it("手機：完全不渲染——底部導覽已經有一顆球，兩顆會變成兩個觸發器搶同一個 triggerRef", () => {
    stubMatchMedia(true);
    const { container } = render(<AssistantLauncher groupId="11111111-1111-4111-8111-111111111111" />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "AI 助手" })).not.toBeInTheDocument();
  });
});
