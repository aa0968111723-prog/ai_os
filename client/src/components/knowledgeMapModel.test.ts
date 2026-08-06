import { describe, expect, it } from "vitest";
import { buildKnowledgeBranches, DB_BRANCH_KEY, GROUP_BRANCH_KEY, type BuildOptions, type MapGraphData } from "./knowledgeMapModel";

const ME = "user-me";
const OTHER = "user-other";
const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";

const fmtDateTime = () => "2026/1/1 09:00";

const DATA: MapGraphData = {
  projects: [
    { id: P1, title: "爬山前導", status: "active", updatedAt: "2026-01-01" },
    { id: P2, title: "期初茶會", status: "active", updatedAt: "2026-01-01" },
  ],
  notes: [
    { id: "n1", projectId: P1, title: "爬山場勘筆記", createdBy: ME, mentions: null, updatedAt: "2026-01-01" },
    { id: "n2", projectId: null, title: "組務雜記", createdBy: OTHER, mentions: [ME], updatedAt: "2026-01-01" },
  ],
  schedule: [{ id: "s1", projectId: P1, title: "始業式", startsAt: "2026-01-02", createdBy: OTHER, mentions: null }],
  knowledge: [{ id: "k1", projectId: P1, kind: "transcript", title: "師父開示：登山", chars: 1200, createdBy: ME, createdAt: "2026-01-01" }],
  agents: [{ id: "a1", projectId: P2, goal: "產出茶會文宣", status: "running", estPoints: 8, userId: ME, updatedAt: "2026-01-01" }],
  databases: [{ id: "d1", scope: "group", name: "報名名單", rowCount: 42, agentAccess: "read", createdBy: OTHER, updatedAt: "2026-01-01" }],
};

const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({
  meId: ME,
  lens: "all",
  focusProject: "",
  types: { note: true, schedule: true, knowledge: true, agent: true, db: true },
  query: "",
  fmtDateTime,
  ...over,
});

const keys = (data: MapGraphData, o: BuildOptions) => buildKnowledgeBranches(data, o).branches.map((b) => b.key);
const labelsOf = (data: MapGraphData, o: BuildOptions, key: string) =>
  buildKnowledgeBranches(data, o).branches.find((b) => b.key === key)?.leaves.map((l) => l.label) ?? [];

