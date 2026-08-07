/**
 * 逐鏡卡片綁定：這一鏡用誰、在哪、拿什麼。
 * 重點是「沒指定 vs 指定了」兩種狀態要講得清楚——沒指定會沿用生成台勾選，
 * 使用者必須看得出來現在是哪一種，否則出圖出錯了也不知道是誰的鍋。
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SceneCardBinding } from "./SceneCardBinding";

const setCardsMutate = vi.fn();

const CHARACTERS = [{ id: "char-1", name: "安倢" }];
const SCENES = [{ id: "scene-1", name: "禪堂" }];
const PROPS = [{ id: "prop-1", name: "紅傘", ownerName: "安倢" }];

vi.mock("../api", () => ({
  trpc: {
    characters: { list: { useQuery: () => ({ data: CHARACTERS, isLoading: false }) } },
    scenePresets: { list: { useQuery: () => ({ data: SCENES, isLoading: false }) } },
    props: { list: { useQuery: () => ({ data: PROPS, isLoading: false }) } },
    scenes: {
      setCards: { useMutation: () => ({ mutate: setCardsMutate, isPending: false, error: null }) },
    },
  },
}));

describe("SceneCardBinding", () => {
  beforeEach(() => setCardsMutate.mockReset());

  it("沒指定時明說會沿用生成台勾選（不是靜默留白）", () => {
    render(
      <SceneCardBinding projectId="p1" scene={{ id: "s1" }} canEdit onSaved={vi.fn()} />,
    );
    expect(screen.getByText(/沿用生成台勾選/)).toBeVisible();
  });

  it("指定過就寫出名字，素材帶歸屬（安倢的紅傘）", () => {
    render(
      <SceneCardBinding
        projectId="p1"
        scene={{ id: "s1", characterIds: ["char-1"], propIds: ["prop-1"] }}
        canEdit
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText(/安倢・安倢的紅傘/)).toBeVisible();
  });

  // 補齊另外兩排等於拿最舊 10 秒前的快照覆寫回去：夥伴剛在同一格綁上的場景卡會被靜默清掉。
  it("勾一張卡只送動到的那一排（沒送的欄位維持原值，不會蓋掉夥伴剛綁的卡）", async () => {
    const user = userEvent.setup();
    render(<SceneCardBinding projectId="p1" scene={{ id: "s1" }} canEdit onSaved={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "指定" }));
    await user.click(screen.getByRole("button", { name: "安倢" }));

    await waitFor(() => expect(setCardsMutate).toHaveBeenCalled());
    expect(setCardsMutate.mock.calls[0][0]).toEqual({
      sceneId: "s1",
      characterIds: ["char-1"],
    });
  });

  it("清除指定＝三組都送空陣列，這一鏡回到沿用生成台勾選", async () => {
    const user = userEvent.setup();
    render(
      <SceneCardBinding
        projectId="p1"
        scene={{ id: "s1", characterIds: ["char-1"] }}
        canEdit
        onSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "改" }));
    await user.click(screen.getByRole("button", { name: /清除這一鏡的指定/ }));

    await waitFor(() => expect(setCardsMutate).toHaveBeenCalled());
    expect(setCardsMutate.mock.calls[0][0]).toEqual({
      sceneId: "s1",
      characterIds: [],
      scenePresetIds: [],
      propIds: [],
    });
  });

  it("檢視者看得到綁定，但沒有任何修改入口", () => {
    render(
      <SceneCardBinding
        projectId="p1"
        scene={{ id: "s1", characterIds: ["char-1"] }}
        canEdit={false}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByText(/安倢/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "改" })).toBeNull();
    expect(screen.queryByRole("button", { name: "指定" })).toBeNull();
  });
});
