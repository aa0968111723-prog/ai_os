import { describe, expect, it } from "vitest";
import { sanitizeAiTracePayload } from "./aiTrace";

describe("sanitizeAiTracePayload", () => {
  it("遮蔽密鑰、cookie 與模型私密推理欄位", () => {
    const safe = sanitizeAiTracePayload({
      authorization: "Bearer secret",
      nested: {
        apiKey: "abc",
        cookie: "session=123",
        reasoning: "hidden chain",
        thinking: ["private"],
        answer: "可公開答案",
      },
    });

    expect(safe.payload).toMatchObject({
      authorization: "（已遮蔽敏感資料）",
      nested: {
        apiKey: "（已遮蔽敏感資料）",
        cookie: "（已遮蔽敏感資料）",
        reasoning: "（不保存模型私密推理）",
        thinking: "（不保存模型私密推理）",
        answer: "可公開答案",
      },
    });
  });

  it("移除簽名網址查詢參數但保留資源路徑", () => {
    const safe = sanitizeAiTracePayload({
      sourceUrl: "https://cdn.example.test/file.png?X-Amz-Signature=secret&X-Amz-Expires=60",
    });
    expect(safe.payload.sourceUrl).toBe("https://cdn.example.test/file.png");
  });

  it("對超長事件保留雜湊與有界預覽", () => {
    const safe = sanitizeAiTracePayload({ text: "x".repeat(700_000) });
    expect(safe.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(safe.truncatedFields).toContain("payload.text");
    expect(JSON.stringify(safe.payload).length).toBeLessThan(520_000);
  });
});
