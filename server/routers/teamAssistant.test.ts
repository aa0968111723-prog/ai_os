import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildHistoryBlock,
  buildSelfCheckClarification,
  countDoneSteps,
  currentStepNote,
  detectCrossGroupMention,
  dispatchAllowed,
  foldGroupStatusAggregate,
  formatGroupBlockerDigest,
  sanitizeContextUsed,
  sanitizeRationale,
  TEAM_ASSISTANT_DATA_BOUNDARY_RULE,
  TEAM_CONTEXT_LABELS,
  formatAgentRunLine,
  groupSummaryFromCounts,
  resolveDispatches,
  resolveCommandProposals,
  formatCommandRefs,
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

  it("多筆合法派工一次全收（上限由呼叫端裁，此處不截）", () => {
    const out = resolveDispatches(
      projByRef,
      [
        { projectRef: "p1", goal: "第一案目標足夠長" },
        { projectRef: "p2", goal: "第二案目標足夠長" },
      ],
      true,
    );
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.projectId)).toEqual(["uuid-1", "uuid-2"]);
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

  it("空陣列回 0", () => {
    expect(countDoneSteps([])).toBe(0);
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

  it("各已知狀態中文化", () => {
    expect(formatAgentRunLine({ ...base, status: "awaiting_approval" })).toContain("待核准");
    expect(formatAgentRunLine({ ...base, status: "waiting" })).toContain("等待人員");
    expect(formatAgentRunLine({ ...base, status: "done" })).toContain("完成");
    expect(formatAgentRunLine({ ...base, status: "failed" })).toContain("失敗");
    expect(formatAgentRunLine({ ...base, status: "stopped" })).toContain("已停止");
    expect(formatAgentRunLine({ ...base, status: "discarded" })).toContain("已放棄");
  });
});

describe("currentStepNote（組儀表當前步驟）", () => {
  it("優先 running，其次 waiting / waiting_confirmation，再 pending", () => {
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
    expect(
      currentStepNote([
        { status: "pending", note: "第 2 鏡" },
        { status: "waiting", note: "待你採用 · 第 1 鏡「鏡1」生成畫面" },
      ]),
    ).toBe("待你採用 · 第 1 鏡「鏡1」生成畫面");
  });

  it("空／非陣列回 null；過長截斷", () => {
    expect(currentStepNote(null)).toBeNull();
    expect(currentStepNote([])).toBeNull();
    const long = "字".repeat(100);
    const note = currentStepNote([{ status: "running", note: long }]);
    expect(note?.endsWith("…")).toBe(true);
    expect(note!.length).toBeLessThanOrEqual(81);
  });

  it("note 空時回退 title；兩者皆空回 null", () => {
    expect(currentStepNote([{ status: "running", title: "生成封面" }])).toBe("生成封面");
    expect(currentStepNote([{ status: "running", note: "  ", title: "  " }])).toBeNull();
  });

  it("沒有 running/waiting/pending 時取最後一列", () => {
    expect(
      currentStepNote([
        { status: "done", note: "第一步" },
        { status: "failed", note: "最後一步失敗" },
      ]),
    ).toBe("最後一步失敗");
  });
});

