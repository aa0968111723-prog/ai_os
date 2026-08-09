import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalGenerationLauncher } from "./ExternalGenerationLauncher";

const prepareSession = vi.fn();
const markOpened = vi.fn();

vi.mock("../../api", () => ({
  trpc: {
    projects: {
      get: { useQuery: () => ({ data: { groupId: "11111111-1111-4111-8111-111111111111" } }) },
    },
    externalIntake: {
      tools: { useQuery: () => ({
        data: [{
          key: "flow",
          name: "Flow",
          url: "https://labs.google/fx/tools/flow",
          capabilities: ["video"],
          instructions: "適合使用 Veo 製作影片。",
          builtIn: true,
          favorite: true,
        }],
        refetch: vi.fn(),
      }) },
      prepareSession: { useMutation: () => ({ mutateAsync: prepareSession, isPending: false }) },
      markOpened: { useMutation: () => ({ mutateAsync: markOpened, isPending: false }) },
      saveTool: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
  },
}));

vi.mock("../../components/interactions", () => ({ useFocusTrap: () => undefined }));

function setup() {
  render(
    <ExternalGenerationLauncher
      projectId="22222222-2222-4222-8222-222222222222"
      sceneId="33333333-3333-4333-8333-333333333333"
      sceneLabel="第 1 鏡"
      prompt="晨光禪堂，長鏡頭"
      targetType="video"
    />,
  );
}

beforeEach(() => {
  prepareSession.mockReset();
  markOpened.mockReset();
  prepareSession.mockResolvedValue({
    id: "44444444-4444-4444-8444-444444444444",
    externalUrl: "https://labs.google/fx/tools/flow",
    externalToolName: "Flow",
  });
  markOpened.mockResolvedValue({ status: "waiting_result" });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("ExternalGenerationLauncher", () => {
  it("彈出視窗被封鎖時不建立假的等待工作階段", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    setup();
    await userEvent.click(screen.getByRole("button", { name: /去外部 AI 生成/ }));
    await userEvent.click(screen.getByRole("button", { name: /Flow/ }));
    expect(await screen.findByText(/瀏覽器封鎖了新分頁/)).toBeInTheDocument();
    expect(prepareSession).not.toHaveBeenCalled();
    expect(markOpened).not.toHaveBeenCalled();
  });

  it("剪貼簿權限失敗時保留可手動複製的完整 Prompt", async () => {
    const popup = { opener: window, location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    setup();
    await userEvent.click(screen.getByRole("button", { name: /去外部 AI 生成/ }));
    await userEvent.click(screen.getByRole("button", { name: /Flow/ }));
    expect(await screen.findByRole("textbox", { name: "待複製的 Prompt" })).toHaveValue("晨光禪堂，長鏡頭");
    expect(screen.getByText(/瀏覽器未允許自動複製/)).toBeInTheDocument();
    expect(popup.location.href).toBe("https://labs.google/fx/tools/flow");
    expect(popup.opener).toBeNull();
    expect(markOpened).toHaveBeenCalledWith({ sessionId: "44444444-4444-4444-8444-444444444444" });
  });
});
