/**
 * Story-first 共用規則測試：名稱正規化與信心分級是「同一段故事重跑不重複建卡」
 * （Idempotency guardrail）的地基，錯一格就是重複實體或漏確認——必須窮舉測。
 */
import { describe, it, expect } from "vitest";
import {
  bucketConfidence,
  nameKey,
  sameEntityName,
  formatEnvironmentState,
  formatShotDirection,
  mergeShotDirection,
  describeDirectionChange,
  storyParseModelSchema,
  diffStoryboardPlan,
  summarizeStoryboardDiff,
  environmentStateSchema,
  CONFIDENCE_AUTO,
  CONFIDENCE_FLAG,
  type ShotCamera,
} from "./story";

describe("nameKey / sameEntityName", () => {
  it("去引號、摺疊空白、統一大小寫後收斂到同一鍵", () => {
    expect(nameKey("「紅色雨傘」")).toBe(nameKey("紅色雨傘"));
    expect(nameKey(" 紅色雨傘 ")).toBe(nameKey("紅色雨傘"));
    expect(nameKey("『安倢』")).toBe(nameKey("安倢"));
    expect(nameKey("Anjie")).toBe(nameKey("anjie"));
    expect(nameKey("安 倢")).toBe(nameKey("安倢"));
    expect(nameKey("安　倢")).toBe(nameKey("安倢")); // 全形空白
  });
  it("不同名字不誤併", () => {
    expect(sameEntityName("紅傘", "紅色雨傘")).toBe(false); // 縮寫歸併交給 LLM 的 aliases/existingRef，規則層不猜
    expect(sameEntityName("安倢", "師父")).toBe(false);
    expect(sameEntityName("", "安倢")).toBe(false);
  });
  it("同名即同實體", () => {
    expect(sameEntityName("安倢", "「安倢」")).toBe(true);
  });
});

describe("bucketConfidence（PE 計畫 §06 三段行為）", () => {
  it("≥0.90 自動套用", () => {
    expect(bucketConfidence(0.9)).toBe("auto");
    expect(bucketConfidence(1)).toBe("auto");
    expect(bucketConfidence(CONFIDENCE_AUTO)).toBe("auto");
  });
  it("0.70–0.89 套用但標記", () => {
    expect(bucketConfidence(0.7)).toBe("flag");
    expect(bucketConfidence(0.89)).toBe("flag");
    expect(bucketConfidence(CONFIDENCE_FLAG)).toBe("flag");
  });
  it("<0.70 暫不落庫、只出確認卡", () => {
    expect(bucketConfidence(0.69)).toBe("confirm");
    expect(bucketConfidence(0)).toBe("confirm");
  });
});

describe("formatEnvironmentState", () => {
  it("只列有填的欄位；全空回空字串（呼叫端據此整段略過）", () => {
    expect(formatEnvironmentState({ weather: "雨天", timeOfDay: "清晨", mood: "平靜" })).toBe("雨天、清晨、平靜");
    expect(formatEnvironmentState({ weather: "雨天" })).toBe("雨天");
    expect(formatEnvironmentState({})).toBe("");
    expect(formatEnvironmentState(null)).toBe("");
    expect(formatEnvironmentState(undefined)).toBe("");
  });
});

describe("formatShotDirection", () => {
  it("鏡頭與表演分段組裝；全空回空字串", () => {
    expect(
      formatShotDirection(
        { shotSize: "特寫", movement: "緩推", lighting: "逆光", composition: "留白" },
        { emotion: "若有所思", gaze: "看向遠方" },
      ),
    ).toBe("鏡頭：特寫、緩推；光線：逆光；構圖：留白；表演：若有所思、看向遠方");
    expect(formatShotDirection({ shotSize: "中景" }, null)).toBe("鏡頭：中景");
    expect(formatShotDirection(null, { emotion: "平靜" })).toBe("表演：平靜");
    expect(formatShotDirection(null, null)).toBe("");
    expect(formatShotDirection({}, {})).toBe("");
  });
});

describe("mergeShotDirection（§12 逐鏡指導：只動被指名的欄位）", () => {
  it("只覆寫 patch 帶到的欄位，其餘原封不動", () => {
    const before = { shotSize: "全景", lighting: "逆光", composition: "留白" };
    expect(mergeShotDirection(before, { shotSize: "特寫" })).toEqual({
      shotSize: "特寫",
      lighting: "逆光",
      composition: "留白",
    });
  });
  it("缺鍵與 undefined 都不算「要清掉」——這是防靜默資料遺失的核心", () => {
    const before = { shotSize: "全景", lighting: "逆光" };
    expect(mergeShotDirection(before, {})).toEqual(before);
    expect(mergeShotDirection(before, { lighting: undefined })).toEqual(before);
  });
  it("空字串＝明確清掉這個欄位", () => {
    expect(mergeShotDirection({ shotSize: "全景", movement: "緩推" }, { movement: "" })).toEqual({ shotSize: "全景" });
    expect(mergeShotDirection({ shotSize: "全景", movement: "  " }, { movement: "" })).toEqual({ shotSize: "全景" });
  });
  it("清空最後一個欄位回 null（不留空物件，與 environment 存法一致）", () => {
    expect(mergeShotDirection({ shotSize: "全景" }, { shotSize: "" })).toBeNull();
    expect(mergeShotDirection(null, {})).toBeNull();
    expect(mergeShotDirection(null, { shotSize: "  " })).toBeNull();
  });
  it("入庫前 trim；base 裡的空白欄位不會被當成有值帶進來", () => {
    expect(mergeShotDirection<ShotCamera>({ shotSize: "  ", angle: " 平視 " }, { movement: " 緩推 " })).toEqual({
      angle: "平視",
      movement: "緩推",
    });
  });
});

