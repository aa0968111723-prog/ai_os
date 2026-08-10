import { describe, expect, it } from "vitest";
import { ASSISTANT_CAPABILITIES } from "@shared/assistantExecution";
import { assistantCapabilityGuide, capabilityExample } from "./assistantCapabilityGuide";
import type { AssistantPageContext } from "./assistantContext";

function ctx(partial: Partial<AssistantPageContext>): AssistantPageContext {
  return { route: "/", pageType: "other", ...partial };
}

/**
 * 這份目錄有兩種會出事的方式：
 * 1. **與真正的能力清單分岔**——畫面寫著做得到、後端沒接，或後端加了新能力畫面永遠不提。
 *    兩者都不會有人在 code review 抓到，因為分岔的兩邊各自看起來都對。
 * 2. **排序失效**——退化成一張固定清單，那就回到「使用者要滑過一堆不相關的行」的原問題。
 */
describe("assistantCapabilityGuide 完整性", () => {
  it("每個已接好的能力都恰好出現一次——不多講也不漏講", () => {
    const listed = assistantCapabilityGuide().groups.flatMap((g) => g.items.map((i) => i.id));
    expect([...listed].sort()).toEqual(ASSISTANT_CAPABILITIES.map((c) => c.id).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("每個能力都有可以直接按的例句——沒有例句的那一行等於還是要人自己猜怎麼講", () => {
    for (const group of assistantCapabilityGuide().groups) {
      for (const item of group.items) {
        expect(item.example.length, `${item.id} 缺例句`).toBeGreaterThan(3);
      }
    }
  });

  it("第一層使用產品語言，而不是 read / auto / confirm / cost", () => {
    expect(assistantCapabilityGuide().groups.map((group) => group.id)).toEqual([
      "data", "video", "project", "work", "collaboration", "generation",
    ]);
  });

  it("加入資料涵蓋既有 Intake / Asset / Database 能力", () => {
    const dataIds = assistantCapabilityGuide().groups.find((g) => g.id === "data")!.items.map((i) => i.id);
    const expected = ASSISTANT_CAPABILITIES
      .filter((c) => ["INTAKE", "ASSET", "DATABASE"].includes(c.domain))
      .map((c) => c.id);
    expect(dataIds.sort()).toEqual(expected.sort());
  });

  it("每一行仍帶著自己的風險後果——產品分類不會削弱確認政策", () => {
    for (const item of assistantCapabilityGuide().suggested) {
      expect(["read", "auto", "confirm", "cost"]).toContain(item.impact);
    }
  });
});

describe("assistantCapabilityGuide 排序（固定清單對誰都不合身）", () => {
  it("推薦區跟著所在頁面走——在資料庫頁就先推資料庫的事", () => {
    const ids = assistantCapabilityGuide({ ctx: ctx({ pageType: "database" }) }).suggested.map((i) => i.id);
    expect(ids).toContain("read_database");
    expect(ids).toContain("add_database_row");
  });

  it("正在看的東西比所在頁面更能代表意圖——盯著某一鏡時分鏡與生成排在前面", () => {
    const ids = assistantCapabilityGuide({
      ctx: ctx({ pageType: "storyboard", entityType: "shot", entityId: "s-1", entityLabel: "第 3 鏡" }),
    }).suggested.map((i) => i.id);
    expect(ids.slice(0, 5)).toEqual(expect.arrayContaining(["read_storyboard", "generate_media"]));
  });

  it("自己用過的浮到最前面——它是唯一由使用者本人產生的訊號，猜錯機率最低", () => {
    const guide = assistantCapabilityGuide({ ctx: ctx({ pageType: "storyboard" }), recent: ["send_dm"] });
    expect(guide.suggested[0].id).toBe("send_dm");
  });

  it("沒有上下文也不會給空清單——空的建議區等於又回到「不知道能幹嘛」", () => {
    expect(assistantCapabilityGuide().suggested.length).toBeGreaterThan(0);
  });

  it("同分時維持型錄順序——每次打開都跳一個新排法，等於逼人每次重新找", () => {
    const a = assistantCapabilityGuide({ ctx: ctx({ pageType: "other" }) }).suggested.map((i) => i.id);
    const b = assistantCapabilityGuide({ ctx: ctx({ pageType: "other" }) }).suggested.map((i) => i.id);
    expect(a).toEqual(b);
  });
});

describe("capabilityExample", () => {
  it("正在盯著某個東西時，例句直接對著它講——樣板句要人自己代換名詞就等於沒省事", () => {
    const focused = ctx({ pageType: "storyboard", entityType: "shot", entityId: "s-1", entityLabel: "第 3 鏡" });
    expect(capabilityExample("generate_media", focused)).toBe("幫我生成第 3 鏡的畫面。");
  });

  it("只有名字沒有 id 時退回通用例句——半個上下文湊出來的句子會指到錯的東西", () => {
    expect(capabilityExample("generate_media", ctx({ pageType: "storyboard", entityLabel: "第 3 鏡" })))
      .toBe("幫我生成第 3 鏡的畫面。");
    expect(capabilityExample("read_storyboard", ctx({ pageType: "storyboard", entityLabel: "第 3 鏡" })))
      .toBe("目前分鏡做到哪？哪幾鏡還沒有畫面或旁白？");
  });

  it("該能力沒有專屬問法時就用通用句，不硬套名字", () => {
    const focused = ctx({ pageType: "notes", entityType: "note", entityId: "n-1", entityLabel: "會議記錄" });
    expect(capabilityExample("read_notes", focused)).toBe("把最近的筆記整理成重點與待辦。");
  });
});