describe("summarizeGroupAgentRuns（組級健康／計數）", () => {
  const now = Date.parse("2026-07-30T12:00:00Z");
  const recent = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();

  it("空陣列 → idle（不是 healthy）：沒東西可分析 ≠ 分析結果良好", () => {
    const s = summarizeGroupAgentRuns([], now);
    expect(s).toEqual({
      running: 0,
      waiting: 0,
      awaitingApproval: 0,
      failedRecent: 0,
      doneRecent: 0,
      stoppedRecent: 0,
      active: 0,
      activeProjects: 0,
      hasRuns: false,
      health: "idle",
    });
  });

  it("有計畫但全部靜止 → healthy、hasRuns=true（與 idle 區分開）", () => {
    const s = summarizeGroupAgentRuns([{ status: "done", projectId: "p1", updatedAt: old }], now);
    expect(s.hasRuns).toBe(true);
    expect(s.health).toBe("healthy");
  });

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

  it("近期失敗 + 待核准 → blocked", () => {
    const s = summarizeGroupAgentRuns(
      [
        { status: "failed", projectId: "p1", updatedAt: recent },
        { status: "awaiting_approval", projectId: "p2", updatedAt: recent },
      ],
      now,
    );
    expect(s.health).toBe("blocked");
  });

  it("僅近期失敗、無等待／待核 → attention（不是 blocked）", () => {
    const s = summarizeGroupAgentRuns(
      [{ status: "failed", projectId: "p1", updatedAt: recent }],
      now,
    );
    expect(s.failedRecent).toBe(1);
    expect(s.active).toBe(0);
    expect(s.health).toBe("attention");
  });

  it("僅 awaiting_approval → attention", () => {
    const s = summarizeGroupAgentRuns(
      [{ status: "awaiting_approval", projectId: "p1", updatedAt: recent }],
      now,
    );
    expect(s.awaitingApproval).toBe(1);
    expect(s.active).toBe(1);
    expect(s.health).toBe("attention");
  });

  it("過舊失敗不計 failedRecent；無活動 healthy", () => {
    const s = summarizeGroupAgentRuns(
      [{ status: "failed", projectId: "p1", updatedAt: old }],
      now,
    );
    expect(s.failedRecent).toBe(0);
    expect(s.health).toBe("healthy");
  });

  it("過舊 done 不計 doneRecent", () => {
    const s = summarizeGroupAgentRuns(
      [{ status: "done", projectId: "p1", updatedAt: old }],
      now,
    );
    expect(s.doneRecent).toBe(0);
    expect(s.health).toBe("healthy");
  });

  it("discarded / stopped 不進 active 計數；stopped 進 stoppedRecent", () => {
    const s = summarizeGroupAgentRuns(
      [
        { status: "discarded", projectId: "p1", updatedAt: recent },
        { status: "stopped", projectId: "p2", updatedAt: recent },
      ],
      now,
    );
    expect(s.active).toBe(0);
    expect(s.stoppedRecent).toBe(1);
    expect(s.health).toBe("healthy");
  });

  it("過舊 stopped 不計 stoppedRecent（與 failed／done 同一條近期窗）", () => {
    const s = summarizeGroupAgentRuns([{ status: "stopped", projectId: "p1", updatedAt: old }], now);
    expect(s.stoppedRecent).toBe(0);
    expect(s.hasRuns).toBe(true);
  });

  it("近期窗邊界：剛好落在 cutoff 上算近期，早一毫秒不算", () => {
    const recentMs = 7 * 24 * 60 * 60 * 1000;
    const onCutoff = new Date(now - recentMs).toISOString();
    const justBefore = new Date(now - recentMs - 1).toISOString();
    expect(summarizeGroupAgentRuns([{ status: "done", projectId: "p1", updatedAt: onCutoff }], now).doneRecent).toBe(1);
    expect(summarizeGroupAgentRuns([{ status: "done", projectId: "p1", updatedAt: justBefore }], now).doneRecent).toBe(0);
  });

  it("近期窗內時，五個狀態計數的總和等於非 discarded 的筆數（不再有計畫消失在數字之間）", () => {
    const runs = [
      { status: "running", projectId: "p1", updatedAt: recent },
      { status: "waiting", projectId: "p1", updatedAt: recent },
      { status: "awaiting_approval", projectId: "p2", updatedAt: recent },
      { status: "failed", projectId: "p2", updatedAt: recent },
      { status: "done", projectId: "p3", updatedAt: recent },
      { status: "stopped", projectId: "p3", updatedAt: recent },
      { status: "discarded", projectId: "p4", updatedAt: recent },
    ];
    const s = summarizeGroupAgentRuns(runs, now);
    const sum = s.running + s.waiting + s.awaitingApproval + s.failedRecent + s.doneRecent + s.stoppedRecent;
    expect(sum).toBe(runs.filter((r) => r.status !== "discarded").length);
  });
});

