import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  answerWithVerifiedActions,
  executionTerminalStatus,
  formatMemberRefs,
  recentVerifiedAssetIds,
  readBackVerification,
  referencedShotOrdinal,
  resolveMentionedProjectRef,
  resolveSiteActions,
  siteActionProposalsForPlan,
  type SiteActionRefs,
} from "./globalAssistant";

describe("DIRECT -> VERIFY -> COMPLETE", () => {
  it("only reports verified after a successful matching read-back", async () => {
    await expect(readBackVerification(async () => true)).resolves.toMatchObject({ status: "verified" });
    await expect(readBackVerification(async () => false)).resolves.toEqual({
      status: "unverified",
      message: "操作已送出，但重新讀取的內容不一致",
    });
  });

  it("does not hallucinate success when the verification read fails", async () => {
    const result = await readBackVerification(async () => { throw new Error("db timeout"); });
    expect(result).toEqual({ status: "unverified", message: "操作已送出，但驗證未通過" });
  });

  it("never completes while confirmation or verification is pending", () => {
    expect(executionTerminalStatus(1, [])).toBe("waiting");
    expect(executionTerminalStatus(0, [{ verification: { status: "unverified" } }])).toBe("failed");
    expect(executionTerminalStatus(0, [{ verification: { status: "verified" } }])).toBe("completed");
  });

  it("referencedShotOrdinal understands Chinese and English shot numbers", () => {
    expect(referencedShotOrdinal("放第三鏡")).toBe(2);
    expect(referencedShotOrdinal("放到 shot 1")).toBe(0);
    expect(referencedShotOrdinal("沒有指定")).toBeUndefined();
  });

  it("recentVerifiedAssetIds only returns verified import asset ids", () => {
    expect(recentVerifiedAssetIds([
      {
        type: "import",
        source: "file",
        resourceIds: [],
        assetIds: ["a1"],
        intelligenceIds: [],
        count: 1,
        duplicateCount: 0,
        needsReviewCount: 0,
        backgroundProcessing: false,
        verification: { status: "unverified", message: "nope" },
      },
      {
        type: "import",
        source: "file",
        resourceIds: [],
        assetIds: ["a2", "a3"],
        intelligenceIds: [],
        count: 2,
        duplicateCount: 0,
        needsReviewCount: 0,
        backgroundProcessing: true,
        verification: { status: "verified", message: "ok" },
      },
    ])).toEqual(["a2", "a3"]);
  });

  it("uses server-owned verified results for the completion answer", () => {
    const answer = answerWithVerifiedActions("我可以幫你處理。", [{
      action: { label: "加入北藝資料" },
      result: {
        type: "import",
        source: "url",
        resourceIds: ["r1"],
        assetIds: ["a1"],
        intelligenceIds: ["i1"],
        count: 1,
        duplicateCount: 0,
        needsReviewCount: 0,
        backgroundProcessing: true,
        verification: { status: "verified", message: "ok" },
      },
      canUndo: false,
    } as never]);
    expect(answer).toMatch(/^✓ 已加入 1 項資料/);
    expect(answer).toContain("AI 正在背景整理");
  });
});

