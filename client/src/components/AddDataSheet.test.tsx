import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddDataSheet } from "./AddDataSheet";

/**
 * ＋加入資料的產品契約：
 * 使用者只被問一個問題（「你想從哪裡加入？」），不必先理解知識庫／素材庫／資料表／整合頁。
 * 連接狀態只講「能不能去挑」，不得被寫成「AI 可以讀你的雲端」。
 */

const { state } = vi.hoisted(() => ({
  state: {
    sources: [
      { id: "google-drive", label: "Google 雲端", configured: true, connected: true, status: "active", detail: "me@gmail.com", count: 1 },
      { id: "notion", label: "Notion", configured: true, connected: false, status: null, detail: null, count: 0 },
      { id: "api", label: "外部 API", configured: true, connected: false, status: null, detail: null, count: 0 },
    ] as unknown,
    projects: [] as unknown,
    addKnowledge: vi.fn(),
  },
}));

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      knowledge: { list: { invalidate: () => {} } },
      projects: { assets: { invalidate: () => {} } },
    }),
    dataHub: {
      sources: { useQuery: () => ({ data: state.sources, isLoading: false, error: null }) },
    },
    projects: {
      list: { useQuery: () => ({ data: state.projects, isLoading: false, error: null }) },
    },
    knowledge: {
      add: {
        useMutation: (opts?: { onSuccess?: (r: { title: string }) => void }) => ({
          isPending: false,
          error: null,
          mutate: (input: unknown) => {
            state.addKnowledge(input);
            opts?.onSuccess?.({ title: "會議紀錄" });
          },
        }),
      },
      importUrl: { useMutation: () => ({ isPending: false, error: null, mutate: () => {} }) },
    },
  },
}));

// 兩個選檔器各有自己的測試；這支關心的是「加入資料」這一層的流程與文案
vi.mock("./GoogleDrivePicker", () => ({
  GoogleDrivePicker: ({ projectId }: { projectId?: string }) => (
    <div data-testid="drive-picker" data-project={projectId} />
  ),
}));
vi.mock("./NotionPagePicker", () => ({
  NotionPagePicker: ({ projectId }: { projectId?: string }) => (
    <div data-testid="notion-picker" data-project={projectId} />
  ),
}));