describe("buildKnowledgeBranches", () => {
  it("依專案分支，未掛專案的歸「組層級」，資料庫自成一支且排在最後", () => {
    const built = buildKnowledgeBranches(DATA, opts());
    expect(built.branches.map((b) => b.key)).toEqual([P1, P2, GROUP_BRANCH_KEY, DB_BRANCH_KEY]);
    expect(built.branches[0]).toMatchObject({ label: "爬山前導", kind: "project", projectId: P1 });
    expect(built.branches[2]).toMatchObject({ label: "組層級", kind: "bucket", projectId: null });
    expect(built.branches[3]).toMatchObject({ label: "資料庫", kind: "dbhub" });
  });

  it("同分支內葉順序是「知識 → 筆記 → 行程 → AI 執行計畫」（由靜到動）", () => {
    const built = buildKnowledgeBranches(DATA, opts());
    expect(built.branches[0].leaves.map((l) => l.kind)).toEqual(["knowledge", "note", "schedule"]);
  });

  it("分支多的排前面（資料庫分支不參與排序、固定墊底）", () => {
    // P2 只有 1 片、P1 有 3 片 → P1 在前
    expect(keys(DATA, opts()).slice(0, 2)).toEqual([P1, P2]);
  });

  it("每種葉都帶得走的導航：筆記／行程跳錨點、知識／代理進專案、資料庫深連結", () => {
    const built = buildKnowledgeBranches(DATA, opts());
    const byId = new Map(built.branches.flatMap((b) => b.leaves).map((l) => [l.id, l]));
    expect(byId.get("n-n1")?.nav).toEqual({ type: "anchor", anchorId: "note-n1" });
    expect(byId.get("s-s1")?.nav).toEqual({ type: "anchor", anchorId: "schedule-s1" });
    expect(byId.get("k-k1")?.nav).toEqual({ type: "project", projectId: P1 });
    expect(byId.get("a-a1")?.nav).toEqual({ type: "project", projectId: P2 });
    expect(byId.get("d-d1")?.nav).toEqual({ type: "db", tableId: "d1" });
  });

  it("副標帶型別與量詞（知識字數、資料庫列數與 AI 權限）", () => {
    const built = buildKnowledgeBranches(DATA, opts());
    const byId = new Map(built.branches.flatMap((b) => b.leaves).map((l) => [l.id, l]));
    expect(byId.get("k-k1")?.sub).toBe("知識庫・師父開示稿・1,200 字");
    expect(byId.get("d-d1")?.sub).toBe("資料庫・組・42 列・AI 唯讀");
    expect(byId.get("a-a1")?.sub).toBe("AI 執行計畫・執行中・估 8 點");
  });

  describe("鏡頭", () => {
    it("「我的」只留自己建立的（各型別皆適用）", () => {
      const built = buildKnowledgeBranches(DATA, opts({ lens: "mine" }));
      const ids = built.branches.flatMap((b) => b.leaves.map((l) => l.id));
      expect(ids.sort()).toEqual(["a-a1", "k-k1", "n-n1"]);
    });

    it("「提及我」只留 @我 的筆記／行程——知識、代理、資料庫沒有提及語意", () => {
      const built = buildKnowledgeBranches(DATA, opts({ lens: "mentioned" }));
      expect(built.branches.flatMap((b) => b.leaves.map((l) => l.id))).toEqual(["n-n2"]);
      expect(built.counts).toEqual({ note: 1, schedule: 0, knowledge: 0, agent: 0, db: 0 });
    });
  });

  it("聚焦某專案時只留該專案，且資料庫整支不畫（資料庫不掛專案）", () => {
    const built = buildKnowledgeBranches(DATA, opts({ focusProject: P1 }));
    expect(built.branches.map((b) => b.key)).toEqual([P1]);
    expect(built.counts.db).toBe(0);
  });

  it("關掉型別開關就整類消失（分支空了也不留空殼）", () => {
    const built = buildKnowledgeBranches(DATA, opts({ types: { note: true, schedule: false, knowledge: false, agent: false, db: false } }));
    expect(built.branches.map((b) => b.key)).toEqual([P1, GROUP_BRANCH_KEY]);
    expect(built.total).toBe(2);
    expect(built.counts).toEqual({ note: 2, schedule: 0, knowledge: 0, agent: 0, db: 0 });
  });

  describe("搜尋", () => {
    it("比對節點標題", () => {
      const built = buildKnowledgeBranches(DATA, opts({ query: "始業式" }));
      expect(built.branches.flatMap((b) => b.leaves.map((l) => l.id))).toEqual(["s-s1"]);
      expect(built.total).toBe(1);
    });

    it("也比對副標（例如搜「見證故事」這種型別字樣）", () => {
      expect(buildKnowledgeBranches(DATA, opts({ query: "師父開示稿" })).total).toBe(1);
    });

    it("命中分支名時整支保留——搜專案名要能一次看到底下全部", () => {
      expect(labelsOf(DATA, opts({ query: "爬山前導" }), P1)).toHaveLength(3);
    });

    it("大小寫不敏感", () => {
      const data: MapGraphData = { ...DATA, notes: [{ id: "n9", projectId: null, title: "Podcast 逐字稿", createdBy: ME, mentions: null, updatedAt: "2026-01-01" }] };
      expect(buildKnowledgeBranches(data, opts({ query: "podcast" })).total).toBe(1);
    });

    it("沒命中就回空樹（讓呼叫端顯示「找不到」而不是整張圖）", () => {
      const built = buildKnowledgeBranches(DATA, opts({ query: "不存在的東西" }));
      expect(built.branches).toEqual([]);
      expect(built.total).toBe(0);
    });
  });

  it("counts／total 反映的是濾完之後畫得出來的節點", () => {
    const built = buildKnowledgeBranches(DATA, opts());
    expect(built.counts).toEqual({ note: 2, schedule: 1, knowledge: 1, agent: 1, db: 1 });
    expect(built.total).toBe(6);
  });

  it("節點掛在已被刪掉的專案上時，分支名標成「（已移除專案）」而不是崩掉", () => {
    const data: MapGraphData = { ...DATA, projects: [] };
    const built = buildKnowledgeBranches(data, opts());
    expect(built.branches.find((b) => b.key === P1)?.label).toBe("（已移除專案）");
  });

  it("完全沒資料時回空樹（不會生出空分支）", () => {
    const empty: MapGraphData = { projects: [], notes: [], schedule: [], knowledge: [], agents: [], databases: [] };
    expect(buildKnowledgeBranches(empty, opts())).toEqual({ branches: [], counts: { note: 0, schedule: 0, knowledge: 0, agent: 0, db: 0 }, total: 0 });
  });
});