describe("foldGroupStatusAggregate（整組計數，不受清單 limit 影響）", () => {
  it("count 回字串也要正確累加；進行中看全部、終局看近期窗", () => {
    const counts = foldGroupStatusAggregate(
      [
        { status: "running", n: "2", nRecent: "1" },
        { status: "waiting", n: "1", nRecent: "0" },
        { status: "awaiting_approval", n: "3", nRecent: "3" },
        { status: "failed", n: "9", nRecent: "2" },
        { status: "done", n: "120", nRecent: "7" },
        { status: "stopped", n: "4", nRecent: "1" },
      ],
      2,
    );
    // running/waiting/awaiting_approval 是「當下」狀態，不套近期窗
    expect(counts.running).toBe(2);
    expect(counts.waiting).toBe(1);
    expect(counts.awaitingApproval).toBe(3);
    // failed/done/stopped 只認近期窗內的
    expect(counts.failedRecent).toBe(2);
    expect(counts.doneRecent).toBe(7);
    expect(counts.stoppedRecent).toBe(1);
    // totalRuns 算全部（含窗外），用來判斷 idle
    expect(counts.totalRuns).toBe(2 + 1 + 3 + 9 + 120 + 4);
    expect(counts.activeProjects).toBe(2);
  });

  it("空聚合 → totalRuns 0，摘要為 idle", () => {
    const counts = foldGroupStatusAggregate([], 0);
    expect(counts.totalRuns).toBe(0);
    expect(groupSummaryFromCounts(counts).health).toBe("idle");
  });

  it("整組有 200 筆完成、清單只看得到 30 筆時，doneRecent 仍回整組的數字", () => {
    // 這正是改成 SQL 聚合的理由：舊版把 limit 30 的視窗當成全組樣本
    const counts = foldGroupStatusAggregate([{ status: "done", n: "200", nRecent: "45" }], 0);
    expect(counts.doneRecent).toBe(45);
    expect(groupSummaryFromCounts(counts).hasRuns).toBe(true);
  });

  it("未知狀態不計入任何桶，但仍計入 totalRuns（不謊報 idle）", () => {
    const counts = foldGroupStatusAggregate([{ status: "some_future_status", n: "5", nRecent: "5" }], 0);
    expect(counts.running + counts.waiting + counts.awaitingApproval).toBe(0);
    expect(counts.totalRuns).toBe(5);
    expect(groupSummaryFromCounts(counts).health).toBe("healthy");
  });

  it("waiting_user_input / waiting_confirmation / waiting_permission 計入 waiting（PR-1 HUD）", () => {
    const counts = foldGroupStatusAggregate(
      [
        { status: "waiting_user_input", n: "2", nRecent: "2" },
        { status: "waiting_confirmation", n: "1", nRecent: "1" },
        { status: "waiting_permission", n: "1", nRecent: "1" },
      ],
      1,
    );
    expect(counts.waiting).toBe(4);
  });
});

describe("formatGroupBlockerDigest（S5：ask 的阻塞上下文）", () => {
  const base = {
    status: "blocked",
    openTasks: 5,
    overdueTasks: 2,
    blockers: [
      { severity: "critical", type: "overdue_task", label: "任務逾期：補齊角色定裝卡" },
      { severity: "warning", type: "waiting_human", label: "等待核准：確認旁白稿" },
    ],
    people: [
      { name: "阿光", userId: "u1", openTasks: 3, overdueTasks: 2 },
      { name: null, userId: null, openTasks: 2, overdueTasks: 0 },
    ],
    byProject: [
      { projectTitle: "招生短片", blockers: 2, criticalBlockers: 1, overdueTasks: 2 },
    ],
  };

  it("把阻塞、人員負荷與專案歸屬寫成結構化結論（不塞原始列）", () => {
    const text = formatGroupBlockerDigest(base);
    expect(text).toContain("有阻塞");
    expect(text).toContain("未結人員任務 5（逾期 2）");
    expect(text).toContain("[嚴重] 任務逾期：補齊角色定裝卡");
    expect(text).toContain("[注意] 等待核准：確認旁白稿");
    expect(text).toContain("阿光 3 件（逾期 2）");
    expect(text).toContain("尚未指派 2 件");
    expect(text).toContain("「招生短片」2 項（嚴重 1）");
  });

  it("沒有阻塞時明說「無」，不要留白讓模型自己想像", () => {
    const text = formatGroupBlockerDigest({ ...base, status: "healthy", blockers: [], people: [], byProject: [] });
    expect(text).toContain("無明顯阻塞");
    expect(text).toContain("阻塞：無");
  });

  it("阻塞過多時截斷並誠實說還有幾項", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ severity: "warning", type: "overdue_task", label: `第 ${i + 1} 項` }));
    const text = formatGroupBlockerDigest({ ...base, blockers: many });
    expect(text).toContain("（另有 4 項未列）");
    expect(text).not.toContain("第 9 項");
  });

  it("沒有任務在身的人不列（避免整組人名洗版提示詞）", () => {
    const text = formatGroupBlockerDigest({
      ...base,
      people: [{ name: "閒著", userId: "u9", openTasks: 0, overdueTasks: 0 }],
    });
    expect(text).not.toContain("閒著");
  });
});

