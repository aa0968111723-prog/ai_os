/**
 * 文字編碼器的公開規格（窗口長度與分詞器家族）。
 *
 * 為什麼需要這個：擴散模型不是把整段 prompt 都讀進去的。文字先過一顆文字編碼器
 * （CLIP／T5／umT5…），那顆編碼器有**固定的序列長度**；超過的 token 會被截掉，
 * 對模型而言等同不存在。站內把世界觀、角色定裝、場景、素材一路疊到 prompt 上，
 * 疊出來的長度很容易超過 CLIP 的 77 —— 於是使用者在預覽裡看到「素材設定」那一段，
 * 以為它生效了，實際上模型根本沒讀到。
 *
 * 這個模組不碰模型內部（hosted API 不回傳 attention），只回答一件可查證的事：
 * 這顆模型的文字塔是什麼、窗口多長——**只在官方／開源權重有公開時才給數字**。
 *
 * token 實際數量不在這裡算：那要真的分詞器，見 server/services/promptTokens。
 * 這裡不做任何估算，站內也不顯示估算值。
 */

/** 分詞器家族：決定站內量不量得到 token（目前只內建 CLIP 的詞表） */
export type TokenizerKind = "clip-bpe" | "sentencepiece";

export interface TextEncoderProfile {
  /** 家族鍵（測試與 UI 用） */
  key: string;
  /** 編碼器名稱（給人看） */
  label: string;
  /**
   * 有效提示詞窗口（token）。**只有公開資料明確載明時才有值**；
   * 閉源模型（Ideogram／Imagen／Seedream／GPT Image…）一律 undefined，
   * UI 據此顯示「未公開」而不是猜一個數字。
   */
  limitTokens?: number;
  tokenizer: TokenizerKind;
  /** 一句話說明窗口怎麼來的、超出會怎樣 */
  note: string;
}

/**
 * 家族 → 編碼器。比對用 model id 的前綴／片段（id 見 shared/models.ts）。
 * 順序有意義：先比對長而具體的 id（flux/schnell 要贏過 flux）。
 *
 * 有數字的都是公開可查的權重設定（diffusers pipeline 的 max_sequence_length
 * 或原論文／模型卡）；沒把握的一律留 undefined，不填「大概」。
 */
interface ProfileRule {
  match: RegExp;
  profile: TextEncoderProfile;
}

const CLIP_77: Omit<TextEncoderProfile, "key" | "label" | "note"> = {
  limitTokens: 77,
  tokenizer: "clip-bpe",
};

const RULES: readonly ProfileRule[] = [
  {
    // FLUX.1 [schnell] 的 T5 上限被壓到 256（蒸餾版設定），比 dev/pro 短一半
    match: /^fal-ai\/flux\/schnell/,
    profile: {
      key: "flux1-schnell",
      label: "T5-XXL（FLUX.1 [schnell]）",
      limitTokens: 256,
      tokenizer: "sentencepiece",
      note: "蒸餾版把 T5 序列壓到 256；另一條 CLIP-L 只取整句 pooled 向量，不逐字對齊。",
    },
  },
  {
    // FLUX.1 全系（dev／pro／ultra／kontext／lora／redux）：T5-XXL 512
    match: /^fal-ai\/flux(\/|-pro|-lora|-kontext)/,
    profile: {
      key: "flux1",
      label: "T5-XXL（FLUX.1）",
      limitTokens: 512,
      tokenizer: "sentencepiece",
      note: "逐字語意走 T5，窗口 512；另一條 CLIP-L 只取整句 pooled 向量，不逐字對齊。",
    },
  },
  {
    // FLUX.2 換成 Mistral-3 系 VLM 當文字塔；官方未載明可用序列長度
    match: /^fal-ai\/flux-2/,
    profile: {
      key: "flux2",
      label: "Mistral-3 系 VLM（FLUX.2）",
      tokenizer: "sentencepiece",
      note: "FLUX.2 改用 VLM 文字塔，官方未公開可用序列長度，無法判定是否截斷。",
    },
  },
  {
    match: /^fal-ai\/(fast-sdxl|fast-lightning-sdxl|lora|playground-v25)/,
    profile: {
      key: "sdxl",
      ...CLIP_77,
      label: "雙 CLIP（SDXL）",
      note: "SDXL 兩顆 CLIP 各 77 格（頭尾兩格是特殊標記，內容實際只放得下 75），超出的部分直接被截掉。",
    },
  },
  {
    match: /^fal-ai\/kolors/,
    profile: {
      key: "kolors",
      label: "ChatGLM3（Kolors）",
      limitTokens: 256,
      tokenizer: "sentencepiece",
      note: "Kolors 用 ChatGLM3 當文字塔，中文分詞效率高，窗口 256。",
    },
  },
  {
    match: /^fal-ai\/sana/,
    profile: {
      key: "sana",
      label: "Gemma-2（Sana）",
      limitTokens: 300,
      tokenizer: "sentencepiece",
      note: "Sana 用 Gemma-2 解碼器當文字塔，窗口 300。",
    },
  },
  {
    match: /^fal-ai\/aura-flow/,
    profile: {
      key: "auraflow",
      label: "Pile-T5（AuraFlow）",
      limitTokens: 256,
      tokenizer: "sentencepiece",
      note: "AuraFlow 用 Pile-T5，窗口 256。",
    },
  },
  {
    match: /^(fal-ai\/wan|wan\/)/,
    profile: {
      key: "wan",
      label: "umT5（Wan）",
      limitTokens: 512,
      tokenizer: "sentencepiece",
      note: "Wan 系列用多語 umT5，窗口 512。",
    },
  },
  {
    match: /^fal-ai\/qwen-image/,
    profile: {
      key: "qwen-image",
      label: "Qwen2.5-VL（Qwen-Image）",
      tokenizer: "sentencepiece",
      note: "文字塔是 Qwen2.5-VL，中文效率好，但 fal 端未公開提示詞可用長度。",
    },
  },
];