describe("AddDataSheet", () => {
  beforeEach(() => {
    state.addKnowledge.mockReset();
    state.projects = [];
  });

  it("關閉時什麼都不算繪（不佔畫面、不搶焦點）", () => {
    const { container } = render(
      <AddDataSheet open={false} destination={{ kind: "project", projectId: "p1" }} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("★ 只問「你想從哪裡加入？」——不要求使用者先分辨資料庫／知識庫／整合", () => {
    render(
      <AddDataSheet open destination={{ kind: "project", projectId: "p1", projectTitle: "AI OS" }} onClose={() => {}} />,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("你想從哪裡加入？")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /上傳檔案/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /貼上文字/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Google 雲端/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Notion/ })).toBeInTheDocument();
    // 工程詞彙不該出現在這一層
    expect(screen.queryByText(/知識庫/)).toBeNull();
    expect(screen.queryByText(/資料列/)).toBeNull();
    expect(screen.queryByText(/Embedding|Index|Binding/i)).toBeNull();
  });

  it("專案上下文：直接說明會加到哪個專案，不再另外問一次", () => {
    render(
      <AddDataSheet open destination={{ kind: "project", projectId: "p1", projectTitle: "AI OS" }} onClose={() => {}} />,
    );
    expect(screen.getByText(/加入到「AI OS」/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/加入到哪個專案/)).toBeNull();
  });

  it("★ 連接狀態只講「能不能去挑」，不得暗示 AI 讀得到整顆雲端", () => {
    render(<AddDataSheet open destination={{ kind: "project", projectId: "p1" }} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /Google 雲端.*已連接/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Notion.*尚未連接/ })).toBeInTheDocument();
    expect(screen.getByText(/AI 只讀得到你真正選中並加入的內容/)).toBeInTheDocument();
  });

  it("選 Google 後就地開既有選檔器，並帶著目的專案", async () => {
    const user = userEvent.setup();
    render(<AddDataSheet open destination={{ kind: "project", projectId: "p1" }} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Google 雲端/ }));
    expect(screen.getByTestId("drive-picker")).toHaveAttribute("data-project", "p1");
  });

  it("選 Notion 後就地開既有選頁器", async () => {
    const user = userEvent.setup();
    render(<AddDataSheet open destination={{ kind: "project", projectId: "p1" }} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Notion/ }));
    expect(screen.getByTestId("notion-picker")).toHaveAttribute("data-project", "p1");
  });

  it("貼上文字就地寫進專案（不跳頁）", async () => {
    const user = userEvent.setup();
    const onAdded = vi.fn();
    render(
      <AddDataSheet open destination={{ kind: "project", projectId: "p1" }} onClose={() => {}} onAdded={onAdded} />,
    );
    await user.click(screen.getByRole("button", { name: /貼上文字/ }));
    await user.type(screen.getByLabelText(/這份資料叫什麼/), "會議紀錄");
    await user.type(screen.getByLabelText("內容"), "十月五日討論重點…");
    await user.click(screen.getByRole("button", { name: "加入" }));
    expect(state.addKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", title: "會議紀錄" }),
    );
    expect(onAdded).toHaveBeenCalled();
    expect(screen.getByText(/這個專案的 AI 現在讀得到/)).toBeInTheDocument();
  });

  it("「換一種方式」回到來源清單", async () => {
    const user = userEvent.setup();
    render(<AddDataSheet open destination={{ kind: "project", projectId: "p1" }} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: /貼上文字/ }));
    expect(screen.queryByText("你想從哪裡加入？")).toBeNull();
    await user.click(screen.getByRole("button", { name: /換一種方式/ }));
    expect(screen.getByText("你想從哪裡加入？")).toBeInTheDocument();
  });

  it("Esc 關閉", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AddDataSheet open destination={{ kind: "project", projectId: "p1" }} onClose={onClose} />);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("資料中心入口：先選專案，選完才能開始加入", async () => {
    state.projects = [
      { id: "p1", title: "AI OS", myProjectRole: "editor" },
      { id: "p2", title: "城市微光", myProjectRole: "editor" },
    ];
    const user = userEvent.setup();
    render(<AddDataSheet open destination={{ kind: "hub" }} onClose={() => {}} />);
    const select = screen.getByLabelText(/加入到哪個專案/);
    expect(screen.getByRole("button", { name: /貼上文字/ })).toBeDisabled();
    await user.selectOptions(select, "p2");
    expect(screen.getByRole("button", { name: /貼上文字/ })).toBeEnabled();
  });

  it("★ 唯讀成員的專案不列入目的地（不做一個按了會被後端擋的選項）", () => {
    state.projects = [
      { id: "p1", title: "AI OS", myProjectRole: "viewer" },
      { id: "p2", title: "城市微光", myProjectRole: "editor" },
    ];
    render(<AddDataSheet open destination={{ kind: "hub" }} onClose={() => {}} />);
    expect(screen.getByRole("option", { name: "城市微光" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "AI OS" })).toBeNull();
  });

  it("沒有可編輯的專案時，講清楚下一步而不是給一個空下拉", () => {
    state.projects = [{ id: "p1", title: "AI OS", myProjectRole: "viewer" }];
    render(<AddDataSheet open destination={{ kind: "hub" }} onClose={() => {}} />);
    expect(screen.getByText(/先建立一個專案，再回來加入資料/)).toBeInTheDocument();
  });

  it("結構化資料表／外部 API 只在呼叫端接得住時才出現（不做按了沒反應的按鈕）", async () => {
    state.projects = [{ id: "p1", title: "AI OS", myProjectRole: "editor" }];
    const onOpenTableFlow = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<AddDataSheet open destination={{ kind: "hub" }} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /CSV/ })).toBeNull();

    rerender(
      <AddDataSheet open destination={{ kind: "hub" }} onClose={onClose} onOpenTableFlow={onOpenTableFlow} />,
    );
    await user.click(screen.getByRole("button", { name: /CSV/ }));
    expect(onOpenTableFlow).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("專案內不出現結構化表與外部 API（那兩條留在資料中心的完整入口）", () => {
    render(
      <AddDataSheet
        open
        destination={{ kind: "project", projectId: "p1" }}
        onClose={() => {}}
        onOpenTableFlow={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /CSV/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /外部 API/ })).toBeNull();
  });
});