describe("sanitizeContextUsed／sanitizeRationale（S5：決策軌跡的守門）", () => {
  it("只留白名單內的標籤，去重且限量", () => {
    expect(sanitizeContextUsed(["專案現況", "故事全文", "阻塞與人員負荷", "專案現況"]))
      .toEqual(["專案現況", "故事全文", "阻塞與人員負荷"]);
  });

  it("編造的來源一律丟掉——不設限的話它會編出看起來很專業卻沒讀過的名稱", () => {
    expect(sanitizeContextUsed(["財務報表", "使用者訪談紀錄", "專案現況"])).toEqual(["專案現況"]);
    expect(sanitizeContextUsed(["完全不存在的東西"])).toEqual([]);
  });

  it("非陣列／非字串一律回空，不會炸", () => {
    expect(sanitizeContextUsed(undefined)).toEqual([]);
    expect(sanitizeContextUsed("專案現況")).toEqual([]);
    expect(sanitizeContextUsed([1, null, {}, "組花費"])).toEqual(["組花費"]);
  });

  it("最多八個（提示詞回來再多也不全收）", () => {
    expect(sanitizeContextUsed([...TEAM_CONTEXT_LABELS]).length).toBe(8);
  });

  it("rationale 壓成單行並截到 300 字", () => {
    expect(sanitizeRationale("  依據阻塞清單，\n\n兩件逾期集中在同一案  ")).toBe("依據阻塞清單， 兩件逾期集中在同一案");
    expect(sanitizeRationale("字".repeat(400))!.length).toBe(301); // 300 + 省略號
    expect(sanitizeRationale("   ")).toBeUndefined();
    expect(sanitizeRationale(undefined)).toBeUndefined();
    expect(sanitizeRationale(123)).toBeUndefined();
  });
});

/* ── 組代理總指揮：指令提議的解析（L1/L2 的露出面） ── */

const commandRefs = {
  runs: [
    { ref: "r1", id: "10000000-0000-0000-0000-000000000001", projectTitle: "招生短片", status: "awaiting_approval", goal: "逐鏡出圖", estPoints: 40 },
    { ref: "r2", id: "10000000-0000-0000-0000-000000000002", projectTitle: "社課回顧", status: "running", goal: "配音", estPoints: 12 },
    { ref: "r3", id: "10000000-0000-0000-0000-000000000003", projectTitle: "禪修營", status: "failed", goal: "拆分鏡", estPoints: 8 },
  ],
  tasks: [
    { ref: "t1", id: "20000000-0000-0000-0000-000000000001", title: "借投影機", projectTitle: "招生短片", assigneeName: "阿光", overdueDays: 3 },
  ],
  members: [{ ref: "u1", id: "30000000-0000-0000-0000-000000000001", name: "阿光" }],
};

