import { describe, expect, it } from "vitest";
import { campaignSummaryText, resolveCampaignPlan, type CampaignRefs } from "./groupCampaignCore";
import { MAX_WATCH_ATTEMPTS, type GroupPlanDraft } from "../../shared/groupAgent";

const refs: CampaignRefs = {
  projects: [
    { ref: "p1", id: "11111111-1111-1111-1111-111111111111", title: "招生短片", note: "video" },
    { ref: "p2", id: "22222222-2222-2222-2222-222222222222", title: "社課回顧", note: "video" },
  ],
  tasks: [
    { ref: "t1", id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "借投影機", note: "「招生短片」｜阿光｜todo" },
  ],
  members: [{ ref: "u1", id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "阿光" }],
  kinds: ["見證故事", "活動宣傳"],
  platforms: ["youtube", "instagram"],
};

/** 全新的組：沒有專案、沒有任務，只有可用的內容類型與平台（create_project 存在的理由） */
const emptyRefs: CampaignRefs = { projects: [], tasks: [], members: refs.members, kinds: refs.kinds, platforms: refs.platforms };

const draft = (steps: GroupPlanDraft["steps"]): GroupPlanDraft => ({ summary: "測試計畫", steps });

describe("resolveCampaignPlan（規劃草稿 → 可執行步驟）", () => {
  it("正常的派工＋盯進度解析出真實 id，並自動補上 watch 對 dispatch 的依賴", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "dispatch", title: "派工", projectRef: "p1", goal: "把腳本拆成分鏡並逐鏡出圖" },
      { id: "s2", kind: "watch", title: "盯著", targetStepId: "s1", maxAttempts: 2 },
    ]), refs);
    expect(steps).toHaveLength(2);
    expect(steps[0].projectId).toBe("11111111-1111-1111-1111-111111111111");
    expect(steps[0].projectTitle).toBe("招生短片");
    // LLM 常常漏寫這條依賴，漏了就會在子計畫還沒建立時開始盯
    expect(steps[1].dependsOn).toEqual(["s1"]);
    expect(steps[1].maxAttempts).toBe(2);
    expect(steps[1].attempts).toBe(0);
  });

  it("幻覺的專案代號整步丟掉，不留一顆註定失敗的按鈕給執行器", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "dispatch", title: "派工", projectRef: "p9", goal: "這個代號不存在" },
      { id: "s2", kind: "dispatch", title: "派工", projectRef: "p2", goal: "這筆合法，應保留" },
    ]), refs);
    expect(steps).toHaveLength(1);
    expect(steps[0].projectId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("派工目標不足 5 字整步丟掉（與 planAgentCore 的下限一致）", () => {
    expect(resolveCampaignPlan(draft([{ id: "s1", kind: "dispatch", title: "派工", projectRef: "p1", goal: "太短" }]), refs)).toEqual([]);
  });

  it("watch 指不到任何 dispatch 步驟就整步移除——沒有子計畫可盯的 watch 是死步", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "report", title: "結論" },
      { id: "s2", kind: "watch", title: "盯著", targetStepId: "s1" },
      { id: "s3", kind: "watch", title: "盯不存在的", targetStepId: "s9" },
    ]), refs);
    expect(steps.map((s) => s.id)).toEqual(["s1"]);
  });

  it("dependsOn 指向被丟掉或不存在的步驟時移除該依賴，否則整條支線永遠等不到", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "dispatch", title: "會被丟掉", projectRef: "p9", goal: "幻覺代號" },
      { id: "s2", kind: "report", title: "結論", dependsOn: ["s1", "s7"] },
    ]), refs);
    expect(steps).toHaveLength(1);
    expect(steps[0].dependsOn).toBeUndefined();
  });

  it("自我依賴會被移除（LLM 偶爾會寫出 s1 依賴 s1）", () => {
    const steps = resolveCampaignPlan(draft([{ id: "s1", kind: "report", title: "結論", dependsOn: ["s1"] }]), refs);
    expect(steps[0].dependsOn).toBeUndefined();
  });

  it("重複的步驟 id 只留第一筆（否則依賴指向誰是未定義行為）", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "report", title: "第一個" },
      { id: "s1", kind: "report", title: "重複的" },
    ]), refs);
    expect(steps).toHaveLength(1);
    expect(steps[0].title).toBe("第一個");
  });

  it("assign_task 解析人員代號；三個欄位都沒有時丟掉（那是一顆什麼都不會改的按鈕）", () => {
    const ok = resolveCampaignPlan(draft([
      { id: "s1", kind: "assign_task", title: "改派", taskRef: "t1", assigneeRef: "u1" },
    ]), refs);
    expect(ok[0].taskId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(ok[0].assigneeId).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    expect(resolveCampaignPlan(draft([{ id: "s1", kind: "assign_task", title: "什麼都沒改", taskRef: "t1" }]), refs)).toEqual([]);
  });

  it("assign_task 的模糊日期不落地——只收解析得出來的時間", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "assign_task", title: "改期", taskRef: "t1", dueAt: "下週五" },
      { id: "s2", kind: "assign_task", title: "改期", taskRef: "t1", dueAt: "2026-08-10T00:00:00+08:00" },
    ]), refs);
    expect(steps.map((s) => s.id)).toEqual(["s2"]);
    expect(steps[0].dueAt).toBe(new Date("2026-08-10T00:00:00+08:00").toISOString());
  });

  it("重試次數收斂到硬頂，負值收成 0", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "dispatch", title: "派工", projectRef: "p1", goal: "把腳本拆成分鏡" },
      { id: "s2", kind: "watch", title: "盯著", targetStepId: "s1", maxAttempts: 3 },
      { id: "s3", kind: "watch", title: "超過硬頂", targetStepId: "s1", maxAttempts: 99 },
      { id: "s4", kind: "watch", title: "負值", targetStepId: "s1", maxAttempts: -5 },
    ]), refs);
    expect(steps[1].maxAttempts).toBe(3);
    expect(steps[2].maxAttempts).toBe(MAX_WATCH_ATTEMPTS);
    expect(steps[3].maxAttempts).toBe(0);
  });

  it("步驟數超過上限時只留前 12 步", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, kind: "report" as const, title: `第 ${i} 步` }));
    expect(resolveCampaignPlan(draft(many), refs)).toHaveLength(12);
  });

  it("所有步驟一律以 pending 落地——執行期欄位不接受規劃器指定", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "dispatch", title: "派工", projectRef: "p1", goal: "把腳本拆成分鏡" },
    ]), refs);
    expect(steps[0].status).toBe("pending");
    expect(steps[0].childRunId).toBeUndefined();
  });
});

