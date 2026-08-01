/**
 * 角色定裝卡／場景設定卡／素材設定卡：編輯表單要能改參考圖（QA 2026-08-01 使用者回報）。
 *
 * 先前只有「新增」表單有參考圖欄，「編輯」表單只有三個文字欄位——使用者看著編輯表單，
 * 合理地以為這張卡配不了素材（參考圖其實得先取消編輯、再去按另一顆「設參考圖」）。
 * 三張卡的新增／編輯表單欄位必須一致，這裡把它釘住。
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterCards } from "./CharacterCards";
import { ScenePresetCards } from "./ScenePresetCards";
import { PropCards } from "./PropCards";

const charUpdate = vi.fn();
const sceneUpdate = vi.fn();
const propUpdate = vi.fn();

const CHAR = {
  id: "char-1",
  projectId: "p1",
  name: "安倢",
  appearance: "紅傘、米白外套、帆布包",
  notes: "引路與陪伴的角色",
  referenceAssetId: null as string | null,
  referenceUrl: null as string | null,
};
const SCENE = {
  id: "scene-1",
  projectId: "p1",
  name: "城市清晨",
  palette: "暖色調、米白與淡橘",
  lighting: "柔和晨光斜射",
  referenceAssetId: null as string | null,
  referenceUrl: null as string | null,
};

const PROP = {
  id: "prop-1",
  projectId: "p1",
  name: "紅傘",
  appearance: "正紅長柄傘、霧面傘布、木質握把",
  notes: "安倢每次出場都帶著",
  referenceAssetId: null as string | null,
  referenceUrl: null as string | null,
};

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      characters: { list: { invalidate: vi.fn() } },
      scenePresets: { list: { invalidate: vi.fn() } },
      props: { list: { invalidate: vi.fn() } },
      projects: { assets: { invalidate: vi.fn() } },
    }),
    characters: {
      list: { useQuery: () => ({ data: [CHAR], isLoading: false }) },
      add: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }) },
      update: { useMutation: () => ({ mutate: charUpdate, isPending: false, error: null, reset: vi.fn() }) },
      remove: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }) },
    },
    scenePresets: {
      list: { useQuery: () => ({ data: [SCENE], isLoading: false }) },
      add: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }) },
      update: { useMutation: () => ({ mutate: sceneUpdate, isPending: false, error: null, reset: vi.fn() }) },
      remove: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }) },
    },
    props: {
      list: { useQuery: () => ({ data: [PROP], isLoading: false }) },
      add: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }) },
      update: { useMutation: () => ({ mutate: propUpdate, isPending: false, error: null, reset: vi.fn() }) },
      remove: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }) },
    },
    projects: { assets: { useQuery: () => ({ data: [] }) } },
  },
}));

describe("卡片編輯表單的參考圖欄", () => {
  beforeEach(() => {
    charUpdate.mockReset();
    sceneUpdate.mockReset();
    propUpdate.mockReset();
  });

  it("角色卡：按「編輯」後，表單裡就有定裝參考圖欄（不必先取消編輯再另外找入口）", async () => {
    const user = userEvent.setup();
    render(<CharacterCards projectId="p1" selectedIds={[]} onToggle={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /編輯/ }));

    expect(screen.getByText("定裝參考圖（選填：上傳或從素材庫選）")).toBeVisible();
    expect(screen.getByRole("button", { name: /從素材庫選/ })).toBeVisible();
  });

  it("角色卡：儲存時連參考圖一起送（沒綁＝null，不會靜默保留舊值）", async () => {
    const user = userEvent.setup();
    render(<CharacterCards projectId="p1" selectedIds={[]} onToggle={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /編輯/ }));
    await user.click(screen.getByRole("button", { name: /儲存/ }));

    await waitFor(() => expect(charUpdate).toHaveBeenCalled());
    expect(charUpdate.mock.calls[0][0]).toMatchObject({ id: "char-1", referenceAssetId: null });
  });

  it("場景卡：編輯表單同樣有場景參考圖欄，儲存時一起送", async () => {
    const user = userEvent.setup();
    render(<ScenePresetCards projectId="p1" selectedIds={[]} onToggle={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /編輯/ }));
    expect(screen.getByText("場景參考圖（選填：上傳或從素材庫選）")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /儲存/ }));
    await waitFor(() => expect(sceneUpdate).toHaveBeenCalled());
    expect(sceneUpdate.mock.calls[0][0]).toMatchObject({ id: "scene-1", referenceAssetId: null });
  });

  it("素材卡：編輯表單同樣有素材參考圖欄，儲存時一起送", async () => {
    const user = userEvent.setup();
    render(<PropCards projectId="p1" selectedIds={[]} onToggle={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /編輯/ }));
    expect(screen.getByText("素材參考圖（選填：上傳或從素材庫選）")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /儲存/ }));
    await waitFor(() => expect(propUpdate).toHaveBeenCalled());
    expect(propUpdate.mock.calls[0][0]).toMatchObject({ id: "prop-1", referenceAssetId: null });
  });

  it("素材卡：勾「生成時帶入」會回報卡片 id（生成才注入道具錨點）", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<PropCards projectId="p1" selectedIds={[]} onToggle={onToggle} />);

    await user.click(screen.getByRole("checkbox", { name: /生成時帶入/ }));
    expect(onToggle).toHaveBeenCalledWith("prop-1");
  });
});
