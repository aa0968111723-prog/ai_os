import { describe, expect, it } from "vitest";
import {
  buildHistoryBlock,
  countDoneSteps,
  currentStepNote,
  dispatchAllowed,
  formatAgentRunLine,
  resolveDispatches,
  summarizeGroupAgentRuns,
} from "./teamAssistant";

/** 迷你專案列（只需 id/title，resolveDispatches 泛型只吃這兩欄） */
const proj = (id: string, title: string) => ({ id, title });
const projByRef = new Map([
  ["p1", proj("uuid-1", "招生短片")],
  ["p2", proj("uuid-2", "社課回顧")],
]);

describe("dispatchAllowed（派工權純規則）", () => {
  it("組長／團隊管理員／開發者恆可派工，不看授權旗標", () => {
    for (const role of ["admin", "leader"] as const) {
      expect(dispatchAllowed(role, null)).toBe(true);
      expect(dispatchAllowed(role, undefined)).toBe(true);
      expect(dispatchAllowed(role, false)).toBe(true);
    }
  });

  it("一般組員預設不可派工（null/undefined/false 皆擋）", () => {
    expect(dispatchAllowed("member", null)).toBe(false);
    expect(dispatchAllowed("member", undefined)).toBe(false);
    expect(dispatchAllowed("member", false)).toBe(false);
  });

  it("被明確授權（true）的組員可派工", () => {
    expect(dispatchAllowed("member", true)).toBe(true);
  });
});

describe("resolveDispatches（LLM 代號派工 → 可執行提議）", () => {
  it("無派工權時一律回空——即使 LLM 越權提議也不落地（露出面與執行面同守一條規則）", () => {
    const out = resolveDispatches(projByRef, [{ projectRef: "p1", goal: "把腳本拆成分鏡並逐鏡出圖" }], false);
    expect(out).toEqual([]);
  });

  it("有派工權時解析出真實 projectId 與人看得懂的標籤", () => {
    const out = resolveDispatches(projByRef, [{ projectRef: "p2", goal: "為每一鏡生成畫面並送審" }], true);
    expect(out).toHaveLength(1);
    expect(out[0].projectId).toBe("uuid-2");
    expect(out[0].projectTitle).toBe("社課回顧");
    expect(out[0].label).toContain("社課回顧");
  });

  it("幻覺的專案代號（對不到現況清單）整筆略過，不給註定失敗的按鈕", () => {
    const out = resolveDispatches(
      projByRef,
      [
        { projectRef: "p9", goal: "這個代號不存在，應被丟棄" },
        { projectRef: "p1", goal: "這筆合法，應保留" },
      ],
      true,
    );
    expect(out).toHaveLength(1);
    expect(out[0].projectId).toBe("uuid-1");
  });

  it("目標 trim 後不足 5 字（與 planAgentCore 下限一致）略過，免得按了才吃 BAD_REQUEST", () => {
    const out = resolveDispatches(projByRef, [{ projectRef: "p1", goal: "  短  " }], true);
    expect(out).toEqual([]);
  });

  it("projectRef 前後空白容錯（LLM 偶爾多帶空白）", () => {
    const out = resolveDispatches(projByRef, [{ projectRef: " p1 ", goal: "把知識庫的腳本拆成分鏡" }], true);
    expect(out).toHaveLength(1);
    expect(out[0].projectId).toBe("uuid-1");
  });

  it("過長目標的標籤截斷到 28 字加省略號（按鈕不被灌爆）", () => {
    const longGoal = "一".repeat(60);
    const out = resolveDispatches(projByRef, [{ projectRef: "p1", goal: longGoal }], true);
    expect(out[0].label).toContain("…");
    // goal 本身保留全文（送 dispatch 用），只有 label 截斷
    expect(out[0].goal).toBe(longGoal);
  });
});

describe("buildHistoryBlock（追問脈絡 → 提示詞區塊）", () => {
  it("沒有歷史（undefined／空陣列）回空字串——提示詞一字不多佔", () => {
    expect(buildHistoryBlock(undefined)).toBe("");
    expect(buildHistoryBlock([])).toBe("");
  });

  it("角色轉中文前綴、順序保留、外層包 <先前對話> 標籤", () => {
    const block = buildHistoryBlock([
      { role: "user", text: "哪個案子卡住了？" },
      { role: "assistant", text: "「招生短片」有 3 鏡待審。" },
    ]);
    expect(block).toContain("<先前對話>");
    expect(block).toContain("</先前對話>");
    expect(block.indexOf("使用者：哪個案子卡住了？")).toBeLessThan(block.indexOf("助手：「招生短片」有 3 鏡待審。"));
  });

  it("超過 6 輪只取最後 6 輪（最舊的被丟掉）", () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ role: "user" as const, text: `第${i + 1}問` }));
    const block = buildHistoryBlock(history);
    expect(block).not.toContain("第1問");
    expect(block).not.toContain("第2問");
    expect(block).toContain("第3問");
    expect(block).toContain("第8問");
  });

  it("單則截到 400 字並壓縮連續空白（防提示詞灌爆）", () => {
    const block = buildHistoryBlock([{ role: "user", text: `${"長".repeat(500)}\n\n  尾巴` }]);
    const line = block.split("\n").find((l) => l.startsWith("使用者："))!;
    expect(line.length).toBeLessThanOrEqual("使用者：".length + 400);
    expect(block).not.toContain("\n\n  尾巴"); // 空白已壓縮
  });

  it("全空白的列剔除；全部剔光時回空字串（不留空殼標籤）", () => {
    expect(buildHistoryBlock([{ role: "user", text: "   " }])).toBe("");
    const block = buildHistoryBlock([
      { role: "user", text: "  " },
      { role: "assistant", text: "有內容" },
    ]);
    expect(block).toContain("助手：有內容");
    expect(block).not.toContain("使用者：");
  });
});

