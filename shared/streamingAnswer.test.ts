import { describe, expect, it } from "vitest";
import { StreamingAnswerExtractor } from "./streamingAnswer";

/** 把整段文字切成固定長度的塊，模擬供應商的 token 邊界落在任意位置 */
function pushInChunks(source: string, size: number): string {
  const extractor = new StreamingAnswerExtractor();
  let out = "";
  for (let i = 0; i < source.length; i += size) out += extractor.push(source.slice(i, i + size));
  return out;
}

describe("StreamingAnswerExtractor", () => {
  it("只吐出 answer 欄位的文字，不吐 JSON 骨架", () => {
    const extractor = new StreamingAnswerExtractor();
    const out = extractor.push('{"answer":"這是回答","actions":[]}');
    expect(out).toBe("這是回答");
    expect(extractor.finished).toBe(true);
  });

  it("工具呼叫那幾輪一個字都不吐", () => {
    const extractor = new StreamingAnswerExtractor();
    expect(extractor.push('{"tool":"read_script","args":{"projectId":"x"}}')).toBe("");
    expect(extractor.finished).toBe(false);
  });

  it("答案被切成任意大小的塊都還原得出同一段文字", () => {
    const payload = '{"answer":"第一句。第二句，還有中文標點！","actions":[]}';
    for (const size of [1, 2, 3, 5, 7, 13]) {
      expect(pushInChunks(payload, size)).toBe("第一句。第二句，還有中文標點！");
    }
  });

  it("跳脫序列跨塊也不會吐出半個壞字元", () => {
    // \n 與 \" 的反斜線落在塊尾，\uXXXX 被切成三段
    const payload = '{"answer":"行一\\n他說\\"好\\"\\u3002尾"}';
    for (const size of [1, 2, 4, 6]) {
      expect(pushInChunks(payload, size)).toBe('行一\n他說"好"。尾');
    }
  });

  it("鍵名本身被切斷仍找得到", () => {
    const extractor = new StreamingAnswerExtractor();
    expect(extractor.push('{"ans')).toBe("");
    expect(extractor.push('wer": "嗨')).toBe("嗨");
    expect(extractor.push('囉"}')).toBe("囉");
    expect(extractor.finished).toBe(true);
  });

  it("答案結束後就不再吐字（後面的 actions 陣列不會被當成答案）", () => {
    const extractor = new StreamingAnswerExtractor();
    expect(extractor.push('{"answer":"完","actions":[{"type":')).toBe("完");
    expect(extractor.push('"split_script"}]}')).toBe("");
  });

  it("找不到 answer 時緩衝不會無限長大", () => {
    const extractor = new StreamingAnswerExtractor();
    for (let i = 0; i < 500; i++) expect(extractor.push("x".repeat(100))).toBe("");
    // 緩衝被裁到尾巴後，鍵仍然找得到——裁切不能把功能弄壞
    expect(extractor.push('{"answer":"仍然可用"}')).toBe("仍然可用");
  });

  it("不合法的 \\u 序列照原樣吐出，不變成 U+0000", () => {
    const extractor = new StreamingAnswerExtractor();
    expect(extractor.push('{"answer":"a\\uZZZZb"}')).toBe("a\\uZZZZb");
  });
});
