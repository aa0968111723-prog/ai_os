/**
 * 文字分鏡腳本的格式化／解析／差異規則。
 * 這支的核心契約是「保守套用」：文字裡少寫一鏡，絕不能讓已出圖的那一格消失。
 */
import { describe, expect, it } from "vitest";
import {
  MAX_SCRIPT_SCENES,
  SCRIPT_PROMPT_MAX,
  SCRIPT_VOICEOVER_MAX,
  diffStoryboardScript,
  formatStoryboardScript,
  parseStoryboardScript,
  resolveScriptTargets,
  summarizeStoryboardScriptDiff,
} from "./storyboardScript";

const ROWS = [
  {
    title: "開場・晨光",
    durationSec: 5,
    prompt: "清晨禪堂，柔和光線",
    voiceover: "那一年，我第一次走進禪堂。",
    ambience: "遠處鐘聲，細微鳥鳴",
  },
  { title: "紅傘特寫", durationSec: 4, prompt: "正紅長柄傘立在門邊", voiceover: null, cardNames: ["安倢的紅傘"] },
];

describe("formatStoryboardScript", () => {
  it("每鏡一段：標題帶序號與秒數，畫面／旁白／環境音各一行", () => {
    expect(formatStoryboardScript(ROWS)).toBe(
      [
        "## 1. 開場・晨光 (5s)",
        "畫面：清晨禪堂，柔和光線",
        "旁白：那一年，我第一次走進禪堂。",
        "環境音：遠處鐘聲，細微鳥鳴",
        "",
        "## 2. 紅傘特寫 (4s)",
        "畫面：正紅長柄傘立在門邊",
        "旁白：",
        "環境音：",
        "設定卡：安倢的紅傘（唯讀）",
      ].join("\n"),
    );
  });

  /**
   * 空的環境音也要輸出。它剛從「沒有欄位可放」變成鏡規格的一員——只在有值時才出現，
   * 等於繼續藏著它，使用者永遠不知道這一格可以寫。
   */
  it("環境音是空的也照樣輸出一行（讓人知道這一格可以寫）", () => {
    const out = formatStoryboardScript([{ title: "T", durationSec: 5, prompt: "畫", voiceover: null }]);
    expect(out).toContain("\n環境音：");
  });

  it("格式化出來的文字，解析回去必須等值（來回不失真）", () => {
    const parsed = parseStoryboardScript(formatStoryboardScript(ROWS));
    expect(parsed.errors).toEqual([]);
    expect(parsed.scenes).toEqual([
      {
        title: "開場・晨光",
        durationSec: 5,
        prompt: "清晨禪堂，柔和光線",
        voiceover: "那一年，我第一次走進禪堂。",
        ambience: "遠處鐘聲，細微鳥鳴",
        ordinal: 1,
      },
      { title: "紅傘特寫", durationSec: 4, prompt: "正紅長柄傘立在門邊", voiceover: "", ambience: "", ordinal: 2 },
    ]);
  });

  it("環境音吃續行，也吃半形冒號（與畫面／旁白同規則）", () => {
    const parsed = parseStoryboardScript(
      ["## 1. T (5s)", "環境音: 蟲鳴", "遠處狗吠", "旁白：說話"].join("\n"),
    );
    expect(parsed.scenes[0]?.ambience).toBe("蟲鳴\n遠處狗吠");
    expect(parsed.scenes[0]?.voiceover).toBe("說話");
  });

  it("內容裡長得像結構的行會跳脫，原封不動寫回不會吃掉字", () => {
    // 沒有跳脫的話：畫面的第二行「旁白：…」會被當成旁白標籤，接著真正的「旁白：」再把它覆蓋成空——
    // 使用者什麼都沒改，那行字卻消失了
    const rows = [
      { title: "T", durationSec: 5, prompt: "第一行\n旁白：這其實是畫面的第二行\n## 這行也是", voiceover: "旁白第一行\n設定卡：這是旁白" },
    ];
    const back = parseStoryboardScript(formatStoryboardScript(rows)).scenes[0];
    expect(back?.prompt).toBe("第一行\n旁白：這其實是畫面的第二行\n## 這行也是");
    expect(back?.voiceover).toBe("旁白第一行\n設定卡：這是旁白");
  });

  it("本來就以反斜線開頭的字不會被誤拆（只還原真的長得像結構的那種）", () => {
    const rows = [{ title: "T", durationSec: 5, prompt: "第一行\n\\不是結構\n\\旁白：是結構", voiceover: null }];
    expect(parseStoryboardScript(formatStoryboardScript(rows)).scenes[0]?.prompt).toBe(
      "第一行\n\\不是結構\n\\旁白：是結構",
    );
  });
});

