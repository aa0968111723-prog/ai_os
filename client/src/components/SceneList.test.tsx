/**
 * 分鏡・交付（SceneList）深度優化後的三件事：
 * 1. 精簡分鏡格——每格一顆「依狀態決定的主要動作」，深改集中到單格工作室；
 * 2. 流程引導——五階段條與「下一步」提示要指對地方；
 * 3. 交付中心——就緒度講清楚、單檔收進進階摺疊。
 * 隔離 trpc mock；SceneStudio／StoryboardPlayer 用 stub（各自有獨立測試）。
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SceneList } from "./SceneList";

const scenesQuery = vi.fn();
const approvalsQuery = vi.fn();
const meQuery = vi.fn();
const updateMutate = vi.fn();
const generateMutate = vi.fn();
const moveMutate = vi.fn();
const removeMutate = vi.fn();
const submitMutate = vi.fn();
const decideMutate = vi.fn();
const exportCreateMutate = vi.fn();
const invalidate = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      scenes: { listByProject: { invalidate } },
      approvals: { listByProject: { invalidate } },
      messages: { list: { invalidate } },
      projects: { listDeleted: { invalidate } },
    }),
    auth: { me: { useQuery: (...args: unknown[]) => meQuery(...args) } },
    scenes: {
      listByProject: { useQuery: (...args: unknown[]) => scenesQuery(...args) },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false, error: null }) },
      generateInto: { useMutation: () => ({ mutate: generateMutate, isPending: false, error: null }) },
      move: { useMutation: () => ({ mutate: moveMutate, isPending: false, error: null }) },
      remove: { useMutation: () => ({ mutate: removeMutate, isPending: false, error: null }) },
    },
    approvals: {
      listByProject: { useQuery: (...args: unknown[]) => approvalsQuery(...args) },
      submit: { useMutation: () => ({ mutate: submitMutate, isPending: false, error: null }) },
      decide: { useMutation: () => ({ mutate: decideMutate, isPending: false, error: null }) },
    },
    exportJobs: {
      create: { useMutation: () => ({ mutate: exportCreateMutate, isPending: false, error: null }) },
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      cancel: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
  },
}));
vi.mock("./SceneStudio", () => ({
  SceneStudio: ({ sceneNumber }: { sceneNumber: number }) => <div role="dialog" aria-label={`單格工作室 stub 第 ${sceneNumber} 鏡`} />,
}));
vi.mock("./StoryboardPlayer", () => ({ StoryboardPlayer: () => <div aria-label="粗剪預覽 stub" /> }));
vi.mock("../discuss", () => ({ discussInMessages: vi.fn() }));

type SceneOver = {
  id: string;
  title?: string;
  status?: string;
  hasAsset?: boolean;
  prompt?: string | null;
  voiceover?: string | null;
  narrationAssetId?: string | null;
};

function scene(over: SceneOver) {
  const hasAsset = over.hasAsset ?? true;
  return {
    id: over.id,
    title: over.title ?? `鏡 ${over.id}`,
    orderIndex: 0,
    durationSec: 5,
    status: over.status ?? "todo",
    assetId: hasAsset ? `asset-${over.id}` : null,
    prompt: over.prompt === undefined ? "海邊遠景" : over.prompt,
    voiceover: over.voiceover ?? null,
    assetUrl: hasAsset ? `https://example.test/${over.id}.png` : null,
    assetKind: hasAsset ? "image" : null,
    generationId: null,
    pendingGenStatus: null,
    narrationAssetId: over.narrationAssetId ?? null,
    narrationUrl: null,
    pendingVoiceStatus: null,
  };
}

function mount(over: { isLeader?: boolean; canEdit?: boolean } = {}) {
  return render(
    <SceneList projectId="p-1" isLeader={over.isLeader ?? false} canEdit={over.canEdit ?? true} />,
  );
}

const rowOf = (id: string) => {
  const el = document.getElementById(`scene-${id}`);
  if (!el) throw new Error(`scene-${id} not rendered`);
  return within(el as HTMLElement);
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  meQuery.mockReturnValue({ isLoading: false, data: { id: "u-1" } });
  scenesQuery.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
  approvalsQuery.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
});

describe("SceneList 流程引導（C）", () => {
  it("有鏡沒畫面：流程條停在「補畫面」，提示帶數字並可一鍵只看無畫面", async () => {
    const user = userEvent.setup();
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", hasAsset: false }), scene({ id: "s2" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    expect(screen.getByText("補畫面").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/還有 1 鏡沒有畫面/)).toBeInTheDocument();
    // 一鍵切到「無畫面」篩選：只剩 s1
    await user.click(screen.getByRole("button", { name: "只看這些" }));
    expect(document.getElementById("scene-s1")).toBeInTheDocument();
    expect(document.getElementById("scene-s2")).not.toBeInTheDocument();
  });

  it("填了配音詞還沒生成旁白：流程條停在「配音」，指路單格工作室", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", voiceover: "大家好" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    expect(screen.getByText("配音").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/1 鏡已填配音詞、還沒生成旁白/)).toBeInTheDocument();
    // 該格 meta 也標出旁白狀態
    expect(rowOf("s1").getByText("旁白未生成")).toBeInTheDocument();
  });

  it("全部通過：流程條到「打包交付」，交付中心亮綠", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", status: "approved" }), scene({ id: "s2", status: "approved", voiceover: "好", narrationAssetId: "n-1" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    expect(screen.getByText("打包交付").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/全部 2 鏡已通過審核，可以打包交付/)).toBeInTheDocument();
    expect(rowOf("s2").getByText("旁白 ✓")).toBeInTheDocument();
  });
});

describe("SceneList 精簡分鏡格（A）：一顆依狀態決定的主要動作", () => {
  it("無畫面有提示詞→生成這一格；有畫面草稿→送審", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", hasAsset: false }), scene({ id: "s2" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    expect(rowOf("s1").getByRole("button", { name: /^生成這一格/ })).toBeInTheDocument();
    expect(rowOf("s1").queryByRole("button", { name: "送審" })).not.toBeInTheDocument();
    expect(rowOf("s2").getByRole("button", { name: "送審" })).toBeInTheDocument();
  });

  it("無畫面也沒提示詞→主動作改成開單格工作室寫提示詞", async () => {
    const user = userEvent.setup();
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", hasAsset: false, prompt: null })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    await user.click(rowOf("s1").getByRole("button", { name: /寫提示詞出圖/ }));
    expect(screen.getByRole("dialog", { name: /單格工作室 stub 第 1 鏡/ })).toBeInTheDocument();
  });

  it("被退回：主動作是去修這一格＋重送審，退回理由就地顯示", async () => {
    const user = userEvent.setup();
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", status: "needs_work" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    approvalsQuery.mockReturnValue({
      data: [{ id: "ap1", sceneId: "s1", status: "needs_work", reason: "文字有錯字" }],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    expect(rowOf("s1").getByText(/文字有錯字/)).toBeInTheDocument();
    expect(rowOf("s1").getByRole("button", { name: "重送審" })).toBeInTheDocument();
    await user.click(rowOf("s1").getByRole("button", { name: /去修這一格/ }));
    expect(screen.getByRole("dialog", { name: /單格工作室 stub/ })).toBeInTheDocument();
  });

  it("待審＋組長：通過／退回就在格上；非組長看不到裁決鈕", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", status: "pending" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    approvalsQuery.mockReturnValue({
      data: [{ id: "ap1", sceneId: "s1", status: "pending" }],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    const first = mount({ isLeader: true });
    expect(rowOf("s1").getByRole("button", { name: /通過/ })).toBeInTheDocument();
    expect(rowOf("s1").getByRole("button", { name: /退回/ })).toBeInTheDocument();
    first.unmount();
    mount({ isLeader: false });
    expect(rowOf("s1").queryByRole("button", { name: /通過/ })).not.toBeInTheDocument();
  });

  it("檢視者（2.3 唯讀）：沒有任何寫入鈕，仍可開單格工作室、下載與討論", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", status: "approved" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount({ canEdit: false });
    const row = rowOf("s1");
    expect(row.queryByRole("button", { name: "送審" })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "重送新版審核" })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "上移" })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: "刪除" })).not.toBeInTheDocument();
    expect(row.getByRole("button", { name: "單格工作室" })).toBeInTheDocument();
    expect(row.getByText("下載")).toBeInTheDocument();
    expect(row.getByRole("button", { name: /討論/ })).toBeInTheDocument();
  });

  it("點縮圖＝開單格工作室（深改唯一入口）", async () => {
    const user = userEvent.setup();
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    await user.click(rowOf("s1").getByRole("button", { name: /第 1 鏡縮圖/ }));
    expect(screen.getByRole("dialog", { name: /單格工作室 stub 第 1 鏡/ })).toBeInTheDocument();
  });
});

describe("SceneList 交付中心（B）", () => {
  it("未全通過：就緒度列出卡在哪；主 CTA 仍可打包", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", status: "approved" }), scene({ id: "s2", status: "pending" }), scene({ id: "s3", hasAsset: false })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    const deliver = within(screen.getByRole("region", { name: "交付" }));
    expect(deliver.getByText(/已通過 1／3 鏡/)).toBeInTheDocument();
    expect(deliver.getByText(/1 鏡無畫面/)).toBeInTheDocument();
    expect(deliver.getByText(/1 鏡待審/)).toBeInTheDocument();
    expect(deliver.getByRole("button", { name: /打包下載交付包/ })).toBeInTheDocument();
  });

  it("單檔下載收進「進階」摺疊區，預設收合", () => {
    scenesQuery.mockReturnValue({
      data: [scene({ id: "s1", status: "approved" })],
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mount();
    const details = document.querySelector(".scene-deliver__advanced");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText(/進階：只要單檔/)).toBeInTheDocument();
  });
});
