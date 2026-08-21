/**
 * 從「還在串流中的 JSON」裡即時抽出 answer 欄位的文字。
 *
 * 為什麼需要它：助手要模型回的是一整包 JSON（`{"tool":…}` 或 `{"answer":…,"actions":[…]}`），
 * 不是純文字。把原始 token 直接推給前端，使用者會看到 `{"answer":"` 這種東西在畫面上長出來。
 * 這支解碼器只在看到頂層 answer 字串後才開始吐字，工具呼叫那幾輪自然一個字都不吐。
 *
 * 邊界情況都由 pending 緩衝處理：`\uXXXX` 被切成兩個 chunk、跳脫反斜線落在 chunk 結尾、
 * `"answer"` 這個鍵本身被切斷——都不會吐出半個壞字元。
 *
 * 已知取捨：若模型在 answer 之前的內容裡就出現 `"answer":"` 字樣（例如工具參數帶了這串），
 * 會提早開始吐字。這只影響串流過程的畫面，最終答案一律以 done 事件的權威版本覆蓋。
 */
const KEY_PATTERN = /"answer"\s*:\s*"/;
/** 找鍵時最多回看這麼多字元——足夠涵蓋 `"answer" : "` 的最長合理寫法，又不會無限長大。 */
const SEEK_KEEP_CHARS = 64;

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

export class StreamingAnswerExtractor {
  private state: "seek" | "inside" | "done" = "seek";
  private pending = "";

  get finished(): boolean {
    return this.state === "done";
  }

  /** 餵入一段新的模型輸出，回傳這一段新解出來的答案文字（可能是空字串）。 */
  push(chunk: string): string {
    if (this.state === "done" || !chunk) return "";
    this.pending += chunk;
    if (this.state === "seek") {
      const match = KEY_PATTERN.exec(this.pending);
      if (!match) {
        // 沒找到就只留尾巴，避免整包 JSON 一直堆在記憶體裡
        if (this.pending.length > SEEK_KEEP_CHARS) this.pending = this.pending.slice(-SEEK_KEEP_CHARS);
        return "";
      }
      this.pending = this.pending.slice(match.index + match[0].length);
      this.state = "inside";
    }
    return this.drainString();
  }

  private drainString(): string {
    const source = this.pending;
    let out = "";
    let i = 0;
    while (i < source.length) {
      const char = source[i];
      if (char === '"') {
        this.state = "done";
        i += 1;
        break;
      }
      if (char === "\\") {
        // 跳脫序列尚未收齊：整段留到下一個 chunk 再處理
        if (i + 1 >= source.length) break;
        const escape = source[i + 1];
        if (escape === "u") {
          if (i + 6 > source.length) break;
          const hex = source.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(Number.parseInt(hex, 16));
          } else {
            // 不是合法的 \uXXXX 就照原樣吐出，不要變成 U+0000
            out += source.slice(i, i + 6);
          }
          i += 6;
          continue;
        }
        out += SIMPLE_ESCAPES[escape] ?? escape;
        i += 2;
        continue;
      }
      out += char;
      i += 1;
    }
    this.pending = this.state === "done" ? "" : source.slice(i);
    return out;
  }
}
