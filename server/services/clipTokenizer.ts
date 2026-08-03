import ClipBpe from "clip-bpe-js";

/**
 * CLIP 分詞（真的分詞，不是估算）。
 *
 * 為什麼要自己寫這一層：`clip-bpe-js` 帶的是 OpenAI 官方的 merges 表（資料是對的），
 * 但它的 encode 把每個字元用 `charCodeAt(0)` 當成一個 byte——那是 UTF-16 碼位，不是
 * UTF-8 byte。ASCII 剛好相等所以看不出問題；中文一律落在 byteEncoder 之外，
 * 整段回 `[undefined]`。站內提示詞以中文為主，直接用它等於拿假數字騙人。
 *
 * 這裡沿用它的 merges／vocab 與 BPE 合併迴圈（那兩塊是正確的），只把 byte 對應
 * 換成 CLIP 原始實作的做法：`token.encode("utf-8")` 後**逐 byte** 查表。
 * 正確性由測試鎖住：ASCII 與參考實作逐 id 相同、中文 encode→decode 可完整還原。
 */

/** CLIP 原始實作的切詞規則（與 clip-bpe-js 相同，來自 OpenAI simple_tokenizer.py） */
const PATTERN = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/gui;

/** 序列總長 77，其中頭尾各一個特殊 token，內容實際只放得下 75 個 */
export const CLIP_SEQUENCE_TOKENS = 77;
export const CLIP_SPECIAL_TOKENS = 2;
export const CLIP_CONTENT_TOKENS = CLIP_SEQUENCE_TOKENS - CLIP_SPECIAL_TOKENS;

interface ClipBpeInternals {
  byteEncoder: Record<number, string>;
  encoder: Record<string, number>;
  decoder: Record<number, string>;
  bpe(token: string): string;
}

/** 詞表建構要跑近五萬條 merges，全程序只做一次 */
let cached: ClipBpeInternals | undefined;
function base(): ClipBpeInternals {
  cached ??= new (ClipBpe as unknown as new () => ClipBpeInternals)();
  return cached;
}

const utf8 = new TextEncoder();

/** 與 CLIP 前處理一致：壓縮空白、去頭尾、轉小寫 */
function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** 文字 → CLIP token id（不含頭尾特殊 token） */
export function clipEncode(text: string): number[] {
  const tokenizer = base();
  const ids: number[] = [];
  for (const match of clean(text ?? "").matchAll(PATTERN)) {
    // 這一行就是與 clip-bpe-js 的差別：逐 UTF-8 byte，而不是逐 UTF-16 碼位
    const mapped = Array.from(utf8.encode(match[0]), (byte) => tokenizer.byteEncoder[byte]).join("");
    for (const piece of tokenizer.bpe(mapped).split(" ")) {
      const id = tokenizer.encoder[piece];
      // byte-level BPE 的每個單 byte 都在詞表裡，理論上不會落空；真的落空寧可爆也不要默默少算
      if (id === undefined) throw new Error(`CLIP 詞表缺少片段：${piece}`);
      ids.push(id);
    }
  }
  return ids;
}

/** token id → 文字。只有測試會用（round-trip 是正確性的主要證據） */
export function clipDecode(ids: readonly number[]): string {
  const tokenizer = base();
  // 順序照 CLIP 原始實作：先逐 byte 還原、UTF-8 解碼，最後才把詞尾標記換成空白。
  // 先換空白會塞進一個不在 byte 表裡的字元，中文就還原不回來。
  const mapped = ids.map((id) => tokenizer.decoder[id]).join("");
  const byteDecoder = new Map(
    Object.entries(tokenizer.byteEncoder).map(([byte, char]) => [char, Number(byte)]),
  );
  const bytes = Uint8Array.from(
    Array.from(mapped, (char) => {
      const byte = byteDecoder.get(char);
      if (byte === undefined) throw new Error(`無法還原字元：${char}`);
      return byte;
    }),
  );
  return new TextDecoder().decode(bytes).replaceAll("</w>", " ");
}

/** 這段文字實際佔幾個 CLIP token */
export function clipTokenCount(text: string): number {
  return clipEncode(text).length;
}

export interface ClipChunk {
  /** CLIP 自己的切詞單位（一個詞或一串中日韓字），原文照抄 */
  text: string;
  /** 這個單位實際佔幾個 token */
  tokens: number;
}

/**
 * 逐「詞」的實際 token 佔用。
 *
 * 這是唯一能誠實回答「模型比較看重哪些字」的量測方向：權重拿不到，但**版面**拿得到——
 * 一個詞吃掉窗口的多少格、落在窗口的第幾格、有沒有被切在線外，都是確定的事實。
 * 切詞單位用 CLIP 自己的 pre-tokenize 規則，不是我們自己另外斷詞。
 */
export function clipEncodeChunks(text: string): ClipChunk[] {
  const tokenizer = base();
  const chunks: ClipChunk[] = [];
  for (const match of clean(text ?? "").matchAll(PATTERN)) {
    const mapped = Array.from(utf8.encode(match[0]), (byte) => tokenizer.byteEncoder[byte]).join("");
    chunks.push({ text: match[0], tokens: tokenizer.bpe(mapped).split(" ").length });
  }
  return chunks;
}
