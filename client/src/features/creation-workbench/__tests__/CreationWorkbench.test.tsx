import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreationWorkbench } from "../CreationWorkbench";
import { clearDraft, loadDraft, saveDraft, emptyDraft, updateDraft } from "../creationDraft";
import { revealWorkbenchAnchor } from "../workbenchNav";

const listByProject = vi.fn();
const flashAnchor = vi.fn();

const generationSubmit = vi.fn();
const promptsSave = vi.fn();
const scenesAddDraft = vi.fn();

vi.mock("../../../api", () => ({
  trpc: {
    useUtils: () => ({
      prompts: { list: { invalidate: vi.fn() } },
      generation: {
        listByProject: { invalidate: vi.fn() },
        listByProjectPaged: { invalidate: vi.fn() },
      },
      quota: { my: { invalidate: vi.fn() } },
      scenes: { listByProject: { invalidate: vi.fn() } },
    }),
    agents: {
      listByProject: {
        useQuery: (...args: unknown[]) => listByProject(...args),
      },
    },
    projects: {
      assets: {
        useQuery: () => ({ data: [] }),
      },
    },
    quota: {
      my: {
        useQuery: () => ({ data: undefined }),
      },
    },
    // KnowledgeSourceStrip（#251 起掛在生成表單上）會查知識庫清單
    knowledge: {
      list: {
        useQuery: () => ({ data: [] }),
      },
    },
    prompts: {
      save: {
        useMutation: () => ({ mutate: promptsSave, isPending: false }),
      },
    },
    scenes: {
      listByProject: {
        useQuery: () => ({ data: [], isLoading: false, isError: false }),
      },
      addDraft: {
        useMutation: () => ({ mutate: scenesAddDraft, isPending: false }),
      },
    },
    generation: {
      // P2 recent strip shares this key with GenerationList
      listByProject: {
        useQuery: () => ({ data: [], isLoading: false, isError: false }),
      },
      submit: {
        useMutation: () => ({ mutate: generationSubmit, isPending: false, error: null }),
      },
    },
  },
}));

vi.mock("../../../discuss", () => ({
  flashAnchor: (...args: unknown[]) => flashAnchor(...args),
  // 元件改用「等到看得見再閃」的版本（tabpanel hidden 時 getElementById 照樣找得到，
  // 直接輪詢 flashAnchor 會提早停）。測試裡沒有真的版面，立即委派給同一顆 spy，
  // 既有的「最後有沒有閃到那個錨點」斷言全部照舊成立。
  flashAnchorWhenVisible: (anchorId: string) => {
    flashAnchor(anchorId);
    return () => {};
  },
}));

/** Captures onCreationAction from AskAiMode → ProjectAssistant for bring-in tests. */
let lastAssistantProps: {
  onCreationAction?: (action: import("../creationActions").CreationAction) => void;
  askFillRequest?: { nonce: number; message: string; autoSend?: boolean } | null;
} = {};

vi.mock("../../../components/ProjectAssistant", () => ({
  ProjectAssistant: (props: {
    onCreationAction?: (action: import("../creationActions").CreationAction) => void;
    askFillRequest?: { nonce: number; message: string; autoSend?: boolean } | null;
  }) => {
    lastAssistantProps = props;
    return <div data-testid="assistant">assistant</div>;
  },
}));

vi.mock("../../../components/AgentCard", () => ({
  AgentCard: () => <div data-testid="agent-card">agent-card</div>,
}));

vi.mock("../../../components/WorkflowCard", () => ({
  WorkflowCard: (props: {
    projectId: string;
    charIds?: string[];
    sceneIds?: string[];
    embedded?: boolean;
    pickRequest?: { templateId: string; nonce: number } | null;
    promptRequest?: { text: string; nonce: number } | null;
  }) => (
    <div
      data-testid="workflow-card"
      data-project-id={props.projectId}
      data-char-ids={(props.charIds ?? []).join(",")}
      data-scene-ids={(props.sceneIds ?? []).join(",")}
      data-embedded={props.embedded ? "1" : "0"}
      data-template-id={props.pickRequest?.templateId ?? ""}
      data-prompt={props.promptRequest?.text ?? ""}
    >
      workflow-card
    </div>
  ),
}));

