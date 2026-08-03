/**
 * 文字分鏡腳本的格式化／解析／差異規則。
 * 這支的核心契約是「保守套用」：文字裡少寫一鏡，絕不能讓已出圖的那一格消失。
 */
import { describe, expect, it } from "vitest";
import {
  diffStoryboardScript,
  formatStoryboardScript,
  parseStoryboardScript,
  summarizeStoryboardScriptDiff,
} from "./storyboardScript";

const ROWS = [
  { title: "開場・晨光", durationSec: 5, prompt: "清晨禪堂，柔和光線", voiceover: "那一年，我第一次走進禪堂。" },
  { title: "紅傘特寫", durationSec: 4, prompt: "正紅長柄傘立在門邊", voiceover: null, cardNames: ["安倢的紅傘"] },
];

describe("formatStoryboardScript", () => {
  it("每鏡一段：標題帶序號與秒數，畫面與旁白各一行", () => {
    expect(formatStoryboardScript(ROWS)).toBe(
      [
        "## 1. 開場・晨光 (5s)",
        "畫面：清晨禪堂，柔和光線",
        "旁白：那一年，我第一次走進禪堂。",
        "",
        "## 2. 紅傘特寫 (4s)",
        "畫面：正紅長柄傘立在門邊",
        "旁白：",
        "設定卡：安倢的紅傘（唯讀）",
      ].join("\n"),
    );
  });

  it("格式化出來的文字，解析回去必須等值（來回不失真）", () => {
    const parsed = parseStoryboardScript(formatStoryboardScript(ROWS));
    expect(parsed.errors).toEqual([]);
    expect(parsed.scenes).toEqual([
      { title: "開場・晨光", durationSec: 5, prompt: "清晨禪堂，柔和光線", voiceover: "那一年，我第一次走進禪堂。" },
      { title: "紅傘特寫", durationSec: 4, prompt: "正紅長柄傘立在門邊", voiceover: "" },
    ]);
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
});