describe("parseStoryboardScript", () => {
  it("序號、秒數、旁白都可省略（手打不必記格式）", () => {
    const parsed = parseStoryboardScript("## 開場\n畫面：晨光");
    expect(parsed.errors).toEqual([]);
    expect(parsed.scenes).toEqual([{ title: "開場", durationSec: undefined, prompt: "晨光", voiceover: undefined }]);
  });

  it("半形冒號與全形冒號都吃", () => {
    const parsed = parseStoryboardScript("## 開場 (5s)\n畫面: 晨光\n旁白: 那一年");
    expect(parsed.scenes[0]).toMatchObject({ prompt: "晨光", voiceover: "那一年" });
  });

  it("續行接在最後一個標籤底下；沒有標籤時當畫面描述", () => {
    const parsed = parseStoryboardScript("## 開場\n畫面：晨光\n灑在木地板上\n旁白：第一句\n第二句");
    expect(parsed.scenes[0]).toMatchObject({
      prompt: "晨光\n灑在木地板上",
      voiceover: "第一句\n第二句",
    });
    const noLabel = parseStoryboardScript("## 開場\n直接寫畫面");
    expect(noLabel.scenes[0]?.prompt).toBe("直接寫畫面");
  });

  it("設定卡是唯讀標注，讀回來會被丟掉（不從文字改綁定）", () => {
    const parsed = parseStoryboardScript("## 開場\n畫面：晨光\n設定卡：安倢・禪堂（唯讀）");
    expect(parsed.scenes[0]).toMatchObject({ prompt: "晨光" });
    expect(JSON.stringify(parsed.scenes[0])).not.toContain("安倢");
  });

  it("秒數超出 1–60 不採用，並講清楚維持原值", () => {
    const parsed = parseStoryboardScript("## 開場 (999s)\n畫面：晨光");
    expect(parsed.scenes[0]?.durationSec).toBeUndefined();
    expect(parsed.warnings.join()).toMatch(/超出 1–60/);
  });

  it("沒有標題時給預設鏡名，不會產生無名分鏡", () => {
    expect(parseStoryboardScript("## \n畫面：晨光").scenes[0]?.title).toBe("第 1 鏡");
  });

  it("第一個 ## 之前的抬頭文字會被忽略，但要說出來", () => {
    const parsed = parseStoryboardScript("城市微光 分鏡腳本\n\n## 開場\n畫面：晨光");
    expect(parsed.scenes).toHaveLength(1);
    expect(parsed.warnings.join()).toMatch(/不會被匯入/);
  });

  it("整段完全沒有 ## → 報錯而不是默默匯入 0 鏡", () => {
    const parsed = parseStoryboardScript("開場：晨光\n旁白：那一年");
    expect(parsed.scenes).toEqual([]);
    expect(parsed.errors.join()).toMatch(/以「## 」開頭/);
  });

  it("空字串＝沒東西可匯入，但不算錯（剛打開編輯器）", () => {
    expect(parseStoryboardScript("   ")).toEqual({ scenes: [], errors: [], warnings: [] });
  });

  it("鏡次讀得回來（中間整段沒寫時要靠它認人）", () => {
    expect(parseStoryboardScript("## 3. C").scenes[0]?.ordinal).toBe(3);
    expect(parseStoryboardScript("## C").scenes[0]?.ordinal).toBeUndefined();
  });
});

describe("欄位與鏡數上限（寫回不能繞過單格編輯的護欄）", () => {
  it("畫面超長擋下來並說出是哪一鏡、幾字", () => {
    const parsed = parseStoryboardScript(`## 1. 開場\n畫面：${"字".repeat(SCRIPT_PROMPT_MAX + 1)}`);
    expect(parsed.errors.join()).toMatch(/第 1 鏡「開場」的畫面 4001 字/);
  });

  it("旁白超長也擋（與單格編輯同口徑）", () => {
    const parsed = parseStoryboardScript(`## 1. 開場\n旁白：${"字".repeat(SCRIPT_VOICEOVER_MAX + 1)}`);
    expect(parsed.errors.join()).toMatch(/旁白 2001 字/);
  });

  it("標題超長擋下來，不靜默截短（切掉的是使用者自己寫的字）", () => {
    const parsed = parseStoryboardScript(`## 1. ${"標".repeat(61)}`);
    expect(parsed.errors.join()).toMatch(/標題 61 字/);
  });

  it("鏡數爆量擋下來，而且不逐鏡洗版", () => {
    const text = Array.from({ length: MAX_SCRIPT_SCENES + 1 }, (_, i) => `## ${i + 1}. 鏡`).join("\n");
    const parsed = parseStoryboardScript(text);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toMatch(/最多 200 鏡，這份有 201 鏡/);
  });

  it("剛好在上限內不擋", () => {
    expect(parseStoryboardScript(`## 1. 開場\n畫面：${"字".repeat(SCRIPT_PROMPT_MAX)}`).errors).toEqual([]);
  });
});

describe("resolveScriptTargets（鏡次是身分證，不是裝飾）", () => {
  it("中間整段沒寫：後面那鏡仍對到自己，不會遞補去蓋前一鏡", () => {
    // A/B/C 只留 ## 1. A 與 ## 3. C：C 必須對到 index 2，否則結果會變成 A/C/C
    const scenes = parseStoryboardScript("## 1. A\n畫面：a\n\n## 3. C\n畫面：c").scenes;
    expect(resolveScriptTargets(3, scenes).map((t) => t.rowIndex)).toEqual([0, 2]);
  });

  it("沒寫鏡次就依序對應（手打的人不必記編號）", () => {
    const scenes = parseStoryboardScript("## A\n畫面：a\n\n## C\n畫面：c").scenes;
    expect(resolveScriptTargets(3, scenes).map((t) => t.rowIndex)).toEqual([0, 1]);
  });

  it("鏡次倒退或重複不採信，退回依序對應", () => {
    const scenes = parseStoryboardScript("## 2. B\n畫面：b\n\n## 1. A\n畫面：a").scenes;
    expect(resolveScriptTargets(3, scenes).map((t) => t.rowIndex)).toEqual([1, 2]);
  });

  it("鏡次超出既有鏡數＝新增，不會在中間留下幽靈空格", () => {
    const scenes = parseStoryboardScript("## 1. A\n畫面：a\n\n## 9. X\n畫面：x\n\n## 10. Y\n畫面：y").scenes;
    expect(resolveScriptTargets(2, scenes).map((t) => t.rowIndex)).toEqual([0, null, null]);
  });
});

describe("diffStoryboardScript（保守套用）", () => {
  it("沒改就是沒變更", () => {
    const parsed = parseStoryboardScript(formatStoryboardScript(ROWS));
    const diff = diffStoryboardScript(ROWS, parsed.scenes);
    expect(diff).toEqual({ updated: [], created: [], keptUntouched: 0 });
    expect(summarizeStoryboardScriptDiff(diff)).toBe("沒有任何變更");
  });

  it("改了畫面／旁白／標題／秒數都算更新", () => {
    const parsed = parseStoryboardScript("## 1. 開場・晨光 (5s)\n畫面：改過的畫面\n旁白：那一年，我第一次走進禪堂。");
    expect(diffStoryboardScript(ROWS, parsed.scenes).updated).toEqual([{ index: 0, title: "開場・晨光" }]);
  });

  it("文字多寫的鏡＝新增到末尾", () => {
    const parsed = parseStoryboardScript(
      `${formatStoryboardScript(ROWS)}\n\n## 3. 收尾 (3s)\n畫面：關門`,
    );
    expect(diffStoryboardScript(ROWS, parsed.scenes).created).toEqual(["收尾"]);
  });

  it("文字少寫的鏡＝保留不動，絕不刪除（已出圖的格不能因為忘了寫就消失）", () => {
    const parsed = parseStoryboardScript("## 1. 開場・晨光 (5s)\n畫面：清晨禪堂，柔和光線\n旁白：那一年，我第一次走進禪堂。");
    const diff = diffStoryboardScript(ROWS, parsed.scenes);
    expect(diff.keptUntouched).toBe(1);
    expect(diff.updated).toEqual([]);
    expect(summarizeStoryboardScriptDiff(diff)).toBe("保留 1 鏡不動（文字裡沒寫到）");
  });

  it("省略的欄位不會被當成「清空」（只寫標題不該把畫面洗掉）", () => {
    const parsed = parseStoryboardScript("## 1. 開場・晨光 (5s)");
    expect(diffStoryboardScript(ROWS, parsed.scenes).updated).toEqual([]);
  });

  it("刪掉中間整段：預告與實際一致，動的是第 2 鏡而不是第 1 鏡", () => {
    const rows = [
      { title: "A", durationSec: 5, prompt: "a", voiceover: null },
      { title: "B", durationSec: 5, prompt: "b", voiceover: null },
      { title: "C", durationSec: 5, prompt: "c", voiceover: null },
    ];
    const parsed = parseStoryboardScript("## 1. A (5s)\n畫面：a\n\n## 3. C (5s)\n畫面：改過的 c");
    const diff = diffStoryboardScript(rows, parsed.scenes);
    expect(diff.updated).toEqual([{ index: 2, title: "C" }]);
    expect(diff.keptUntouched).toBe(1); // 被保留的是 B
  });
});
