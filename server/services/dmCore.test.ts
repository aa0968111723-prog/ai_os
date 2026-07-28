import { describe, expect, it } from "vitest";
import { dmRefRoute, dmSnippet, dmThreadPreview, sharesAnyGroup } from "./dmCore";

describe("sharesAnyGroup（可私訊判定核心）", () => {
  it("有交集＝可訊", () => {
    expect(sharesAnyGroup(["g1", "g2"], ["g2", "g3"])).toBe(true);
  });
  it("無交集＝不可訊", () => {
    expect(sharesAnyGroup(["g1"], ["g2"])).toBe(false);
  });
  it("任一方無組＝不可訊（空陣列不誤判）", () => {
    expect(sharesAnyGroup([], ["g1"])).toBe(false);
    expect(sharesAnyGroup(["g1"], [])).toBe(false);
    expect(sharesAnyGroup([], [])).toBe(false);
  });
});

describe("dmSnippet（對話串預覽截斷）", () => {
  it("短句原樣返回", () => {
    expect(dmSnippet("收到 🙏")).toBe("收到 🙏");
  });
  it("換行折成單行空白", () => {
    expect(dmSnippet("第一行\n第二行")).toBe("第一行 第二行");
  });
  it("超長截斷補省略號", () => {
    const long = "字".repeat(120);
    const out = dmSnippet(long);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBe(81); // 80 字＋省略號
  });
  it("恰好等於上限不截斷", () => {
    const exact = "a".repeat(80);
    expect(dmSnippet(exact)).toBe(exact);
  });
});

describe("dmThreadPreview（對話串最後一句預覽合成）", () => {
  it("有內文＝截斷內文（不受附件／標注影響）", () => {
    expect(dmThreadPreview({ body: "晚點交給你", hasAttachment: true, refType: "project" })).toBe("晚點交給你");
  });
  it("空內文＋有附件＝附件佔位字", () => {
    expect(dmThreadPreview({ body: "", hasAttachment: true, refType: null })).toBe("📎 附件");
    expect(dmThreadPreview({ body: "   ", hasAttachment: true, refType: null })).toBe("📎 附件");
  });
  it("空內文＋只有標注＝標注佔位字（帶型別中文）", () => {
    expect(dmThreadPreview({ body: "", hasAttachment: false, refType: "database" })).toBe("🔗 資料庫");
    expect(dmThreadPreview({ body: "", hasAttachment: false, refType: "note" })).toBe("🔗 筆記");
  });
  it("附件優先於標注（同時存在時顯示附件）", () => {
    expect(dmThreadPreview({ body: "", hasAttachment: true, refType: "schedule" })).toBe("📎 附件");
  });
  it("未知 refType 不誤標（回空字串）", () => {
    expect(dmThreadPreview({ body: "", hasAttachment: false, refType: "bogus" })).toBe("");
    expect(dmThreadPreview({ body: "", hasAttachment: false, refType: null })).toBe("");
  });
});

describe("dmRefRoute（標注卡導頁必須對上 App 路由）", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("專案走 /p/:id（不是已廢棄的 /project/）", () => {
    expect(dmRefRoute("project", id)).toBe(`/p/${id}`);
  });
  it("資料庫帶 open 深連結", () => {
    expect(dmRefRoute("database", id)).toBe(`/databases?open=${id}`);
  });
  it("排程／筆記走 planner focus 錨點", () => {
    expect(dmRefRoute("schedule", id)).toBe(`/planner?focus=schedule-${id}`);
    expect(dmRefRoute("note", id)).toBe(`/planner?focus=note-${id}`);
  });
});
