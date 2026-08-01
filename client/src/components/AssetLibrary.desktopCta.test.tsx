/**
 * DESK-01: AssetLibrary external-editor CTA is gated by desktop bridge.
 * With bridge → open / reveal actions; without → download + subtle web hint (no auto-return promise).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assetsQuery = vi.fn();
const meQuery = vi.fn();
const openAssetInExternalEditor = vi.fn();
const revealAssetInFolder = vi.fn();
const hasDesktopBridge = vi.fn();
const detectDesktopEditors = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      projects: {
        assets: { invalidate: vi.fn() },
        listDeleted: { invalidate: vi.fn() },
      },
      knowledge: { list: { invalidate: vi.fn() } },
    }),
    auth: {
      me: { useQuery: (...args: unknown[]) => meQuery(...args) },
    },
    projects: {
      assets: { useQuery: (...args: unknown[]) => assetsQuery(...args) },
      deleteAsset: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
      renameAsset: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
      setAssetLock: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
    knowledge: {
      addFromAsset: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: null, error: null }),
      },
      describeImageAsset: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: null, error: null }),
      },
    },
  },
}));

vi.mock("../platform/desktopBridge", async () => {
  const actual = await vi.importActual<typeof import("../platform/desktopBridge")>("../platform/desktopBridge");
  return {
    ...actual,
    hasDesktopBridge: () => hasDesktopBridge(),
    openAssetInExternalEditor: (...args: unknown[]) => openAssetInExternalEditor(...args),
    revealAssetInFolder: (...args: unknown[]) => revealAssetInFolder(...args),
    detectDesktopEditors: (...args: unknown[]) => detectDesktopEditors(...args),
  };
});

vi.mock("./Icon", () => ({
  Icon: () => <span aria-hidden="true" />,
}));

vi.mock("./ExportJobButton", () => ({
  ExportJobButton: () => null,
}));

vi.mock("./interactions", () => ({
  ConfirmButton: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  useRovingRadio: (_keys: string[], value: string) => ({
    groupProps: { onKeyDown: () => undefined },
    itemProps: (index: number) => ({
      tabIndex: index === 0 || _keys[index] === value ? 0 : -1,
      ref: () => undefined,
    }),
  }),
  useFocusTrap: () => undefined,
}));

vi.mock("./MediaFallback", () => ({
  AssetImg: () => <div data-testid="asset-img" />,
  AssetVideo: () => <div data-testid="asset-video" />,
  AssetAudio: () => <div data-testid="asset-audio" />,
}));

vi.mock("../discuss", () => ({
  discussInMessages: vi.fn(),
}));

import { AssetLibrary } from "./AssetLibrary";

const PROJECT_ID = "fedcba98-7654-3210-fedc-ba9876543210";
const ASSET_ID = "01234567-89ab-cdef-0123-456789abcdef";

const sampleAsset = {
  id: ASSET_ID,
  projectId: PROJECT_ID,
  groupId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  kind: "video",
  title: "scene-cut",
  url: `/api/assets/${ASSET_ID}/file`,
  tags: [],
  isAiGenerated: false,
  meta: { originalName: "scene-cut.mp4" },
  storagePath: "assets/scene-cut.mp4",
  mime: "video/mp4",
  sizeBytes: 1024,
  uploadedBy: "user-1",
  locked: false,
  deletedAt: null,
  createdAt: new Date().toISOString(),
};

describe("AssetLibrary DESK-01 desktop CTA", () => {
  beforeEach(() => {
    assetsQuery.mockReset();
    meQuery.mockReset();
    openAssetInExternalEditor.mockReset();
    revealAssetInFolder.mockReset();
    hasDesktopBridge.mockReset();
    detectDesktopEditors.mockReset();
    delete window.__AIOS_DESKTOP__;

    meQuery.mockReturnValue({
      data: {
        user: { id: "user-1" },
        groups: [{ groupId: sampleAsset.groupId, role: "member" }],
      },
    });
    assetsQuery.mockReturnValue({
      data: [sampleAsset],
      isLoading: false,
      isFetching: false,
      error: null,
    });
    detectDesktopEditors.mockResolvedValue([
      { id: "capcut", name: "CapCut", kind: "video-editor", installed: true },
      { id: "system-default", name: "系統預設", kind: "system-default", installed: true, systemDefault: true },
    ]);
  });

  afterEach(() => {
    delete window.__AIOS_DESKTOP__;
    vi.restoreAllMocks();
  });

  async function openMoreMenu() {
    const user = userEvent.setup();
    render(<AssetLibrary projectId={PROJECT_ID} />);
    await user.click(screen.getByRole("button", { name: "更多動作" }));
    return user;
  }

  it("shows external-editor actions when desktop bridge is available", async () => {
    hasDesktopBridge.mockReturnValue(true);
    openAssetInExternalEditor.mockResolvedValue({ ok: true, handoffId: "handoff-1" });

    const user = await openMoreMenu();

    expect(screen.getByRole("button", { name: /用外部軟體開啟/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /在資料夾顯示/ })).toBeInTheDocument();
    expect(screen.queryByText(/下載後本機開啟/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /下載/ })).not.toBeInTheDocument();

    // 有 bridge 時可選軟體；預設第一個 video-editor
    await waitFor(() => {
      expect(screen.getByLabelText(/開啟用軟體/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /用外部軟體開啟/ }));

    await waitFor(() => {
      expect(openAssetInExternalEditor).toHaveBeenCalledWith({
        assetId: ASSET_ID,
        projectId: PROJECT_ID,
        editorKind: "video-editor",
        editorId: "capcut",
        suggestedName: "scene-cut.mp4",
        returnPath: `/p/${PROJECT_ID}?tab=assets`,
      });
    });
  });

  it("reveals asset in folder via bridge", async () => {
    hasDesktopBridge.mockReturnValue(true);
    revealAssetInFolder.mockResolvedValue({ ok: true });

    const user = await openMoreMenu();
    await user.click(screen.getByRole("button", { name: /在資料夾顯示/ }));

    await waitFor(() => {
      expect(revealAssetInFolder).toHaveBeenCalledWith({
        assetId: ASSET_ID,
        projectId: PROJECT_ID,
      });
    });
  });

  it("shows download + web hint (not working desktop CTAs) when bridge is absent", async () => {
    hasDesktopBridge.mockReturnValue(false);

    await openMoreMenu();

    expect(screen.queryByRole("button", { name: /用外部軟體開啟/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /在資料夾顯示/ })).not.toBeInTheDocument();

    const download = screen.getByRole("menuitem", { name: /下載/ });
    expect(download).toHaveAttribute("href", `/api/assets/${ASSET_ID}/file`);
    expect(screen.getByText(/下載後本機開啟；Aios 桌面版可自動回傳編輯結果/)).toBeInTheDocument();
    // Never promise auto-return without bridge in a clickable desktop action
    expect(openAssetInExternalEditor).not.toHaveBeenCalled();
  });

  it("surfaces handoff errors inline on the card", async () => {
    hasDesktopBridge.mockReturnValue(true);
    openAssetInExternalEditor.mockResolvedValue({
      ok: false,
      reason: "editor-not-found",
      message: "找不到可用的剪輯軟體",
    });

    const user = await openMoreMenu();
    await user.click(screen.getByRole("button", { name: /用外部軟體開啟/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("找不到可用的剪輯軟體");
    });
  });
});
