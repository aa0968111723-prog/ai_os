import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantStreamHandlers } from "./assistantStream";
import { ProjectAssistant } from "./ProjectAssistant";

const mocks = vi.hoisted(() => ({
  askMutate: vi.fn(),
  invalidate: vi.fn(),
  requestAssistantStream: vi.fn(),
  runMutateAsync: vi.fn(),
  undoMutateAsync: vi.fn(),
}));

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      agents: { invalidate: mocks.invalidate },
      approvals: { invalidate: mocks.invalidate },
      generation: { invalidate: mocks.invalidate },
      quota: { invalidate: mocks.invalidate },
      scenes: { invalidate: mocks.invalidate },
      workflows: { invalidate: mocks.invalidate },
    }),
    assistant: {
      ask: {
        useMutation: () => ({ mutate: mocks.askMutate }),
      },
      generateModels: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      runAction: {
        useMutation: () => ({ mutateAsync: mocks.runMutateAsync }),
      },
      undoCreatedScenes: {
        useMutation: () => ({ mutateAsync: mocks.undoMutateAsync, mutate: vi.fn(), isPending: false, isSuccess: false, error: null }),
      },
    },
  },
}));

vi.mock("./assistantStream", async (importOriginal) => {
  const original = await importOriginal<typeof import("./assistantStream")>();
  return {
    ...original,
    requestAssistantStream: mocks.requestAssistantStream,
  };
});

vi.mock("./AssistantTrace", () => ({
  AssistantTrace: ({ events }: { events: Array<{ text: string }> }) => (
    <div data-testid="saved-trace">{events.map((event) => event.text).join("|")}</div>
  ),
  LiveAssistantTrace: ({ events }: { events: Array<{ text: string }> }) => (
    <div data-testid="live-trace">{events.map((event) => event.text).join("|")}</div>
  ),
}));

vi.mock("./Icon", () => ({
  Icon: () => <span aria-hidden="true" />,
}));

vi.mock("./interactions", () => ({
  ConfirmButton: ({
    children,
    disabled,
    onConfirm,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onConfirm: () => Promise<void> | void;
  }) => (
    <button type="button" disabled={disabled} onClick={() => void onConfirm()}>
      {children}
    </button>
  ),
}));

