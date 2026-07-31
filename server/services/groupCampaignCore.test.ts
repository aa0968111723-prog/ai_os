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
};

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
});
