import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotionPagePicker } from "./NotionPagePicker";

/** PR-E4 前端關鍵路徑：未設定 Notion 的 CTA 與範圍透明文案。 */

const { queryState } = vi.hoisted(() => ({ queryState: { data: null as unknown } }));

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({ databases: { listFiles: { invalidate: () => {} } } }),
    integrations: {
      listNotionPages: { useQuery: () => ({ data: queryState.data, error: null, isFetching: false }) },
    },
    databases: {
      importUrl: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false, error: null }) },
    },
  },
}));

describe("NotionPagePicker", () => {
  it("未設定：顯示「分享給整合」範圍文案與前往設定 CTA", () => {
    queryState.data = { ok: false, reason: "not-connected", message: "尚未設定 Notion token" };
    render(<NotionPagePicker tableId="t1" onImported={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/只有「分享給整合」的頁面會出現/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /前往設定 Notion/ })).toHaveAttribute("href", "/integrations");
  });

  it("已連接：顯示 workspace 名稱與頁面列", () => {
    queryState.data = { ok: true, workspace: "弘法工作區", pages: [{ id: "p1", title: "劇本初稿", lastEdited: null }] };
    render(<NotionPagePicker tableId="t1" onImported={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/「弘法工作區」workspace/)).toBeInTheDocument();
    expect(screen.getByText("劇本初稿")).toBeInTheDocument();
  });
});