describe("describeDirectionChange（§14 變更預覽：確認前看得到改什麼）", () => {
  it("沒填過的欄位顯示「－」，新舊並陳", () => {
    expect(describeDirectionChange({ shotSize: "全景" }, { shotSize: "特寫", movement: "緩推" })).toEqual([
      "鏡別 全景→特寫",
      "運鏡 －→緩推",
    ]);
  });
  it("清掉欄位也要看得到（→－）", () => {
    expect(describeDirectionChange({ movement: "緩推" }, null)).toEqual(["運鏡 緩推→－"]);
  });
  it("沒有實際差異回空陣列——呼叫端據此不給一顆假按鈕", () => {
    expect(describeDirectionChange({ shotSize: "全景" }, { shotSize: "全景" })).toEqual([]);
    expect(describeDirectionChange(null, null)).toEqual([]);
    expect(describeDirectionChange({ shotSize: "全景" }, { shotSize: " 全景 " })).toEqual([]);
  });
  it("表演欄位也走同一份中文欄名", () => {
    expect(describeDirectionChange({ emotion: "平靜" }, { emotion: "若有所思", gaze: "看向遠方" })).toEqual([
      "情緒 平靜→若有所思",
      "視線 －→看向遠方",
    ]);
  });
});

describe("diffStoryboardPlan（§22 逐場套用：不重複建、也不蓋掉使用者的編輯）", () => {
  const plan = [
    { title: "第一幕｜克難坡的雨", shots: [1, 2, 3] },
    { title: "第二幕｜禪堂", shots: [1, 2] },
  ];

  it("全新專案：每一場都建", () => {
    expect(diffStoryboardPlan(plan, [])).toEqual([
      { title: "第一幕｜克難坡的雨", action: "create", shots: 3 },
      { title: "第二幕｜禪堂", action: "create", shots: 2 },
    ]);
  });

  it("同名且底下有鏡＝沿用，一鏡都不新增（使用者調過的鏡頭語言不能被蓋掉）", () => {
    const existing = [{ id: "s1", title: "第一幕｜克難坡的雨", liveShots: 4 }];
    expect(diffStoryboardPlan(plan, existing)).toEqual([
      { title: "第一幕｜克難坡的雨", action: "reuse", storySceneId: "s1", shots: 0 },
      { title: "第二幕｜禪堂", action: "create", shots: 2 },
    ]);
  });

  it("同名但底下空了＝補鏡（沒有東西會被蓋掉）", () => {
    const existing = [{ id: "s1", title: "第一幕｜克難坡的雨", liveShots: 0 }];
    expect(diffStoryboardPlan(plan, existing)[0]).toEqual({
      title: "第一幕｜克難坡的雨",
      action: "fill",
      storySceneId: "s1",
      shots: 3,
    });
  });

  it("場名比對走 nameKey：引號與空白差異視為同一場", () => {
    const existing = [{ id: "s1", title: "「第一幕｜克難坡的雨」 ", liveShots: 2 }];
    expect(diffStoryboardPlan(plan, existing)[0].action).toBe("reuse");
  });

  it("一個既有場只被認領一次——同名兩場不會都指到同一個既有場", () => {
    const dupPlan = [
      { title: "第一幕", shots: [1] },
      { title: "第一幕", shots: [1, 2] },
    ];
    const existing = [{ id: "s1", title: "第一幕", liveShots: 3 }];
    const d = diffStoryboardPlan(dupPlan, existing);
    expect(d[0]).toEqual({ title: "第一幕", action: "reuse", storySceneId: "s1", shots: 0 });
    expect(d[1]).toEqual({ title: "第一幕", action: "create", shots: 2 });
  });

  it("摘要數字＝預覽與實際套用共用的同一份計畫", () => {
    const existing = [
      { id: "s1", title: "第一幕｜克難坡的雨", liveShots: 4 },
      { id: "s2", title: "第二幕｜禪堂", liveShots: 0 },
    ];
    expect(summarizeStoryboardDiff(diffStoryboardPlan(plan, existing))).toEqual({
      createScenes: 0,
      fillScenes: 1,
      reuseScenes: 1,
      newShots: 2,
    });
  });
});

describe("storyParseModelSchema（模型輸出守門）", () => {
  const minimalScene = { title: "第一場", shots: [{ prompt: "清晨禪堂空景" }] };
  it("最小合法輸出可過", () => {
    const r = storyParseModelSchema.safeParse({ scenes: [minimalScene] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.characters).toEqual([]); // default
    }
  });
  it("scenes 超過 12 場拒絕（提示詞規模上限）", () => {
    const r = storyParseModelSchema.safeParse({ scenes: Array.from({ length: 13 }, () => minimalScene) });
    expect(r.success).toBe(false);
  });
  it("角色 confidence 超界拒絕", () => {
    const r = storyParseModelSchema.safeParse({
      characters: [{ name: "安倢", confidence: 1.5 }],
      scenes: [minimalScene],
    });
    expect(r.success).toBe(false);
  });
  it("shots 空陣列拒絕（沒有鏡的場沒有意義）", () => {
    const r = storyParseModelSchema.safeParse({ scenes: [{ title: "空場", shots: [] }] });
    expect(r.success).toBe(false);
  });
});

describe("environmentStateSchema", () => {
  it("trim 後入庫；超長拒絕", () => {
    const r = environmentStateSchema.safeParse({ weather: " 雨天 " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.weather).toBe("雨天");
    expect(environmentStateSchema.safeParse({ weather: "多".repeat(41) }).success).toBe(false);
  });
});