describe("resolveCommandProposals（LLM 代號指令 → 可執行動作）", () => {
  it("等級不足時一律回空——即使 LLM 越權提議也不落地", () => {
    for (const level of ["none", "dispatch"] as const) {
      expect(resolveCommandProposals(commandRefs, [{ kind: "approve_run", ref: "r1" }], level)).toEqual([]);
    }
  });

  it("有監督權時解析出真實 runId 與人看得懂的標籤（含估點，按之前就知道要花多少）", () => {
    const out = resolveCommandProposals(commandRefs, [{ kind: "approve_run", ref: "r1", reason: "三鏡都等它" }], "supervise");
    expect(out).toHaveLength(1);
    expect(out[0].command).toEqual({ kind: "approve_run", runId: "10000000-0000-0000-0000-000000000001" });
    expect(out[0].label).toContain("招生短片");
    expect(out[0].label).toContain("40 點");
    expect(out[0].reason).toBe("三鏡都等它");
  });

  it("狀態對不上的指令整筆丟掉——LLM 只看得到清單，不會自己想「這個狀態能不能做這件事」", () => {
    // r2 正在跑：不能核准也不能放棄；r1 待核准：不能停止也不能重跑
    const bad = resolveCommandProposals(commandRefs, [
      { kind: "approve_run", ref: "r2" },
      { kind: "discard_run", ref: "r2" },
      { kind: "stop_run", ref: "r1" },
      { kind: "retry_run", ref: "r1" },
    ], "supervise");
    expect(bad).toEqual([]);
  });

  it("狀態對得上的都放行：停正在跑的、重跑失敗的", () => {
    const out = resolveCommandProposals(commandRefs, [
      { kind: "stop_run", ref: "r2" },
      { kind: "retry_run", ref: "r3" },
    ], "supervise");
    expect(out.map((o) => o.command.kind)).toEqual(["stop_run", "retry_run"]);
  });

  it("幻覺的代號整筆略過", () => {
    expect(resolveCommandProposals(commandRefs, [{ kind: "approve_run", ref: "r9" }], "supervise")).toEqual([]);
    expect(resolveCommandProposals(commandRefs, [{ kind: "assign_task", ref: "t9", assigneeRef: "u1" }], "supervise")).toEqual([]);
  });

  it("assign_task 解析成員代號與明確日期；模糊日期不落地", () => {
    const out = resolveCommandProposals(commandRefs, [
      { kind: "assign_task", ref: "t1", assigneeRef: "u1", dueAt: "2026-08-10T00:00:00+08:00" },
      { kind: "assign_task", ref: "t1", dueAt: "下週五" },
    ], "supervise");
    expect(out).toHaveLength(1);
    expect(out[0].command).toMatchObject({ kind: "assign_task", taskId: "20000000-0000-0000-0000-000000000001", assigneeId: "30000000-0000-0000-0000-000000000001" });
    expect(out[0].label).toContain("阿光");
  });

  it("assign_task 三個欄位都沒有時丟掉（不給一顆什麼都不會改的按鈕）", () => {
    expect(resolveCommandProposals(commandRefs, [{ kind: "assign_task", ref: "t1" }], "supervise")).toEqual([]);
  });

  it("最多 4 筆——再多就變成另一種選項牆（用相異提議證明，否則會被去重規則蓋掉）", () => {
    const manyRefs = {
      ...commandRefs,
      runs: Array.from({ length: 8 }, (_, i) => ({
        ref: `r${i + 1}`,
        id: `10000000-0000-0000-0000-00000000000${i + 1}`,
        projectTitle: `案子 ${i + 1}`,
        status: "running",
        goal: "配音",
        estPoints: 5,
      })),
    };
    const many = Array.from({ length: 8 }, (_, i) => ({ kind: "stop_run" as const, ref: `r${i + 1}` }));
    expect(resolveCommandProposals(manyRefs, many, "command")).toHaveLength(4);
  });

  it("同一道指令重複提議只留一筆——四顆一模一樣的按鈕會把上限用完卻只給一個選擇", () => {
    const dup = Array.from({ length: 4 }, () => ({ kind: "stop_run" as const, ref: "r2" }));
    expect(resolveCommandProposals(commandRefs, dup, "command")).toHaveLength(1);
  });

  it("同一件任務但改的欄位不同，算兩筆不同的提議（改派與改期是兩個決定）", () => {
    const out = resolveCommandProposals(commandRefs, [
      { kind: "assign_task", ref: "t1", assigneeRef: "u1" },
      { kind: "assign_task", ref: "t1", dueAt: "2026-08-10T00:00:00+08:00" },
    ], "supervise");
    expect(out).toHaveLength(2);
  });
});

