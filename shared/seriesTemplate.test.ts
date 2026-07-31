/**
 * 母版系列契約測試——守住 SOP 的硬規則：
 * 命名可雙向解析、4 格必填（含「無」也要明寫）、5 段骨架不走樣、退回標籤固定。
 */
import { describe, expect, it } from "vitest";
import {
  EPISODE_AGENT_STEPS,
  EPISODE_SUCCESS_CRITERIA,
  MASTER_TITLE_PREFIX,
  PROJECT_TITLE_MAX,
  REWORK_TAGS,
  buildEpisodeNote,
  buildEpisodeScenes,
  buildEpisodeTitle,
  buildMasterNote,
  buildSeriesPlannerHint,
  composeReworkReason,
  episodeVariablesSchema,
  getSeriesTemplate,
  isMasterTitle,
  listSeriesTemplates,
  masterTemplateOfTitle,
  masterTitle,
  parseEpisodeTitle,
  reworkTagNeedsNote,
} from "./seriesTemplate";

const template = getSeriesTemplate("weekly-dharma-60")!;

const vars = episodeVariablesSchema.parse({
  topic: "忙的時候更要留一點空隙",
  sourceQuote: "把心交給佛，日子就有了呼吸的空隙。",
  taboo: "不提個案姓名",
  dueDate: "2026-08-05",
});

describe("母版目錄", () => {
  it("SOP §1：先固定一條系列，不一次上滿", () => {
    expect(listSeriesTemplates()).toHaveLength(1);
    expect(template.seriesName).toBe("週更開示60秒");
  });

  it("5 段骨架連續覆蓋 0→60 秒，段號即分鏡順序", () => {
    expect(template.segments).toHaveLength(5);
    expect(template.segments[0].startSec).toBe(0);
    expect(template.segments.at(-1)!.endSec).toBe(template.totalSec);
    template.segments.forEach((s, i) => {
      expect(s.no).toBe(i + 1);
      if (i > 0) expect(s.startSec).toBe(template.segments[i - 1].endSec);
    });
  });

  it("每集只有 4 格變數（多一格就是母版被稀釋）", () => {
    expect(template.variables.map((v) => v.key)).toEqual(["topic", "sourceQuote", "taboo", "dueDate"]);
    expect(template.variables.every((v) => v.required)).toBe(true);
  });
});

describe("母版本體識別", () => {
  it("母版標題＝前綴＋系列名，且可被認出來", () => {
    expect(masterTitle(template)).toBe(`${MASTER_TITLE_PREFIX}週更開示60秒`);
    expect(isMasterTitle(masterTitle(template))).toBe(true);
    expect(masterTemplateOfTitle(masterTitle(template))?.id).toBe(template.id);
  });

  it("本集、同名但沒前綴、以及未知系列都不算母版", () => {
    expect(isMasterTitle("週更開示60秒｜2026-08-05｜主題")).toBe(false);
    expect(isMasterTitle("週更開示60秒")).toBe(false);
    expect(isMasterTitle("【母版】還沒有的系列")).toBe(false);
    expect(masterTemplateOfTitle("隨便一個專案")).toBeUndefined();
  });
});

describe("本集命名（系列｜日期｜主題）", () => {
  it("組出來的標題可以原樣反解回三個欄位", () => {
    const title = buildEpisodeTitle(template, vars);
    expect(title).toBe("週更開示60秒｜2026-08-05｜忙的時候更要留一點空隙");
    const parsed = parseEpisodeTitle(title);
    expect(parsed?.template.id).toBe(template.id);
    expect(parsed?.dueDate).toBe("2026-08-05");
    expect(parsed?.topic).toBe(vars.topic);
  });

  it("主題含分隔符時，反解仍保留完整主題（只切前兩段）", () => {
    const parsed = parseEpisodeTitle("週更開示60秒｜2026-08-05｜前｜後");
    expect(parsed?.topic).toBe("前｜後");
  });

  it("超長主題只裁主題，總長不超過專案標題上限", () => {
    const long = episodeVariablesSchema.parse({ ...vars, topic: "很".repeat(40) });
    const title = buildEpisodeTitle(template, long);
    expect(title.length).toBeLessThanOrEqual(PROJECT_TITLE_MAX);
    expect(title.startsWith("週更開示60秒｜2026-08-05｜")).toBe(true);
  });

  it("不是本集命名的標題一律回 null", () => {
    expect(parseEpisodeTitle("隨便一個專案")).toBeNull();
    expect(parseEpisodeTitle("週更開示60秒｜不是日期｜主題")).toBeNull();
    expect(parseEpisodeTitle("週更開示60秒｜2026-08-05｜")).toBeNull();
    expect(parseEpisodeTitle("沒這系列｜2026-08-05｜主題")).toBeNull();
  });
});

