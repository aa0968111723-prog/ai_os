import { describe, expect, it } from "vitest";
import { billingGroupIdFor, formatStatsLine, mediaKindOf, parseClassifyReply, type TableStats } from "./databaseMedia";
import { signDbFileUrl, verifyDbFileSig, verifyAssetSig } from "./storage";
import { normalizeFileCategory } from "../../shared/databaseFields";

describe("mediaKindOf", () => {
  it("依 mime 前綴分四類（含參數與大小寫）", () => {
    expect(mediaKindOf("image/png")).toBe("image");
    expect(mediaKindOf("IMAGE/JPEG; charset=binary")).toBe("image");
    expect(mediaKindOf("video/mp4")).toBe("video");
    expect(mediaKindOf("audio/mpeg")).toBe("audio");
    expect(mediaKindOf("application/pdf")).toBe("doc");
    expect(mediaKindOf("text/plain")).toBe("doc");
  });
});

describe("parseClassifyReply", () => {
  it("正常 JSON：取 description 與正規化後的 category", () => {
    const r = parseClassifyReply('{"description":"一位師姐在佛堂前雙手合十。","category":" 人物 "}');
    expect(r.description).toBe("一位師姐在佛堂前雙手合十。");
    expect(r.category).toBe("人物");
  });
  it("JSON 混在其他文字中也抓得到", () => {
    const r = parseClassifyReply('好的，以下是結果：\n{"description":"夕陽下的寺廟。","category":"場景"}\n希望有幫助');
    expect(r.description).toBe("夕陽下的寺廟。");
    expect(r.category).toBe("場景");
  });
  it("broken fence does not swallow a later complete classify object", () => {
    const r = parseClassifyReply('```json\n{"description":"壞\n```\n{"description":"正確的圖。","category":"場景"}');
    expect(r.description).toBe("正確的圖。");
    expect(r.category).toBe("場景");
  });
  it("缺 category：分類退「其他」", () => {
    const r = parseClassifyReply('{"description":"一張海報。"}');
    expect(r.description).toBe("一張海報。");
    expect(r.category).toBe("其他");
  });
  it("壞 JSON：整段文字當描述、分類退「其他」", () => {
    const r = parseClassifyReply("這張圖片是一座山。");
    expect(r.description).toBe("這張圖片是一座山。");
    expect(r.category).toBe("其他");
  });
  it("壞 JSON（描述為空）：給占位描述不回空字串", () => {
    const r = parseClassifyReply("");
    expect(r.description.length).toBeGreaterThan(0);
    expect(r.category).toBe("其他");
  });
  it("超長描述截斷到上限", () => {
    const r = parseClassifyReply(JSON.stringify({ description: "甲".repeat(5000), category: "物件" }));
    expect(r.description.length).toBe(2000);
    expect(r.category).toBe("物件");
  });
  it("超長分類截到 30 字（normalizeFileCategory 同一把尺）", () => {
    const r = parseClassifyReply(JSON.stringify({ description: "描述", category: "乙".repeat(80) }));
    expect(r.category.length).toBe(30);
  });
});

describe("normalizeFileCategory", () => {
  it("去空白、收斂內部空白、空值回 null", () => {
    expect(normalizeFileCategory("  人物  ")).toBe("人物");
    expect(normalizeFileCategory("海報  文宣")).toBe("海報 文宣");
    expect(normalizeFileCategory("")).toBeNull();
    expect(normalizeFileCategory("   ")).toBeNull();
    expect(normalizeFileCategory(null)).toBeNull();
    expect(normalizeFileCategory(42)).toBeNull();
  });
});

describe("billingGroupIdFor", () => {
  const auth = { groups: [{ groupId: "g-1" }, { groupId: "g-2" }] } as never;
  it("組庫記到該組", () => {
    expect(billingGroupIdFor(auth, { scope: "group", groupId: "g-9" })).toBe("g-9");
  });
  it("個人／團隊／全站庫記到使用者第一個組", () => {
    expect(billingGroupIdFor(auth, { scope: "personal", groupId: null })).toBe("g-1");
    expect(billingGroupIdFor(auth, { scope: "team", groupId: null })).toBe("g-1");
    expect(billingGroupIdFor(auth, { scope: "global", groupId: null })).toBe("g-1");
  });
  it("無任何組回 null（呼叫端擋）", () => {
    expect(billingGroupIdFor({ groups: [] } as never, { scope: "personal", groupId: null })).toBeNull();
  });
});

describe("formatStatsLine", () => {
  const base: TableStats = {
    rowCount: 1234,
    fieldCount: 5,
    files: {
      count: 7,
      totalBytes: 3 * 1024 * 1024,
      readableCount: 2,
      readableChars: 4567,
      describedCount: 3,
      byKind: [
        { kind: "image", count: 4, bytes: 2 * 1024 * 1024 },
        { kind: "video", count: 1, bytes: 1024 * 1024 },
        { kind: "audio", count: 0, bytes: 0 },
        { kind: "doc", count: 2, bytes: 0 },
      ],
    },
    categories: [
      { category: "人物", count: 3 },
      { category: "場景", count: 1 },
    ],
    lastActivityAt: null,
  };
  it("含列數、分佈、可讀字數、看圖數與分類", () => {
    const line = formatStatsLine(base);
    expect(line).toContain("1,234 列");
    expect(line).toContain("5 欄");
    expect(line).toContain("圖片 4");
    expect(line).toContain("影片 1");
    expect(line).not.toContain("音訊"); // 0 的類型不列
    expect(line).toContain("3.0 MB");
    expect(line).toContain("AI 可讀 4,567 字");
    expect(line).toContain("已看圖描述 3 份");
    expect(line).toContain("人物 3");
  });
  it("空庫：標示無附掛文件、不出現可讀/分類段", () => {
    const line = formatStatsLine({
      ...base,
      rowCount: 0,
      files: { count: 0, totalBytes: 0, readableCount: 0, readableChars: 0, describedCount: 0, byKind: [] },
      categories: [],
    });
    expect(line).toContain("無附掛文件");
    expect(line).not.toContain("AI 可讀");
    expect(line).not.toContain("分類：");
  });
});

describe("資料庫文件簽名網址（dbfile 分域）", () => {
  it("簽出的網址可通過驗證", () => {
    const url = new URL(signDbFileUrl("f-123", 600));
    expect(url.pathname).toBe("/api/databases/files/f-123/file");
    const exp = url.searchParams.get("exp") ?? undefined;
    const sig = url.searchParams.get("sig") ?? undefined;
    expect(verifyDbFileSig("f-123", exp, sig)).toBe(true);
  });
  it("換一個 fileId 驗證失敗", () => {
    const url = new URL(signDbFileUrl("f-123", 600));
    expect(verifyDbFileSig("f-456", url.searchParams.get("exp")!, url.searchParams.get("sig")!)).toBe(false);
  });
  it("dbfile 簽名不能拿去換素材簽名（分域）", () => {
    const url = new URL(signDbFileUrl("same-id", 600));
    expect(verifyAssetSig("same-id", url.searchParams.get("exp")!, url.searchParams.get("sig")!)).toBe(false);
  });
  it("缺參數或過期一律失敗", () => {
    expect(verifyDbFileSig("f-123", undefined, undefined)).toBe(false);
    const past = String(Math.floor(Date.now() / 1000) - 10);
    expect(verifyDbFileSig("f-123", past, "deadbeef")).toBe(false);
  });
});
