/**
 * 文字編碼器窗口偵測（「注意力預算」）。
 *
 * 為什麼需要這個：擴散模型不是把整段 prompt 都讀進去的。文字先過一顆文字編碼器
 * （CLIP／T5／umT5…），那顆編碼器有**固定的序列長度**；超過的 token 會被截掉，
 * 對模型而言等同不存在。站內把世界觀、角色定裝、場景、素材一路疊到 prompt 上，
 * 疊出來的長度很容易超過 CLIP 的 77 —— 於是使用者在預覽裡看到「素材設定」那一段，
 * 以為它生效了，實際上模型根本沒讀到。
 *
 * 這個模組不碰模型內部（hosted API 不回傳 attention），只做兩件可驗證的事：
 * 1. 這顆模型的文字窗口是多少（**只在官方／開源權重有公開時才給數字**）。
 * 2. 這段文字大概佔多少 token（給區間，不給假精確值）。
 *
 * 判定截斷時一律用**樂觀下界**：只有「連最少的估計都超過窗口」才敢說被截掉。
 * 寧可漏報也不誤報——誤報會讓使用者刪掉其實有效的設定。
 */

/** 分詞器家族：對中文的效率差很多，估算必須分開算 */
export type TokenizerKind = "clip-bpe" | "sentencepiece";

export interface TokenRange {
  /** 樂觀下界 */
  min: number;
  /** 保守上界 */
  max: number;
}

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
      note: "SDXL 兩顆 CLIP 各 77 token，超出的部分直接被截掉，對模型等同不存在。",
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

/** 完全比對不到家族時的保底：只算 token，不宣稱任何窗口 */
const UNKNOWN_PROFILE: TextEncoderProfile = {
  key: "unknown",
  label: "未知文字編碼器",
  tokenizer: "sentencepiece",
  note: "站內沒有這顆模型的文字窗口資料，只顯示 token 估算，不判定是否截斷。",
};

export function textEncoderProfileFor(modelId: string | undefined | null): TextEncoderProfile {
  if (!modelId) return UNKNOWN_PROFILE;
  for (const rule of [...RULES, ...UNDISCLOSED]) {
    if (rule.match.test(modelId)) return rule.profile;
  }
  return UNKNOWN_PROFILE;
}

/**
 * 每字元的 token 成本區間。
 *
 * CLIP 走 byte-level BPE：一個中日韓字是 3 個 UTF-8 byte，常被切成 1～3 個 token，
 * 中文因此特別吃窗口。T5／umT5／ChatGLM 走多語 sentencepiece，一個中文字通常 ≤1 token。
 * 這些是估算不是實測——所以回傳區間，並且只在下界都超標時才敢說「被截斷」。
 */
const CHAR_COST: Record<TokenizerKind, Record<"cjk" | "latin" | "digit" | "other", TokenRange>> = {
  "clip-bpe": {
    cjk: { min: 1, max: 3 },
    latin: { min: 0.2, max: 0.35 },
    digit: { min: 0.4, max: 1 },
    other: { min: 0.15, max: 0.6 },
  },
  sentencepiece: {
    cjk: { min: 0.7, max: 1.5 },
    latin: { min: 0.2, max: 0.35 },
    digit: { min: 0.3, max: 1 },
    other: { min: 0.15, max: 0.6 },
  },
};

const CJK = /[㐀-䶿一-鿿぀-ヿ가-힣　-〿＀-･]/;
const LATIN = /[A-Za-z]/;
const DIGIT = /[0-9]/;

/** 一段文字的 token 估算區間（估算，不是實測分詞） */
export function estimateTokenRange(text: string, tokenizer: TokenizerKind): TokenRange {
  const cost = CHAR_COST[tokenizer];
  let min = 0;
  let max = 0;
  for (const char of text ?? "") {
    const bucket = CJK.test(char) ? "cjk" : LATIN.test(char) ? "latin" : DIGIT.test(char) ? "digit" : "other";
    min += cost[bucket].min;
    max += cost[bucket].max;
  }
  return { min: Math.round(min), max: Math.round(max) };
}

/**
 * 一段提示詞在窗口裡的處境。
 * - `inside`：連保守上界都在窗口內 → 確定進得去
 * - `at_risk`：下界在窗口內、上界超出 → 估算跨在邊界上，可能被截
 * - `truncated`：連樂觀下界都超出窗口 → 確定有一部分沒進模型
 * - `dropped`：這一段的起點就已經在窗口之外 → 整段確定沒進模型
 * - `unknown`：模型窗口未公開 → 不判定
 */
export type BudgetStatus = "inside" | "at_risk" | "truncated" | "dropped" | "unknown";

export interface BudgetSegment<T = string> {
  /** 呼叫端自己的識別（節點 key 等） */
  id: T;
  text: string;
}

export interface BudgetSegmentResult<T = string> {
  id: T;
  tokens: TokenRange;
  /** 這一段在整串裡的起始位置（樂觀下界累計） */
  startMin: number;
  status: BudgetStatus;
}

export interface PromptBudget<T = string> {
  profile: TextEncoderProfile;
  total: TokenRange;
  segments: BudgetSegmentResult<T>[];
  /** 樂觀下界都超過窗口＝這次確定有內容沒進模型 */
  overflows: boolean;
}

/**
 * 依序（＝實際送出的疊加順序）算出每一段的 token 佔用與處境。
 * 順序很重要：截斷從尾端發生，所以「最後疊上去的素材設定」最先被犧牲。
 */
export function analyzePromptBudget<T>(
  segments: readonly BudgetSegment<T>[],
  profile: TextEncoderProfile,
): PromptBudget<T> {
  const limit = profile.limitTokens;
  let cursorMin = 0;
  let cursorMax = 0;
  const results: BudgetSegmentResult<T>[] = segments.map((segment) => {
    const tokens = estimateTokenRange(segment.text, profile.tokenizer);
    const startMin = cursorMin;
    const startMax = cursorMax;
    cursorMin += tokens.min;
    cursorMax += tokens.max;
    let status: BudgetStatus = "unknown";
    if (limit != null) {
      if (startMin >= limit) status = "dropped";
      else if (cursorMin > limit) status = "truncated";
      else if (startMax + tokens.max > limit) status = "at_risk";
      else status = "inside";
    }
    return { id: segment.id, tokens, startMin, status };
  });
  return {
    profile,
    total: { min: cursorMin, max: cursorMax },
    segments: results,
    overflows: limit != null && cursorMin > limit,
  };
}