describe("formatCommandRefs（可下令對象的提示詞區塊）", () => {
  it("沒有監督權時整段不注入——不揭露做不到的動作", () => {
    expect(formatCommandRefs(commandRefs, "dispatch")).toBe("");
    expect(formatCommandRefs(commandRefs, "none")).toBe("");
  });

  it("有監督權時列出代號、專案、狀態與逾期天數（狀態要看得到，才不會提議做不到的事）", () => {
    const text = formatCommandRefs(commandRefs, "supervise");
    expect(text).toContain("r1｜「招生短片」｜待核准");
    expect(text).toContain("r3｜「禪修營」｜失敗");
    expect(text).toContain("逾期 3 天");
    expect(text).toContain("u1=阿光");
  });

  it("完全沒有可下令對象時回空字串（提示詞一字不多佔）", () => {
    expect(formatCommandRefs({ runs: [], tasks: [], members: [] }, "command")).toBe("");
  });
});

describe("TEAM_ASSISTANT_DATA_BOUNDARY_RULE（組級助手資料範圍邊界）", () => {
  it("明確宣告只能查本組、被問其他組要誠實說無法查詢（防「沒有動畫組的專案」誤導）", () => {
    const rule = TEAM_ASSISTANT_DATA_BOUNDARY_RULE;
    expect(rule).toContain("本組");
    expect(rule).toContain("我只能查詢本組資料");
    expect(rule).toContain("無法查詢其他組");
  });

  it("禁止把「看不到」推論成「該組沒有資料」（看不到 ≠ 不存在）", () => {
    const rule = TEAM_ASSISTANT_DATA_BOUNDARY_RULE;
    expect(rule).toContain("推論");
    expect(rule).toContain("不代表不存在");
    expect(rule).toContain("不要猜測");
  });

  it("列出／統計本組專案時只能列 <組現況> 清單上的，不得把其他來源的專案名當本組專案", () => {
    const rule = TEAM_ASSISTANT_DATA_BOUNDARY_RULE;
    expect(rule).toContain("只能列 <組現況> 清單上出現的專案");
    expect(rule).toContain("嚴禁把先前對話、資料庫搜尋或其他任何來源出現過的專案名當成本組專案");
  });
});

describe("detectCrossGroupMention（資料層邊界強制：跨組請求短迴路）", () => {
  // 模擬系統裡的組名（對應測試案例：剪輯組／文宣組／動畫組／卉庭組／短影音組）
  const allGroups = [
    { groupId: "g-editing", groupName: "剪輯組" },
    { groupId: "g-copy", groupName: "文宣組" },
    { groupId: "g-anim", groupName: "動畫組" },
    { groupId: "g-huiting", groupName: "卉庭組" },
    { groupId: "g-short", groupName: "短影音組" },
  ];

  it("盤點其他組專案：明確點名其他組 → 回該組名（複測準則一/二的根因案例）", () => {
    expect(detectCrossGroupMention("請統計文宣組現在一共有幾個專案", "剪輯組", allGroups))
      .toEqual({ targetGroupName: "文宣組" });
    expect(detectCrossGroupMention("盤點動畫組的專案", "短影音組", allGroups))
      .toEqual({ targetGroupName: "動畫組" });
  });

  it("比較／跨組請求也命中（只要訊息裡有非本組的組名就攔，不管怎麼問）", () => {
    expect(detectCrossGroupMention("比較文宣組和剪輯組的專案量", "剪輯組", allGroups))
      .toEqual({ targetGroupName: "文宣組" });
  });

  it("自查（訊息提到本組名）不算跨組 → 回 null，正常走 LLM", () => {
    expect(detectCrossGroupMention("列出文宣組所有專案", "文宣組", allGroups)).toBeNull();
    expect(detectCrossGroupMention("本組現在有幾個專案？", "文宣組", allGroups)).toBeNull();
    expect(detectCrossGroupMention("我們組有哪些案子在跑", "剪輯組", allGroups)).toBeNull();
  });

  it("組名子字串遮蔽：本組「新文宣組」自問不會被「文宣組」誤判成跨組", () => {
    const nested = [...allGroups, { groupId: "g-copy2", groupName: "新文宣組" }];
    expect(detectCrossGroupMention("新文宣組現在有幾個專案", "新文宣組", nested)).toBeNull();
    // 但真的問「文宣組」（另一組）仍要攔
    expect(detectCrossGroupMention("文宣組現在有幾個專案", "新文宣組", nested))
      .toEqual({ targetGroupName: "文宣組" });
  });

  it("訊息不含任何組名 → null；空白訊息 → null", () => {
    expect(detectCrossGroupMention("幫我看看本組有哪些瓶頸", "剪輯組", allGroups)).toBeNull();
    expect(detectCrossGroupMention("   ", "剪輯組", allGroups)).toBeNull();
  });
});

