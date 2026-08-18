import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assistantAskCompletionChip,
  claimsCompletedWrite,
  claimsInabilityToCheck,
  formatAssistantWriteResult,
  rewriteCompletedTenseToProposal,
  settleAssistantAskCompletion,
  userAskedForWrite,
  writeVerificationOk,
} from "./assistantHonestCompletion";

describe("settleAssistantAskCompletion（completed-tense + actions=[] must not claim writes）", () => {
  it("forbids agent.completed and rewrites 已建立 when actions are empty", () => {
    const settled = settleAssistantAskCompletion({
      answer: "已建立三個分鏡，已寫入角色小華。",
      actions: [],
    });
    expect(settled.emitCompleted).toBe(false);
    expect(settled.claimedUnexecutedWrite).toBe(true);
    expect(settled.answer).toContain("尚未寫入專案");
    expect(settled.answer).not.toMatch(/已建立/);
    expect(settled.answer).not.toMatch(/已寫入/);
    expect(settled.answer).toContain("建議建立");
  });

  it("pending confirm actions also cannot emit completed or keep completed-tense", () => {
    const settled = settleAssistantAskCompletion({
      answer: "已更新第 3 鏡標題。",
      actions: [{ type: "update_scene" }],
    });
    expect(settled.emitCompleted).toBe(false);
    expect(settled.answer).toContain("建議更新");
    expect(settled.answer).not.toMatch(/已更新/);
  });

  it("read-only answers with no write claim may emit agent.completed", () => {
    const settled = settleAssistantAskCompletion({
      answer: "目前有 7 個分鏡，第 4 鏡才出現禪定龜龜。",
      actions: [],
    });
    expect(settled.emitCompleted).toBe(true);
    expect(settled.claimedUnexecutedWrite).toBe(false);
    expect(settled.cannotVerify).toBe(false);
    expect(settled.answer).toBe("目前有 7 個分鏡，第 4 鏡才出現禪定龜龜。");
  });

  it("forbids 已完成盤點 when the body says it cannot see the saved story", () => {
    const settled = settleAssistantAskCompletion({
      answer: "我看不到你的故事，請貼上腳本我才能拆分鏡。",
      actions: [],
    });
    expect(claimsInabilityToCheck(settled.answer)).toBe(true);
    expect(settled.emitCompleted).toBe(false);
    expect(settled.cannotVerify).toBe(true);
    const chip = assistantAskCompletionChip({
      settled,
      actionCount: 0,
      okSourceCount: 1,
      okSourceItems: 4,
    });
    expect(chip.type).toBe("waiting.user_input");
    expect(chip.title).not.toMatch(/已完成盤點|Aios 已完成/);
    expect(chip.title).toContain("尚未核對");
  });

  it("read-only inventory chip is 已讀取 N 個來源, never 已完成盤點", () => {
    const settled = settleAssistantAskCompletion({
      answer: "目前有 7 個分鏡。",
      actions: [],
      userMessage: "現在有幾鏡？",
    });
    const chip = assistantAskCompletionChip({
      settled,
      actionCount: 0,
      okSourceCount: 3,
      okSourceItems: 12,
    });
    expect(chip.type).toBe("agent.completed");
    expect(chip.title).toBe("已讀取 3 個來源");
    expect(chip.title).not.toMatch(/已完成盤點/);
  });

  it("write intent with no verified write waits — 尚未寫入，請確認", () => {
    expect(userAskedForWrite("幫我把你的故事儲存起來")).toBe(true);
    expect(userAskedForWrite("修改第 3 鏡頭的對白")).toBe(true);
    expect(userAskedForWrite("現在有幾鏡？")).toBe(false);
    const settled = settleAssistantAskCompletion({
      answer: "好，故事已經在專案裡。",
      actions: [],
      userMessage: "請儲存故事",
    });
    expect(settled.emitCompleted).toBe(false);
    expect(settled.unverifiedWriteIntent).toBe(true);
    const chip = assistantAskCompletionChip({
      settled,
      actionCount: 0,
      okSourceCount: 2,
      okSourceItems: 8,
    });
    expect(chip.type).toBe("waiting.user_input");
    expect(chip.title).toBe("尚未寫入，請確認");
    expect(chip.title).not.toMatch(/已完成盤點/);
  });

  it("chip source never emits 已完成盤點", () => {
    const src = readFileSync(join(process.cwd(), "shared/assistantHonestCompletion.ts"), "utf8");
    expect(src).not.toContain("已完成盤點");
    const globalSrc = readFileSync(join(process.cwd(), "server/routers/globalAssistant.ts"), "utf8");
    expect(globalSrc).not.toContain("已完成盤點");
  });
});

describe("write verification", () => {
  it("verified is the only ok path", () => {
    expect(writeVerificationOk({ status: "verified", message: "ok" })).toBe(true);
    expect(writeVerificationOk({ status: "unverified", message: "mismatch" })).toBe(false);
  });

  it("update_scene / direct_shot without read-back match → ok:false and no completed-tense", () => {
    const mismatch = formatAssistantWriteResult(
      { status: "unverified", message: "操作已送出，但驗證未通過" },
      "已更新分鏡",
    );
    expect(mismatch.ok).toBe(false);
    expect(mismatch.message).toBe("操作已送出，但驗證未通過");
    expect(mismatch.message).not.toMatch(/已更新|已調整/);
    const noChange = formatAssistantWriteResult(
      { status: "unverified", message: "沒有變更，未寫入" },
      "已調整「標題」：近景",
    );
    expect(noChange.ok).toBe(false);
    expect(noChange.message).toBe("沒有變更，未寫入");
  });

  it("detects completed-tense write claims", () => {
    expect(claimsCompletedWrite("已調整鏡頭")).toBe(true);
    expect(claimsCompletedWrite("我建議調整鏡頭，請確認")).toBe(false);
    expect(rewriteCompletedTenseToProposal("已套用世界觀")).toContain("建議套用");
  });
});