type StreamRequest = {
  projectId: string;
  handlers: AssistantStreamHandlers;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

async function submitQuestion(text: string) {
  const input = screen.getByRole("textbox");
  await userEvent.setup().type(input, text);
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("ProjectAssistant project-scoped async results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    mocks.requestAssistantStream.mockResolvedValue(true);
  });

  it("drops late SSE events from the previous project while allowing the new project response", async () => {
    const requests: StreamRequest[] = [];
    const completions: Array<ReturnType<typeof deferred<boolean>>> = [];
    mocks.requestAssistantStream.mockImplementation((request: StreamRequest) => {
      requests.push(request);
      const completion = deferred<boolean>();
      completions.push(completion);
      return completion.promise;
    });

    const { rerender } = render(<ProjectAssistant projectId="project-a" embedded />);
    await submitQuestion("question-a");
    await waitFor(() => expect(requests).toHaveLength(1));

    rerender(<ProjectAssistant projectId="project-b" embedded />);
    await waitFor(() => expect(screen.getByRole("textbox")).not.toBeDisabled());

    await act(async () => {
      requests[0].handlers.onStep({ phase: "lookup", text: "STALE_SSE_STEP" });
      requests[0].handlers.onDone({
        answer: "STALE_SSE_ANSWER",
        actions: [],
        steps: [],
        mock: false,
        fallback: false,
      });
      completions[0].resolve(true);
      await completions[0].promise;
    });

    expect(screen.queryByText("STALE_SSE_STEP")).not.toBeInTheDocument();
    expect(screen.queryByText("STALE_SSE_ANSWER")).not.toBeInTheDocument();

    await submitQuestion("question-b");
    await waitFor(() => expect(requests).toHaveLength(2));
    await act(async () => {
      requests[1].handlers.onDone({
        answer: "CURRENT_SSE_ANSWER",
        actions: [],
        steps: [],
        mock: false,
        fallback: false,
      });
      completions[1].resolve(true);
      await completions[1].promise;
    });

    expect(await screen.findByText("CURRENT_SSE_ANSWER")).toBeInTheDocument();
    expect(screen.queryByText("STALE_SSE_ANSWER")).not.toBeInTheDocument();
  });

  it("drops a late tRPC fallback callback from the previous project", async () => {
    mocks.requestAssistantStream.mockResolvedValue(false);
    const { rerender } = render(<ProjectAssistant projectId="project-a" embedded />);
    await submitQuestion("fallback-a");
    await waitFor(() => expect(mocks.askMutate).toHaveBeenCalledTimes(1));
    const callbacks = mocks.askMutate.mock.calls[0][1] as {
      onSuccess: (result: { answer: string; actions: unknown[]; steps: string[] }) => void;
      onError: (error: Error) => void;
      onSettled: () => void;
    };

    rerender(<ProjectAssistant projectId="project-b" embedded />);
    await waitFor(() => expect(screen.getByRole("textbox")).not.toBeDisabled());

    act(() => {
      callbacks.onSuccess({
        answer: "STALE_TRPC_ANSWER",
        actions: [],
        steps: ["STALE_TRPC_STEP"],
      });
      callbacks.onError(new Error("STALE_TRPC_ERROR"));
      callbacks.onSettled();
    });

    expect(screen.queryByText("STALE_TRPC_ANSWER")).not.toBeInTheDocument();
    expect(screen.queryByText("STALE_TRPC_STEP")).not.toBeInTheDocument();
    expect(screen.queryByText("STALE_TRPC_ERROR")).not.toBeInTheDocument();
  });

  it("does not append a late confirmed-action result to the newly selected project", async () => {
    mocks.requestAssistantStream.mockImplementation(async (request: StreamRequest) => {
      request.handlers.onDone({
        answer: "ACTION_READY",
        actions: [
          {
            type: "create_scene",
            label: "RUN_STALE_ACTION",
            title: "Scene",
          },
        ],
        steps: [],
        mock: false,
        fallback: false,
      });
      return true;
    });
    const action = deferred<{ kind: string; message: string }>();
    mocks.runMutateAsync.mockReturnValue(action.promise);

    const { rerender } = render(<ProjectAssistant projectId="project-a" embedded />);
    await submitQuestion("prepare-action");
    await screen.findByText("ACTION_READY");

    await userEvent.setup().click(screen.getByRole("button", { name: "RUN_STALE_ACTION" }));
    await waitFor(() => expect(mocks.runMutateAsync).toHaveBeenCalledWith({
      projectId: "project-a",
      action: {
        type: "create_scene",
        title: "Scene",
        voiceover: undefined,
        durationSec: undefined,
        prompt: undefined,
      },
    }));

    rerender(<ProjectAssistant projectId="project-b" embedded />);
    await waitFor(() => expect(screen.queryByText("ACTION_READY")).not.toBeInTheDocument());

    await act(async () => {
      action.resolve({ kind: "create_scene", message: "STALE_ACTION_RESULT" });
      await action.promise;
    });

    expect(screen.queryByText(/STALE_ACTION_RESULT/)).not.toBeInTheDocument();
  });

  it("明確要求拆目前腳本時直接持久化分鏡，不再退回確認卡", async () => {
    mocks.runMutateAsync.mockResolvedValue({
      kind: "split_script",
      createdScenes: 8,
      sceneIds: ["11111111-1111-4111-8111-111111111111"],
      message: "已拆出 8 個分鏡，可逐鏡生成畫面",
    });
    mocks.requestAssistantStream.mockImplementation(async (request: StreamRequest) => {
      request.handlers.onDone({
        answer: "我會把目前腳本拆成真正分鏡。",
        actions: [{ type: "split_script", label: "把目前專案腳本拆成分鏡（AI 導演，免費）" }],
        steps: [],
        mock: false,
        fallback: false,
      });
      return true;
    });

    render(<ProjectAssistant projectId="project-a" embedded />);
    await submitQuestion("幫我把目前腳本拆成分鏡");

    await waitFor(() => expect(mocks.runMutateAsync).toHaveBeenCalledWith({
      projectId: "project-a",
      action: { type: "split_script", script: undefined },
    }));
    expect(await screen.findByText("已拆出 8 個分鏡，可逐鏡生成畫面")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /把目前專案腳本拆成分鏡/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /復原/ })).toBeInTheDocument();
  });
});

