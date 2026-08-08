import { describe, expect, it } from "vitest";
import {
  classifyRevisionPatch,
  readRevisionConflict,
  revisionConflictMessage,
  revisionEntityLabel,
  revisionFieldLabel,
  type RevisionConflict,
} from "./revision";

describe("classifyRevisionPatch（逐欄三方比對）", () => {
  it("別人沒動過的欄位＝可合併：A 改提示詞、B 改旁白，兩份修改不該互相擋", () => {
    // 我載入時 prompt='舊'、voiceover='原本的旁白'；我只改 prompt。
    // 別人在這期間把 voiceover 改掉了（所以 rev 撞了），但他沒碰 prompt。
    const plan = classifyRevisionPatch(
      { prompt: "新的畫面提示" },
      { prompt: "舊" },
      { prompt: "舊", voiceover: "夥伴改過的旁白" },
    );
    expect(plan.mergeable).toEqual(["prompt"]);
    expect(plan.contested).toEqual([]);
  });

  it("同一欄兩份不同的值＝真衝突：這是唯一該打擾使用者的情況", () => {
    const plan = classifyRevisionPatch(
      { prompt: "我寫的版本" },
      { prompt: "舊" },
      { prompt: "夥伴寫的版本" },
    );
    expect(plan.contested).toEqual(["prompt"]);
    expect(plan.mergeable).toEqual([]);
  });

  it("別人已經改成跟我一樣＝noop，不必寫也不必問", () => {
    const plan = classifyRevisionPatch({ title: "開場" }, { title: "舊標題" }, { title: "開場" });
    expect(plan.noop).toEqual(["title"]);
    expect(plan.contested).toEqual([]);
    expect(plan.mergeable).toEqual([]);
  });

  it("沒有 baseline 一律當衝突——證明不了沒被動過時，寧可多問一次也不要靜默覆蓋", () => {
    const plan = classifyRevisionPatch({ prompt: "我的" }, null, { prompt: "別人的" });
    expect(plan.contested).toEqual(["prompt"]);
  });

  it("baseline 缺該欄（舊客戶端只送了一半）同樣當衝突，不放行", () => {
    const plan = classifyRevisionPatch({ prompt: "我的", action: "我的走位" }, { prompt: "舊" }, {
      prompt: "舊",
      action: "夥伴的走位",
    });
    expect(plan.mergeable).toEqual(["prompt"]);
    expect(plan.contested).toEqual(["action"]);
  });

  it("null 與 undefined 視為同一件事——否則每次載入都會冒出假衝突", () => {
    const plan = classifyRevisionPatch({ notes: "補充" }, { notes: undefined }, { notes: null });
    expect(plan.mergeable).toEqual(["notes"]);
    expect(plan.contested).toEqual([]);
  });

  it("物件欄（camera/environment）比內容而不是比參考", () => {
    const plan = classifyRevisionPatch(
      { camera: { shotSize: "特寫" } },
      { camera: { shotSize: "中景" } },
      { camera: { shotSize: "中景" } },
    );
    expect(plan.mergeable).toEqual(["camera"]);
  });

  it("多欄混合：可合併、真衝突、noop 三類要分得開", () => {
    const plan = classifyRevisionPatch(
      { prompt: "我的提示", voiceover: "我的旁白", title: "同一個標題" },
      { prompt: "舊提示", voiceover: "舊旁白", title: "舊標題" },
      { prompt: "舊提示", voiceover: "夥伴的旁白", title: "同一個標題" },
    );
    expect(plan.mergeable).toEqual(["prompt"]);
    expect(plan.contested).toEqual(["voiceover"]);
    expect(plan.noop).toEqual(["title"]);
  });
});

describe("衝突文案", () => {
  it("說得出「誰動了什麼」——不是一句「儲存失敗」", () => {
    expect(revisionConflictMessage({ entity: "scene", updatedBy: { userId: "u1", name: "韋澔" } })).toBe(
      "韋澔 剛剛更新了這一鏡",
    );
  });

  it("查不到名字時退回「有夥伴」，仍然比「儲存失敗」有用", () => {
    expect(revisionConflictMessage({ entity: "story", updatedBy: null })).toBe("有夥伴剛剛更新了這份故事");
  });

  it("實體與欄位都有給人看的名字", () => {
    expect(revisionEntityLabel("characterLook")).toBe("這個造型");
    expect(revisionFieldLabel("voiceover")).toBe("旁白");
    expect(revisionFieldLabel("someUnknownField")).toBe("someUnknownField");
  });
});

describe("readRevisionConflict（前端取用衝突 payload）", () => {
  const valid: RevisionConflict = {
    reason: "REVISION_CONFLICT",
    entity: "scene",
    entityId: "11111111-1111-1111-1111-111111111111",
    expectedRev: 3,
    currentRev: 5,
    currentData: { prompt: "夥伴的版本" },
    contestedFields: ["prompt"],
    mergeableFields: [],
    updatedBy: { userId: "u1", name: "韋澔" },
    updatedAt: "2026-08-07T00:00:00.000Z",
  };

  it("認得合法 payload", () => {
    expect(readRevisionConflict({ conflict: valid })).toEqual(valid);
  });

  it("形狀不符一律回 null，不讓壞資料炸畫面", () => {
    expect(readRevisionConflict(null)).toBeNull();
    expect(readRevisionConflict({})).toBeNull();
    expect(readRevisionConflict({ conflict: { reason: "OTHER" } })).toBeNull();
    expect(readRevisionConflict({ conflict: { ...valid, entity: "unknownEntity" } })).toBeNull();
    expect(readRevisionConflict({ conflict: { ...valid, expectedRev: "3" } })).toBeNull();
    expect(readRevisionConflict({ conflict: { ...valid, contestedFields: undefined } })).toBeNull();
  });
});
