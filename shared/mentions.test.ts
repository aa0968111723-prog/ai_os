import { describe, expect, it } from "vitest";
import { parseMentionedNames, buildMentionRegExp, escapeRegExp } from "./mentions";

describe("parseMentionedNames", () => {
  const names = ["阿明", "阿明師兄", "小美", "王大文"];

  it("長名優先:@阿明師兄 只算成阿明師兄,不誤把阿明也算進去", () => {
    // 這正是舊 body.includes('@'+name) 的 bug:兩者都會被命中
    expect(parseMentionedNames("@阿明師兄 麻煩你了", names)).toEqual(["阿明師兄"]);
  });

  it("同一句同時提及前綴名與長名時,兩個都算得到", () => {
    expect(parseMentionedNames("@阿明 跟 @阿明師兄 都看一下", names).sort()).toEqual(
      ["阿明", "阿明師兄"].sort(),
    );
  });

  it("重複提及去重,且只回名單內的名字", () => {
    expect(parseMentionedNames("@小美 @小美 @路人甲 收到", names)).toEqual(["小美"]);
  });

  it("沒有任何提及回空陣列", () => {
    expect(parseMentionedNames("大家早安", names)).toEqual([]);
    expect(parseMentionedNames("", names)).toEqual([]);
  });

  it("空名單不會爆(回空)", () => {
    expect(parseMentionedNames("@誰都好", [])).toEqual([]);
  });

  it("名字含正則特殊字元也能正確比對", () => {
    expect(parseMentionedNames("辛苦了 @A.B(組長)", ["A.B(組長)", "AXB"]).length).toBe(1);
    expect(parseMentionedNames("辛苦了 @A.B(組長)", ["A.B(組長)", "AXB"])).toEqual(["A.B(組長)"]);
  });
});

describe("buildMentionRegExp", () => {
  it("空名單回 null", () => {
    expect(buildMentionRegExp([])).toBeNull();
    expect(buildMentionRegExp([""])).toBeNull();
  });

  it("非空名單回可用的全域 RegExp", () => {
    const re = buildMentionRegExp(["阿明"]);
    expect(re).toBeInstanceOf(RegExp);
    expect(re?.global).toBe(true);
  });
});

describe("escapeRegExp", () => {
  it("跳脫正則特殊字元", () => {
    expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
  });
});