/**
 * create_project 是組代理唯一會「在組裡長出新東西」的步驟，也是「幫我開一個中秋活動宣傳專案」
 * 這句話唯一能成立的地方——agentRunner 的每份 run 都綁死一個 projectId，還不存在的專案沒有
 * run 可以掛，所以它只能落在組層。這一組守的是它的三個要害：能不能派到剛開的專案、
 * 平台亂猜會不會讓整份計畫作廢、以及會不會一口氣開出一整排空專案。
 */
describe("resolveCampaignPlan：create_project", () => {
  it("開專案後派工到它——projectRef 寫的是那一步的 id，並自動補上依賴", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "create_project", title: "開專案", projectTitle: "中秋活動宣傳", projectKind: "活動宣傳", platform: "instagram" },
      { id: "s2", kind: "dispatch", title: "做內容", projectRef: "s1", goal: "寫一支 30 秒的中秋活動宣傳短片" },
    ]), emptyRefs);
    expect(steps).toHaveLength(2);
    expect(steps[0].projectTitle).toBe("中秋活動宣傳");
    expect(steps[0].platform).toBe("instagram");
    expect(steps[0].projectKind).toBe("活動宣傳");
    // 規劃當下那個專案還不存在，只能記下「跟哪一步拿」
    expect(steps[1].projectId).toBeUndefined();
    expect(steps[1].projectFromStepId).toBe("s1");
    // 漏寫這條依賴的話，執行器會在專案還沒建出來時就去派工
    expect(steps[1].dependsOn).toEqual(["s1"]);
  });

  it("dispatch 寫在 create_project 前面也認得——規劃器不保證按執行順序輸出", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s2", kind: "dispatch", title: "做內容", projectRef: "s1", goal: "寫一支中秋活動宣傳短片" },
      { id: "s1", kind: "create_project", title: "開專案", projectTitle: "中秋活動宣傳", platform: "instagram" },
    ]), emptyRefs);
    expect(steps.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(steps[0].projectFromStepId).toBe("s1");
  });

  it("平台猜錯就退回第一個可用的——不為了一個名字讓整份計畫作廢", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "create_project", title: "開專案", projectTitle: "中秋活動", platform: "tiktok" },
    ]), emptyRefs);
    expect(steps[0].platform).toBe("youtube");
    expect(steps[0].projectKind).toBe("見證故事"); // 沒給內容類型就用第一個可用的
  });

  it("組裡完全沒有可用平台時整步丟掉——開不起來的專案不要留在計畫裡", () => {
    const noPlatform: CampaignRefs = { ...emptyRefs, platforms: [] };
    expect(resolveCampaignPlan(draft([
      { id: "s1", kind: "create_project", title: "開專案", projectTitle: "中秋活動", platform: "youtube" },
    ]), noPlatform)).toEqual([]);
  });

  it("沒有專案名稱就丟掉（沒有標題的專案建不起來）", () => {
    expect(resolveCampaignPlan(draft([
      { id: "s1", kind: "create_project", title: "   ", platform: "youtube" },
    ]), emptyRefs)).toEqual([]);
  });

  it("step.title 可以當專案名稱的退路——規劃器常常只填一個標題", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "create_project", title: "中秋活動宣傳", platform: "youtube" },
    ]), emptyRefs);
    expect(steps[0].projectTitle).toBe("中秋活動宣傳");
  });

  it("一份計畫最多開 3 個新專案——含糊的目標不該長出一整排空專案", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`, kind: "create_project" as const, title: `專案 ${i}`, platform: "youtube",
    }));
    const steps = resolveCampaignPlan(draft(many), emptyRefs);
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
  });

  it("指向被上限砍掉的 create_project 的 dispatch 也一起移除，不留一顆執行期才爆的步驟", () => {
    const steps = resolveCampaignPlan(draft([
      ...Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, kind: "create_project" as const, title: `專案 ${i}`, platform: "youtube" })),
      { id: "c3", kind: "create_project", title: "第四個，會被砍", platform: "youtube" },
      { id: "d1", kind: "dispatch", title: "派到第四個", projectRef: "c3", goal: "這一步應該一起消失" },
      { id: "d2", kind: "dispatch", title: "派到第一個", projectRef: "c0", goal: "這一步應該留下來" },
    ]), emptyRefs);
    expect(steps.map((s) => s.id)).toEqual(["c0", "c1", "c2", "d2"]);
  });

  it("既有專案代號仍然優先——p1 不會被誤判成步驟 id", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "p1", kind: "create_project", title: "故意跟代號同名", platform: "youtube" },
      { id: "s2", kind: "dispatch", title: "派工", projectRef: "p1", goal: "應該派到既有的招生短片" },
    ]), refs);
    expect(steps[1].projectId).toBe("11111111-1111-1111-1111-111111111111");
    expect(steps[1].projectFromStepId).toBeUndefined();
  });
});

describe("campaignSummaryText", () => {
  it("摘要點出派工數與自動核准授權——「這份計畫會替我花多少錢」要在核准前看得到", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "dispatch", title: "派工", projectRef: "p1", goal: "把腳本拆成分鏡" },
      { id: "s2", kind: "watch", title: "盯著", targetStepId: "s1" },
    ]), refs);
    const text = campaignSummaryText("把招生短片推到可交付", steps, 120);
    expect(text).toContain("派工 1");
    expect(text).toContain("120 點");
  });

  it("會開新專案時摘要第一行就說出來——專案只能封存不能刪，核准前就該看見", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "create_project", title: "中秋活動宣傳", platform: "youtube" },
      { id: "s2", kind: "dispatch", title: "做內容", projectRef: "s1", goal: "寫一支中秋活動宣傳短片" },
    ]), emptyRefs);
    expect(campaignSummaryText("辦一波中秋宣傳", steps, 120)).toContain("開專案 1");
  });

  it("沒有新專案時不提它——沒發生的事不要佔摘要的字數", () => {
    const steps = resolveCampaignPlan(draft([
      { id: "s1", kind: "dispatch", title: "派工", projectRef: "p1", goal: "把腳本拆成分鏡" },
    ]), refs);
    expect(campaignSummaryText("推進招生短片", steps, 120)).not.toContain("開專案");
  });
});