describe("4 格變數驗證", () => {
  it("沒有原句／禁忌也要明寫「無」，空字串一律擋下", () => {
    expect(episodeVariablesSchema.safeParse({ ...vars, sourceQuote: "無", taboo: "無" }).success).toBe(true);
    expect(episodeVariablesSchema.safeParse({ ...vars, sourceQuote: "  " }).success).toBe(false);
    expect(episodeVariablesSchema.safeParse({ ...vars, taboo: "" }).success).toBe(false);
    expect(episodeVariablesSchema.safeParse({ ...vars, topic: "" }).success).toBe(false);
  });

  it("截止日期只收真實存在的 YYYY-MM-DD", () => {
    expect(episodeVariablesSchema.safeParse({ ...vars, dueDate: "2026/08/05" }).success).toBe(false);
    expect(episodeVariablesSchema.safeParse({ ...vars, dueDate: "2026-02-31" }).success).toBe(false);
    expect(episodeVariablesSchema.safeParse({ ...vars, dueDate: "2026-02-28" }).success).toBe(true);
  });
});

describe("分鏡空殼", () => {
  const scenes = buildEpisodeScenes(template, vars);

  it("生出 5 格、依 1→5 排序、秒數對得上母版段落", () => {
    expect(scenes.map((s) => s.orderIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(scenes.reduce((n, s) => n + s.durationSec, 0)).toBe(template.totalSec);
  });

  it("必留原句只掛在核心句那一段，且逐字保留", () => {
    expect(scenes[1].voiceover).toContain(vars.sourceQuote);
    expect(scenes.filter((s) => s.voiceover.includes(vars.sourceQuote))).toHaveLength(1);
  });

  it("原句填「無」時不會生出假的原句欄位", () => {
    const none = buildEpisodeScenes(template, { ...vars, sourceQuote: "無" });
    // 第 2 段的提示語本來就會提到「必留原句」；這裡守的是「逐字保留」那條實際附加的原句行
    expect(none.some((s) => s.voiceover.includes("逐字保留"))).toBe(false);
  });

  it("旁白是待寫草稿而非成品——空殼不得被當定稿", () => {
    expect(scenes.every((s) => s.voiceover.startsWith("（待寫）"))).toBe(true);
  });

  it("禁忌會帶進每一段畫面提示", () => {
    expect(scenes.every((s) => s.prompt.includes(vars.taboo))).toBe(true);
    const noTaboo = buildEpisodeScenes(template, { ...vars, taboo: "無" });
    expect(noTaboo.every((s) => !s.prompt.includes("本集禁忌"))).toBe(true);
  });
});

describe("筆記文本", () => {
  it("母版筆記含固定規格與 5 段", () => {
    const note = buildMasterNote(template);
    expect(note).toContain("直式 9:16");
    template.segments.forEach((s) => expect(note).toContain(s.title));
  });

  it("本集筆記含 4 格填寫值與送審前自查", () => {
    const note = buildEpisodeNote(template, vars);
    template.variables.forEach((v) => expect(note).toContain(vars[v.key]));
    template.preflight.forEach((p) => expect(note).toContain(p));
  });
});

describe("退回標籤（固定 5 種）", () => {
  it("標籤集合與含義固定，不可自由造字", () => {
    expect(REWORK_TAGS.map((t) => t.value)).toEqual(["結構跑掉", "出處不符", "點數過高", "風格不符", "其他"]);
  });

  it("一般標籤自己就成句", () => {
    expect(composeReworkReason("結構跑掉")).toBe("[結構跑掉] 未依母版 5 段");
    expect(reworkTagNeedsNote("結構跑掉")).toBe(false);
  });

  it("有補充說明時以說明為準", () => {
    expect(composeReworkReason("風格不符", "第 3 鏡色調太冷")).toBe("[風格不符] 第 3 鏡色調太冷");
  });

  it("「其他」沒寫說明就不合法", () => {
    expect(reworkTagNeedsNote("其他")).toBe(true);
    expect(composeReworkReason("其他")).toBeNull();
    expect(composeReworkReason("其他", "   ")).toBeNull();
    expect(composeReworkReason("其他", "拍攝檔名要重編")).toBe("[其他] 拍攝檔名要重編");
  });

  it("理由長度不超過 approvals.reason 的 500 字上限", () => {
    expect(composeReworkReason("其他", "長".repeat(600))!.length).toBeLessThanOrEqual(500);
  });
});

describe("第 2 期代理計畫", () => {
  it("6 步驟依序，且第 4／6 步必須停下來等人", () => {
    expect(EPISODE_AGENT_STEPS.map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(EPISODE_AGENT_STEPS.filter((s) => s.waitsForHuman).map((s) => s.no)).toEqual([4, 6]);
  });

  it("成功條件以「停在待審」收尾——自動化不得走完最後一哩", () => {
    expect(EPISODE_SUCCESS_CRITERIA).toHaveLength(5);
    expect(EPISODE_SUCCESS_CRITERIA.at(-1)).toContain("待審");
  });

  it("規劃提示帶著禁令，不只帶步驟", () => {
    const hint = buildSeriesPlannerHint();
    expect(hint).toContain("待審");
    expect(hint).toContain("禁止");
    expect(hint).toContain("未通過就當定稿");
  });
});
