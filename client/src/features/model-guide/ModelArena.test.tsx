import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { getModel } from "@shared/models";
import { ModelArena } from "./ModelArena";

const projects = vi.fn();
const benchState = vi.fn();
const mutate = vi.fn();
vi.mock("../../api", () => ({
  trpc: {
    projects: { list: { useQuery: () => ({ data: projects(), isLoading: false }) } },
    generation: { bench: { useMutation: () => ({ ...benchState(), mutate }) } },
    models: { analytics: { useQuery: () => ({ data: undefined, isLoading: false, error: null }) } },
  },
}));

vi.mock("./ModelArenaResults", () => ({
  ModelArenaResults: () => <div data-testid="arena-results" />,
}));

const PROJECT = { id: "11111111-1111-1111-1111-111111111111", title: "禪修短片", status: "active", myProjectRole: "editor" };
// 兩顆真的存在於目錄的模型：點數與來源需求都取自共享目錄，不另外編一份假資料
const FLUX = "fal-ai/flux/dev";
const SCHNELL = "fal-ai/flux/schnell";
const I2I = "fal-ai/flux/dev/image-to-image";

describe("ModelArena", () => {
  it("還沒選模型時，直說要去哪裡選", () => {
    projects.mockReturnValue([PROJECT]);
    benchState.mockReturnValue({ data: undefined, error: null, isPending: false });
    render(<ModelArena groupId="g1" modelIds={[]} onRemove={() => undefined} onClear={() => undefined} />);
    expect(screen.getByText(/還沒選模型/)).toBeInTheDocument();
  });

  it("送出前先把總點數算給使用者看（每一顆都是真的生成）", () => {
    projects.mockReturnValue([PROJECT]);
    benchState.mockReturnValue({ data: undefined, error: null, isPending: false });
    render(<ModelArena groupId="g1" modelIds={[FLUX, SCHNELL]} onRemove={() => undefined} onClear={() => undefined} />);
    const total = (getModel(FLUX)?.points ?? 0) + (getModel(SCHNELL)?.points ?? 0);
    expect(screen.getByRole("button", { name: new RegExp(`同題並跑 2 顆・約 ${total} 點`) })).toBeInTheDocument();
  });

  it("題目沒填就不能送出——避免點了才被伺服器擋", async () => {
    projects.mockReturnValue([PROJECT]);
    benchState.mockReturnValue({ data: undefined, error: null, isPending: false });
    render(<ModelArena groupId="g1" modelIds={[FLUX, SCHNELL]} onRemove={() => undefined} onClear={() => undefined} />);
    const button = screen.getByRole("button", { name: /同題並跑/ });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox", { name: /題目/ }), "竹林晨光");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ modelIds: [FLUX, SCHNELL], prompt: "竹林晨光", projectId: PROJECT.id }),
    );
  });

  it("要素材的模型事前標示，不讓人花點數換一則錯誤訊息", () => {
    projects.mockReturnValue([PROJECT]);
    benchState.mockReturnValue({ data: undefined, error: null, isPending: false });
    render(<ModelArena groupId="g1" modelIds={[FLUX, I2I]} onRemove={() => undefined} onClear={() => undefined} />);
    expect(screen.getByText(/來源素材網址/)).toBeInTheDocument();
    expect(screen.getByText(/沒給的話這幾顆會直接失敗/)).toBeInTheDocument();
  });

  it("封存／唯讀的專案不進下拉選單（送出去也只會被擋）", () => {
    projects.mockReturnValue([
      PROJECT,
      { id: "22222222-2222-2222-2222-222222222222", title: "已封存的專案", status: "archived", myProjectRole: "editor" },
      { id: "33333333-3333-3333-3333-333333333333", title: "我只能看的專案", status: "active", myProjectRole: "viewer" },
    ]);
    benchState.mockReturnValue({ data: undefined, error: null, isPending: false });
    render(<ModelArena groupId="g1" modelIds={[FLUX, SCHNELL]} onRemove={() => undefined} onClear={() => undefined} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("禪修短片");
  });

  it("送出後回報沒跑成的那幾顆，不讓失敗默默消失", () => {
    projects.mockReturnValue([PROJECT]);
    benchState.mockReturnValue({
      data: {
        runId: "44444444-4444-4444-4444-444444444444",
        prompt: "竹林晨光",
        pointsTotal: 34,
        runs: [{ id: "g1", modelId: FLUX, modelLabel: "FLUX.1 dev", status: "queued", pointsEst: 30 }],
        failed: [{ modelId: I2I, modelLabel: "FLUX.1 圖生圖", message: "這顆模型需要來源素材" }],
      },
      error: null,
      isPending: false,
    });
    render(<ModelArena groupId="g1" modelIds={[FLUX, I2I]} onRemove={() => undefined} onClear={() => undefined} />);
    expect(screen.getByText(/1 顆沒送出/)).toBeInTheDocument();
    expect(screen.getByText(/這顆模型需要來源素材/)).toBeInTheDocument();
    expect(screen.getByTestId("arena-results")).toBeInTheDocument();
  });
});