vi.mock("../../../components/ModelPicker", () => ({
  ModelPicker: ({
    onChange,
  }: {
    onChange: (m: {
      id: string;
      label: string;
      points: number;
      needs: string | null;
      sourceHint: string | null;
      kind: string;
      tierLabel: string;
      strengths: string;
      verified: boolean;
      recommended: boolean;
    } | null) => void;
  }) => {
    // fire once after mount without useEffect to keep mock simple
    queueMicrotask(() =>
      onChange({
        id: "fal-ai/flux/schnell",
        label: "FLUX Schnell",
        points: 1,
        needs: null,
        sourceHint: null,
        kind: "image",
        tierLabel: "經濟",
        strengths: "快",
        verified: true,
        recommended: true,
      }),
    );
    return <div data-testid="model-picker">model-picker</div>;
  },
}));

vi.mock("../../../components/GenerationList", () => ({
  GenerationList: () => <div data-testid="generation-list">generation-list</div>,
}));

vi.mock("../../../realtime", () => ({
  CollabZone: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("CreationWorkbench", () => {
  const projectId = "project-1";
  const originalSearch = window.location.search;

  const renderWorkbench = (props = {}) =>
    render(<CreationWorkbench projectId={projectId} canEdit groupId="g1" {...props} />);

  beforeEach(() => {
    listByProject.mockReset();
    listByProject.mockReturnValue({ data: [] });
    flashAnchor.mockReset();
    flashAnchor.mockReturnValue(true);
    generationSubmit.mockReset();
    promptsSave.mockReset();
    scenesAddDraft.mockReset();
    lastAssistantProps = {};
    clearDraft(projectId);
    clearDraft("project-2");
    clearDraft("project-3");
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    window.history.replaceState({}, "", "/project/project-1");
  });

  afterEach(() => {
    window.history.replaceState({}, "", `/${originalSearch || ""}`);
    clearDraft(projectId);
  });

  it("renders workbench shell with goal input, mode tabs, and context bar", () => {
    renderWorkbench();

    expect(screen.getByRole("heading", { name: "AI 創作工作台" })).toBeVisible();
    // P1: 預設直接出圖 → 目標框為可選單行
    expect(screen.getByLabelText("這次想完成什麼（可選）")).toBeVisible();
    expect(screen.getByRole("tablist", { name: "AI 創作模式" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /直接出圖/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /一起想/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /套用範本/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /多步開拍/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("group", { name: "AI 創作工作台可連動的專案系統" })).toBeVisible();
    expect(screen.getByText("前往設定")).toBeVisible();
    expect(document.getElementById("sec-ai-hub")).toBeTruthy();
    expect(document.getElementById("sec-assistant")).toBeTruthy();
    expect(document.getElementById("sec-agent")).toBeTruthy();
  });

  /**
   * 實測回報「不知道該如何使用在專案上」的直接解答：四個模式的上下文語意不同，
   * 而直接出圖／套範本完全不讀專案依據與資料表。切模式時這行必須跟著變，
   * 否則使用者只會體驗到「有時候有用、有時候沒用」。語意本體有 aiContextSummary.test.ts。
   */
  it("切模式時「本次 AI 會讀到」跟著變", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    const line = () => screen.getByTestId("ai-context-line").getAttribute("aria-label") ?? "";
    expect(line()).toContain("不含專案依據與團隊資料表");

    await user.click(screen.getByRole("tab", { name: /一起想/ }));
    expect(line()).toContain("專案依據");
    expect(line()).not.toContain("不含");
  });

  /**
   * QA 2026-08-01：頂部「你想完成什麼畫面？」先前只把字鏡射到下面的模式面板，本身沒有送出行為，
   * 使用者回報「上面那個框不能用」。以下四個案例釘住「每個模式按下去各自會做什麼」。
   */
  it("目標框送出：一起想＝直接問 AI（免費，autoSend）", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    await user.click(screen.getByRole("tab", { name: /一起想/ }));
    await user.type(screen.getByLabelText("你想完成什麼畫面？"), "幫我想三個開場鏡頭");
    await user.click(screen.getByRole("button", { name: "問 AI" }));

    await waitFor(() => {
      expect(lastAssistantProps.askFillRequest?.message).toBe("幫我想三個開場鏡頭");
    });
    expect(lastAssistantProps.askFillRequest?.autoSend).toBe(true);
  });

  it("目標框送出：直接出圖＝只帶入提示詞，不自動生成（會扣點的動作要使用者自己按）", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    // P1: 預設已是直接出圖；compact 單行 + 帶入提示詞
    await user.type(screen.getByLabelText("這次想完成什麼（可選）"), "清晨公園長椅靜坐");
    await user.click(screen.getByRole("button", { name: "帶入提示詞" }));

    await waitFor(() => {
      expect(loadDraft(projectId).prompt).toBe("清晨公園長椅靜坐");
    });
    expect(generationSubmit).not.toHaveBeenCalled();
  });

  it("目標框送出：套用範本＝帶入想法欄，不自動執行", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    await user.click(screen.getByRole("tab", { name: /套用範本/ }));
    await user.type(screen.getByLabelText("你想完成什麼畫面？"), "做一張金句卡");
    await user.click(screen.getByRole("button", { name: "帶入範本" }));

    await waitFor(() => {
      expect(screen.getByTestId("workflow-card")).toHaveAttribute("data-prompt", "做一張金句卡");
    });
  });

  it("目標框：沒打字時送出鈕不可按（不會送出空目標）", () => {
    renderWorkbench();
    // P1: 預設 generate → 帶入提示詞
    expect(screen.getByRole("button", { name: "帶入提示詞" })).toBeDisabled();
  });

  it("shows only the active mode panel", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    // P1: default generate
    const generateTab = screen.getByRole("tab", { name: /直接出圖/ });
    expect(generateTab).toHaveAttribute("aria-selected", "true");
    const genPanel = screen.getByRole("tabpanel", { name: /直接出圖/ });
    expect(genPanel).not.toHaveAttribute("hidden");
    expect(document.getElementById("sec-studio")).toBeTruthy();
    expect(within(genPanel).getByTestId("model-picker")).toBeVisible();
    expect(document.getElementById("gen-prompt")).toBeTruthy();

    const askTab = screen.getByRole("tab", { name: /一起想/ });
    await user.click(askTab);
    expect(askTab).toHaveAttribute("aria-selected", "true");
    const askPanel = screen.getByRole("tabpanel", { name: /一起想/ });
    expect(askPanel).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("assistant")).toBeVisible();

    const panels = document.querySelectorAll('[role="tabpanel"]');
    const visible = [...panels].filter((p) => !p.hasAttribute("hidden"));
    expect(visible).toHaveLength(1);
    expect(screen.getByTestId("assistant")).toBeInTheDocument();
    expect(generateTab).toHaveAttribute("aria-selected", "false");
  });

  it("persists goal across mode switch and collapse", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    // Start on generate (compact), type goal, switch away and back
    const goal = screen.getByLabelText("這次想完成什麼（可選）");
    await user.type(goal, "拆分鏡並出圖");
    expect(goal).toHaveValue("拆分鏡並出圖");

    await user.click(screen.getByRole("tab", { name: /一起想/ }));
    expect(screen.getByLabelText("你想完成什麼畫面？")).toHaveValue("拆分鏡並出圖");

    await user.click(screen.getByRole("tab", { name: /直接出圖/ }));
    expect(screen.getByLabelText("這次想完成什麼（可選）")).toHaveValue("拆分鏡並出圖");
    const generatePanel = screen.getByRole("tabpanel", { name: /直接出圖/ });
    expect(within(generatePanel).getByText(/目前目標/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "收合" }));
    expect(document.querySelector("#sec-ai-hub-body")).toHaveAttribute("hidden");
    expect(screen.getByText(/草稿與模式已保留/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "展開" }));
    expect(screen.getByLabelText("這次想完成什麼（可選）")).toHaveValue("拆分鏡並出圖");
    expect(screen.getByRole("tab", { name: /直接出圖/ })).toHaveAttribute("aria-selected", "true");

    await waitFor(() => {
      const stored = loadDraft(projectId);
      expect(stored.goal).toBe("拆分鏡並出圖");
      expect(stored.mode).toBe("generate");
    });
  });

  it("generate form prompt survives mode switch (draft persistence)", async () => {
    const user = userEvent.setup();
    renderWorkbench();
    // Already on generate by default

    const prompt = document.getElementById("gen-prompt") as HTMLTextAreaElement;
    expect(prompt).toBeTruthy();
    await user.type(prompt, "禪堂清晨");
    expect(prompt).toHaveValue("禪堂清晨");

    await user.click(screen.getByRole("tab", { name: /一起想/ }));
    await user.click(screen.getByRole("tab", { name: /直接出圖/ }));
    expect((document.getElementById("gen-prompt") as HTMLTextAreaElement).value).toBe("禪堂清晨");

    await waitFor(() => {
      expect(loadDraft(projectId).prompt).toBe("禪堂清晨");
    });
  });

  it("restores draft from storage on remount", async () => {
    saveDraft(projectId, {
      ...emptyDraft("template"),
      goal: "用範本跑片頭",
    });
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByLabelText("你想完成什麼畫面？")).toHaveValue("用範本跑片頭");
    });
    expect(screen.getByRole("tab", { name: /套用範本/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("workflow-card")).toBeInTheDocument();
    expect(document.getElementById("sec-workflow")).toBeTruthy();
  });

  it("supports arrow keys on mode tabs", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    // P1 tab order: generate → ask → template → plan
    const generate = screen.getByRole("tab", { name: /直接出圖/ });
    generate.focus();
    expect(generate).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /一起想/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /一起想/ })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /套用範本/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: /多步開拍/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: /直接出圖/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: /多步開拍/ })).toHaveAttribute("aria-selected", "true");
  });

  it("direct generate mode hosts #sec-studio form (no jump button)", async () => {
    const user = userEvent.setup();
    renderWorkbench();
    // default generate — still click to be explicit

    expect(document.getElementById("sec-studio")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /前往創作生成台/ })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/預估消耗/);
  });

  it("template mode embeds WorkflowCard with projectId/charIds/sceneIds and #sec-workflow", async () => {
    const user = userEvent.setup();
    renderWorkbench({ characterIds: ["c1", "c2"], scenePresetIds: ["s1"] });
    await user.click(screen.getByRole("tab", { name: /套用範本/ }));

    const card = screen.getByTestId("workflow-card");
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute("data-project-id", projectId);
    expect(card).toHaveAttribute("data-char-ids", "c1,c2");
    expect(card).toHaveAttribute("data-scene-ids", "s1");
    expect(card).toHaveAttribute("data-embedded", "1");
    expect(document.getElementById("sec-workflow")).toBeTruthy();
    expect(document.getElementById("sec-workflow")?.contains(card)).toBe(true);
    expect(screen.queryByRole("button", { name: /前往套用範本/ })).toBeNull();
  });

  it("template mode pre-selects draft.templateId; goal is hint-only until 帶入想法", async () => {
    const user = userEvent.setup();
    saveDraft(projectId, {
      ...emptyDraft("template"),
      goal: "禪堂香煙範本目標",
      templateId: "wf/quote-card-economy",
    });
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /套用範本/ })).toHaveAttribute("aria-selected", "true");
    });

    const card = screen.getByTestId("workflow-card");
    await waitFor(() => {
      expect(card).toHaveAttribute("data-template-id", "wf/quote-card-economy");
    });
    // Goal is display-only — does not auto-write idea box on restore/keystrokes
    expect(card).toHaveAttribute("data-prompt", "");
    expect(screen.getByRole("button", { name: "帶入想法" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "帶入想法" }));
    await waitFor(() => {
      expect(card).toHaveAttribute("data-prompt", "禪堂香煙範本目標");
    });
  });

  it("goal keystrokes do not auto-fill idea box (no continuous confirm spam)", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWorkbench();
    await user.click(screen.getByRole("tab", { name: /套用範本/ }));

    const goal = screen.getByLabelText("你想完成什麼畫面？");
    await user.type(goal, "abc");

    const card = screen.getByTestId("workflow-card");
    expect(card).toHaveAttribute("data-prompt", "");
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("CreationAction run_template bring-in switches mode and wires templateId/goal without start", async () => {
    renderWorkbench({ characterIds: ["c1"], scenePresetIds: ["s1"] });

    act(() => {
      lastAssistantProps.onCreationAction!({
        type: "run_template",
        templateId: "wf/full-short-economy",
        goal: "帶入範本目標",
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /套用範本/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(generationSubmit).not.toHaveBeenCalled();

    const card = screen.getByTestId("workflow-card");
    await waitFor(() => {
      expect(card).toHaveAttribute("data-template-id", "wf/full-short-economy");
      expect(card).toHaveAttribute("data-prompt", "帶入範本目標");
    });
    await waitFor(() => {
      const stored = loadDraft(projectId);
      expect(stored.templateId).toBe("wf/full-short-economy");
      expect(stored.goal).toBe("帶入範本目標");
      expect(stored.mode).toBe("template");
    });
  });

  it("PromptLibrary sticky request does not shadow later run_template idea fill", async () => {
    const { rerender } = render(
      <CreationWorkbench
        projectId={projectId}
        canEdit
        groupId="g1"
        workflowPromptRequest={{ text: "庫裡的咒語", nonce: 1 }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("workflow-card")).toHaveAttribute("data-prompt", "庫裡的咒語");
    });

    // sticky prop still truthy (same nonce) — later run_template must still win
    act(() => {
      lastAssistantProps.onCreationAction!({
        type: "run_template",
        templateId: "wf/full-short-economy",
        goal: "新的帶入目標",
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /套用範本/ })).toHaveAttribute("aria-selected", "true");
    });
    await waitFor(() => {
      expect(screen.getByTestId("workflow-card")).toHaveAttribute("data-prompt", "新的帶入目標");
    });

    // sticky parent re-render with same nonce must not re-overwrite
    rerender(
      <CreationWorkbench
        projectId={projectId}
        canEdit
        groupId="g1"
        workflowPromptRequest={{ text: "庫裡的咒語", nonce: 1 }}
      />,
    );
    expect(screen.getByTestId("workflow-card")).toHaveAttribute("data-prompt", "新的帶入目標");
  });

  it("revealWorkbenchAnchor(#sec-workflow) switches to template and unhides panel", async () => {
    renderWorkbench();
    const hiddenTemplate = document.getElementById("sec-workflow")?.closest('[role="tabpanel"]');
    expect(hiddenTemplate).toHaveAttribute("hidden");

    act(() => {
      revealWorkbenchAnchor("#sec-workflow", { projectId });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /套用範本/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(document.getElementById("sec-workflow")?.closest("[hidden]")).toBeNull();
    await waitFor(() => {
      expect(document.getElementById("sec-workflow")?.scrollIntoView).toHaveBeenCalled();
    });
  });

  it("plan mode embeds agent card and opens on activity", async () => {
    listByProject.mockReturnValue({
      data: [
        { id: "run-1", status: "running" },
        { id: "run-2", status: "awaiting_approval" },
      ],
    });
    const user = userEvent.setup();
    renderWorkbench();

    expect(screen.getAllByText("執行中 1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("待核准 1").length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("tab", { name: /多步開拍/ }));
    expect(screen.getByTestId("agent-card")).toBeInTheDocument();
    // 多步開拍：#sec-agent 常駐可見（非 details 收合）
    expect(document.querySelector("#sec-agent")).toBeTruthy();
    expect(document.getElementById("sec-agent")?.closest('[role="tabpanel"]')).not.toHaveAttribute("hidden");
  });

  it("plan panel stays mounted and visible while activity continues", async () => {
    let data = [{ id: "run-1", status: "running" }];
    listByProject.mockImplementation(() => ({ data }));
    const { rerender } = renderWorkbench();

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /多步開拍/ }));
    expect(document.querySelector("#sec-agent")).toBeTruthy();
    expect(screen.getByTestId("agent-card")).toBeInTheDocument();

    data = [
      { id: "run-1", status: "running" },
      { id: "run-2", status: "awaiting_approval" },
    ];
    rerender(<CreationWorkbench projectId={projectId} canEdit groupId="g1" />);
    expect(document.querySelector("#sec-agent")).toBeTruthy();
    expect(screen.getAllByText(/待核准|等你/).length).toBeGreaterThanOrEqual(1);
  });

  it("focus=agent-run-* deep link switches to plan and flashes anchor", async () => {
    window.history.replaceState({}, "", "/project/project-1?focus=agent-run-abc123");
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /多步開拍/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(document.querySelector("#sec-ai-hub-body")).not.toHaveAttribute("hidden");
    expect(document.querySelector("#sec-agent")).toBeTruthy();
    await waitFor(() => {
      expect(flashAnchor).toHaveBeenCalledWith("agent-run-abc123");
    });
  });

  it("ignores non agent-run focus query params", () => {
    window.history.replaceState({}, "", "/project/project-1?focus=generation-xyz");
    renderWorkbench();

    expect(screen.getByRole("tab", { name: /直接出圖/ })).toHaveAttribute("aria-selected", "true");
    expect(flashAnchor).not.toHaveBeenCalled();
  });

  it.each([
    // C2：① 錨點走 project-context-reveal → flashAnchor；分鏡仍純捲動
    { label: "知識", anchorId: "sec-knowledge", via: "reveal" as const },
    { label: "素材", anchorId: "sec-assets", via: "reveal" as const },
    { label: "分鏡與交付", anchorId: "stage-deliver", via: "scroll" as const },
  ] as const)("context chip $label navigates to #$anchorId", async ({ label, anchorId, via }) => {
    const user = userEvent.setup();
    renderWorkbench();
    const target = document.createElement("div");
    target.id = anchorId;
    document.body.appendChild(target);

    await user.click(screen.getByRole("button", { name: label }));
    if (via === "reveal") {
      await waitFor(() => expect(flashAnchor).toHaveBeenCalledWith(anchorId));
    } else {
      await waitFor(() => expect(target.scrollIntoView).toHaveBeenCalled());
    }
    target.remove();
  });

  it("collapse preserves mounted assistant content", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    const body = document.querySelector("#sec-ai-hub-body");
    expect(body).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("assistant")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收合" }));
    expect(body).toHaveAttribute("hidden");
    expect(screen.getByTestId("assistant")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展開" }));
    expect(body).not.toHaveAttribute("hidden");
  });

  it("revealWorkbenchAnchor(#sec-agent) from other mode shows plan panel (GenerationList path)", async () => {
    renderWorkbench();
    // default generate — plan panel hidden
    expect(screen.getByRole("tab", { name: /直接出圖/ })).toHaveAttribute("aria-selected", "true");
    const hiddenPlan = document.getElementById("sec-agent")?.closest('[role="tabpanel"]');
    expect(hiddenPlan).toHaveAttribute("hidden");

    act(() => {
      revealWorkbenchAnchor("#sec-agent", { projectId });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /多步開拍/ })).toHaveAttribute("aria-selected", "true");
    });
    const planPanel = screen.getByRole("tabpanel", { name: /多步開拍/ });
    expect(planPanel).not.toHaveAttribute("hidden");
    expect(document.getElementById("sec-agent")?.closest("[hidden]")).toBeNull();
    expect(document.querySelector("#sec-agent")).toBeTruthy();
    await waitFor(() => {
      expect(document.getElementById("sec-agent")?.scrollIntoView).toHaveBeenCalled();
    });
  });

  it("revealWorkbenchAnchor(#sec-studio) switches to generate mode", async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole("tab", { name: /一起想/ }));
    expect(screen.getByRole("tab", { name: /一起想/ })).toHaveAttribute("aria-selected", "true");

    act(() => {
      revealWorkbenchAnchor("#sec-studio", { projectId });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /直接出圖/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByRole("tabpanel", { name: /直接出圖/ })).not.toHaveAttribute("hidden");
    expect(document.getElementById("sec-studio")?.closest("[hidden]")).toBeNull();
  });

  it("revealWorkbenchAnchor(#gen-prompt) unhides generate form (onboard / deep-link path)", async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole("tab", { name: /一起想/ }));
    expect(screen.getByRole("tab", { name: /一起想/ })).toHaveAttribute("aria-selected", "true");
    // Prompt exists but is under a hidden tabpanel while ask is active
    expect(document.getElementById("gen-prompt")?.closest("[hidden]")).not.toBeNull();

    act(() => {
      revealWorkbenchAnchor("#gen-prompt", { projectId });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /直接出圖/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByRole("tabpanel", { name: /直接出圖/ })).not.toHaveAttribute("hidden");
    expect(document.getElementById("gen-prompt")?.closest("[hidden]")).toBeNull();
    expect(document.getElementById("sec-studio")?.closest("[hidden]")).toBeNull();
  });

  it("revealWorkbenchAnchor(#sec-assistant) switches to ask mode", async () => {
    renderWorkbench();
    // default generate
    expect(screen.getByRole("tab", { name: /直接出圖/ })).toHaveAttribute("aria-selected", "true");

    act(() => {
      revealWorkbenchAnchor("#sec-assistant", { projectId });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /一起想/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByRole("tabpanel", { name: /一起想/ })).not.toHaveAttribute("hidden");
    expect(document.getElementById("sec-assistant")?.closest("[hidden]")).toBeNull();
  });

  it("restored plan-mode draft does not force-open empty execution details", () => {
    saveDraft(projectId, { ...emptyDraft("plan"), goal: "restore-plan" });
    renderWorkbench();

    expect(screen.getByRole("tab", { name: /多步開拍/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("你想完成什麼畫面？")).toHaveValue("restore-plan");
    expect(document.querySelector("#sec-agent")).not.toHaveAttribute("open");
  });

  it("tab aria-controls matches tabpanel id", () => {
    renderWorkbench();
    // Selected tab (default generate) owns the visible panel
    const tab = screen.getByRole("tab", { name: /直接出圖/ });
    const controls = tab.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    const panel = document.getElementById(controls!);
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(panel).not.toHaveAttribute("hidden");
  });

  it("switches draft when projectId prop changes without cross-bleed", async () => {
    saveDraft("project-1", { ...emptyDraft("ask"), goal: "goal-one" });
    saveDraft("project-2", { ...emptyDraft("generate"), goal: "goal-two" });

    const { rerender } = render(<CreationWorkbench projectId="project-1" canEdit groupId="g1" />);
    expect(screen.getByLabelText("你想完成什麼畫面？")).toHaveValue("goal-one");
    expect(screen.getByRole("tab", { name: /一起想/ })).toHaveAttribute("aria-selected", "true");

    rerender(<CreationWorkbench projectId="project-2" canEdit groupId="g1" />);
    await waitFor(() => {
      expect(screen.getByLabelText("這次想完成什麼（可選）")).toHaveValue("goal-two");
    });
    expect(screen.getByRole("tab", { name: /直接出圖/ })).toHaveAttribute("aria-selected", "true");

    expect(loadDraft("project-1").goal).toBe("goal-one");
  });

  it("CreationAction generate bring-in fills draft, switches mode, does not submit", async () => {
    const { generateBringInAction } = await import("../creationActions");
    renderWorkbench({ characterIds: ["c1"], scenePresetIds: ["s1"] });

    expect(lastAssistantProps.onCreationAction).toBeTypeOf("function");

    act(() => {
      lastAssistantProps.onCreationAction!(
        generateBringInAction({
          prompt: "AI 建議分鏡：香爐特寫",
          modelId: "fal-ai/flux/schnell",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /直接出圖/ })).toHaveAttribute("aria-selected", "true");
    });
    expect((document.getElementById("gen-prompt") as HTMLTextAreaElement).value).toBe(
      "AI 建議分鏡：香爐特寫",
    );
    expect(generationSubmit).not.toHaveBeenCalled();

    await waitFor(() => {
      const stored = loadDraft(projectId);
      expect(stored.prompt).toBe("AI 建議分鏡：香爐特寫");
      expect(stored.modelId).toBe("fal-ai/flux/schnell");
      expect(stored.mode).toBe("generate");
      // Page-mirrored picks still present after bring-in
      expect(stored.characterIds).toEqual(["c1"]);
      expect(stored.scenePresetIds).toEqual(["s1"]);
    });
  });

  it("CreationAction create_plan bring-in switches to plan without agents.plan", async () => {
    renderWorkbench();

    act(() => {
      lastAssistantProps.onCreationAction!({
        type: "create_plan",
        goal: "把腳本拆成分鏡並出圖",
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /多步開拍/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByLabelText("你想完成什麼畫面？")).toHaveValue("把腳本拆成分鏡並出圖");
    expect(document.querySelector("#sec-agent")).toBeTruthy();
    expect(generationSubmit).not.toHaveBeenCalled();
  });

  it("planBringInAction with partial prompt/model preserves page character/scene picks", async () => {
    const { planBringInAction } = await import("../creationActions");
    renderWorkbench({ characterIds: ["c-keep"], scenePresetIds: ["s-keep"] });

    // Wait for page pick mirror into draft
    await waitFor(() => {
      expect(loadDraft(projectId).characterIds).toEqual(["c-keep"]);
    });

    act(() => {
      lastAssistantProps.onCreationAction!(
        planBringInAction("計畫目標", { prompt: "建議文字", modelId: "m-plan" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /多步開拍/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(generationSubmit).not.toHaveBeenCalled();
    await waitFor(() => {
      const stored = loadDraft(projectId);
      expect(stored.goal).toBe("計畫目標");
      expect(stored.prompt).toBe("建議文字");
      expect(stored.characterIds).toEqual(["c-keep"]);
      expect(stored.scenePresetIds).toEqual(["s-keep"]);
    });
  });

  it("cross-mode: goal/prompt/model survive tab switches after bring-in", async () => {
    const user = userEvent.setup();
    const { generateBringInAction } = await import("../creationActions");
    renderWorkbench();

    act(() => {
      lastAssistantProps.onCreationAction!(
        generateBringInAction({
          prompt: "跨模式提示",
          modelId: "m-cross",
          goal: "共享目標",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /直接出圖/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByLabelText("這次想完成什麼（可選）")).toHaveValue("共享目標");
    expect((document.getElementById("gen-prompt") as HTMLTextAreaElement).value).toBe("跨模式提示");

    await user.click(screen.getByRole("tab", { name: /套用範本/ }));
    expect(screen.getByLabelText("你想完成什麼畫面？")).toHaveValue("共享目標");

    await user.click(screen.getByRole("tab", { name: /多步開拍/ }));
    expect(screen.getByLabelText("你想完成什麼畫面？")).toHaveValue("共享目標");

    await user.click(screen.getByRole("tab", { name: /直接出圖/ }));
    expect(screen.getByLabelText("這次想完成什麼（可選）")).toHaveValue("共享目標");
    expect((document.getElementById("gen-prompt") as HTMLTextAreaElement).value).toBe("跨模式提示");
    expect(generationSubmit).not.toHaveBeenCalled();

    await waitFor(() => {
      const stored = loadDraft(projectId);
      expect(stored.goal).toBe("共享目標");
      expect(stored.prompt).toBe("跨模式提示");
      // modelId may be synced from ModelPicker once generate panel is active (mock defaults to flux)
      expect(stored.modelId).toBeTruthy();
    });
  });
});

describe("creationDraft helpers", () => {
  afterEach(() => {
    clearDraft("p-a");
    clearDraft("p-b");
  });

  it("emptyDraft defaults to generate (P1 main path)", () => {
    expect(emptyDraft().mode).toBe("generate");
    expect(emptyDraft("ask").mode).toBe("ask");
  });

  it("load/save/update round-trip", () => {
    expect(loadDraft("p-a").goal).toBe("");
    expect(loadDraft("p-a").mode).toBe("generate");
    saveDraft("p-a", { ...emptyDraft("ask"), goal: "hello", modelId: "m1" });
    expect(loadDraft("p-a").goal).toBe("hello");
    expect(loadDraft("p-a").modelId).toBe("m1");

    const next = updateDraft("p-a", { mode: "plan", prompt: "x" });
    expect(next.mode).toBe("plan");
    expect(next.goal).toBe("hello");
    expect(next.prompt).toBe("x");
  });

  it("isolates drafts by projectId", () => {
    saveDraft("p-a", { ...emptyDraft("ask"), goal: "alpha" });
    saveDraft("p-b", { ...emptyDraft("template"), goal: "beta" });
    expect(loadDraft("p-a").goal).toBe("alpha");
    expect(loadDraft("p-a").mode).toBe("ask");
    expect(loadDraft("p-b").goal).toBe("beta");
    expect(loadDraft("p-b").mode).toBe("template");
    updateDraft("p-a", { goal: "alpha-2" });
    expect(loadDraft("p-b").goal).toBe("beta");
  });
});
