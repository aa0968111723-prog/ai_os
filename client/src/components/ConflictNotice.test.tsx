/**
 * 併發衝突卡：這張卡存在的唯一理由，是取代那句沒有用的「儲存失敗」。
 * 所以測的重點不是它有沒有渲染，而是它有沒有回答三個問題：
 * 誰動了什麼、他改成什麼、我的東西怎麼辦。
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RevisionConflict } from "@shared/revision";
import { ConflictNotice, conflictFromError } from "./ConflictNotice";

function conflict(over: Partial<RevisionConflict> = {}): RevisionConflict {
  return {
    reason: "REVISION_CONFLICT",
    entity: "scene",
    entityId: "11111111-1111-1111-1111-111111111111",
    expectedRev: 3,
    currentRev: 4,
    currentData: { prompt: "韋澔改的畫面" },
    contestedFields: ["prompt"],
    mergeableFields: [],
    updatedBy: { userId: "u-wei", name: "韋澔" },
    updatedAt: "2026-08-07T00:00:00.000Z",
    ...over,
  };
}

describe("ConflictNotice", () => {
  it("說出「誰動了什麼」，不是一句「儲存失敗」", () => {
    render(<ConflictNotice conflict={conflict()} />);
    expect(screen.getByText("韋澔 剛剛更新了這一鏡")).toBeInTheDocument();
    expect(screen.queryByText(/儲存失敗/)).not.toBeInTheDocument();
  });

  it("指出撞在哪一欄，並保證使用者的字沒被吃掉", () => {
    render(<ConflictNotice conflict={conflict()} />);
    expect(screen.getByText(/你們同時改了畫面提示詞/)).toBeInTheDocument();
    expect(screen.getByText(/沒有被覆蓋/)).toBeInTheDocument();
  });

  it("查不到名字時退回「有夥伴」——仍然比「儲存失敗」有用", () => {
    render(<ConflictNotice conflict={conflict({ updatedBy: null, entity: "story" })} />);
    expect(screen.getByText("有夥伴剛剛更新了這份故事")).toBeInTheDocument();
  });

  it("「比較差異」攤得出夥伴那一版的實際內容", async () => {
    const user = userEvent.setup();
    render(<ConflictNotice conflict={conflict()} />);
    expect(screen.queryByText("韋澔改的畫面")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "比較差異" }));
    expect(screen.getByText("韋澔改的畫面")).toBeInTheDocument();
  });

  it("提供兩條出路：查看新版、重新套用我的修改", async () => {
    const user = userEvent.setup();
    const onReapply = vi.fn();
    const onViewLatest = vi.fn();
    render(<ConflictNotice conflict={conflict()} onReapply={onReapply} onViewLatest={onViewLatest} />);
    await user.click(screen.getByRole("button", { name: "查看新版" }));
    expect(onViewLatest).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "重新套用我的修改" }));
    expect(onReapply).toHaveBeenCalledTimes(1);
  });

  it("主要按鈕的觸控目標 >= 44px（手機是一級公民）", () => {
    render(<ConflictNotice conflict={conflict()} onReapply={vi.fn()} onViewLatest={vi.fn()} />);
    for (const name of ["比較差異", "查看新版", "重新套用我的修改"]) {
      const btn = screen.getByRole("button", { name });
      expect(btn.style.minHeight).toBe("44px");
    }
  });

  it("以 role=status + aria-live 播報：衝突不能只靠顏色被看見", () => {
    render(<ConflictNotice conflict={conflict()} />);
    const box = screen.getByTestId("conflict-notice");
    expect(box).toHaveAttribute("role", "status");
    expect(box).toHaveAttribute("aria-live", "polite");
  });
});

describe("conflictFromError", () => {
  it("認得 tRPC 錯誤裡的結構化衝突", () => {
    expect(conflictFromError({ data: { conflict: conflict() } })).toEqual(conflict());
  });

  it("一般錯誤回 null——呼叫端照舊顯示原本的訊息", () => {
    expect(conflictFromError({ data: { code: "BAD_REQUEST" } })).toBeNull();
    expect(conflictFromError(new Error("boom"))).toBeNull();
    expect(conflictFromError(null)).toBeNull();
  });
});