describe("ProjectAssistant WB-03 bring-in (no runAction)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    mocks.requestAssistantStream.mockResolvedValue(true);
  });

  it("renders bring-in buttons and clicks call onCreationAction without runAction", async () => {
    const onCreationAction = vi.fn();
    mocks.requestAssistantStream.mockImplementation(async (request: StreamRequest) => {
      request.handlers.onDone({
        answer: "這裡有幾個建議",
        actions: [
          {
            type: "generate",
            label: "生成香爐",
            prompt: "香爐特寫",
            modelId: "fal-ai/flux/schnell",
          },
          {
            type: "plan_agent",
            label: "排計畫",
            goal: "拆分鏡並出圖",
          },
          {
            type: "run_workflow",
            label: "跑範本",
            presetId: "preset-open",
            prompt: "片頭 15 秒",
          },
        ],
        steps: [],
        mock: false,
        fallback: false,
      });
      return true;
    });

    render(
      <ProjectAssistant projectId="project-wb03" embedded onCreationAction={onCreationAction} />,
    );
    await submitQuestion("給我建議");
    await screen.findByText("這裡有幾個建議");

    // Bring-in buttons present。ProactiveModelConverter 也會為每個模型建議渲染一顆同名的
    // 「建立多步開拍」，所以這裡鎖定 SuggestionActions 自己的 group，別讓查詢撞到別人的鈕。
    const bringInGroup = screen.getByRole("group", { name: "建議帶入工作台" });
    expect(within(bringInGroup).getByRole("button", { name: "帶入直接出圖" })).toBeInTheDocument();
    expect(within(bringInGroup).getByRole("button", { name: "建立多步開拍" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "帶入多步開拍" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "帶入套用範本" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(bringInGroup).getByRole("button", { name: "帶入直接出圖" }));
    expect(onCreationAction).toHaveBeenCalled();
    const genCall = onCreationAction.mock.calls.at(-1)![0];
    expect(genCall.type).toBe("generate");
    expect(genCall.draft.prompt).toBe("香爐特寫");
    expect(mocks.runMutateAsync).not.toHaveBeenCalled();

    onCreationAction.mockClear();
    await user.click(screen.getByRole("button", { name: "帶入多步開拍" }));
    expect(onCreationAction).toHaveBeenCalledWith({
      type: "create_plan",
      goal: "拆分鏡並出圖",
    });
    expect(mocks.runMutateAsync).not.toHaveBeenCalled();

    onCreationAction.mockClear();
    await user.click(screen.getByRole("button", { name: "帶入套用範本" }));
    expect(onCreationAction).toHaveBeenCalledWith({
      type: "run_template",
      templateId: "preset-open",
      goal: "片頭 15 秒",
    });
    expect(mocks.runMutateAsync).not.toHaveBeenCalled();
  });

  it("askFillRequest fills chat input without sending", async () => {
    const { rerender } = render(
      <ProjectAssistant
        projectId="project-wb03"
        embedded
        askFillRequest={{ nonce: 1, message: "填入問 AI 的問題" }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("填入問 AI 的問題");
    });
    expect(mocks.requestAssistantStream).not.toHaveBeenCalled();
    expect(mocks.askMutate).not.toHaveBeenCalled();

    rerender(
      <ProjectAssistant
        projectId="project-wb03"
        embedded
        askFillRequest={{ nonce: 2, message: "第二次填入" }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("第二次填入");
    });
  });
});

describe("ProjectAssistant 代理規劃模型選擇", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    mocks.requestAssistantStream.mockImplementation(async (request: StreamRequest) => {
      request.handlers.onDone({
        answer: "可以建立代理計畫",
        actions: [{
          type: "plan_agent",
          label: "排計畫",
          goal: "安排活動前一週的完整準備",
        }],
        steps: [],
        mock: false,
        fallback: false,
      });
      return true;
    });
    mocks.runMutateAsync.mockResolvedValue({
      kind: "plan_agent",
      message: "已建立計畫",
    });
  });

  it("讓使用者在確認前選 Fal 用量級別並送到後端", async () => {
    render(<ProjectAssistant projectId="project-agent" embedded />);
    await submitQuestion("請排完整計畫");
    await screen.findByText("可以建立代理計畫");

    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "選擇代理規劃模型與用量" }),
      "fal_economy",
    );
    await user.click(screen.getByRole("button", { name: "排計畫" }));

    await waitFor(() => expect(mocks.runMutateAsync).toHaveBeenCalledWith({
      projectId: "project-agent",
      action: {
        type: "plan_agent",
        goal: "安排活動前一週的完整準備",
        plannerMode: "fal_economy",
      },
    }));
    expect(window.localStorage.getItem("aios.agentPlannerMode")).toBe("fal_economy");
  });
});