describe("countDoneSteps（steps jsonb 防禦解析）", () => {
  it("非陣列（null／物件／字串）一律回 0，不炸", () => {
    expect(countDoneSteps(null)).toBe(0);
    expect(countDoneSteps(undefined)).toBe(0);
    expect(countDoneSteps({})).toBe(0);
    expect(countDoneSteps("bad")).toBe(0);
  });

  it("只數 done；pending/running/failed、缺 status 或 null 列都不計", () => {
    expect(
      countDoneSteps([
        { status: "done" },
        { status: "running" },
        { status: "pending" },
        { status: "done" },
        { note: "沒有 status" },
        null,
      ]),
    ).toBe(2);
  });
});

describe("formatAgentRunLine（代理動態一行摘要）", () => {
  const base = { projectTitle: "招生短片", goal: "把腳本拆成分鏡並逐鏡出圖", status: "running", doneSteps: 2, totalSteps: 5, estPoints: 12 };

  it("含專案名、狀態中文、進度與估點", () => {
    const line = formatAgentRunLine(base);
    expect(line).toContain("「招生短片」");
    expect(line).toContain("執行中");
    expect(line).toContain("2/5 步");
    expect(line).toContain("12 點");
    expect(line).toContain("把腳本拆成分鏡並逐鏡出圖");
  });

  it("未知狀態原樣輸出（新增狀態時顯示不壞掉）", () => {
    expect(formatAgentRunLine({ ...base, status: "mystery" })).toContain("mystery");
  });

  it("目標超過 40 字截斷加省略號", () => {
    const line = formatAgentRunLine({ ...base, goal: "目".repeat(60) });
    expect(line).toContain("…");
    expect(line).not.toContain("目".repeat(41));
  });

  it("0 步計畫（壞資料防禦）進度顯示 —，不出現 0/0", () => {
    const line = formatAgentRunLine({ ...base, doneSteps: 0, totalSteps: 0 });
    expect(line).toContain("進度 —");
    expect(line).not.toContain("0/0");
  });
});

describe("currentStepNote（組儀表當前步驟）", () => {
  it("優先 running，其次 waiting，再 pending", () => {
    expect(
      currentStepNote([
        { status: "done", note: "已完成" },
        { status: "pending", note: "待做" },
        { status: "running", note: "正在生成主視覺" },
      ]),
    ).toBe("正在生成主視覺");
    expect(
      currentStepNote([
        { status: "waiting", note: "等人審" },
        { status: "pending", note: "後面" },
      ]),
    ).toBe("等人審");
  });

  it("空／非陣列回 null；過長截斷", () => {
    expect(currentStepNote(null)).toBeNull();
    expect(currentStepNote([])).toBeNull();
    const long = "字".repeat(100);
    const note = currentStepNote([{ status: "running", note: long }]);
    expect(note?.endsWith("…")).toBe(true);
    expect(note!.length).toBeLessThanOrEqual(81);
  });
});

describe("summarizeGroupAgentRuns（組級健康／計數）", () => {
  const now = Date.parse("2026-07-30T12:00:00Z");
  const recent = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();

  it("統計 active 與 activeProjects 去重", () => {
    const s = summarizeGroupAgentRuns(
      [
        { status: "running", projectId: "p1", updatedAt: recent },
        { status: "waiting", projectId: "p1", updatedAt: recent },
        { status: "awaiting_approval", projectId: "p2", updatedAt: recent },
        { status: "done", projectId: "p3", updatedAt: recent },
      ],
      now,
    );
    expect(s.running).toBe(1);
    expect(s.waiting).toBe(1);
    expect(s.awaitingApproval).toBe(1);
    expect(s.active).toBe(3);
    expect(s.activeProjects).toBe(2);
    expect(s.doneRecent).toBe(1);
    expect(s.health).toBe("attention");
  });

  it("近期失敗 + 仍有等待 → blocked", () => {
    const s = summarizeGroupAgentRuns(
      [
        { status: "failed", projectId: "p1", updatedAt: recent },
        { status: "waiting", projectId: "p2", updatedAt: recent },
      ],
      now,
    );
    expect(s.failedRecent).toBe(1);
    expect(s.health).toBe("blocked");
  });

  it("過舊失敗不計 failedRecent；無活動 healthy", () => {
    const s = summarizeGroupAgentRuns(
      [{ status: "failed", projectId: "p1", updatedAt: old }],
      now,
    );
    expect(s.failedRecent).toBe(0);
    expect(s.health).toBe("healthy");
  });
});
