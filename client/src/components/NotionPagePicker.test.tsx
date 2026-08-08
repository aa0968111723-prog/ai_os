import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotionPagePicker } from "./NotionPagePicker";

/** PR-E4 前端關鍵路徑：未設定 Notion 的 CTA、範圍透明文案，以及資料庫（表格）也要能選。 */

const { queryState } = vi.hoisted(() => ({ queryState: { data: null as unknown } }));

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      databases: { listFiles: { invalidate: () => {} } },
      knowledge: { list: { invalidate: () => {} } },
    }),
    integrations: {
      listNotionPages: { useQuery: () => ({ data: queryState.data, error: null, isFetching: false }) },
    },
    databases: {
      importUrl: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false, error: null }) },
    },
    knowledge: {
      importUrl: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false, error: null }) },
    },
  },
}));

describe("NotionPagePicker", () => {
  // 資料中心 P2 契約變更：Notion 沒有 OAuth 重導，但設定頁一樣要能把人送回原本的流程，
  // 所以 CTA 帶 ?return=<目前畫面>（IntegrationsPage 存好 token 後導回）。
  it("未設定：顯示「分享給整合」範圍文案，CTA 帶回跳目的地", () => {
    queryState.data = { ok: false, reason: "not-connected", message: "尚未設定 Notion token" };
    render(<NotionPagePicker tableId="t1" onImported={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/只有「分享給整合」的頁面／資料庫會出現/)).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /連接 Notion/ });
    expect(cta.getAttribute("href")).toContain("/integrations");
    expect(cta.getAttribute("href")).toContain("return=");
  });

  it("專案目的地：主按鈕改成「加入這個專案」", () => {
    queryState.data = {
      ok: true,
      workspace: "弘法工作區",
      pages: [{ id: "p1", title: "劇本初稿", lastEdited: null, type: "page" }],
    };
    render(<NotionPagePicker projectId="proj-1" onImported={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /加入這個專案/ })).toBeInTheDocument();
  });

  it("已連接：顯示 workspace 名稱與頁面列", () => {
    queryState.data = {
      ok: true,
      workspace: "弘法工作區",
      pages: [{ id: "p1", title: "劇本初稿", lastEdited: null, type: "page" }],
    };
    render(<NotionPagePicker tableId="t1" onImported={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/「弘法工作區」workspace/)).toBeInTheDocument();
    expect(screen.getByText("劇本初稿")).toBeInTheDocument();
  });

  // 迴歸：資料庫（表格）曾經整類被濾掉、選頁器裡永遠找不到——列得出來且標示得出來
  it("資料庫可勾選並標示為「資料庫」", () => {
    queryState.data = {
      ok: true,
      workspace: null,
      pages: [
        { id: "db1", title: "影片進度表", lastEdited: null, type: "database" },
        { id: "p1", title: "劇本初稿", lastEdited: null, type: "page" },
      ],
    };
    render(<NotionPagePicker tableId="t1" onImported={() => {}} onClose={() => {}} />);
    expect(screen.getByText("影片進度表")).toBeInTheDocument();
    expect(screen.getByText("資料庫")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });
});
