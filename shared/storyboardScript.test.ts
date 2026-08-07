/**
 * 文字分鏡腳本的格式化／解析／差異規則。
 * 這支的核心契約是「保守套用」：文字裡少寫一鏡，絕不能讓已出圖的那一格消失。
 */
import { describe, expect, it } from "vitest";
import {
  MAX_SCRIPT_SCENES,
  SCRIPT_FIELDS,
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
  { title: "紅傘特寫", durationSec: 4, prompt: "正紅長柄傘立在門邊", voiceover: null, propNames: ["安倢的紅傘"] },
];

describe("formatStoryboardScript", () => {
  it("每鏡一段：標題帶序號與秒數，五個描述欄各一行（編輯模式）", () => {
    expect(formatStoryboardScript(ROWS)).toBe(
      [
        "## 1. 開場・晨光 (5s)",
        "畫面：清晨禪堂，柔和光線",
        "動作：",
        "旁白：那一年，我第一次走進禪堂。",
        "對白：",
        "環境音：遠處鐘聲，細微鳥鳴",
        "",
        "## 2. 紅傘特寫 (4s)",
        "畫面：正紅長柄傘立在門邊",
        "動作：",
        "旁白：",
        "對白：",
        "環境音：",
        "素材卡：安倢的紅傘",
      ].join("\n"),
    );
  });

  /**
   * 唯讀通讀省略空欄。欄位變多之後一律輸出會讓 12 鏡從 59 行漲到 119 行，
   * 編輯框一眼從 3.7 鏡掉到 1.8 鏡——連相鄰兩鏡都看不到，而「這鏡接不接得上下一鏡」
   * 正是打開全文的主要動作。唯讀那份不會被 parse，壓縮它不影響任何契約。
   */
  it("唯讀模式省略空欄——通讀時篇幅不被空標籤灌水", () => {
    const out = formatStoryboardScript(ROWS, "read");
    expect(out).not.toContain("動作：");
    expect(out).not.toContain("旁白：\n");
    expect(out).toContain("畫面：清晨禪堂，柔和光線");
    expect(out).toContain("環境音：遠處鐘聲，細微鳥鳴");
    // 編輯模式仍然是全欄模板（那是漏傳欄位的防呆）
    expect(formatStoryboardScript(ROWS, "edit")).toContain("動作：");
  });

  it("唯讀模式明顯比編輯模式短——這是它存在的唯一理由", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      title: `鏡${i + 1}`, durationSec: 5, prompt: "畫面描述", voiceover: i % 3 ? "旁白" : null,
    }));
    const edit = formatStoryboardScript(many, "edit").split("\n").length;
    const read = formatStoryboardScript(many, "read").split("\n").length;
    expect(read).toBeLessThan(edit * 0.75);
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
        action: "",
        voiceover: "那一年，我第一次走進禪堂。",
        dialogue: "",
        ambience: "遠處鐘聲，細微鳥鳴",
        ordinal: 1,
      },
      {
        title: "紅傘特寫",
        durationSec: 4,
        prompt: "正紅長柄傘立在門邊",
        action: "",
        voiceover: "",
        dialogue: "",
        ambience: "",
        props: "安倢的紅傘",
        ordinal: 2,
      },
    ]);
  });

  it("環境音吃續行，也吃半形冒號（與畫面／旁白同規則）", () => {
    const parsed = parseStoryboardScript(
      ["## 1. T (5s)", "環境音: 蟲鳴", "遠處狗吠", "旁白：說話"].join("\n"),
    );
    expect(parsed.scenes[0]?.ambience).toBe("蟲鳴\n遠處狗吠");
    expect(parsed.scenes[0]?.voiceover).toBe("說話");
  });

  /**
   * 值中間的空行。
   *
   * 這條守的是「原封不動貼回來不會被改寫」：逐行 trim 會把段落之間的空行併掉，
   * 而使用者什麼都沒改、diff 卻判定有變更 → applyScript 把少了空行的版本寫進 DB。
   * 旁白目前少用空行所以沒人踩到，但對白幾乎必然用空行分段。
   */
  it("欄位值中間的空行原樣保留——使用者用空行分段，貼回來不能被併掉", () => {
    const parsed = parseStoryboardScript(
      ["## 1. T (5s)", "旁白：第一段", "", "第二段", "", "", "第三段"].join("\n"),
    );
    expect(parsed.scenes[0]?.voiceover).toBe("第一段\n\n第二段\n\n\n第三段");
  });

  it("值的頭尾空白仍然修掉（只有中間的空行要留）", () => {
    const parsed = parseStoryboardScript(["## 1. T (5s)", "畫面：", "", "  正文  ", "", ""].join("\n"));
    expect(parsed.scenes[0]?.prompt).toBe("正文");
  });

  it("帶空行的值來回不失真——format 後再 parse 必須拿回同一個字串", () => {
    const rows = [
      { title: "T", durationSec: 5, prompt: "第一段\n\n第二段", voiceover: "唸第一句\n\n唸第二句", ambience: null },
    ];
    const back = parseStoryboardScript(formatStoryboardScript(rows)).scenes[0];
    expect(back?.prompt).toBe("第一段\n\n第二段");
    expect(back?.voiceover).toBe("唸第一句\n\n唸第二句");
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

describe("對白：逐句序列，旁白可混在裡面交錯", () => {
  const BLOCK = ["@旁白：那一年。", "@師父：坐吧。", "@安倢（小聲）：謝謝師父。"].join("\n");

  it("標籤自己一行、台詞列在下面——第一句不會被擠在冒號後面對不齊", () => {
    const out = formatStoryboardScript([{ title: "T", durationSec: 5, dialogue: BLOCK }]);
    expect(out).toContain("對白：\n@旁白：那一年。");
  });

  it("整段對白來回不失真（@ 行不匹配標籤規則，所以不需要跳脫）", () => {
    const rows = [{ title: "T", durationSec: 8, prompt: "畫", dialogue: BLOCK }];
    expect(parseStoryboardScript(formatStoryboardScript(rows)).scenes[0]?.dialogue).toBe(BLOCK);
  });

  it("對白裡的「旁白：」不會被誤讀成旁白欄位（有 @ 前綴保護）", () => {
    const parsed = parseStoryboardScript(
      ["## 1. T (5s)", "對白：", "@旁白：這是對白區塊裡的旁白", "旁白：這才是旁白欄位"].join("\n"),
    );
    expect(parsed.scenes[0]?.dialogue).toBe("@旁白：這是對白區塊裡的旁白");
    expect(parsed.scenes[0]?.voiceover).toBe("這才是旁白欄位");
  });
});

describe("SCRIPT_FIELDS（欄位表是 parse/format/上限的單一來源）", () => {
  it("描述型欄位一律吃續行——設成單行會讓續行落回前一欄再被覆寫，字無聲消失", () => {
    // 實測過的回歸：環境音一度被設成 multiline:false，這份輸入會讓「遠處狗吠」完全不見
    const parsed = parseStoryboardScript(
      ["## 1. T (5s)", "環境音：蟲鳴", "遠處狗吠", "旁白：說話"].join("\n"),
    );
    expect(parsed.scenes[0]?.ambience).toBe("蟲鳴\n遠處狗吠");
    expect(parsed.scenes[0]?.voiceover).toBe("說話");
    // 規則不是「全部多行」，而是「描述型多行、名單型單行」。名單型（配樂與之後的
    // 角色／場景／道具）排在一鏡最後，續行落回前一個描述欄不會被覆寫，所以安全。
    const DESCRIPTIVE = new Set(["prompt", "action", "voiceover", "dialogue", "ambience"]);
    for (const f of SCRIPT_FIELDS) {
      expect(f.multiline, `${f.human} 的 multiline 設錯`).toBe(DESCRIPTIVE.has(f.key));
    }
  });

  it("單行的名單型欄位排在最後，續行落回前一個描述欄而不是消失", () => {
    const parsed = parseStoryboardScript(
      ["## 1. T (5s)", "環境音：蟲鳴", "配樂：起｜鋼琴", "這是鏡末尾的筆記"].join("\n"),
    );
    expect(parsed.scenes[0]?.music).toBe("起｜鋼琴");
    expect(parsed.scenes[0]?.ambience).toBe("蟲鳴\n這是鏡末尾的筆記"); // 沒有消失
  });

  it("配樂空的時候不輸出那一行——它是區間端點，不是每鏡都有的屬性", () => {
    const out = formatStoryboardScript([{ title: "T", durationSec: 5, prompt: "畫" }]);
    expect(out).not.toContain("配樂：");
    expect(out).toContain("環境音："); // 描述欄仍是全欄模板
    expect(formatStoryboardScript([{ title: "T", durationSec: 5, music: "起｜鋼琴" }])).toContain("配樂：起｜鋼琴");
  });

  it("動作走位是獨立欄位，不會混進畫面（畫面是要送圖像模型的）", () => {
    const parsed = parseStoryboardScript(
      ["## 1. T (5s)", "畫面：禪堂夜坐，中景", "動作：安倢從門口走到窗邊，停下"].join("\n"),
    );
    expect(parsed.scenes[0]?.prompt).toBe("禪堂夜坐，中景");
    expect(parsed.scenes[0]?.action).toBe("安倢從門口走到窗邊，停下");
  });

  it("同一欄寫兩次會出聲——標籤是賦值不是附加，第一次的字會被蓋掉", () => {
    const parsed = parseStoryboardScript(["## 1. T (5s)", "旁白：第一句", "旁白：第二句"].join("\n"));
    expect(parsed.scenes[0]?.voiceover).toBe("第二句");
    expect(parsed.warnings.join()).toMatch(/「旁白」寫了不只一次/);
  });

  it("每一欄的上限都由表導出，不會有欄位漏掉檢查", () => {
    for (const field of SCRIPT_FIELDS) {
      const parsed = parseStoryboardScript(`## 1. 開場\n${field.label}：${"字".repeat(field.max + 1)}`);
      expect(parsed.errors.join(), `${field.human} 沒有上限檢查`).toMatch(
        new RegExp(`的${field.human} ${field.max + 1} 字`),
      );
    }
  });

  it("卡片三行排在一鏡最後，且只在真的綁了卡時才輸出", () => {
    const out = formatStoryboardScript([
      { title: "T", durationSec: 5, prompt: "畫", characterNames: ["安倢", "師父"], propNames: ["安倢的紅傘"] },
    ]);
    expect(out).toContain("角色卡：安倢・師父");
    expect(out).toContain("素材卡：安倢的紅傘");
    // 沒綁場景卡就不印那一行：空的卡片行是**沒有作用**的（留白＝維持原值），
    // 印在編輯模板裡會誤導人以為清空它就能解除綁定
    expect(out).not.toContain("場景卡：");
    // 排在最後：讀起來像分場表的場末註記，也讓單行欄位的續行落回前一個描述欄
    expect(out.trim().split("\n").at(-1)).toBe("素材卡：安倢的紅傘");
  });

  it("卡片行來回不失真，且鏡末尾補的筆記不會被吞進名單", () => {
    const rows = [{ title: "T", durationSec: 5, prompt: "畫", characterNames: ["安倢", "師父"] }];
    expect(parseStoryboardScript(formatStoryboardScript(rows)).scenes[0]?.characters).toBe("安倢・師父");
    // 名單型欄位不吃續行——被吞進去的筆記會拿去查卡片，查不到就整行不套用，
    // 使用者會看到「我只是加了一句話，綁定就壞了」
    const parsed = parseStoryboardScript(
      ["## 1. T (5s)", "環境音：蟲鳴", "角色卡：安倢", "這是鏡末尾的筆記"].join("\n"),
    );
    expect(parsed.scenes[0]?.characters).toBe("安倢");
    expect(parsed.scenes[0]?.ambience).toBe("蟲鳴\n這是鏡末尾的筆記");
  });

  it("舊腳本的「設定卡：」仍被安全忽略，且不會吃掉它後面的行", () => {
    const parsed = parseStoryboardScript(
      ["## 1. T (5s)", "畫面：晨光", "設定卡：安倢・禪堂（唯讀）", "這行是補充"].join("\n"),
    );
    expect(JSON.stringify(parsed.scenes[0])).not.toContain("安倢");
    expect(parsed.scenes[0]?.prompt).toBe("晨光\n這行是補充");
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

  /**
   * 卡片行的「空」不等於「清空」，所以預告不能拿字串直接比。
   * 照字串比會把留白算成一筆更新，按下去卻毫無動靜——預覽說謊比不預覽更糟。
   */
  it("卡片行留白不算變更（伺服器也不會動它）", () => {
    const rows = [{ title: "T", durationSec: 5, prompt: "畫", characterNames: ["安倢"] }];
    expect(diffStoryboardScript(rows, parseStoryboardScript("## 1. T (5s)\n角色卡：").scenes).updated).toEqual([]);
  });

  it("卡片行寫「無」＝解除，算變更；換名字、換順序也算", () => {
    const rows = [{ title: "T", durationSec: 5, prompt: "畫", characterNames: ["安倢", "師父"] }];
    const updatedBy = (line: string) =>
      diffStoryboardScript(rows, parseStoryboardScript(`## 1. T (5s)\n${line}`).scenes).updated;
    expect(updatedBy("角色卡：無")).toHaveLength(1);
    expect(updatedBy("角色卡：安倢")).toHaveLength(1);
    // 順序會決定提示詞裡卡片的組裝順序，不能當成無序集合
    expect(updatedBy("角色卡：師父・安倢")).toHaveLength(1);
    expect(updatedBy("角色卡：安倢・師父")).toEqual([]);
  });

  it("沒綁卡的鏡寫「無」不算變更（不製造一筆什麼都沒動的更新）", () => {
    const rows = [{ title: "T", durationSec: 5, prompt: "畫" }];
    expect(diffStoryboardScript(rows, parseStoryboardScript("## 1. T (5s)\n角色卡：無").scenes).updated).toEqual([]);
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
