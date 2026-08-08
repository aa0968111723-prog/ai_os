/**
 * 假模式抽取（mockStoryExtract）的確定性測試：e2e 與示範環境都靠它走完
 * 「貼故事→解析→確認卡→轉分鏡」金路徑，行為飄移會讓整條驗收鏈靜默失真。
 * 標記行契約：「角色：」「場景：」「道具：」（0.95）＋「疑似道具：」（0.6→確認卡）。
 */
import { describe, it, expect } from "vitest";
import { mockStoryExtract, sha256Hex } from "./storyParse";
import { storyParseModelSchema } from "../../shared/story";

const SAMPLE = [
  "角色：安倢（黑髮、柔和五官）、師父（灰袍長者）",
  "場景：克難坡（石階、老樹）",
  "道具：紅傘（紅色油紙傘）",
  "疑似道具：帆布包",
  "造型：安倢＝米白外套",
  "",
  "清晨的克難坡下著雨。安倢撐著紅傘走下石階。",
  "",
  "師父在坡頂等她。安倢停下腳步，回頭看了一眼。",
].join("\n");

describe("mockStoryExtract", () => {
  it("標記行 → 實體候選（0.95），疑似 → 低信心候選（0.6）", () => {
    const plan = mockStoryExtract(SAMPLE);
    expect(plan.characters.map((c) => c.name)).toEqual(["安倢", "師父"]);
    expect(plan.characters[0].appearance).toBe("黑髮、柔和五官");
    expect(plan.characters[0].confidence).toBe(0.95);
    expect(plan.locations[0]).toMatchObject({ name: "克難坡", features: "石階、老樹", confidence: 0.95 });
    expect(plan.props.map((p) => [p.name, p.confidence])).toEqual([
      ["紅傘", 0.95],
      ["帆布包", 0.6],
    ]);
  });

  it("「造型：角色＝描述」掛到角色 costume（Identity/Look 分層）", () => {
    const plan = mockStoryExtract(SAMPLE);
    expect(plan.characters.find((c) => c.name === "安倢")?.costume).toBe("米白外套");
    expect(plan.characters.find((c) => c.name === "師父")?.costume).toBeUndefined();
  });

  it("出場道具掛 propRefs（假模式要與真模式同一份契約，否則 e2e 是假綠燈）", () => {
    const plan = mockStoryExtract(SAMPLE);
    const withUmbrella = plan.scenes.flatMap((s) => s.shots).filter((sh) => (sh.propRefs ?? []).includes("紅傘"));
    expect(withUmbrella.length).toBeGreaterThan(0);
    // 沒提到道具的鏡不該被硬掛（錨點會被灌進不相干的畫面）
    const sceneryOnly = plan.scenes.flatMap((s) => s.shots).find((sh) => sh.prompt.includes("下著雨") && !sh.prompt.includes("紅傘"));
    expect(sceneryOnly?.propRefs ?? []).not.toContain("紅傘");
  });

  it("段落 → 場；句子 → 鏡；環境（雨/清晨）寫進 environment；出場角色掛 characterRefs", () => {
    const plan = mockStoryExtract(SAMPLE);
    expect(plan.scenes).toHaveLength(2);
    expect(plan.scenes[0].environment).toMatchObject({ weather: "雨天", timeOfDay: "清晨" });
    expect(plan.scenes[0].shots.length).toBeGreaterThanOrEqual(2);
    const shotWithAnjie = plan.scenes[0].shots.find((s) => s.prompt.includes("安倢"));
    expect(shotWithAnjie?.characterRefs).toContain("安倢");
    // 第二段沒有雨/時間字樣 → 無 environment
    expect(plan.scenes[1].environment).toBeUndefined();
  });

  it("輸出必過模型 schema（假模式與真模式走同一道守門）", () => {
    expect(storyParseModelSchema.safeParse(mockStoryExtract(SAMPLE)).success).toBe(true);
    // 沒有任何標記與段落結構的極端輸入也要能成一場
    expect(storyParseModelSchema.safeParse(mockStoryExtract("只有一句話")).success).toBe(true);
  });

  it("同輸入同輸出（確定性；e2e 斷言的前提）", () => {
    expect(JSON.stringify(mockStoryExtract(SAMPLE))).toBe(JSON.stringify(mockStoryExtract(SAMPLE)));
  });
});

describe("sha256Hex", () => {
  it("同文同雜湊、異文異雜湊（解析冪等短路的依據）", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
    expect(sha256Hex("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});
