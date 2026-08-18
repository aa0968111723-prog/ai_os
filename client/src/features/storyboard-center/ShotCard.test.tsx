/**
 * ShotCard Progressive Disclosure：緊湊面預設精簡、展開後功能仍在。
 * 不測完整 trpc 管線——mutation 以 stub 驗證入口存在與結構 class。
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShotCard, type ShotRow } from "./ShotCard";

const invalidate = vi.fn();
const mutateUpdate = vi.fn();
const mutateRemove = vi.fn();
const mutateInherit = vi.fn();
const mutateSetVisual = vi.fn();
const mutateConfirm = vi.fn();

vi.mock("../../api", () => ({
  trpc: {
    useUtils: () => ({
      scenes: { listByProject: { invalidate } },
      externalIntake: { inbox: { invalidate } },
      projects: { assets: { invalidate } },
      story: { shotAssetSuggestionsBatch: { invalidate } },
    }),
    scenes: {
      update: { useMutation: () => ({ mutate: mutateUpdate, isPending: false, error: null }) },
      remove: { useMutation: () => ({ mutate: mutateRemove, isPending: false, error: null }) },
      inheritFromPrevious: {
        useMutation: () => ({ mutate: mutateInherit, isPending: false, error: null, data: undefined }),
      },
      setVisualFromAsset: {
        useMutation: () => ({ mutate: mutateSetVisual, isPending: false, error: null }),
      },
    },
    externalIntake: {
      confirm: { useMutation: () => ({ mutate: mutateConfirm, isPending: false, error: null }) },
    },
    projects: {
      assets: {
        useQuery: () => ({
          data: [
            { id: "a1", title: "參考圖 A", kind: "image", url: "https://example.com/a1.jpg" },
          ],
          isLoading: false,
        }),
      },
    },
    characters: { list: { useQuery: () => ({ data: [{ id: "c1", name: "阿梅" }] }) } },
    scenePresets: { list: { useQuery: () => ({ data: [{ id: "s1", name: "咖啡店" }] }) } },
    props: { list: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock("../../components/SceneCardBinding", () => ({
  SceneCardBinding: () => <div data-testid="scene-card-binding">世界引用完整面板</div>,
}));

vi.mock("../external-intake/ExternalAssetIntake", () => ({
  ExternalAssetIntake: ({ triggerLabel }: { triggerLabel?: string }) => (
    <button type="button">{triggerLabel ?? "帶入成果"}</button>
  ),
}));

vi.mock("../external-intake/ExternalGenerationLauncher", () => ({
  ExternalGenerationLauncher: () => <button type="button">外部生成</button>,
}));

vi.mock("../external-intake/mediaMetadata", () => ({
  readLocalMediaMetadata: vi.fn(async () => ({})),
}));

function baseShot(over: Partial<ShotRow> = {}): ShotRow {
  return {
    id: "shot-1",
    title: "開場特寫",
    orderIndex: 0,
    durationSec: 3,
    status: "todo",
    prompt: "逆光窗邊",
    action: null,
    dialogue: null,
    voiceover: null,
    assetId: null,
    assetUrl: null,
    assetKind: null,
    characterIds: ["c1"],
    scenePresetIds: ["s1"],
    propIds: [],
    storySceneId: null,
    camera: { shotSize: "特寫" },
    performance: null,
    lookIds: [],
    pendingGenStatus: null,
    rev: 3,
    ...over,
  };
}

const defaultProps = {
  projectId: "p1",
  shotNumber: 1,
  canEdit: true,
  mode: "simple" as const,
  looks: [] as Array<{ id: string; characterId: string; name: string }>,
  characterNames: new Map([["c1", "阿梅"]]),
  onOpenStudio: vi.fn(),
};

describe("ShotCard progressive disclosure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("緊湊面永遠可見：編號、標題、完成度、預覽空狀態、素材庫入口", () => {
    render(<ShotCard {...defaultProps} shot={baseShot()} />);
    const card = screen.getByRole("article");
    expect(within(card).getByText("#1")).toBeInTheDocument();
    expect(within(card).getByDisplayValue("開場特寫")).toBeInTheDocument();
    expect(within(card).getByText("拖入現有素材或點擊生成")).toBeInTheDocument();
    // 緊湊面與展開區都有「從素材庫選用」
    expect(within(card).getAllByRole("button", { name: /從素材庫選用/ }).length).toBeGreaterThanOrEqual(1);
    expect(within(card).getByRole("button", { name: /單格工作室/ })).toBeInTheDocument();
  });

  it("簡單模式預設不展開細節：details 預設收合，點摘要後 open", async () => {
    const user = userEvent.setup();
    // matchMedia 模擬手機 → preferDetailsOpen 在 pro 也會關；simple 一律關
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: q.includes("max-width"),
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    render(<ShotCard {...defaultProps} mode="simple" shot={baseShot()} />);
    const details = screen.getByText("素材與設定").closest("details");
    expect(details).toBeTruthy();
    expect(details).not.toHaveAttribute("open");
    // DOM 內仍有完整區塊（details 語意），但預設收合
    expect(screen.getByTestId("scene-card-binding")).toBeInTheDocument();
    expect(screen.getByLabelText("鏡頭語言")).toBeInTheDocument();
    expect(screen.getByLabelText("素材操作")).toBeInTheDocument();
    await user.click(screen.getByText("素材與設定"));
    expect(details).toHaveAttribute("open");
  });

  it("有綁定時顯示摘要 chips 與鎖定提示", () => {
    render(<ShotCard {...defaultProps} shot={baseShot()} />);
    expect(screen.getByLabelText("已鎖定定裝")).toBeInTheDocument();
    expect(screen.getByText("阿梅")).toBeInTheDocument();
    expect(screen.getByText("咖啡店")).toBeInTheDocument();
  });

  it("有畫面時預覽顯示圖，仍保留從素材庫選用", () => {
    render(
      <ShotCard
        {...defaultProps}
        shot={baseShot({
          assetId: "vis-1",
          assetUrl: "https://example.com/shot.jpg",
          assetKind: "image",
        })}
      />,
    );
    expect(screen.getByAltText("第 1 鏡畫面")).toBeInTheDocument();
    expect(screen.queryByText("拖入現有素材或點擊生成")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /從素材庫選用/ }).length).toBeGreaterThanOrEqual(1);
  });

  it("展開素材庫可點選套用 setVisualFromAsset", async () => {
    const user = userEvent.setup();
    render(<ShotCard {...defaultProps} shot={baseShot()} />);
    // 點緊湊面入口會開 library + details
    await user.click(screen.getAllByRole("button", { name: /從素材庫選用/ })[0]!);
    const option = await screen.findByRole("option", { name: /參考圖 A/ });
    await user.click(option);
    expect(mutateSetVisual).toHaveBeenCalledWith({ sceneId: "shot-1", assetId: "a1" });
  });

  it("專業模式用注入的 assetHints 畫推薦 chips，不自行查詢", () => {
    render(
      <ShotCard
        {...defaultProps}
        mode="pro"
        shot={baseShot()}
        assetHints={[{ id: "hint-1", title: "安倢定裝", kind: "image", url: "/a.jpg", matched: ["安倢"] }]}
      />,
    );
    expect(screen.getByText("專案素材裡名稱或標籤對得上的：")).toBeInTheDocument();
    expect(screen.getByText("安倢定裝")).toBeInTheDocument();
  });

  it("文案區分帶入我的素材 vs 外部成果", async () => {
    const user = userEvent.setup();
    render(<ShotCard {...defaultProps} shot={baseShot()} />);
    await user.click(screen.getByText("素材與設定"));
    // 緊湊面 + 展開區各一顆「從素材庫選用」
    expect(screen.getAllByRole("button", { name: /從素材庫選用/ }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: /帶入外部成果/ })).toBeInTheDocument();
  });
});
