/**
 * 回饋代理純函式單元測試（無 DB／無網路）：
 * 提示詞組裝、LLM 回覆解析（含髒輸出）、後備分診、回覆信組裝。
 */
import { describe, expect, it } from "vitest";
import {
  buildTriagePrompt,
  parseTriage,
  fallbackTriage,
  buildReplyEmail,
  type ReportForTriage,
} from "./feedbackAgent";

const report: ReportForTriage = {
  id: "r1",
  category: "bug",
  pages: ["專案頁", "作業台（首頁）"],
  targetLabel: "生成按鈕",
  note: "按了生成沒反應，也沒有錯誤訊息",
};

describe("buildTriagePrompt", () => {
  it("含分類中文、頁面、元件與回報內容，且要求只輸出 JSON", () => {
    const p = buildTriagePrompt(report);
    expect(p).toContain("問題／怪怪的"); // bug 的中文標籤
    expect(p).toContain("專案頁");
    expect(p).toContain("生成按鈕");
    expect(p).toContain("按了生成沒反應");
    expect(p).toMatch(/只輸出 JSON/);
  });

  it("頁面與元件皆缺時不炸、仍成句", () => {
    const p = buildTriagePrompt({ id: "x", category: "other", pages: null, targetLabel: null, note: "隨手一提" });
    expect(p).toContain("其他");
    expect(p).toContain("隨手一提");
  });
});

describe("parseTriage", () => {
  it("解析乾淨 JSON", () => {
    const t = parseTriage('{"severity":"high","summary":"生成無回應","fix":"檢查送出 handler","reply":"謝謝回報"}');
    expect(t).not.toBeNull();
    expect(t!.severity).toBe("high");
    expect(t!.summary).toBe("生成無回應");
    expect(t!.fix).toBe("檢查送出 handler");
    expect(t!.reply).toBe("謝謝回報");
  });

  it("剝除 ```json 圍欄與前後說明文字", () => {
    const raw = "好的，分診如下：\n```json\n{\"severity\":\"medium\",\"summary\":\"s\",\"fix\":\"f\",\"reply\":\"r\"}\n```\n以上。";
    const t = parseTriage(raw);
    expect(t?.severity).toBe("medium");
    expect(t?.summary).toBe("s");
  });

  it("嚴重度用中文或未知值時收斂（高→high、亂值→medium）", () => {
    expect(parseTriage('{"severity":"高"}')?.severity).toBe("high");
    expect(parseTriage('{"severity":"critical"}')?.severity).toBe("medium");
    expect(parseTriage('{"severity":"低"}')?.severity).toBe("low");
  });

  it("空字串／非 JSON 回 null（呼叫端退後備）", () => {
    expect(parseTriage("")).toBeNull();
    expect(parseTriage("完全不是 JSON")).toBeNull();
    expect(parseTriage("{壞掉的 json")).toBeNull();
  });

  it("缺欄位時以保底字串補齊、不回 null", () => {
    const t = parseTriage('{"severity":"low"}');
    expect(t).not.toBeNull();
    expect(t!.summary.length).toBeGreaterThan(0);
    expect(t!.fix.length).toBeGreaterThan(0);
  });
});

describe("fallbackTriage", () => {
  it("bug/stuck 給 medium、其餘 low；摘要帶分類與內容", () => {
    expect(fallbackTriage(report).severity).toBe("medium");
    expect(fallbackTriage({ ...report, category: "feature" }).severity).toBe("low");
    const t = fallbackTriage(report);
    expect(t.summary).toContain("問題／怪怪的");
    expect(t.reply.length).toBeGreaterThan(0);
  });
});

describe("buildReplyEmail", () => {
  it("主旨帶分類、內文含回覆與署名；reply 為空時以分類保底補上", () => {
    const mail = buildReplyEmail(report, { severity: "high", summary: "s", fix: "f", reply: "謝謝你，我們會處理" });
    expect(mail.subject).toContain("問題／怪怪的");
    expect(mail.text).toContain("謝謝你，我們會處理");
    expect(mail.text).toContain("回饋代理");

    const empty = buildReplyEmail(report, { severity: "low", summary: "s", fix: "f", reply: "   " });
    expect(empty.text).toContain("謝謝你回報"); // 保底回覆
  });
});
