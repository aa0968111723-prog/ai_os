import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCard } from "./AgentCard";

/**
 * QA 2026-08-02：工作台「你想完成什麼畫面？」與多步計畫「目標」原本是兩個各自獨立的輸入框，
 * 字不互通（下面打的永遠不會回寫上面），使用者得打兩次還不知道排步驟送的是哪一份。
 * 傳 onGoalChange＝受控模式：本卡不再自帶輸入框，值與寫入都回到上層那一格。
 */

vi.mock("../discuss", () => ({ flashAnchor: vi.fn() }));

const { queryOf, mutationOf, planMutate } = vi.hoisted(() => ({
  queryOf: (data: unknown) => ({ data, error: null, isLoading: false }),
  mutationOf: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
  planMutate: vi.fn(),
}));

vi.mock("../api", () => {
  const api = {
    useUtils: () => ({
      agents: {
        listByProject: { invalidate: vi.fn() },
        eventsByProject: { invalidate: vi.fn() },
        insights: { invalidate: vi.fn() },
      },
      quota: { my: { invalidate: vi.fn() } },
      tasks: { listByProject: { invalidate: vi.fn() } },
      generation: { listByProject: { invalidate: vi.fn() }, listByProjectPaged: { invalidate: vi.fn() } },
      scenes: { listByProject: { invalidate: vi.fn() } },
      notes: { list: { invalidate: vi.fn() } },
      schedule: { list: { invalidate: vi.fn() } },
      knowledge: { list: { invalidate: vi.fn() } },
    }),
    auth: { me: { useQuery: () => queryOf({ user: { id: "user-1" } }) } },
    agents: {
      listByProject: { useQuery: () => queryOf([]) },
      eventsByProject: { useQuery: () => queryOf({ items: [] }) },
      insights: { useQuery: () => queryOf(null) },
      plan: {
        useMutation: () => ({ mutate: planMutate, mutateAsync: async () => ({}), isPending: false, error: null }),
      },
      approve: { useMutation: mutationOf },
      discard: { useMutation: mutationOf },
      stop: { useMutation: mutationOf },
    },
    tasks: {
      listByProject: { useQuery: () => queryOf([]) },
      complete: { useMutation: mutationOf },
      decideApproval: { useMutation: mutationOf },
    },
    knowledge: { importDriveFile: { useMutation: mutationOf } },
  };
  return { trpc: api };
});

/** 工作台那一格：受控模式下這是全頁唯一的目標輸入框 */
function WorkbenchGoalBox({ goal }: { goal: string }) {
  return <textarea id="cw-goal" aria-label="你想完成什麼畫面？" defaultValue={goal} />;
}

describe("AgentCard 目標欄合併（單一輸入框）", () => {
  beforeEach(() => planMutate.mockReset());

  it("受控模式不再自帶「目標」輸入框", () => {
    render(
      <AgentCard
        projectId="project-1"
        canEdit
        embedded
        compactComposer
        goal="把腳本拆成 6 鏡"
        onGoalChange={vi.fn()}
        goalInputId="cw-goal"
      />,
    );
    expect(screen.queryByLabelText("目標")).not.toBeInTheDocument();
    // 改成唯讀回顯，讓使用者知道排步驟會送哪一句
    expect(screen.getByText(/目標：把腳本拆成 6 鏡/)).toBeInTheDocument();
  });

  it("未受控（舊入口）維持自帶輸入框", () => {
    render(<AgentCard projectId="project-1" canEdit embedded />);
    expect(screen.getByLabelText("目標")).toBeInTheDocument();
  });

  it("職能 chip 寫進上層那一格，並把焦點送回去", async () => {
    const user = userEvent.setup();
    const onGoalChange = vi.fn();
    render(
      <>
        <WorkbenchGoalBox goal="" />
        <AgentCard
          projectId="project-1"
          canEdit
          embedded
          compactComposer
          goal=""
          onGoalChange={onGoalChange}
          goalInputId="cw-goal"
        />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "分鏡助理" }));
    expect(onGoalChange).toHaveBeenCalledWith(
      "把知識庫的腳本拆成分鏡，並為每一鏡生成畫面（記得帶角色定裝）",
    );
    expect(document.activeElement).toBe(screen.getByLabelText("你想完成什麼畫面？"));
  });

  it("「幫我排步驟」讀的是上層那一格：未滿 5 字時停用", () => {
    render(
      <AgentCard
        projectId="project-1"
        canEdit
        embedded
        compactComposer
        goal="短"
        onGoalChange={vi.fn()}
        goalInputId="cw-goal"
      />,
    );
    expect(screen.getByRole("button", { name: "幫我排步驟" })).toBeDisabled();
    expect(screen.getByText("目標至少 5 個字")).toBeInTheDocument();
  });

  it("排步驟送出的是上層那一格的文字", async () => {
    const user = userEvent.setup();
    render(
      <AgentCard
        projectId="project-1"
        canEdit
        embedded
        compactComposer
        goal="  把腳本拆成 6 鏡，每鏡出一張定裝一致的圖  "
        onGoalChange={vi.fn()}
        goalInputId="cw-goal"
      />,
    );
    await user.click(screen.getByRole("button", { name: "幫我排步驟" }));
    await user.click(screen.getByRole("button", { name: "排步驟" }));
    expect(planMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        goal: "把腳本拆成 6 鏡，每鏡出一張定裝一致的圖",
      }),
    );
  });
});
