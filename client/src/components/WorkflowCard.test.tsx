/**
 * WB-00 baseline: WorkflowCard template entry, start gate, promptRequest apply.
 * Smoke-tests template execution UI without backend.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowCard } from "./WorkflowCard";

const workflowsQuery = vi.fn();
const runsQuery = vi.fn();
const meQuery = vi.fn();
const startMutate = vi.fn();
const stopMutate = vi.fn();
const invalidate = vi.fn();
const runsRefetch = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      generation: {
        listByProject: { invalidate },
        listByProjectPaged: { invalidate },
      },
      quota: { my: { invalidate } },
      prompts: { list: { invalidate } },
    }),
    models: {
      workflows: {
        useQuery: (...args: unknown[]) => workflowsQuery(...args),
      },
    },
    auth: {
      me: {
        useQuery: (...args: unknown[]) => meQuery(...args),
      },
    },
    workflows: {
      listByProject: {
        useQuery: (...args: unknown[]) => runsQuery(...args),
      },
      start: {
        useMutation: (opts?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            startMutate(input);
            opts?.onSuccess?.();
          },
          isPending: false,
          error: null,
        }),
      },
      stop: {
        useMutation: () => ({
          mutate: stopMutate,
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock("./Icon", () => ({
  Icon: () => <span aria-hidden="true" />,
}));

const sampleWorkflow = {
  id: "wf-storyboard",
  label: "分鏡快速串",
  tierLabel: "經濟",
  points: 12,
  strengths: "固定步驟",
  bestFor: "重複分鏡",
  steps: [{ modelId: "m1" }, { modelId: "m2" }],
};

describe("WorkflowCard", () => {
  beforeEach(() => {
    workflowsQuery.mockReset();
    runsQuery.mockReset();
    meQuery.mockReset();
    startMutate.mockReset();
    stopMutate.mockReset();
    invalidate.mockReset();
    runsRefetch.mockReset();

    workflowsQuery.mockReturnValue({ data: [sampleWorkflow] });
    runsQuery.mockReturnValue({ data: [], refetch: runsRefetch });
    meQuery.mockReturnValue({ data: { user: { id: "user-1" } } });
  });

  it("renders the template entry with selection, idea box, and estimated points", () => {
    render(<WorkflowCard projectId="project-1" />);

    expect(screen.getByRole("heading", { name: /製作範本/ })).toBeVisible();
    expect(screen.getByLabelText("選擇製作範本")).toBeVisible();
    expect(screen.getByRole("option", { name: /經濟・分鏡快速串 — 約 12 點（2 步）/ })).toBeInTheDocument();
    expect(screen.getByLabelText("這次想完成什麼？（一句話）")).toBeVisible();
    expect(screen.getByRole("button", { name: /執行製作範本（約 −12 點）/ })).toBeDisabled();
  });

  it("enables start after idea is filled and submits preset + prompt + char/scene caps", async () => {
    const user = userEvent.setup();
    render(
      <WorkflowCard
        projectId="project-1"
        charIds={["c1", "c2", "c3", "c4", "c5", "c6", "c7"]}
        sceneIds={["s1", "s2", "s3", "s4", "s5"]}
      />,
    );

    expect(screen.getByText(/角色 7/)).toBeVisible();
    expect(screen.getByText(/場景 5/)).toBeVisible();

    await user.type(screen.getByLabelText("這次想完成什麼？（一句話）"), "禪堂香煙");
    const start = screen.getByRole("button", { name: /執行製作範本/ });
    expect(start).toBeEnabled();
    await user.click(start);

    expect(startMutate).toHaveBeenCalledWith({
      projectId: "project-1",
      presetId: sampleWorkflow.id,
      prompt: "禪堂香煙",
      characterIds: ["c1", "c2", "c3", "c4", "c5", "c6"],
      scenePresetIds: ["s1", "s2", "s3", "s4"],
    });
  });

  it("applies promptRequest from 提示詞庫 into the idea box (nonce-driven)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { rerender } = render(
      <WorkflowCard projectId="project-1" promptRequest={{ text: "第一則咒語", nonce: 1 }} />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("這次想完成什麼？（一句話）")).toHaveValue("第一則咒語");
    });

    rerender(
      <WorkflowCard projectId="project-1" promptRequest={{ text: "第二則咒語", nonce: 2 }} />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("這次想完成什麼？（一句話）")).toHaveValue("第二則咒語");
    });
    // second apply asks before overwriting existing idea text (same courtesy as applyPrompt)
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("pre-selects template via pickRequest and shows plan preview steps", async () => {
    const second = {
      id: "wf-quote",
      label: "金句卡",
      tierLabel: "經濟",
      points: 2,
      strengths: "摘句出圖",
      bestFor: "日更",
      steps: [
        { modelId: "nvidia-nim#qwen2.5-72b", note: "摘金句", promptTemplate: "{prompt}" },
        { modelId: "fal-ai/flux/dev", note: "生成底圖", promptTemplate: "{prev}" },
      ],
    };
    workflowsQuery.mockReturnValue({ data: [sampleWorkflow, second] });

    const { rerender } = render(
      <WorkflowCard projectId="project-1" pickRequest={{ templateId: "wf-quote", nonce: 1 }} />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("選擇製作範本")).toHaveValue("wf-quote");
    });
    expect(screen.getByTestId("workflow-plan-preview")).toBeVisible();
    expect(screen.getByText("摘金句")).toBeVisible();
    expect(screen.getByText("生成底圖")).toBeVisible();
    expect(screen.getByText(/預估消耗：約 2 點/)).toBeVisible();
    expect(screen.getByText(/是否需要核准/)).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(/約 2 點/);

    rerender(
      <WorkflowCard projectId="project-1" pickRequest={{ templateId: "wf-storyboard", nonce: 2 }} />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("選擇製作範本")).toHaveValue("wf-storyboard");
    });
  });

  it("surfaces a hint when pickRequest templateId is not in the list", async () => {
    render(
      <WorkflowCard projectId="project-1" pickRequest={{ templateId: "preset-open", nonce: 1 }} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/帶入範本無法對應/)).toBeVisible();
    });
    expect(screen.getByText("preset-open")).toBeInTheDocument();
    // keeps default first preset selected
    expect(screen.getByLabelText("選擇製作範本")).toHaveValue(sampleWorkflow.id);
  });

  it("embedded mode skips outer card chrome", () => {
    const { container } = render(<WorkflowCard projectId="project-1" embedded />);
    expect(container.querySelector("section.card")).toBeNull();
    expect(screen.getByTestId("workflow-card")).toBeInTheDocument();
  });

  it("shows run tracking for an active template and stop mutates with runId", async () => {
    const user = userEvent.setup();
    runsQuery.mockReturnValue({
      data: [
        {
          id: "run-1",
          userId: "user-1",
          presetId: sampleWorkflow.id,
          status: "running",
          prompt: "禪堂",
          createdAt: new Date("2026-01-15T10:00:00Z").toISOString(),
          characterIds: ["c1"],
          scenePresetIds: null,
          steps: [
            { note: "出圖", status: "done", generationId: "g1" },
            { note: "旁白", status: "running", generationId: "g2" },
          ],
          error: null,
        },
      ],
      refetch: runsRefetch,
    });

    render(<WorkflowCard projectId="project-1" />);

    expect(screen.getByText("分鏡快速串")).toBeVisible();
    expect(screen.getByText("執行中")).toBeVisible();
    expect(screen.getByText(/想法：禪堂/)).toBeVisible();
    expect(screen.getByText("出圖")).toBeVisible();
    expect(screen.getByText("旁白")).toBeVisible();
    // own active run disables start
    expect(screen.getByRole("button", { name: /執行製作範本/ })).toBeDisabled();
    expect(screen.getByText("已有一個製作範本在執行")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "停止後續步驟" }));
    expect(stopMutate).toHaveBeenCalledWith({ runId: "run-1" });
  });
});