describe("buildSelfCheckClarification（自查釐清：本組組名寫給 LLM 看）", () => {
  it("含本組組名與「提到本組名＝自查、要正常回答」的明確指示", () => {
    const note = buildSelfCheckClarification("文宣組");
    expect(note).toContain("文宣組");
    expect(note).toContain("本組");
    expect(note).toContain("自查");
    expect(note).toContain("必須正常回答");
  });

  it("組名空白（auth 解析不到）回空字串——不佔提示詞、不多一行意義不明的說明", () => {
    expect(buildSelfCheckClarification("")).toBe("");
    expect(buildSelfCheckClarification("   ")).toBe("");
  });

  it("組名前後空白 trim 後才寫入（auth 解析的組名可能帶多餘空白）", () => {
    const note = buildSelfCheckClarification("  剪輯組  ");
    expect(note).toContain("「剪輯組」");
    expect(note).not.toContain("「  剪輯組」");
  });
});

describe("project_detail injects persisted story", () => {
  it("reads stories.content through formatPersistedStoryForAssistant", () => {
    const src = readFileSync(new URL("./teamAssistant.ts", import.meta.url), "utf8");
    const block = src.slice(src.indexOf('if (call.tool === "project_detail")'), src.indexOf('if (call.tool === "read_scene")'));
    expect(block).toContain("formatPersistedStoryForAssistant");
    expect(block).toContain("schema.stories.content");
    expect(block).toContain("storyBlock");
    expect(TEAM_CONTEXT_LABELS).toContain("故事全文");
  });

  it("組現況 lists 有故事稿／尚未儲存稿 without dumping 故事全文", () => {
    const src = readFileSync(new URL("./teamAssistant.ts", import.meta.url), "utf8");
    const inventory = src.slice(src.indexOf("let storyRows"), src.indexOf("const hidden = totalProjects"));
    expect(inventory).toContain("formatTeamInventoryStoryFlag");
    expect(inventory).toContain("schema.stories");
    expect(inventory).toContain("${storyFlag}");
    expect(inventory).not.toContain("formatPersistedStoryForAssistant");
  });

  it("team ask binds the same 120s wall-clock as project/site assistant", () => {
    const src = readFileSync(new URL("./teamAssistant.ts", import.meta.url), "utf8");
    expect(src).toContain("bindAssistantAskDeadline");
    expect(src).toContain("ASSISTANT_ASK_TIMEOUT_MESSAGE");
    expect(src).toContain("signal: askSignal");
  });

  it("只用免費 never calls luna: assertFreeOnlyCompletion wraps completeText", () => {
    const src = readFileSync(new URL("./teamAssistant.ts", import.meta.url), "utf8");
    expect(src).toContain("assertFreeOnlyCompletion");
    expect(src).toContain("allowPaidFallback: quality === \"auto\"");
    expect(src).toContain("resolveFreeOnlyLlmMode");
  });

  it("story-read injects THIS project's stories.content only and locks 她 / no 疲憊", () => {
    const src = readFileSync(new URL("./teamAssistant.ts", import.meta.url), "utf8");
    expect(src).toContain("isAssistantStoryReadIntent");
    expect(src).toContain("pickNamedStoryProject");
    expect(src).toContain("loadPersistedStoryRow");
    expect(src).toContain("lockAssistantStoryAnswer");
    expect(src).toContain("STORY_READ_THIS_PROJECT_LOCK");
    expect(src).toContain("storyReadAsk ? 0 : MAX_TOOL_ROUNDS");
    expect(src).toContain("storyReadAsk ? [] : await retrieveDatabaseEvidence");
    expect(src).toContain("storyReadAsk ? \"\" : historyBlock");
    expect(src).toContain("fallbackReadOnlyStorySummary");
    expect(src).not.toContain("已完成盤點");
  });
});

