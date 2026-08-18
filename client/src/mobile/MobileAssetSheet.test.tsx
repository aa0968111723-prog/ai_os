import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const assetsQuery = vi.fn();
const addOpened: string[] = [];

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({ projects: { assets: { invalidate: vi.fn() } } }),
    projects: { assets: { useQuery: (...args: unknown[]) => assetsQuery(...args) } },
  },
}));
vi.mock("../lib/assistantContext", () => ({ registerAssistantFocus: () => {} }));
vi.mock("./MobileAiBar", () => ({ MobileAiBar: () => null }));
vi.mock("../components/AddDataSheet", () => ({
  AddDataSheet: ({ open }: { open: boolean }) => (open ? <div data-testid="add-data-sheet">加入資料</div> : null),
}));

import { MobileAssetSheet } from "./MobileAssetSheet";

beforeEach(() => {
  addOpened.length = 0;
  assetsQuery.mockReturnValue({ data: [], isLoading: false, isFetching: false });
});

describe("手機素材抽屜", () => {
  it("空清單也找得到加入素材，不是只能看圖", () => {
    render(<MobileAssetSheet projectId="p1" onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /加入素材/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /加入素材/ }));
    expect(screen.getByTestId("add-data-sheet")).toBeInTheDocument();
  });
});