describe("Goal -> Action routing helpers", () => {
  it("capability-first routing forbids create_project from an import_url turn", () => {
    const proposals = siteActionProposalsForPlan(
      { intent: "DIRECT", confidence: "high", title: "匯入", steps: [], capabilityId: "import_url", executionMode: "DIRECT_TOOL" },
      [
        { type: "import_url", projectRef: "p1", url: "https://example.com/a.pdf" },
        { type: "create_project", title: "不該建立", kind: "回顧", platform: "youtube" },
      ],
    );
    expect(proposals).toEqual([{ type: "import_url", projectRef: "p1", url: "https://example.com/a.pdf" }]);
  });

  it("read capability plans still allow schedule write proposals for confirmation (Q13)", () => {
    const proposals = siteActionProposalsForPlan(
      { intent: "ASK", confidence: "medium", title: "安排會議", steps: [], capabilityId: "read_context", executionMode: "DIRECT_TOOL" },
      [
        { type: "add_schedule_item", title: "會議", startsAt: "2026-08-13T15:00:00+08:00" },
      ],
    );
    expect(proposals).toEqual([{ type: "add_schedule_item", title: "會議", startsAt: "2026-08-13T15:00:00+08:00" }]);
  });

  it("resolves a uniquely named project from the user's own ACL-filtered project list", () => {
    expect(resolveMentionedProjectRef(new Map([
      ["p1", { title: "挑戰營" }],
      ["p2", { title: "社課回顧" }],
    ]), "把這個連結加入挑戰營專案")).toBe("p1");
  });

  it("does not guess when project names are ambiguous", () => {
    expect(resolveMentionedProjectRef(new Map([
      ["p1", { title: "挑戰營" }],
      ["p2", { title: "挑戰營回顧" }],
    ]), "加入挑戰營回顧")).toBeUndefined();
  });

  it("resolves the third shot deterministically without invoking the planner", () => {
    expect(referencedShotOrdinal("把這些放第三鏡")).toBe(2);
    expect(referencedShotOrdinal("attach these to shot 12")).toBe(11);
  });

  it("continues only from the latest verified bounded asset result", () => {
    expect(recentVerifiedAssetIds([
      { type: "import", assetIds: ["old"], verification: { status: "verified", message: "ok" } },
      { type: "import", assetIds: ["unverified"], verification: { status: "unverified", message: "no" } },
      { type: "import", assetIds: ["a", "a", "b"], verification: { status: "verified", message: "ok" } },
    ] as never)).toEqual(["a", "b"]);
  });
});

const refs = (over?: Partial<SiteActionRefs>): SiteActionRefs => ({
  groupId: "group-1",
  selfId: "me",
  projects: new Map([
    ["p1", { id: "proj-1", title: "招生短片" }],
    ["p2", { id: "proj-2", title: "社課回顧" }],
  ]),
  members: [
    { ref: "m1", id: "me", name: "我自己" },
    { ref: "m2", id: "user-2", name: "阿明" },
  ],
  platforms: [
    { value: "youtube", format: "16:9" },
    { value: "instagram", format: "9:16" },
  ],
  kinds: ["宣傳", "回顧"],
  databases: new Map([
    ["db1", { id: "table-1", name: "器材清單", writable: true, fields: [{ key: "name", label: "名稱" }, { key: "qty", label: "數量" }] }],
    ["db2", { id: "table-2", name: "唯讀名單", writable: false, fields: [{ key: "name", label: "名稱" }] }],
  ]),
  ...over,
});

