import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { Tokenizer } from "@huggingface/tokenizers";

/**
 * T5 分詞（FLUX.1 那條線的文字塔）。
 *
 * 詞表是隨庫附帶的資產：`server/assets/t5-tokenizer.json.gz`
 * （來源：npm `@plurnk/plurnk-mimetypes-tokenizers`（MIT）打包的 T5 `tokenizer.json`；
 * 原始詞表出自 Google T5，Apache-2.0）。分詞引擎用 `@huggingface/tokenizers`——
 * Unigram 與 precompiled_charsmap 正規化都由它實作，我們不自己重寫 sentencepiece。
 *
 * **這份詞表沒有任何中日韓字元**（測試會鎖住這件事）。所以中文在 T5 這條線上
 * 一律變成 `<unk>`：整串中文塌成一個未知符號，模型讀不到任何語意。這不是站內的
 * 推測，是分詞結果——也是這個模組存在的主要理由：讓使用者看得到這件事。
 */

/** T5 的三個固定 id（詞表正確性由測試比對） */
export const T5_PAD_ID = 0;
export const T5_EOS_ID = 1;
export const T5_UNK_ID = 2;

/** FLUX.1 dev／pro 系把 T5 序列設在 512，最後一格是 </s>，內容放得下 511 */
export const T5_SEQUENCE_TOKENS = 512;
export const T5_CONTENT_TOKENS = T5_SEQUENCE_TOKENS - 1;
/** FLUX.1 [schnell] 蒸餾版把序列壓到 256 */
export const T5_SCHNELL_SEQUENCE_TOKENS = 256;
export const T5_SCHNELL_CONTENT_TOKENS = T5_SCHNELL_SEQUENCE_TOKENS - 1;

const VOCAB_PATH = path.join("server", "assets", "t5-tokenizer.json.gz");

interface T5Engine {
  encode(text: string, options: { add_special_tokens: boolean }): { ids: number[]; tokens: string[] };
}

/** 詞表三萬多條，全程序只建一次 */
let cached: T5Engine | undefined;
function engine(): T5Engine {
  if (!cached) {
    const raw = gunzipSync(readFileSync(path.resolve(process.cwd(), VOCAB_PATH))).toString("utf8");
    cached = new Tokenizer(JSON.parse(raw), {}) as unknown as T5Engine;
  }
  return cached;
}

export interface T5Token {
  /** 分詞器給的片段字面（`▁` 代表詞首空白；未知片段會顯示成原文那一段） */
  text: string;
  /** 這個 token 是不是 `<unk>`——是的話模型讀到的只有「有東西但不知道是什麼」 */
  unknown: boolean;
}

/** 逐 token 切分（不含特殊 token；特殊 token 是框架加的，不屬於內容） */
export function t5Tokens(text: string): T5Token[] {
  const encoded = engine().encode(text ?? "", { add_special_tokens: false });
  return encoded.ids.map((id, index) => ({
    text: encoded.tokens[index] ?? "",
    unknown: id === T5_UNK_ID,
  }));
}

/** 這段文字實際佔幾個 T5 token */
export function t5TokenCount(text: string): number {
  return engine().encode(text ?? "", { add_special_tokens: false }).ids.length;
}