/** 閉源／未公開窗口的家族：明講「未公開」，不猜數字 */
const UNDISCLOSED: readonly ProfileRule[] = [
  { match: /ideogram/, profile: { key: "ideogram", label: "Ideogram（未公開）", tokenizer: "sentencepiece", note: "閉源模型，官方未公開文字編碼器與窗口長度。" } },
  { match: /imagen/, profile: { key: "imagen", label: "Google Imagen（未公開）", tokenizer: "sentencepiece", note: "閉源模型，官方未公開文字編碼器與窗口長度。" } },
  { match: /nano-banana|gemini/, profile: { key: "gemini-image", label: "Gemini 系（未公開）", tokenizer: "sentencepiece", note: "閉源模型，官方未公開提示詞窗口；一般認為長提示詞可用，但無公開數字可據。" } },
  { match: /seedream|seededit|bytedance/, profile: { key: "seedream", label: "字節 Seed 系（未公開）", tokenizer: "sentencepiece", note: "閉源模型，官方未公開文字編碼器與窗口長度。" } },
  { match: /gpt-image|openai/, profile: { key: "gpt-image", label: "OpenAI 影像模型（未公開）", tokenizer: "sentencepiece", note: "閉源模型，官方未公開提示詞窗口長度。" } },
  { match: /recraft/, profile: { key: "recraft", label: "Recraft（未公開）", tokenizer: "sentencepiece", note: "閉源模型，官方未公開文字編碼器與窗口長度。" } },
  { match: /hunyuan/, profile: { key: "hunyuan", label: "混元文字塔（未公開）", tokenizer: "sentencepiece", note: "官方未公開可用序列長度。" } },
  { match: /kling|veo|luma|minimax|pixverse|pika|runway|seedance/, profile: { key: "video-closed", label: "閉源影片模型（未公開）", tokenizer: "sentencepiece", note: "閉源影片模型，官方未公開文字編碼器與窗口長度。" } },
];

/** 完全比對不到家族時的保底：只報實際字數，不宣稱任何窗口 */
const UNKNOWN_PROFILE: TextEncoderProfile = {
  key: "unknown",
  label: "未知文字編碼器",
  tokenizer: "sentencepiece",
  note: "站內沒有這顆模型的文字窗口資料，也沒有內建它的分詞器，只顯示實際字數。",
};

export function textEncoderProfileFor(modelId: string | undefined | null): TextEncoderProfile {
  if (!modelId) return UNKNOWN_PROFILE;
  for (const rule of [...RULES, ...UNDISCLOSED]) {
    if (rule.match.test(modelId)) return rule.profile;
  }
  return UNKNOWN_PROFILE;
}
