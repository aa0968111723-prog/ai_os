import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assistantAskCompletionChip,
  claimsCompletedWrite,
  claimsInabilityToCheck,
  formatAssistantWriteResult,
  isCompletedInventoryChipTitle,
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
      answer: "目前有 6 個分鏡，第 4 鏡才出現禪定龜龜。",
      actions: [],
    });
    expect(settled.emitCompleted).toBe(true);
    expect(settled.claimedUnexecutedWrite).toBe(false);
    expect(settled.cannotVerify).toBe(false);
    expect(settled.answer).toBe("目前有 6 個分鏡，第 4 鏡才出現禪定龜龜。");
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

  it("story-read ask is not a write and chip is never 已完成盤點", () => {
    expect(userAskedForWrite("請讀已存故事，兩句摘要小華在講什麼並列出角色名")).toBe(false);
    const settled = settleAssistantAskCompletion({
      answer: "小華在校門口自我介紹，夕陽下問宇宙呀。角色有小華和禪定龜龜。",
      actions: [],
      userMessage: "請讀已存故事，兩句摘要小華在講什麼並列出角色名",
    });
    expect(settled.emitCompleted).toBe(true);
    const chip = assistantAskCompletionChip({
      settled,
      actionCount: 0,
      okSourceCount: 2,
      okSourceItems: 2,
    });
    expect(chip.title).toBe("已讀取 2 個來源");
    expect(chip.title).not.toMatch(/已完成盤點/);
  });

  it("read-only inventory chip is 已讀取 N 個來源, never 已完成盤點", () => {
    const settled = settleAssistantAskCompletion({
      answer: "目前有 6 個分鏡。",
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

  it("bans 已完成盤點 on write intent with no verified write — even with 2 sources", () => {
    expect(userAskedForWrite("新增角色 小華 粉橘短髮女孩、大二化工")).toBe(true);
    expect(userAskedForWrite("把小華改成粉橘短髮女孩")).toBe(true);
    const settled = settleAssistantAskCompletion({
      answer: "已完成盤點。現有卡「小華：年輕男性」與「粉橘短髮女孩、大二化工」衝突，要改寫還是另取一名？",
      actions: [],
      userMessage: "新增角色 小華 粉橘短髮女孩、大二化工",
      hasVerifiedWrite: false,
    });
    expect(settled.emitCompleted).toBe(false);
    expect(settled.answer).not.toMatch(/已完成盤點/);
    expect(settled.claimedUnexecutedWrite || settled.unverifiedWriteIntent).toBe(true);
    const chip = assistantAskCompletionChip({
      settled,
      actionCount: 0,
      okSourceCount: 2,
      okSourceItems: 2,
    });
    expect(chip.type).toBe("waiting.user_input");
    expect(chip.title).toBe("尚未寫入，請確認");
    expect(chip.title).not.toMatch(/已完成盤點|Aios 已完成/);
  });

  it("failed or empty NIM run never paints a completed-inventory chip", () => {
    const settled = settleAssistantAskCompletion({
      answer: "小華在校門口自我介紹。角色：小華、禪定龜龜。",
      actions: [],
      userMessage: "請讀已存故事，兩句摘要小華在講什麼並列出角色名",
      runFailed: true,
    });
    expect(settled.emitCompleted).toBe(false);
    expect(settled.runFailed).toBe(true);
    const chip = assistantAskCompletionChip({
      settled,
      actionCount: 0,
      okSourceCount: 2,
      okSourceItems: 8,
    });
    expect(chip.type).toBe("agent.failed");
    expect(chip.title).toBe("模型未完成");
    expect(isCompletedInventoryChipTitle(chip.title)).toBe(false);
    expect(chip.title).not.toMatch(/已完成盤點|已取得來源|已讀取/);
    expect(chip.description).not.toMatch(/已完成盤點|已取得來源/);
  });

  it("chip titles never emit 已完成盤點", () => {
    const src = readFileSync(join(process.cwd(), "shared/assistantHonestCompletion.ts"), "utf8");
    expect(src).not.toMatch(/title:\s*[`'"][^`'"]*已完成盤點/);
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
    expect(claimsCompletedWrite("我新增了角色小華的角色卡。")).toBe(true);
    expect(claimsCompletedWrite("我建議調整鏡頭，請確認")).toBe(false);
    expect(rewriteCompletedTenseToProposal("已套用世界觀")).toContain("建議套用");
    expect(rewriteCompletedTenseToProposal("我新增了角色小華的角色卡。")).not.toContain("我新增了");
  });
});
