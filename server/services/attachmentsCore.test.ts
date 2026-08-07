import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_INJECT_CHARS,
  attachmentNameChecked,
  attachmentUrl,
  formatAttachmentInjectBlock,
  parseAttachmentKind,
} from "./attachmentsCore";

describe("parseAttachmentKind（附件類別守門）", () => {
  it("只收 note／knowledge", () => {
    expect(parseAttachmentKind("note")).toBe("note");
    expect(parseAttachmentKind("knowledge")).toBe("knowledge");
  });
  it("其他值一律擋下——ref_id 依 kind 指向不同表，錯一個字就會指到別張表的列", () => {
    for (const bad of ["", "notes", "asset", "NOTE", "../note"]) {
      expect(() => parseAttachmentKind(bad)).toThrow();
    }
  });
});

describe("attachmentNameChecked（檔名正規化）", () => {
  it("去頭尾空白、換行折成空白（檔名混進換行會拆掉清單版面）", () => {
    expect(attachmentNameChecked("  週會白板\n照片.jpg  ")).toBe("週會白板 照片.jpg");
  });
  it("空字串退回預設名，不會出現沒有名字的附件列", () => {
    expect(attachmentNameChecked("   ")).toBe("附件");
    expect(attachmentNameChecked("", "講義")).toBe("講義");
  });
  it("超長檔名截到 120 字", () => {
    expect(attachmentNameChecked("字".repeat(300))).toHaveLength(120);
  });
});

describe("attachmentUrl", () => {
  it("指向附件檔案服務（權限回推母體，非公開網址）", () => {
    expect(attachmentUrl("abc")).toBe("/api/attachments/abc/file");
  });
});

describe("formatAttachmentInjectBlock（知識庫附件注入區塊）", () => {
  it("每份檔案帶檔名標頭，讓 AI 知道這段文字的出處", () => {
    const out = formatAttachmentInjectBlock([{ name: "開示稿.pdf", textContent: "萬法唯心造" }]);
    expect(out).toBe("【附件：開示稿.pdf】\n萬法唯心造");
  });

  it("沒有抽到文字的附件（照片）不佔注入預算", () => {
    expect(formatAttachmentInjectBlock([
      { name: "合照.jpg", textContent: null },
      { name: "空白.txt", textContent: "   " },
    ])).toBe("");
  });

  it("多份檔案以空行分隔，順序照傳入", () => {
    const out = formatAttachmentInjectBlock([
      { name: "A.pdf", textContent: "甲" },
      { name: "B.docx", textContent: "乙" },
    ]);
    expect(out).toBe("【附件：A.pdf】\n甲\n\n【附件：B.docx】\n乙");
  });

  it("單份過長會截斷並標明——一份 300 頁 PDF 不該吃掉整個知識預算", () => {
    const out = formatAttachmentInjectBlock([{ name: "長稿.pdf", textContent: "字".repeat(ATTACHMENT_INJECT_CHARS + 500) }]);
    expect(out).toContain("（附件過長，已截斷）");
    // 標頭 + 截斷後本文 + 提示；本文不得超過上限
    expect(out.split("\n")[1].startsWith("字".repeat(ATTACHMENT_INJECT_CHARS))).toBe(true);
    expect(out.length).toBeLessThan(ATTACHMENT_INJECT_CHARS + 60);
  });

  it("恰好等於上限不截斷（邊界不多送一段警語）", () => {
    const out = formatAttachmentInjectBlock([{ name: "剛好.pdf", textContent: "字".repeat(ATTACHMENT_INJECT_CHARS) }]);
    expect(out).not.toContain("已截斷");
  });
});