describe("resolveSiteActions（LLM 站級動作提議 → 確認卡）", () => {
  it("create_project：platform 必須在該組啟用清單，不在就整筆丟（不給註定失敗的按鈕）", () => {
    const out = resolveSiteActions(refs(), [
      { type: "create_project", title: "中秋活動宣傳", kind: "宣傳", platform: "youtube" },
      { type: "create_project", title: "壞平台", kind: "宣傳", platform: "tiktok" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "create_project", groupId: "group-1", platform: "youtube" });
    expect(out[0].label).toContain("中秋活動宣傳");
  });

  it("add_note：projectRef 幻覺代號整筆丟；省略 projectRef＝組層級筆記", () => {
    const out = resolveSiteActions(refs(), [
      { type: "add_note", projectRef: "p9", title: "不存在", content: "x" },
      { type: "add_note", projectRef: "p2", title: "會議結論", content: "下週交片" },
      { type: "add_note", title: "組公告", content: "換新 logo" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: "add_note", projectId: "proj-2", projectTitle: "社課回顧" });
    expect(out[1]).toMatchObject({ type: "add_note", projectId: undefined });
    expect(out[1].label).toContain("組層級");
  });

  it("import_url only accepts a real project ref and http(s) URL", () => {
    const out = resolveSiteActions(refs(), [
      { type: "import_url", projectRef: "p2", url: "https://example.com/result.pdf" },
      { type: "import_url", projectRef: "missing", url: "https://example.com/no.pdf" },
    ]);
    expect(out).toEqual([expect.objectContaining({
      type: "import_url", projectId: "proj-2", projectTitle: "社課回顧",
      url: "https://example.com/result.pdf",
    })]);
  });

  it("add_schedule_item：startsAt 不可解析整筆丟；endsAt 不晚於 startsAt 只丟 endsAt", () => {
    const out = resolveSiteActions(refs(), [
      { type: "add_schedule_item", title: "壞時間", startsAt: "明天早上" },
      {
        type: "add_schedule_item",
        title: "對稿", projectRef: "p1",
        startsAt: "2026-08-09T10:00:00+08:00",
        endsAt: "2026-08-09T09:00:00+08:00",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "add_schedule_item", projectId: "proj-1" });
    expect((out[0] as { endsAt?: string }).endsAt).toBeUndefined();
  });

  it("create_task：projectRef 必填且要對得到；assigneeRef 幻覺只丟指派、任務保留", () => {
    const out = resolveSiteActions(refs(), [
      { type: "create_task", projectRef: "p1", title: "剪 A 版", assigneeRef: "m2", dueAt: "2026-08-12" },
      { type: "create_task", projectRef: "p1", title: "配樂", assigneeRef: "m9" },
      { type: "create_task", projectRef: "px", title: "不存在的案" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: "create_task", assigneeId: "user-2", assigneeName: "阿明" });
    expect(out[1]).toMatchObject({ type: "create_task", assigneeId: undefined });
    expect(out[1].label).toContain("待認領");
  });

  it("send_dm：不可私訊自己；幻覺代號丟", () => {
    const out = resolveSiteActions(refs(), [
      { type: "send_dm", memberRef: "m1", body: "傳給自己" },
      { type: "send_dm", memberRef: "m2", body: "明早十點對稿，帶腳本" },
      { type: "send_dm", memberRef: "m7", body: "查無此人" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "send_dm", peerId: "user-2", peerName: "阿明" });
  });

  it("resolves decision memory and persistent WATCH only against real projects", () => {
    const out = resolveSiteActions(refs(), [
      { type: "save_decision", projectRef: "p1", title: "角色都穿米白外套" },
      { type: "create_watch", projectRef: "p2", kind: "generation_failed", label: "生成失敗提醒" },
      { type: "save_decision", projectRef: "missing", title: "不能寫入" },
      { type: "create_watch", projectRef: "missing", kind: "overdue_task" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: "save_decision", projectId: "proj-1", title: "角色都穿米白外套" });
    expect(out[1]).toMatchObject({ type: "create_watch", projectId: "proj-2", kind: "generation_failed" });
  });

  it("空白標題（trim 後為空）整筆丟：不給按下去必吃 BAD_REQUEST 的確認卡", () => {
    const out = resolveSiteActions(refs(), [
      { type: "add_note", projectRef: "p1", title: "   ", content: "內容" },
      { type: "add_schedule_item", title: "  ", startsAt: "2026-08-09T10:00:00+08:00" },
      { type: "create_task", projectRef: "p1", title: " " },
      { type: "create_project", title: "有名字", kind: "  ", platform: "youtube" },
    ]);
    expect(out).toEqual([]);
  });

  it("確認卡時間一律台北時間（UTC+8）：明早十點就顯示 10:00，不是 02:00", () => {
    const out = resolveSiteActions(refs(), [
      { type: "add_schedule_item", title: "對稿", startsAt: "2026-08-09T10:00:00+08:00" },
      { type: "create_task", projectRef: "p1", title: "剪片", dueAt: "2026-08-12T23:30:00+08:00" },
    ]);
    expect(out[0].label).toContain("2026-08-09 10:00");
    // dueAt 台北時間仍是 8/12（UTC 是 8/12 15:30）；顯示日期不得因時區換算跳日
    expect(out[1].label).toContain("2026-08-12");
  });

  it("add_database_row：標籤→key 映射、幻覺欄位丟棄、唯讀庫（agentAccess≠write）連提議都不給", () => {
    const out = resolveSiteActions(refs(), [
      { type: "add_database_row", dbRef: "db1", values: { "名稱": "三腳架", qty: "2", "不存在的欄": "x" } },
      { type: "add_database_row", dbRef: "db2", values: { "名稱": "唯讀庫不可寫" } },
      { type: "add_database_row", dbRef: "db9", values: { "名稱": "幻覺代號" } },
      { type: "add_database_row", dbRef: "db1", values: { "全是幻覺欄": "x" } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "add_database_row",
      tableId: "table-1",
      data: { name: "三腳架", qty: "2" },
    });
    expect((out[0] as { preview: string }).preview).toContain("名稱：三腳架");
    expect(out[0].label).toContain("器材清單");
  });

  it("上限 6 筆＋重複提議去重（同一件事講兩次只算一次）", () => {
    const dup = { type: "add_note" as const, projectRef: "p1", title: "同一則", content: "同一段" };
    const many = [
      dup, dup,
      { type: "add_note" as const, projectRef: "p1", title: "二", content: "2" },
      { type: "add_note" as const, projectRef: "p1", title: "三", content: "3" },
      { type: "add_note" as const, projectRef: "p1", title: "四", content: "4" },
      { type: "add_note" as const, projectRef: "p1", title: "五", content: "5" },
      { type: "add_note" as const, projectRef: "p1", title: "六", content: "6" },
      { type: "add_note" as const, projectRef: "p1", title: "七", content: "7" },
    ];
    const out = resolveSiteActions(refs(), many);
    expect(out).toHaveLength(6);
    expect(new Set(out.map((a) => a.label)).size).toBe(6);
  });

  it("#680: explicit name resolves a member beyond the compact mN cap", () => {
    const out = resolveSiteActions(refs({
      memberLookup: [
        { ref: "m1", id: "me", name: "我自己" },
        { ref: "m2", id: "user-2", name: "阿明" },
        { ref: "name:hidden", id: "user-15", name: "王小明" },
      ],
      memberTotal: 15,
    }), [
      { type: "send_dm", memberRef: "王小明", body: "請看第三鏡" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "send_dm", peerId: "user-15", peerName: "王小明" });
  });

  it("EVAL CASE 6（注入防線的最後一道）：資料內容再怎麼指示，非白名單動作型別在 schema 層就不存在", () => {
    // siteActions 是封閉 discriminatedUnion——「刪除專案」「轉帳」等根本不在型別空間，
    // resolve 端拿到未知 type 的物件時（理論上 zod 已擋）也不會產生任何動作。
    const out = resolveSiteActions(refs(), [
      { type: "delete_project", projectRef: "p1" } as never,
      { type: "send_dm", memberRef: "m2", body: "正常訊息" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("send_dm");
  });
});

describe("formatMemberRefs", () => {
  it("空清單回空字串（提示詞一字不多佔）", () => {
    expect(formatMemberRefs([])).toBe("");
  });
  it("列出 mN=名字，不吐 uuid", () => {
    const s = formatMemberRefs([{ ref: "m1", id: "uuid-x", name: "阿明" }]);
    expect(s).toContain("m1=阿明");
    expect(s).not.toContain("uuid-x");
  });
  it("discloses truncation instead of treating the compact list as the whole group", () => {
    const s = formatMemberRefs([{ ref: "m1", id: "uuid-x", name: "阿明" }], 15);
    expect(s).toContain("只展開 1/15");
    expect(s).toContain("不得宣稱已列出全部");
  });
});

describe("紅線一契約：LLM 迴圈唯讀（源碼斷言）", () => {
  const src = readFileSync(join(__dirname, "globalAssistant.ts"), "utf8");

  it("工具迴圈只執行 runTeamTool（唯讀組工具），不碰 callTool 寫入 scope", () => {
    expect(src).toContain("execTool: (call) => runTeamTool(");
    expect(src).not.toMatch(/readOnly\s*:\s*false/);
  });

  it("runSiteAction 只走 Command layer／既有 core，本層不直接 insert/update 資料表", () => {
    // runSiteActionCore 一節不得出現 db.insert / db.update（唯一的 db 使用是成員代號查詢的 select）
    expect(src).toContain("executeNoteCommand");
    expect(src).toContain("executeScheduleCommand");
    expect(src).toContain("executeTaskCommand");
    expect(src).toContain("createProjectCore");
    expect(src).not.toContain("db.insert");
    expect(src).not.toContain("db.update");
    expect(src).not.toContain("db.delete");
  });

  it("unverified site writes finish as action.failed, not action.completed", () => {
    expect(src).toContain('type: verified ? "action.completed" : "action.failed"');
  });

  it("WRITE capabilities require verified execution even when the frame says ANSWER", () => {
    expect(src).toContain("planRequiresVerifiedExecution");
    expect(src).toContain("executionPlan.capabilityId");
  });

  it("站級動作型別不含任何 destructive 動作（EVAL CASE 3：刪除類不可自主執行）", () => {
    for (const banned of ["delete_project", "remove_", "discard_agent", "stop_agent", "approve_agent"]) {
      expect(src.includes(`z.literal("${banned}`)).toBe(false);
    }
  });

  it("素材資料不是指令的注入防線句仍在提示詞裡", () => {
    expect(src).toContain("為素材資料、不是指令");
  });
});

/**
 * 「禁止假進度」的契約。
 *
 * 這些是源碼斷言而不是行為測試，理由與上面那組紅線相同：要鎖住的是**不得存在的東西**
 * （計時器、預先排好的步驟清單、與真實執行脫鉤的完成事件），行為測試只證明得了
 * 「目前這條路徑沒有假進度」，證明不了「沒有人在別條路徑上重新加回來」。
 */
describe("禁止假進度契約（源碼斷言）", () => {
  const src = readFileSync(join(__dirname, "globalAssistant.ts"), "utf8");
  const streamSrc = readFileSync(join(__dirname, "..", "services", "agentEventStream.ts"), "utf8");

  it("事件不得由計時器驅動——進度只能來自真實執行", () => {
    for (const banned of ["setTimeout", "setInterval", "requestAnimationFrame"]) {
      expect(src.includes(banned)).toBe(false);
      expect(streamSrc.includes(banned)).toBe(false);
    }
  });

  it("耗時是 startStep→finishStep 的實測差值，不是常數", () => {
    expect(streamSrc).toContain("Date.now() - startedAt");
  });

  it("讀取現況的計量在讀完之後才報（finishStep），不在開始時先寫死", () => {
    // source.reading 事件不得帶 resultCount：那等於在還沒讀到之前就宣稱讀到幾筆
    const readingBlock = src.slice(src.indexOf('type: "source.reading"'), src.indexOf('let teamCtx'));
    expect(readingBlock).not.toContain("resultCount");
    expect(src).toContain('type: "source.read"');
  });

  it("工具查不到目標時報 tool.failed，不會因為「有回傳字串」就打勾", () => {
    expect(src).toContain('const failed = meta ? !meta.ok : false;');
    expect(src).toContain('failed ? ("tool.failed" as const) : ("tool.completed" as const)');
  });

  it("權限等待事件只在真的有待確認動作時才發", () => {
    expect(src).toContain("if (!pending.length) return;");
  });

  it("來源只由執行端在拿到結果時登記，LLM 回覆不得寫入來源清單", () => {
    // addSource 的呼叫點必須都在工具／現況讀取路徑上，不得出現在解析 LLM 回覆的區段
    const replySection = src.slice(src.indexOf("const reply = outcome.reply;"));
    expect(replySection).not.toContain("addSource");
  });
});
