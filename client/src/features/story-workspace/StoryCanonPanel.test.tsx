import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoryCanonPanel } from "./StoryCanonPanel";

const applyUpgrade = vi.fn();
const promote = vi.fn();
const createCanon = vi.fn();
const saveVersion = vi.fn();

const workspaceData = {
  canonPins: [
    {
      pinId: "pin-1", canonId: "canon-1", kind: "character", name: "魯夫",
      state: "UPDATE_AVAILABLE", pinnedVersionNumber: 7, productionVersionNumber: 8,
      localEntityKind: "character", localEntityId: "char-1",
    },
    {
      pinId: "pin-2", canonId: "canon-2", kind: "scene", name: "淺水灣",
      state: "PINNED", pinnedVersionNumber: 3, productionVersionNumber: 3,
      localEntityKind: "scene_preset", localEntityId: "preset-1",
    },
  ],
};

vi.mock("../../api", () => {
  const invalidate = () => Promise.resolve();
  return {
    trpc: {
      useUtils: () => ({
        canon: { projectPins: { invalidate }, get: { invalidate } },
        creativeContext: { workspace: { invalidate } },
        characters: { list: { invalidate } },
        scenePresets: { list: { invalidate } },
        props: { list: { invalidate } },
      }),
      creativeContext: {
        workspace: { useQuery: () => ({ data: workspaceData, isLoading: false }) },
      },
      characters: {
        list: { useQuery: () => ({ data: [{ id: "char-1", name: "魯夫" }, { id: "char-2", name: "娜美" }] }) },
      },
      scenePresets: { list: { useQuery: () => ({ data: [{ id: "preset-1", name: "淺水灣" }] }) } },
      props: { list: { useQuery: () => ({ data: [] }) } },
      canon: {
        get: {
          useQuery: () => ({
            isLoading: false,
            data: {
              canon: { productionVersionId: "v8" },
              versions: [
                { id: "v8", versionNumber: 8, archived: false, hasTraining: true },
                { id: "v7", versionNumber: 7, archived: false, hasTraining: false },
              ],
            },
          }),
        },
        upgradeImpact: {
          useQuery: () => ({ data: { affectedShotIds: ["s1", "s2"], currentMediaCount: 1 } }),
        },
        applyUpgrade: { useMutation: () => ({ isPending: false, mutate: applyUpgrade }) },
        promoteVersion: { useMutation: () => ({ isPending: false, mutate: promote }) },
        addVersionFromPin: { useMutation: () => ({ isPending: false, mutate: saveVersion }) },
        createFromEntity: { useMutation: () => ({ isPending: false, mutate: createCanon }) },
      },
    },
  };
});

describe("StoryCanonPanel", () => {
  it("shows pins with new-version state and never a silent upgrade", () => {
    render(<StoryCanonPanel projectId="p1" canEdit />);
    expect(screen.getByText(/角色・魯夫/)).toBeInTheDocument();
    expect(screen.getByText(/有新版 V8/)).toBeInTheDocument();
    // 沒有點開之前不顯示升級按鈕（更不會自動升級）
    expect(screen.queryByRole("button", { name: /升級到最新版/ })).not.toBeInTheDocument();
    expect(applyUpgrade).not.toHaveBeenCalled();
  });

  it("expanding a pin shows the real impact and upgrade is an explicit click", () => {
    render(<StoryCanonPanel projectId="p1" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /角色・魯夫/ }));
    expect(screen.getByText(/升級會讓 2 鏡需要重新生成/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "升級到最新版" }));
    expect(applyUpgrade).toHaveBeenCalledWith({ pinId: "pin-1" });
  });

  it("promote is explicit and only offered for non-production versions", () => {
    render(<StoryCanonPanel projectId="p1" canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /角色・魯夫/ }));
    const promoteButtons = screen.getAllByRole("button", { name: "採用為 production" });
    expect(promoteButtons).toHaveLength(1); // 只有 V7（非 production）
    fireEvent.click(promoteButtons[0]!);
    expect(promote).toHaveBeenCalledWith({ versionId: "v7" });
  });

  it("offers to canonize only cards that are not already pinned", () => {
    render(<StoryCanonPanel projectId="p1" canEdit />);
    expect(screen.getByRole("button", { name: "升級「娜美」" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "升級「魯夫」" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "升級「娜美」" }));
    expect(createCanon).toHaveBeenCalledWith({
      projectId: "p1", entityKind: "character", entityId: "char-2", confirmRights: true,
    });
  });

  it("read-only members see state but no mutating buttons", () => {
    render(<StoryCanonPanel projectId="p1" canEdit={false} />);
    fireEvent.click(screen.getByRole("button", { name: /角色・魯夫/ }));
    expect(screen.queryByRole("button", { name: "升級到最新版" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "採用為 production" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /升級「/ })).not.toBeInTheDocument();
  });
});
