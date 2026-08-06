/**
 * 模型註冊表 v2 — 「沒有模型支撐的選項不出現」的單一真相來源。
 * 12 類,每類至少 旗艦3＋經濟3＋最低成本1;2026-07 依《fal生態研究》修 6 項現值錯誤並補中文命脈梯隊
 * (Qwen Image 2.0/Pro、GPT Image 2、Kolors、Qwen Edit Plus、Qwen 3 TTS、Qwen 訓練器)。
 * W2 全量擴充:納入研究清單 300+ 條目並新增「圖生影片」類別(分鏡圖成片的結構性缺口);
 * 單來源 LoRA 推論端點已補(flux/flux-2/wan/SDXL,來源欄=LoRA 檔網址)。
 * 3D(OutputKind 不支援)、多來源輸入(首尾影格/參考圖組/姿勢轉移/kontext+qwen-edit LoRA 編輯,
 * 待 needs 陣列化)與完整 LoRA 資產機制依產品建議 #2/#14/#15 另案,未收錄。
 * 啟動時同步進 model_catalog 資料表供代理查詢。
 * 定案:只接 Fal.ai;1 點 ≈ NT$1(USD×31 估);cost 為官方約略價,實際帳單以 fal 計價頁為準。
 * 實價計點(2026-08-01):fal 模型的 points 一律由 cost 的 USD 實價機械換算(realPricePoints),
 * 手填值只當「無法機械換算」的後備;改價改 cost 字串即可,點數自動跟上。
 * verified=true 表示模型頁面於 2026-07 逐一查證過;false 為合理推測 ID,真實模式首跑需確認
 * (失敗會自動退點並顯示錯誤,不會白扣)。
 */

export type ModelCategory =
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
  | "image-to-video"
  | "video-to-video"
  | "llm"
  | "vision"
  | "speech-to-text"
  | "text-to-speech"
  | "text-to-audio"
  | "training"
  | "workflow";

export type ModelTier = "flagship" | "economy" | "budget";

/** 生成輸出型態(決定結果如何呈現/入庫) */
export type OutputKind = "image" | "video" | "audio" | "text";
/** 需要的來源輸入(素材庫網址或外部 URL) */
export type SourceKind = "image" | "audio" | "video" | "zip";

/**
 * 專案畫面比例 —— 取「生成模型實際吃得下的全部比例」（fal aspect_ratio 通用列舉：
 * 21:9／16:9／4:3／3:2／1:1／2:3／3:4／9:16／9:21）。
 * 舊專案只會存 16:9／9:16／1:1，仍是本集合的子集，不必資料遷移。
 */
export type ProjectFormat = "21:9" | "16:9" | "3:2" | "4:3" | "1:1" | "3:4" | "2:3" | "9:16" | "9:21";

export interface ProjectFormatMeta {
  id: ProjectFormat;
  /** 白話用途(選單與視覺化比例圖顯示;非技術夥伴看得懂的那一行) */
  use: string;
  /** 寬 ÷ 高。視覺化比例圖畫框、以及「就近對應」到模型支援集合時都用它 */
  ratio: number;
  /** 交付像素(短邊 1080;時間軸/剪映草稿/匯出共用) */
  width: number;
  height: number;
  orientation: "landscape" | "square" | "portrait";
}

/**
 * 全部可選比例（顯示順序：最寬 → 方形 → 最長）。
 * 像素一律「短邊 1080」：橫式高 1080、直式寬 1080、方形 1080×1080——
 * 與 resolutionForFormat 舊行為（1920×1080／1080×1920／1080×1080）完全相容。
 */
export const PROJECT_FORMATS: ProjectFormatMeta[] = [
  { id: "21:9", use: "電影寬幅・橫向大螢幕", ratio: 21 / 9, width: 2520, height: 1080, orientation: "landscape" },
  { id: "16:9", use: "YouTube 橫式・簡報播放", ratio: 16 / 9, width: 1920, height: 1080, orientation: "landscape" },
  { id: "3:2", use: "相機橫幅・沖印照片", ratio: 3 / 2, width: 1620, height: 1080, orientation: "landscape" },
  { id: "4:3", use: "傳統電視・投影片", ratio: 4 / 3, width: 1440, height: 1080, orientation: "landscape" },
  { id: "1:1", use: "社群方形貼文", ratio: 1, width: 1080, height: 1080, orientation: "square" },
  { id: "3:4", use: "IG 直式貼文", ratio: 3 / 4, width: 1080, height: 1440, orientation: "portrait" },
  { id: "2:3", use: "直式海報・書封", ratio: 2 / 3, width: 1080, height: 1620, orientation: "portrait" },
  { id: "9:16", use: "Shorts / Reels / 限動", ratio: 9 / 16, width: 1080, height: 1920, orientation: "portrait" },
  { id: "9:21", use: "超長直式・電子看板", ratio: 9 / 21, width: 1080, height: 2520, orientation: "portrait" },
];

export const PROJECT_FORMAT_IDS: ProjectFormat[] = PROJECT_FORMATS.map((f) => f.id);

const FORMAT_META = new Map<string, ProjectFormatMeta>(PROJECT_FORMATS.map((f) => [f.id, f]));

/** 預設比例（未指定或無法辨識時一律退這個，維持既有橫式行為） */
export const DEFAULT_PROJECT_FORMAT: ProjectFormat = "16:9";

/** 任意字串 → 合法比例；認不得就退 16:9（DB 舊值與外部輸入都走這裡） */
export function normalizeProjectFormat(format: string | null | undefined): ProjectFormat {
  return FORMAT_META.has(format ?? "") ? (format as ProjectFormat) : DEFAULT_PROJECT_FORMAT;
}

export function formatMeta(format: string | null | undefined): ProjectFormatMeta {
  return FORMAT_META.get(normalizeProjectFormat(format))!;
}

/** 交付像素(短邊 1080)；shared/options 的 resolutionForFormat 轉呼叫這支，全站單一真相 */
export function pixelsForFormat(format: string | null | undefined): { width: number; height: number } {
  const m = formatMeta(format);
  return { width: m.width, height: m.height };
}

/**
 * 就近對應：專案比例不在某模型支援的集合內時，取「寬高比最接近」的那個，而不是硬塞未知值被 API 退件。
 * 用對數距離比較，讓 21:9→16:9 與 9:21→9:16 這種對稱情況得到對稱結果。
 */
export function nearestFormat(format: string | null | undefined, allowed: ProjectFormat[]): ProjectFormat {
  const f = normalizeProjectFormat(format);
  if (allowed.includes(f)) return f;
  if (allowed.length === 0) return f;
  const target = Math.log(formatMeta(f).ratio);
  let best = allowed[0];
  let bestDist = Infinity;
  for (const cand of allowed) {
    const dist = Math.abs(Math.log(formatMeta(cand).ratio) - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  }
  return best;
}

export interface ModelEntry {
  /** 目錄唯一鍵(nvidia-nim/any-llm 系列用 # 區分子型號) */
  id: string;
  /** 實際佇列端點(預設同 id;"nvidia-nim" 表示走 NVIDIA NIM 而非 fal) */
  endpoint?: string;
  label: string;
  category: ModelCategory;
  tier: ModelTier;
  kind: OutputKind;
  /** 需要來源輸入時標注(UI 會顯示來源欄位) */
  needs?: SourceKind;
  /** 同時需要第二個來源檔（例如對嘴＝人物影片＋配音音訊）。 */
  secondaryNeeds?: SourceKind;
  /** 每次生成扣點(1 點 ≈ NT$1;訓練類為每次訓練)。fal 模型在模組載入時由 cost 官方 USD
   *  實價 × USD_TO_TWD 自動覆寫(見 realPricePoints);字面手填值僅在不可機械換算時生效 */
  points: number;
  /** 特性(研究摘要) */
  strengths: string;
  /** 擅長領域 */
  bestFor: string;
  /** 官方約略價 */
  cost: string;
  /** Fal 即時目錄回傳的原始美元單價／單位；靜態目錄可不填。 */
  priceUsd?: number;
  priceUnit?: string;
  verified: boolean;
  /** 推薦預設:每個類別恰一個「已驗證、經濟」的日常主力;挑選器預設選它、UI 標「推薦」 */
  recommended?: boolean;
  /** 來源輸入欄位的提示文字 */
  sourceHint?: string;
  secondarySourceHint?: string;
  input: (prompt: string, format: ProjectFormat, sourceUrl?: string, secondarySourceUrl?: string) => Record<string, unknown>;
}

/**
 * 角色卡/場景卡會被使用的視覺類別（QA-002 能力標示的單一真相來源；
 * generationCore 的錨點注入判斷同用此集合，前後端不分岔）。
 * 注意：目前「所有」模型都不支援把卡片參考圖當 image conditioning 送入模型——
 * 卡片一律以「文字描述錨點」注入提示詞；非本集合的類別更是完全不使用卡片。
 * UI 據此對使用者明確標示，不讓人誤以為定裝參考圖已送進模型（QA-002 實測踩到的誤解）。
 */
export const CARD_ANCHOR_CATEGORIES: ReadonlySet<ModelCategory> = new Set<ModelCategory>([
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
]);

/** 此類別的模型是否會使用角色卡/場景卡（以文字錨點注入提示詞） */
export function supportsCardAnchors(category: ModelCategory): boolean {
  return CARD_ANCHOR_CATEGORIES.has(category);
}

/**
 * 會被注入世界觀（專案基調）的類別——generationCore 的注入判斷與前端「AI 會收到什麼」
 * 預覽同用此集合，前後端不分岔。
 * 不在集合內的刻意排除：TTS（會把注入文字唸出來）、配樂/音效（敘事句對音頻是雜訊）、
 * 轉錄／視覺理解／訓練（不適用）。
 */
export const WORLDVIEW_INJECT_CATEGORIES: ReadonlySet<ModelCategory> = new Set<ModelCategory>([
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
  "llm",
]);

/** 此類別的模型生成時是否會帶上世界觀 */
export function injectsWorldview(category: ModelCategory): boolean {
  return WORLDVIEW_INJECT_CATEGORIES.has(category);
}

/**
 * 有頂層 negative_prompt 欄位的模型 id（保守 allowlist）：世界觀禁忌詞對視覺類別要走 negative_prompt——
 * 擴散模型無法靠正向提示詞「避免」某物（塞正向反而可能被畫出來，甚至把禁忌字當畫面文字渲染）。
 * 只收「fal schema 明確有 negative_prompt」的 id（預設不在＝不送，安全）：
 *   - 圖像：SD 系（SDXL/Kolors/Sana/Playground/LoRA）——經典 negative_prompt 模型，零風險。
 *   - 圖像：Qwen Image 2 / Pro / Max（fal llms.txt 有 negative_prompt；中文字卡主力應吃世界觀禁忌）。
 *   - 圖像：fal-ai/flux-lora（fal 頁列有 negative_prompt；純 FLUX.1/2 主端點仍不收）。
 *   - 影片：wan / kling / hunyuan-video / ltx-video / pixverse / mochi / cogvideox 族——fal 文件皆有 negative_prompt。
 * 刻意不收：FLUX/FLUX.2/Kontext 主端點、GPT-Image、Nano-Banana、Seedream、Ideogram、Recraft、Imagen4、Luma、Veo、Sora、AuraFlow
 *   （AuraFlow v0.3 官方 schema 無 negative_prompt，誤送恐 422；未列＝禁忌詞單純移出正向不再污染，仍是淨改善）。
 * 研究依據：docs/模型底層邏輯與運作流程.md + docs/research/model-deep-dive-2026-08/
 */
export const NEGATIVE_PROMPT_SUPPORTED: ReadonlySet<string> = new Set<string>([
  // 圖像（SD 系，高信心）
  "fal-ai/fast-lightning-sdxl",
  "fal-ai/lora",
  "fal-ai/fast-sdxl/image-to-image",
  "fal-ai/kolors",
  "fal-ai/sana",
  "fal-ai/playground-v25",
  // 圖像（Qwen 統一生成-編輯；2026-08 fal schema 確認有 negative_prompt）
  "fal-ai/qwen-image-2/text-to-image",
  "fal-ai/qwen-image-2/pro/text-to-image",
  "fal-ai/qwen-image-max/text-to-image",
  // 圖像（FLUX.1 LoRA 端點；主端點 flux/dev 仍不收）
  "fal-ai/flux-lora",
  // 影片 text-to-video
  "fal-ai/wan-t2v",
  "fal-ai/wan/v2.2-a14b/text-to-video",
  "fal-ai/wan/v2.2-a14b/text-to-video/lora",
  "fal-ai/wan/v2.5/text-to-video",
  "fal-ai/wan/v2.6/text-to-video",
  "fal-ai/ltx-video",
  // 審計 R：初代 hunyuan-video OpenAPI **無** negative_prompt（僅 1.5 有）→ 勿送
  "fal-ai/hunyuan-video-v1.5/text-to-video",
  "fal-ai/mochi-v1",
  "fal-ai/cogvideox-5b",
  "fal-ai/pixverse/v5.5/text-to-video",
  "fal-ai/pixverse/v6/text-to-video",
  "fal-ai/kling-video/v1.6/standard/text-to-video",
  "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
  "fal-ai/kling-video/v2.6/pro/text-to-video",
  "fal-ai/kling-video/o3/pro/text-to-video",
  // 影片 image-to-video
  "fal-ai/wan-i2v",
  "fal-ai/wan/v2.2-a14b/image-to-video",
  "fal-ai/ltx-video-v095/image-to-video",
  "fal-ai/hunyuan-video-image-to-video",
  "fal-ai/pixverse/v5/image-to-video",
  "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  "fal-ai/kling-video/v2.6/pro/image-to-video",
  "fal-ai/kling-video/v3/pro/image-to-video",
]);

/** 此模型是否吃頂層 negative_prompt（見 NEGATIVE_PROMPT_SUPPORTED） */
export function supportsNegativePrompt(model: ModelEntry): boolean {
  return NEGATIVE_PROMPT_SUPPORTED.has(model.id);
}

/**
 * 此模型的 fal schema 是否吃頂層 `seed`。
 *
 * 只有消融實測（影響力量測）會用到：兩次跑必須共用同一顆隨機噪聲，
 * 差異才歸因得到「被拿掉的那一段」，否則差的可能只是噪聲。
 *
 * 名單刻意保守——與 `NEGATIVE_PROMPT_SUPPORTED` 同一個原則：
 * **不猜未知欄位**（猜錯是整包請求 400，使用者白等）。不在名單上的模型
 * 照樣能跑消融，只是 UI 會誠實說「這顆模型固定不了噪聲，結果只能當參考」。
 */
export const SEED_SUPPORTED: ReadonlySet<string> = new Set<string>([
  // SD 系（seed 是這條線的標準欄位）
  "fal-ai/fast-lightning-sdxl",
  "fal-ai/lora",
  "fal-ai/fast-sdxl/image-to-image",
  "fal-ai/playground-v25",
  "fal-ai/kolors",
  "fal-ai/sana",
  "fal-ai/aura-flow",
  // FLUX.1 系
  "fal-ai/flux/dev",
  "fal-ai/flux/schnell",
  "fal-ai/flux/dev/image-to-image",
  "fal-ai/flux-lora",
  // Qwen-Image（與 negative_prompt 同一批 schema 確認）
  "fal-ai/qwen-image-2/text-to-image",
  "fal-ai/qwen-image-2/pro/text-to-image",
  "fal-ai/qwen-image-max/text-to-image",
  // Wan 文生影片
  "fal-ai/wan/v2.2-a14b/text-to-video",
  "fal-ai/wan/v2.5/text-to-video",
  "fal-ai/wan/v2.6/text-to-video", // 審計 #116：OpenAPI V26Input 有 seed
]);

/** 消融實測能不能固定隨機噪聲（見 SEED_SUPPORTED） */
export function supportsSeed(model: ModelEntry): boolean {
  return SEED_SUPPORTED.has(model.id);
}

export const CATEGORIES: Array<{ id: ModelCategory; label: string; hint: string }> = [
  { id: "text-to-image", label: "文生圖", hint: "打字生成圖像(分鏡、場景、卡片)" },
  { id: "image-to-image", label: "圖生圖・編輯", hint: "用文字修改既有圖像(換風格、局部修改、合成)" },
  { id: "text-to-video", label: "文生影片", hint: "打字生成短影片(5–10 秒鏡頭)" },
  { id: "image-to-video", label: "圖生影片", hint: "把分鏡圖/照片變成會動的鏡頭(你的圖=首格)" },
  { id: "video-to-video", label: "影片轉影片", hint: "升級畫質、對嘴、去背、補幀" },
  { id: "llm", label: "大型語言模型", hint: "腳本、文案、翻譯、想法(文字進文字出)" },
  { id: "vision", label: "圖片轉文字", hint: "看圖說話:描述、辨識、OCR 擷取文字" },
  { id: "speech-to-text", label: "語音轉文字", hint: "錄音/開示轉逐字稿" },
  { id: "text-to-speech", label: "文字轉語音", hint: "旁白配音(支援中文)" },
  { id: "text-to-audio", label: "文字轉音頻", hint: "配樂與音效" },
  { id: "training", label: "訓練(LoRA)", hint: "用自家素材訓練專屬風格模型" },
  { id: "workflow", label: "工作流", hint: "一鍵串多個模型(腳本→圖→影→音)" },
];

const TIER_LABEL: Record<ModelTier, string> = { flagship: "旗艦", economy: "經濟", budget: "最低成本" };
export function tierLabel(tier: ModelTier): string {
  return TIER_LABEL[tier];
}

/* ── 輸入組裝小工具 ── */
/**
 * fal image_size 只有五種列舉(方形/4:3/16:9 各正反)，比可選比例少；
 * 一律以「最接近的寬高比」對應，使用者選 3:2 不會被退件、也不會被硬轉成 16:9 之外的怪值。
 */
const IMAGE_SIZE_BUCKETS: ProjectFormat[] = ["16:9", "4:3", "1:1", "3:4", "9:16"];
const IMAGE_SIZE_BY_BUCKET: Record<string, string> = {
  "16:9": "landscape_16_9",
  "4:3": "landscape_4_3",
  "1:1": "square_hd",
  "3:4": "portrait_4_3",
  "9:16": "portrait_16_9",
};
const imageSize = (f: ProjectFormat) => IMAGE_SIZE_BY_BUCKET[nearestFormat(f, IMAGE_SIZE_BUCKETS)];
const aspect = (f: ProjectFormat) => normalizeProjectFormat(f);
/** 只吃橫式/直式兩種的影片模型(多數 image-to-video)：方形與其他比例就近取一 */
const wideOrTall = (f: ProjectFormat) => nearestFormat(f, ["16:9", "9:16"]);
/** LLM 系列共用(NVIDIA NIM 與舊 any-llm 皆為 {model, prompt} 形狀;NIM 端由 nimSubmit 轉 chat messages) */
const llmInput = (model: string) => (prompt: string) => ({ model, prompt });
const llmVisionInput = (model: string) => (prompt: string, _f: ProjectFormat, sourceUrl?: string) => ({
  model,
  prompt: prompt || "請詳細描述這張圖片(繁體中文)",
  image_url: sourceUrl,
});

export const MODELS: ModelEntry[] = [
  /* ═══ 1. 文生圖 text-to-image ═══ */
  {
    // 目錄錯誤修正(fal生態研究 #9):官方模型頁 URL 為 flux-2-pro(連字號),原 flux-2/pro 斜線寫法查無佐證
    // ——id 保留舊值讓既有生成紀錄對得上,實際呼叫走 endpoint;首跑仍需確認,故 verified 維持 false
    id: "fal-ai/flux-2/pro", endpoint: "fal-ai/flux-2-pro", label: "FLUX.2 [pro]", category: "text-to-image", tier: "flagship", kind: "image",
    points: 1, cost: "$0.03/MP", verified: false,
    strengths: "Black Forest Labs 最新旗艦;構圖與光影頂級、提示詞遵循極準",
    bestFor: "正式成品分鏡、需要高質感的宣傳主視覺",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/qwen-image-2/pro/text-to-image", label: "Qwen Image 2.0 Pro", category: "text-to-image", tier: "flagship", kind: "image",
    points: 2, cost: "$0.075/張(原生 2K)", verified: false,
    strengths: "阿里通義最高保真檔;中文渲染上限最高之一,長段中文、書法字、直排都穩",
    bestFor: "正式交付的中文長版海報、書法字與密集中文並存的主視覺",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "openai/gpt-image-2", label: "GPT Image 2(OpenAI)", category: "text-to-image", tier: "flagship", kind: "image",
    points: 5, cost: "$0.158/張(fal 預設 high 1080p;medium≈$0.04、4k high≈$0.40);點數以預設 high 檔估", verified: false,
    strengths: "fal 官方夥伴端點;跨拉丁與 CJK 字元級文字準確、複雜指令理解強",
    bestFor: "要求文字逐字精準的對外物料、中英並存的字卡",
    // 審計 L2：OpenAPI image_size 為 preset enum 或 {width,height}，非 "1536x1024" 字串
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/bytedance/seedream/v4.5/text-to-image", label: "Seedream 4.5", category: "text-to-image", tier: "flagship", kind: "image",
    points: 1, cost: "$0.04/張", verified: true,
    strengths: "字節旗艦;深度思考式提示理解、原生 14 語文字渲染、密集版面控制",
    bestFor: "含中文字的畫面(標題卡、海報)、多元素構圖",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/nano-banana-2", label: "Nano Banana 2(Google)", category: "text-to-image", tier: "flagship", kind: "image",
    points: 3, cost: "$0.06–0.16/張(依解析度)", verified: true,
    strengths: "Gemini 3.1 Flash Image;推理式生成、文字準確、風格多變",
    bestFor: "寫實人物場景、需要準確理解複雜指令的畫面",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/flux/dev", label: "FLUX.1 [dev]", category: "text-to-image", tier: "economy", kind: "image",
    points: 1, cost: "$0.025/MP", verified: true, recommended: true,
    strengths: "開源界標竿;品質/成本平衡點、生態最豐(LoRA 可搭)",
    bestFor: "日常分鏡草稿、可訓練專屬風格後搭配使用",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/ideogram/v3", label: "Ideogram v3", category: "text-to-image", tier: "economy", kind: "image",
    points: 2, cost: "$0.03–0.09/張", verified: false,
    strengths: "文字排版之王;海報級字型渲染、設計感強",
    bestFor: "金句卡、活動海報、含大量文字的社群圖",
    // 審計 #7：OpenAPI 用 image_size preset，無 aspect_ratio（誤送畫幅死在 square_hd）
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/flux/schnell", label: "FLUX.1 [schnell]", category: "text-to-image", tier: "economy", kind: "image",
    points: 1, cost: "$0.003/MP", verified: true,
    strengths: "1–2 秒出圖;快速迭代找方向",
    bestFor: "大量試構圖、腦力激盪期",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/qwen-image-2/text-to-image", label: "Qwen Image 2.0", category: "text-to-image", tier: "economy", kind: "image",
    points: 1, cost: "$0.035/張(原生 2K)", verified: false,
    strengths: "中文文字渲染 SOTA(多篇獨立評測認證);專業排版、海報/資訊圖,亂碼錯字率最低",
    bestFor: "繁/簡中文金句卡、密集中文海報——中文字卡的第一主力",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/kolors", label: "Kolors(快手可圖)", category: "text-to-image", tier: "economy", kind: "image",
    points: 1, cost: "≈$0.02–0.04/張", verified: false,
    strengths: "中英雙語原生訓練;中文提示理解到位、寫實人像自然",
    bestFor: "中文語境的寫實人物/生活場景,實惠的中文可用檔",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/fast-lightning-sdxl", label: "SDXL Lightning", category: "text-to-image", tier: "budget", kind: "image",
    points: 1, cost: "≈$0.001/張(按算秒)", verified: true,
    strengths: "全站最低成本;品質堪用、速度極快",
    bestFor: "純試驗、佔位圖、教學練習",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  /* —— W2 全量擴充(fal生態研究):以下 text-to-image 新增,全部 verified:false 首跑校準 —— */
  {
    // 審計 #12：OpenAPI 200 確認 fal-ai/flux-2-flex 活躍；steps/guidance 可調但站內未接
    id: "fal-ai/flux-2-flex", label: "FLUX.2 [flex]", category: "text-to-image", tier: "flagship", kind: "image",
    points: 2, cost: "$0.05/MP", verified: false,
    strengths: "FLUX.2 可調版;可控推論步數與 guidance,質感細節上限最高",
    bestFor: "主視覺精修、願意微調參數的進階場景",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    // 審計 #13：OpenAPI 200 確認活躍；L2 success 已有；schema 無 loras（strengths 文案 P1）
    id: "fal-ai/flux-2", label: "FLUX.2 [dev]", category: "text-to-image", tier: "economy", kind: "image",
    points: 1, cost: "$0.012/MP", verified: false,
    strengths: "FLUX.2 開源檔;品質接近 pro 但便宜過半、可搭 LoRA",
    bestFor: "日常分鏡草稿新主力、專屬風格 LoRA 基底",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/flux-pro/v1.1-ultra", label: "FLUX1.1 [pro] ultra", category: "text-to-image", tier: "flagship", kind: "image",
    points: 2, cost: "$0.06/張(可達 4MP/2K)", verified: false,
    strengths: "上代旗艦高解析檔;約 10 秒出 4MP、寫實人像質感極佳",
    bestFor: "海報主圖、印刷級莊嚴人像與志工紀實",
    // 審計 #14：OpenAPI 用 aspect_ratio（非 image_size）；1:1 合法
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    // 審計 L2：OpenAPI/queue Path /seedream/v5/text-to-image 404——landing 有、佇列無；勿 live 重試
    // 中文長版海報請用 seedream/v4.5 或 qwen-image-2/pro（見 SCENARIO_RECIPES sc-cn-poster）
    id: "fal-ai/bytedance/seedream/v5/text-to-image", label: "Seedream 5.0 Pro", category: "text-to-image", tier: "flagship", kind: "image",
    points: 2, cost: "約 $0.05–0.09/張(待 fal 計價確認)", verified: false,
    strengths: "⚠fal 佇列 404（slug 未上線）;產品定位：字節新旗艦、密集中文版面——上線前請用 v4.5",
    bestFor: "最複雜的中文長版海報、多段文字主視覺（端點上線前勿選）",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    // 審計 L2：fal-ai/ideogram/v4 佇列 404 Path /v4；真端點 ideogram/v4；OpenAPI 用 image_size
    id: "fal-ai/ideogram/v4", endpoint: "ideogram/v4",
    label: "Ideogram v4", category: "text-to-image", tier: "flagship", kind: "image",
    points: 1, cost: "$0.015/MP(Balanced 預設;Turbo $0.0075、Quality $0.025);約 1MP≈$0.015、1080p(~2MP)≈$0.03", verified: false,
    strengths: "排版龍頭新版;維持字型排版優勢並拉近寫實度",
    bestFor: "精緻英文海報、設計感社群圖(中文勿當主力)",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/recraft/v3/text-to-image", label: "Recraft V3", category: "text-to-image", tier: "economy", kind: "image",
    points: 1, cost: "$0.04/張(向量 $0.08)", verified: false,
    strengths: "設計導向;長段文字、向量 SVG、品牌風格一致批量產",
    bestFor: "可無限放大的字標/logo、印刷向量海報",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/recraft/v4.1/text-to-image", label: "Recraft V4.1", category: "text-to-image", tier: "economy", kind: "image",
    points: 1, cost: "$0.04/張(Pro $0.25)", verified: false,
    strengths: "Recraft 新版;提示控制更準、構圖乾淨,品牌/編輯設計取向",
    bestFor: "品牌系統化活動主視覺、編輯風排版物料",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    // fal生態研究:端點 🔸推定,首跑確認
    id: "fal-ai/nano-banana-pro", label: "Nano Banana Pro(Google)", category: "text-to-image", tier: "flagship", kind: "image",
    points: 5, cost: "$0.15/張(4K 加倍)", verified: true,
    strengths: "Gemini 3 Pro Image;高階推理、細節與指令遵循更強、可 4K",
    bestFor: "最考驗理解力的敘事主視覺、4K 正式成品",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/imagen4/preview/ultra", label: "Google Imagen 4 Ultra", category: "text-to-image", tier: "flagship", kind: "image",
    points: 2, cost: "$0.06/張", verified: true,
    strengths: "Google 旗艦;寫實膚質、提示還原度極高、幾乎零瑕疵",
    bestFor: "交付級莊嚴人物寫真、療癒風景空鏡",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/imagen4/preview/fast", label: "Google Imagen 4 Fast", category: "text-to-image", tier: "economy", kind: "image",
    points: 1, cost: "$0.02/張", verified: true,
    strengths: "Imagen 4 速度檔;約 2.7 秒出圖、品質仍佳",
    bestFor: "日常寫實草稿、快速刷療癒風景",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    // fal生態研究:端點 🔸推定、價格待確認,首跑校準
    id: "fal-ai/qwen-image-max/text-to-image", label: "Qwen Image Max", category: "text-to-image", tier: "flagship", kind: "image",
    points: 2, cost: "$0.075/張", verified: true,
    strengths: "通義頂配檔;質感構圖再拉高,中文渲染頂級",
    bestFor: "最講究的中文設計成品,Pro 不夠時的天花板",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    // fal生態研究:❓待確認——fal 是否上架與 slug 均未證實,首跑必查
    // 審計 #23：Queue OpenAPI id 路徑 404；真端點 …/v3/text-to-image
    id: "fal-ai/hunyuan-image/v3", endpoint: "fal-ai/hunyuan-image/v3/text-to-image",
    label: "Hunyuan Image 3.0(騰訊混元)", category: "text-to-image", tier: "flagship", kind: "image",
    points: 2, cost: "$0.10/百萬像素(1MP 約一張，按輸出解析度計費)", verified: true,
    strengths: "騰訊混元;中文理解與藝術表現強,國風/書法/水墨題材佳",
    bestFor: "國風禪意大圖、中文文化語境主視覺",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/sana", label: "Sana(NVIDIA)", category: "text-to-image", tier: "budget", kind: "image",
    points: 1, cost: "$0.001/MP(每張約 1MP=$0.001;按百萬像素計費)", verified: true,
    strengths: "高效模型;不到 1 秒出 4K、文圖對齊佳",
    bestFor: "大量 4K 佔位圖、極速刷背景/材質",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/playground-v25", label: "Playground v2.5", category: "text-to-image", tier: "budget", kind: "image",
    points: 1, cost: "約 $0.002–0.006/張", verified: false,
    strengths: "開源美學標竿;色彩與構圖討喜、成本極低",
    bestFor: "美感取向的氛圍圖、療癒風底圖",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/luma-photon", label: "Luma Photon", category: "text-to-image", tier: "economy", kind: "image",
    points: 1, cost: "$0.019/MP(標準;Flash 版 $0.005/MP 更省)", verified: true,
    strengths: "Luma 視覺模型;創意、可個人化、理解力強",
    bestFor: "創意概念圖、風格化敘事主視覺",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/aura-flow", label: "AuraFlow v0.3", category: "text-to-image", tier: "budget", kind: "image",
    points: 1, cost: "$0.028/MP(每張約 1MP=$0.028)", verified: false,
    strengths: "開源 flow 架構;語義精準但較慢(50 步)",
    bestFor: "研究性/開源偏好的出圖,優先度低",
    // 審計 #27：OpenAPI 無 image_size／aspect_ratio，只認 prompt（+可選 steps/CFG）
    input: (p, _f) => ({ prompt: p }),
  },
  /* —— LoRA 推論(W2 打磨,研究表「必補」):來源欄=訓練成果 LoRA 檔網址,打通訓練器斷鏈;
        完整 LoRA 資產機制(自動轉存/步數鎖)仍屬產品建議 #2 另案 —— */
  {
    id: "fal-ai/flux-lora", label: "FLUX.1 掛 LoRA 生圖", category: "text-to-image", tier: "economy", kind: "image",
    needs: "zip", points: 1, cost: "$0.035/MP", verified: true,
    strengths: "掛載訓練成果生圖的標準端點;fast-training/人像/turbo/krea 成果都在這用",
    bestFor: "用自家風格 LoRA 出圖(提示詞須含觸發詞)",
    sourceHint: "訓練成果 LoRA 檔網址(.safetensors)",
    input: (p, f, s) => ({ prompt: p, image_size: imageSize(f), loras: [{ path: s, scale: 1 }] }),
  },
  {
    id: "fal-ai/flux-2/lora", label: "FLUX.2 掛 LoRA 生圖", category: "text-to-image", tier: "economy", kind: "image",
    needs: "zip", points: 1, cost: "$0.021/MP(LoRA 逾 2GB 有 50%/GB 加價)", verified: true,
    strengths: "FLUX.2 訓練成果的生成端點;可同時疊多顆 LoRA",
    bestFor: "旗艦品質+自家風格的日常出圖(提示詞含觸發詞)",
    sourceHint: "訓練成果 LoRA 檔網址(.safetensors)",
    input: (p, f, s) => ({ prompt: p, image_size: imageSize(f), loras: [{ path: s, scale: 1 }] }),
  },
  {
    id: "fal-ai/lora", label: "SDXL 掛社群 LoRA", category: "text-to-image", tier: "budget", kind: "image",
    needs: "zip", points: 1, cost: "按算力秒計(未查到明細)", verified: false,
    strengths: "掛任意社群 SDXL/SD1.5 LoRA;零訓練成本試風格的後門",
    bestFor: "試水墨/佛畫/蓮花裝飾等現成風格(品質低於 FLUX 系)",
    sourceHint: "社群 LoRA 檔網址(civitai/HF 的 .safetensors)",
    // 端點需指定底模 model_name,先鎖 SDXL base;首跑確認
    input: (p, f, s) => ({ model_name: "stabilityai/stable-diffusion-xl-base-1.0", prompt: p, image_size: imageSize(f), loras: [{ path: s, scale: 1 }] }),
  },

  /* ═══ 2. 圖生圖・編輯 image-to-image ═══ */
  {
    id: "fal-ai/nano-banana-2/edit", label: "Nano Banana 2 Edit", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 2, cost: "$0.08/張(1K)", verified: true,
    strengths: "免遮罩自然語言編輯;最多 14 張參考圖合成、知道該改什麼不該動什麼",
    bestFor: "「把背景換成禪堂」這類口語修改、多圖合成",
    sourceHint: "要編輯的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
  },
  {
    // 審計 #32：OpenAPI id 路徑 404；真端點 fal-ai/flux-2-pro/edit（image_urls）
    id: "fal-ai/flux-2/pro/edit", endpoint: "fal-ai/flux-2-pro/edit",
    label: "FLUX.2 [pro] Edit", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 1, cost: "$0.03/首MP,之後 $0.015/MP", verified: true,
    strengths: "生產級編輯;最多 9 張參考圖、構圖一致性佳",
    bestFor: "正式成品的精修、系列圖風格統一",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
  },
  {
    id: "fal-ai/bytedance/seedream/v4.5/edit", label: "Seedream 4.5 Edit", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 1, cost: "$0.04/張", verified: true,
    strengths: "生成+編輯一體架構;中文指令理解佳",
    bestFor: "中文指令修改、文字元素調整",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
  },
  {
    id: "fal-ai/flux-kontext/dev", label: "FLUX.1 Kontext [dev]", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.025/MP", verified: true,
    strengths: "Kontext 開源檔;指令式編輯、可搭 LoRA,成本最低的 Kontext",
    bestFor: "日常量大的指令修圖、自家 LoRA 編輯基底",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/flux-pro/kontext", label: "FLUX.1 Kontext [pro]", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.04/張", verified: true,
    strengths: "局部編輯與整景轉換兼顧;角色一致性迭代編輯",
    bestFor: "同角色連續分鏡、逐步修圖",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/qwen-image-edit", label: "Qwen Image Edit", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "≈$0.03/張(按百萬像素計費 $0.03/MP,基準1MP)", verified: true,
    strengths: "阿里通義;複雜中文文字渲染與精準編輯",
    bestFor: "中文標題卡修字、低成本批量修改",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/qwen-image-edit-plus", label: "Qwen Image Edit Plus", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "≈$0.03/張", verified: true,
    strengths: "Qwen 編輯強化版;多圖輸入、文字編輯優於基礎版(改字不跑版)",
    bestFor: "同人物換背景且中文橫幅要正確、批量換卡片文字",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
  },
  {
    id: "fal-ai/flux/dev/image-to-image", label: "FLUX.1 [dev] 圖生圖", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.025/MP", verified: true, recommended: true,
    strengths: "以草圖/舊圖為底重繪;強度可控",
    bestFor: "草稿升級成品、風格轉換",
    sourceHint: "作為底圖的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s, strength: 0.85 }),
  },
  {
    id: "fal-ai/fast-sdxl/image-to-image", label: "SDXL 圖生圖", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "≈$0.001/張", verified: false,
    strengths: "最低成本的圖生圖",
    bestFor: "試驗風格方向",
    sourceHint: "作為底圖的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s, strength: 0.75 }),
  },
  /* —— W2 全量擴充(fal生態研究):以下 image-to-image 新增(含編輯/打光/去背/擴圖/修復) —— */
  {
    id: "fal-ai/flux-pro/kontext/max", label: "FLUX.1 Kontext [max]", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 2, cost: "$0.08/張", verified: true,
    strengths: "Kontext 頂規;提示遵循與排版更強、角色一致性最高",
    bestFor: "正式對外成品的角色一致編輯、系列海報收尾",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // fal生態研究:另有別名 fal-ai/gemini-3-pro-image-preview/edit,首跑確認
    id: "fal-ai/nano-banana-pro/edit", label: "Nano Banana Pro Edit(Google)", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 5, cost: "$0.15/張(1K)", verified: true,
    strengths: "品質天花板之一;多模態推理讀懂意圖、複雜指令一次到位",
    bestFor: "最高規成品的關鍵一張、複雜多條件修改",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
  },
  {
    // fal生態研究:端點 🔸推定,首跑確認
    id: "fal-ai/nano-banana/edit", label: "Nano Banana Edit(v1)", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "約 $0.04/張", verified: true,
    strengths: "初代 Nano Banana 編輯;口語指令、速度快、成本低於 v2",
    bestFor: "日常量大的口語小改(換底色、去雜物)",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
  },
  {
    // fal生態研究:端點 🔸推定,首跑確認
    id: "fal-ai/bytedance/seedream/v4/edit", label: "Seedream 4.0 Edit", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "約 $0.03/張", verified: true,
    strengths: "Seedream 前代編輯;能力接近 4.5、單價更親民,中文文字編輯佳",
    bestFor: "量大預算敏感的中文卡片修改",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
  },
  {
    // fal生態研究:端點 🔸推定,首跑確認
    id: "fal-ai/bytedance/seededit/v3/edit-image", label: "SeedEdit 3.0(字節)", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "約 $0.03/張", verified: false,
    strengths: "純指令式單圖編輯;保真度高、對原圖改動最小,支援中文指令",
    bestFor: "只動一處、其餘像素級不變的精準小修",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // fal生態研究:同排另列 fal-ai/qwen-image-edit-2511,擇一收錄;首跑確認
    id: "fal-ai/qwen-image-2/edit", label: "Qwen Image 2.0 Edit", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.035/張", verified: true,
    strengths: "Qwen 最新編輯;風格轉換+物件增刪+中文字疊加一站完成",
    bestFor: "實照轉水墨/工筆莊嚴風、疊中文字",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
  },
  {
    id: "openai/gpt-image-2/edit", label: "GPT Image 2 Edit(OpenAI)", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 5, cost: "約 $0.158/張(1080p·high 品質，fal 預設 high;4K $0.401、1024² $0.211;另計 token 費)", verified: true,
    strengths: "GPT 影像編輯;指令理解好、只動要動的、單價極低",
    bestFor: "大量社群素材的日常小修、複雜多步指令",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
  },
  {
    // fal生態研究:端點 🔸推定;同線另有 /edit(需遮罩)與 /replace-background,先收 remix
    id: "fal-ai/ideogram/v3/remix", label: "Ideogram V3 Remix", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 2, cost: "約 $0.03–0.09/張", verified: true,
    strengths: "排版之王的編輯線;保留字體設計感換風格/底圖/配色",
    bestFor: "金句海報保留排版重出變體",
    sourceHint: "要重混的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // fal生態研究:端點 🔸推定(亦有 fal-ai/flux-pro/v1/redux),首跑確認;端點不吃 prompt
    id: "fal-ai/flux/dev/redux", label: "FLUX.1 Redux(變體)", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.025/MP", verified: true,
    strengths: "餵一張圖產同調變體;不改內容、只要「像這張」的量產",
    bestFor: "滿意的莊嚴風格圖量產同風格系列卡",
    sourceHint: "要生成變體的參考圖",
    input: (_p, f, s) => ({ image_url: s, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/iclight-v2", label: "IC-Light V2(重新打光)", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 3, cost: "$0.1/MP（每百萬像素，按輸出尺寸計費）", verified: true,
    strengths: "文字條件式重新打光+換背景;可指定光源方向強度",
    bestFor: "把雜亂光線照片統一成莊嚴光感、合成後補光",
    sourceHint: "要重新打光的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // 審計 #50：OpenAPI BriaBackgroundReplaceInput 背景描述欄為 prompt（非 bg_prompt；描述文仍寫 bg_prompt 屬文件債）
    id: "fal-ai/bria/background/replace", label: "Bria 換背景", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "約 $0.04/張", verified: true,
    strengths: "文字描述換背景;授權資料訓練、商用版權安全、結果穩定",
    bestFor: "一鍵換成禪堂/蓮花/晨光背景,對外發布安心",
    sourceHint: "要換背景的圖",
    input: (p, _f, s) => ({ image_url: s, prompt: p }),
  },
  {
    id: "fal-ai/bria/background/remove", label: "Bria RMBG 2.0 去背", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "$0.018/張", verified: true,
    strengths: "去背出透明 PNG;商用授權、邊緣髮絲細緻",
    bestFor: "人物/結緣品去背成素材,供卡片海報排版",
    sourceHint: "要去背的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    // fal Bria expand 可能另需 original_image_size/location 參數,首跑校準
    id: "fal-ai/bria/expand", label: "Bria Expand(生成式擴圖)", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.023/次", verified: true,
    strengths: "往畫面外補內容轉比例;授權安全的 outpainting",
    bestFor: "直式照擴 16:9 上 YouTube、老照片補天補地",
    sourceHint: "要擴圖的圖",
    input: (p, f, s) => ({ image_url: s, prompt: p, canvas_size: [pixelsForFormat(f).width, pixelsForFormat(f).height] }),
  },
  {
    id: "fal-ai/image-editing/object-removal", label: "物件移除 Object Removal", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.04/張", verified: false,
    strengths: "移除雜物/路人並自動補背景;一鍵免畫遮罩",
    bestFor: "活動照清雜物、讓開示/合影畫面乾淨莊嚴",
    sourceHint: "要清雜物的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // fal生態研究:端點 🔸推定;同排 genfill 需遮罩未收。參數名可能為 scene_description,首跑確認
    id: "fal-ai/bria/product-shot", label: "Bria Product Shot(情境商品圖)", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.04/張", verified: true,
    strengths: "去背+生成攝影棚級情境擺拍;版權安全",
    bestFor: "佛珠/香品/書籍生成莊嚴擺拍圖用於義賣頁",
    sourceHint: "商品/結緣品照片",
    input: (p, _f, s) => ({ image_url: s, scene_description: p }),
  },
  {
    // fal生態研究:端點待確認(🔸推定);同排 fal-ai/gfpgan 亦待確認,先收 CodeFormer
    id: "fal-ai/codeformer", label: "臉部修復 CodeFormer", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "$0.0021/百萬像素(每張約 $0.002,<1點)", verified: true,
    strengths: "修復模糊/老舊照片的臉部細節與清晰度",
    bestFor: "早年開示低清老照片修臉,救回紀念影片素材",
    sourceHint: "要修復的老照片",
    // 產品建議 #13 保守檔:fidelity 偏高以忠於本人樣貌
    input: (_p, _f, s) => ({ image_url: s, fidelity: 0.7 }),
  },
  /* ── W2 全量擴充:放大與修復(fal生態研究 §480–505) ── */
  {
    id: "fal-ai/image-editing/photo-restoration", label: "老照片修復(一鍵)", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 1, cost: "$0.04/張", verified: true,
    strengths: "一鍵修老照:去刮痕污漬、去模糊、補殘缺並上色;免提示詞",
    bestFor: "泛黃老照、先人遺照救援(中文題字修後請校對)",
    sourceHint: "要修復的老照片",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    // 價格文件查不到,推估按張計(1–3 點),首跑校準
    id: "fal-ai/image-apps-v2/photo-restoration", label: "老照片修復(Gemini 版)", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.04/張", verified: false,
    strengths: "Gemini 路線修復;破損缺角重建力更強(生成式,中文題字風險高)",
    bestFor: "image-editing 版修不好時的第二選擇",
    sourceHint: "要修復的老照片",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/esrgan", label: "Real-ESRGAN 放大", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "$0.00111/計算秒(每張<1點)", verified: true,
    strengths: "經典 4x 放大;face_enhance 可順帶 GFPGAN 修臉,全站最便宜之一",
    bestFor: "大量舊素材粗放大+修臉的省錢首選",
    sourceHint: "要放大的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/ddcolor", label: "DDColor 上色", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.001/MP", verified: true,
    strengths: "黑白照上色專用;只加色不動細節,忠實低風險",
    bestFor: "黑白遺照/老照重獲色彩;中文題字安全",
    sourceHint: "要上色的黑白照片",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/clarity-upscaler", label: "Clarity 創意放大", category: "image-to-image", tier: "flagship", kind: "image",
    // 審計 B9：原 $0.03/MP 機械估 1 點低估 4K；cost 改以中階≈4MP 單次估，runtime realPricePoints 才會跟
    needs: "image", points: 4, cost: "$0.12/張(≈4MP@$0.03/MP;4K約$0.24)", verified: true,
    strengths: "社群最紅創意放大;放大同時補生細節到交付級",
    bestFor: "AI 圖放大 4K/印刷;含中文字的圖建議改用 Thera 忠實放大",
    sourceHint: "要放大的圖",
    // 產品建議 #13 保守檔:creativity 壓低,防中文字被重繪成亂碼
    input: (_p, _f, s) => ({ image_url: s, creativity: 0.35 }),
  },
  {
    id: "fal-ai/topaz/upscale/image", label: "Topaz 影像放大", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 2, cost: "按輸出解析度分級:≤24MP $0.08/張、≤48MP $0.16/張、≤96MP $0.32/張,最高 512MP $1.36/張(基準 24MP $0.08)", verified: true,
    strengths: "業界標準照片級放大;自然無 AI 塑膠感,印刷首選",
    bestFor: "海報、展場輸出等印刷級大尺寸放大",
    sourceHint: "要放大的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/aura-sr", label: "AuraSR 忠實放大", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 2, cost: "按計算秒計費(約每張 1–2 點)", verified: false,
    strengths: "fal 自研 GigaGAN 4x 忠實放大;不改臉不改字、少假影",
    bestFor: "人物照、中文字卡的安全放大日常主力",
    sourceHint: "要放大的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    // 價格文件查不到(推估按 MP),首跑校準
    id: "fal-ai/ccsr", label: "CCSR 忠實超解析", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 2, cost: "查不到精確價(推估按 MP)", verified: false,
    strengths: "內容忠實超解析;低幻覺、比純 GAN 更漂亮的中間選項",
    bestFor: "要保留當事人真實樣貌的高品質放大",
    sourceHint: "要放大的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    // 價格文件查不到(fal 有免費試用+付費),首跑校準
    id: "fal-ai/supir", label: "SUPIR 重建放大", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 3, cost: "查不到精確價", verified: false,
    strengths: "重度生成式修復放大;極破損素材大幅重建(會二次創作,需人工把關)",
    bestFor: "糊到其他工具救不回的最後手段;字卡勿用",
    sourceHint: "極破損/極低清的照片",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/thera", label: "Thera 忠實放大(零走樣)", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.0021/MP", verified: false,
    strengths: "任意倍率、數學上無鋸齒的忠實放大;幾乎零幻覺",
    bestFor: "含中文字/書法的字卡、海報放大首選",
    sourceHint: "要放大的圖(含文字尤佳)",
    // 審計 #65：OpenAPI required image_url+backbone(edsr|rdn)；缺 backbone 會 422
    input: (_p, _f, s) => ({ image_url: s, backbone: "edsr" }),
  },
  {
    id: "fal-ai/seedvr/upscale/image", label: "SeedVR2 影像放大", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.001/MP(seamless 版 $0.0025/MP)", verified: true,
    strengths: "可到 10K 超大輸出、極便宜;風格偏乾淨略帶 AI 感",
    bestFor: "展場大圖、印刷跨頁的省錢放大;精細中文字搭 Thera",
    sourceHint: "要放大的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "clarityai/crystal-upscaler", label: "Crystal 人像放大", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 1, cost: "$0.016/MP(4K 約 4 點)", verified: true,
    strengths: "人像特化放大;皮膚紋理、虹膜、髮絲細節,可到 10K",
    bestFor: "法師人像特寫、肖像大圖輸出的極致臉部品質",
    sourceHint: "人像照片",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/recraft/upscale/crisp", label: "Recraft 清晰化放大", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "$0.004/張", verified: true,
    strengths: "非生成清晰化;邊緣乾淨臉更利,近乎免費",
    bestFor: "交付前最後銳化;中文字卡安全",
    sourceHint: "要銳化的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/recraft/upscale/creative", label: "Recraft 創意放大", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 8, cost: "$0.25/張", verified: true,
    strengths: "生成式創意放大;大幅補細節、品質高但單價貴",
    bestFor: "要印大圖的主視覺;含中文字有改字風險不建議",
    sourceHint: "要放大的主視覺",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/swin2sr", label: "Swin2SR 去壓縮放大", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "$0.025/MP", verified: true,
    strengths: "Transformer 忠實放大;擅長去除 JPEG 壓縮假影",
    bestFor: "被通訊軟體多次轉傳壓爛的低清舊圖救援",
    sourceHint: "壓縮失真的舊圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/drct-super-resolution", label: "DRCT 超解析", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "$0.0045/MP", verified: true,
    strengths: "較新的 Transformer 忠實放大;性價比佳,中文字安全",
    bestFor: "便宜忠實放大的 A/B 比較備選",
    sourceHint: "要放大的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/creative-upscaler", label: "Creative Upscaler(舊版)", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "$0.00111/計算秒", verified: false,
    strengths: "fal 早期 SD 創意放大;定位與 Clarity 重疊且較舊",
    bestFor: "相容備援;新專案優先用 Clarity",
    sourceHint: "要放大的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/mix-dehaze-net", label: "Mix-Dehaze 去霧", category: "image-to-image", tier: "budget", kind: "image",
    // 審計 B9/零成本：OpenAPI 404 — 撤 verified，待下架或換 slug
    needs: "image", points: 1, cost: "$0.025/MP", verified: false,
    strengths: "⚠OpenAPI 404;去霧/去朦朧(上線前勿選)",
    bestFor: "修復管線前處理:先去霧再放大修復",
    sourceHint: "發灰起霧的舊照/掃描",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  /* ── W2 全量擴充:去背/換背景(fal生態研究 §506–539) ── */
  {
    id: "fal-ai/birefnet/v2", label: "BiRefNet v2 去背", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "按算秒計費(每張約 $0.001–0.005)", verified: false,
    strengths: "開源最強級去背;髮絲/複雜邊緣標竿,多變體可選",
    bestFor: "人像與複雜物件摳成透明 PNG",
    sourceHint: "要去背的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/birefnet", label: "BiRefNet v1 去背", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "按算秒計費(同 v2 量級)", verified: false,
    strengths: "BiRefNet 初版;與 v2 同用途的舊權重",
    bestFor: "相容備援;新專案直接用 v2",
    sourceHint: "要去背的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/ideogram/remove-background", label: "Ideogram 去背", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.01/張", verified: true,
    strengths: "固定一口價的簡單可靠去背;最好估點數",
    bestFor: "批次摳「弘法素材貼紙庫」的一鍵工具",
    sourceHint: "要去背的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "pixelcut/background-removal", label: "Pixelcut 去背", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.016/張", verified: false,
    strengths: "電商級產品摳圖(合作夥伴端點)",
    bestFor: "結緣品、書封等產品照去背;RMBG 備援",
    sourceHint: "產品照",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/imageutils/rembg", label: "rembg 去背(陽春)", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "按算秒計費(每張遠低於 $0.01)", verified: false,
    strengths: "經典 u2net 去背;幾乎免費",
    bestFor: "單一主體、背景乾淨的簡單場景",
    sourceHint: "要去背的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/ben/v2/image", label: "BEN v2 去背", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.025/MP", verified: true,
    strengths: "新世代快速高品質去背(Background Erase Network)",
    bestFor: "求快的日常去背;小圖便宜、大圖按 MP 較貴",
    sourceHint: "要去背的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    // 文件檔位/價格未定(「建議實測後再定位」),暫列經濟檔
    id: "smoretalk-ai/rembg-enhance", label: "Rembg Enhance 去背", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.006/張", verified: true,
    strengths: "rembg+ViTMatte 邊緣強化;2D/3D 圖形與照片優化",
    bestFor: "AI 插畫/佛像圖去背,邊緣更柔和",
    sourceHint: "要去背的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/ideogram/v3/replace-background", label: "Ideogram v3 換背景", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 2, cost: "$0.03–0.09/張(依速度檔)", verified: true,
    strengths: "Ideogram 生態的一步換背景;TURBO 檔便宜",
    bestFor: "字卡出圖後統一視覺的換背景(提示詞英文)",
    sourceHint: "要換背景的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // 文件價格未查到、優先序低,暫列經濟檔
    id: "fal-ai/image-editing/background-change", label: "換背景(image-editing)", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.04/張", verified: false,
    strengths: "fal 官方 image-editing 套件的生成式換背景",
    bestFor: "一步換背景備選;與口語編輯模型重疊",
    sourceHint: "要換背景的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  /* ── W2 全量擴充:一致性/特殊工具(fal生態研究 §577–648;真人臉照一律需本人授權,產品建議 #12) ── */
  {
    id: "fal-ai/ideogram/character", label: "Ideogram 角色一致", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 3, cost: "$0.10(turbo)–0.20(quality)/張", verified: true,
    strengths: "單張參考照→跨提示詞、跨場景同一張臉;寫實角色一致旗艦",
    bestFor: "見證故事分鏡:同一主角演到底(提示詞英文)",
    sourceHint: "主角清晰照片一張",
    // 審計 #83：OpenAPI required=reference_image_urls[]（非 image_url）；image_size 對齊專案比例
    input: (p, f, s) => ({ prompt: p, reference_image_urls: s ? [s] : [], image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/instant-character", label: "Instant Character 角色一致", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 3, cost: "$0.10/MP", verified: true,
    strengths: "單張參考圖出新姿勢新場景;寫實與插畫/動畫皆可",
    bestFor: "繪本、吉祥物系列圖的角色一致",
    sourceHint: "角色設定圖一張",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // 文件價格未查到;參數偏工程,採端點預設
    id: "fal-ai/flux-pulid", label: "PuLID FLUX 人臉鎖定", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.0333/MP", verified: true,
    strengths: "FLUX 底免訓練人臉鎖定;一張臉照+提示詞進任何場景",
    bestFor: "把授權過的講者臉放進生成場景(提示詞英文)",
    sourceHint: "人臉清晰照(需本人授權)",
    // 審計 #85：OpenAPI required=reference_image_url（非 image_url）；image_size 對齊專案比例
    input: (p, f, s) => ({ prompt: p, reference_image_url: s, image_size: imageSize(f) }),
  },
  {
    // 端點存在為推定(🔸),價格未查到,首跑確認
    id: "fal-ai/instantid", label: "InstantID(SDXL 舊代)", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "查不到(按張,便宜)", verified: false,
    strengths: "零樣本人臉保真生成(SDXL 世代);便宜快速",
    bestFor: "省成本批量試稿;正式成品用新代模型",
    sourceHint: "人臉照片(需授權)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // 審計 #87：OpenAPI required=image_archive_url（ZIP 參考照包，非 image_url 單圖）
    id: "fal-ai/photomaker", label: "PhotoMaker 人像生成", category: "image-to-image", tier: "budget", kind: "image",
    needs: "zip", points: 1, cost: "$0.001/算秒(每張約 1–3 美分)", verified: true,
    strengths: "參考照學臉生成;最便宜的「把某人畫進畫面」",
    bestFor: "人物紀念圖草稿(SDXL 世代質感有限)",
    sourceHint: "1–4 張人像參考照的 ZIP（需授權；提示詞建議含 img 觸發詞）",
    input: (p, _f, s) => ({ prompt: p, image_archive_url: s }),
  },
  {
    // 文件價格未查到,首跑校準
    id: "fal-ai/face-to-sticker", label: "臉變貼圖(Face to Sticker)", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "查不到(按張,便宜)", verified: false,
    strengths: "一張臉→Q 版貼紙風;一鍵零參數",
    bestFor: "志工大頭照變貼圖、社群互動素材",
    sourceHint: "大頭照",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // 官方畫廊 LoRA 端點(LoRA 已內建於端點,非外掛資產);價格未查到
    id: "fal-ai/qwen-image-edit-plus-lora-gallery/next-scene", label: "Next-Scene 分鏡推進", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.035/MP", verified: true,
    strengths: "「下一幕」專用 LoRA;角色與場景自動延續推進劇情",
    bestFor: "敘事故事板連續推鏡;中文指令可用",
    sourceHint: "目前分鏡畫面",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // 文件價格未查到,首跑校準
    id: "fal-ai/minimax/image-01/subject-reference", label: "MiniMax 人物參考出圖", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "$0.01/張", verified: true,
    strengths: "單張臉照鎖定的圖像生成;參數少上手快",
    bestFor: "低成本把人物放進海報/金句卡底圖",
    sourceHint: "人物臉部照片(需授權)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/image-editing/expression-change", label: "表情微調(Expression Change)", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 2, cost: "$0.04/張", verified: false,
    strengths: "微調照片人物表情(眨眼、微笑、視線)",
    bestFor: "人物照表情太嚴肅/閉眼,不重拍直接調",
    sourceHint: "人物照片",
    input: (p, _f, s) => ({ image_url: s, prompt: p.trim() || "gentle smile" }),
  },
  {
    // 參數名 face_image_0 依 fal 文件慣例推定,首跑確認;雙人版需第二張臉(多來源,#15 另案)
    id: "easel-ai/easel-avatar", label: "Easel Avatar 人物場景", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 2, cost: "$0.05/次", verified: true,
    strengths: "自拍照+提示詞生成人物場景;免訓練保臉",
    bestFor: "志工形象照、單人合成場景",
    sourceHint: "本人自拍照(需授權)",
    input: (p, _f, s) => ({ prompt: p, face_image_0: s }),
  },
  {
    // 文件價格未查到,首跑校準
    id: "fal-ai/image-apps-v2/headshot-photo", label: "專業形象照生成", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.04/張", verified: true,
    strengths: "生活照→專業形象照,可換背景一鍵莊重化",
    bestFor: "講師簡介、義工證、講者卡的統一形象照",
    sourceHint: "本人生活照",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/finegrain-eraser", label: "Finegrain 精修去物", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 6, cost: "$0.18/次(prompt 模式);bbox/mask 模式 $0.04/次", verified: true,
    strengths: "高品質物件移除(prompt 模式);邊緣乾淨的精修版",
    bestFor: "印刷級海報的關鍵去物",
    sourceHint: "要精修的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // 文件價格未查到;輸出為 SVG 檔(以 image 型態承載)
    id: "fal-ai/recraft/vectorize", label: "Recraft 向量化(SVG)", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "$0.01/張", verified: true,
    strengths: "點陣圖→SVG 向量化(Recraft 引擎)",
    bestFor: "圖示/標誌/裝飾轉 SVG,放大印刷不失真",
    sourceHint: "要向量化的圖",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    // 輸出為 SVG 檔(以 image 型態承載)
    id: "fal-ai/image2svg", label: "Image2SVG 向量化", category: "image-to-image", tier: "budget", kind: "image",
    needs: "image", points: 1, cost: "$0.005/張", verified: true,
    strengths: "最便宜的圖轉 SVG",
    bestFor: "簡單圖形/剪影/單色圖示批量向量化",
    sourceHint: "要向量化的簡單圖形",
    input: (_p, _f, s) => ({ image_url: s }),
  },

  /* ═══ 3. 文生影片 text-to-video ═══ */
  {
    id: "fal-ai/veo3.1", label: "Veo 3.1(Google)", category: "text-to-video", tier: "flagship", kind: "video",
    // 為什麼:fal 影片模型按秒計費,固定扣點蓋不住長鏡頭——按秒計費模型一律以「6 秒鏡頭」估點(USD×31;區間價取中價),並在 cost 註明基準讓使用者知道超過 6 秒實際費用更高
    points: 31, cost: "$0.20/秒(720p/1080p 無音)、$0.40/秒(含音)、4k $0.40–0.60;按秒計費,點數為 5 秒基準", verified: true,
    strengths: "當前最強影片模型之一;物理正確、可含原生音效與對白",
    bestFor: "正式成品鏡頭、需要聲音的敘事片段",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/sora-2/text-to-video", label: "Sora 2(OpenAI)", category: "text-to-video", tier: "flagship", kind: "video",
    points: 16, cost: "$0.10/秒(720p);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "細節豐富的動態場景、含音訊;敘事鏡頭語言自然",
    bestFor: "故事性片段、複雜運鏡",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", label: "Kling 2.5 Turbo Pro", category: "text-to-video", tier: "flagship", kind: "video",
    points: 11, cost: "$0.07/秒;按秒計費,點數為 6 秒基準", verified: false,
    strengths: "動作流暢度標竿;快節奏動態場景",
    bestFor: "人物動作、活動紀錄感鏡頭",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f), duration: "5" }),
  },
  {
    id: "fal-ai/veo3.1/fast", label: "Veo 3.1 Fast", category: "text-to-video", tier: "economy", kind: "video",
    points: 16, cost: "$0.10/秒(無音)、$0.15/秒(含音,720p/1080p);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "Veo 家族的速度版;迭代快、質感仍佳",
    bestFor: "先看方向再升旗艦重生成",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/wan/v2.2-a14b/text-to-video", label: "Wan 2.2(開源)", category: "text-to-video", tier: "economy", kind: "video",
    points: 12, cost: "$0.08/秒(720p)、$0.06/秒(580p)、$0.04/秒(480p);按秒計費(16fps基準)", verified: true, recommended: true,
    strengths: "開源 14B;性價比首選、已在站內驗證",
    bestFor: "日常分鏡影片、預算有限時的主力",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/minimax/hailuo-2.3/standard/text-to-video", label: "Hailuo 2.3 Standard", category: "text-to-video", tier: "economy", kind: "video",
    points: 9, cost: "$0.28/6秒(768p,單支固定價)", verified: true,
    strengths: "MiniMax;人物表演與鏡頭感佳(Pro 版 1080p 已驗證存在)",
    bestFor: "人物特寫、情緒鏡頭",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    // 審計 #103：OpenAPI LtxVideoInput 僅 prompt／negative／seed／steps／guidance——**無** aspect_ratio
    id: "fal-ai/ltx-video", label: "LTX Video(開源)", category: "text-to-video", tier: "budget", kind: "video",
    points: 1, cost: "$0.02/支(固定價)", verified: true,
    strengths: "最低成本影片;秒級生成(新版 LTX-2.3 支援 4K+原生音訊)",
    bestFor: "動態預覽、試鏡頭節奏",
    input: (p) => ({ prompt: p }),
  },
  /* —— W2 全量擴充(fal生態研究):以下 text-to-video 新增;音訊開關型定價以「關音訊」為基準計點 —— */
  {
    id: "fal-ai/veo2", label: "Veo 2(Google)", category: "text-to-video", tier: "flagship", kind: "video",
    points: 58, cost: "$2.50/5秒(720p)+$0.50/追加秒;按秒計費", verified: true,
    strengths: "前代 Google 旗艦;寫實穩、運鏡電影感,無原生音效",
    bestFor: "相容舊專案;新案建議用 Veo 3.1",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/kling-video/v2.6/pro/text-to-video", label: "Kling 2.6 Pro", category: "text-to-video", tier: "flagship", kind: "video",
    points: 11, cost: "$0.07/秒(無音)、$0.14/秒(含音);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "Kling 最新旗艦;動作流暢標竿、新增原生音效,5/10 秒可選",
    bestFor: "人物動作、法會活動動態鏡頭",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f), duration: "5" }),
  },
  {
    // slug 推定(fal生態研究:2026 新版 O3,slug 待現場確認),真實模式首跑需確認
    id: "fal-ai/kling-video/o3/pro/text-to-video", label: "Kling 3.0/O3 Pro", category: "text-to-video", tier: "flagship", kind: "video",
    points: 17, cost: "$0.112/秒(無音)、$0.14/秒(含音);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "Kling 最頂級電影感新世代;含語音控制,單價最高",
    bestFor: "最高規對外成片、電影級運鏡表演",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f), duration: "5" }),
  },
  {
    id: "fal-ai/minimax/hailuo-2.3/pro/text-to-video", label: "Hailuo 2.3 Pro", category: "text-to-video", tier: "flagship", kind: "video",
    points: 15, cost: "$0.49/支(1080p)", verified: true,
    strengths: "人物表演與情緒張力最強;比 Veo/Kling 更會演",
    bestFor: "見證故事人物特寫、情緒鏡頭",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/luma-dream-machine/ray-2", label: "Luma Ray 2", category: "text-to-video", tier: "flagship", kind: "video",
    points: 16, cost: "$0.5/5秒", verified: true,
    strengths: "運鏡優雅、光影細膩、物理順;意境系旗艦",
    bestFor: "莊嚴療癒的抽象空鏡、電影感慢運鏡",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/bytedance/seedance/v1/pro/text-to-video", label: "Seedance 1.0 Pro(字節)", category: "text-to-video", tier: "flagship", kind: "video",
    points: 19, cost: "≈$0.62/支(1080p 5秒)", verified: true,
    strengths: "寫實質感與運鏡一致性極佳、指令遵循準(1080p)",
    bestFor: "寫實空鏡與敘事鏡頭的成片首選",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/bytedance/seedance/v1.5/pro/text-to-video", label: "Seedance 1.5 Pro(字節)", category: "text-to-video", tier: "flagship", kind: "video",
    points: 8, cost: "$0.26/支(720p 5秒,含音)", verified: true,
    strengths: "寫實再進化、新增原生音訊;有聲寫實裡極具競爭力",
    bestFor: "要寫實又一次帶環境音的成片",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    // slug 推定(fal生態研究:2026 上半年新上線,細節與價格待現場確認);暫依 Seedance 1.0 Pro 估點
    id: "bytedance/seedance-2.0/text-to-video", label: "Seedance 2.0(字節)", category: "text-to-video", tier: "flagship", kind: "video",
    points: 47, cost: "720p $0.3034/秒、1080p $0.682/秒(標準檔,含音免費);Fast 720p $0.2419/秒;按秒計費,點數為 6 秒基準", verified: true,
    strengths: "字節最新世代旗艦;寫實與可控性再升級",
    bestFor: "最高規寫實成片;先小量試跑再定主力",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    // 點數以「無音」首價 $0.03×5s 計(realPricePoints);開音訊／更長秒實際費用較高
    // 審計 #112：OpenAPI aspect_ratio 僅 16:9|9:16（無 1:1）→ 1:1 映射 16:9 防 422；duration 預設 8s+generate_audio true 與扁平 5 點脫鉤見卡 P0
    id: "fal-ai/veo3.1/lite", label: "Veo 3.1 Lite(Google)", category: "text-to-video", tier: "economy", kind: "video",
    // 審計 B9：含音 $0.05/秒×6s×31≈9；原 5 低估（1:1 已映 16:9）
    points: 9, cost: "720p $0.03/秒(無音)–$0.05(含音)、1080p $0.05–0.08/秒;按秒計費,點數為 6 秒含音基準", verified: true,
    strengths: "Veo 質感的超低價版;含音只要 $0.05/秒",
    bestFor: "量產日常 B-roll、空鏡、活動預告",
    input: (p, f) => ({ prompt: p, aspect_ratio: wideOrTall(f) }),
  },
  {
    id: "fal-ai/minimax/hailuo-02/standard/text-to-video", label: "Hailuo 02 Standard", category: "text-to-video", tier: "economy", kind: "video",
    points: 7, cost: "$0.045/秒(768p;Pro 1080p $0.08/秒);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "物理與指令遵循好;按秒計費透明",
    bestFor: "中等預算的日常敘事鏡頭",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/minimax/video-01-director", label: "Video-01 Director(Hailuo 01)", category: "text-to-video", tier: "economy", kind: "video",
    points: 16, cost: "$0.5/支", verified: true,
    strengths: "導演式運鏡指令(推軌、環繞、俯仰)直覺好控",
    bestFor: "精準指定運鏡的鏡頭(如環繞佛像)",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    // 審計 #115：OpenAPI 404 於 fal-ai/wan/v2.5/… → 實端點 fal-ai/wan-25/text-to-video（連字號 25）
    // P0：官方 default resolution=1080p（$0.15/秒）但 points 機械取首價 480p $0.05×5s≈8——見卡
    id: "fal-ai/wan/v2.5/text-to-video",
    endpoint: "fal-ai/wan-25/text-to-video",
    label: "Wan 2.5(開源)", category: "text-to-video", tier: "economy", kind: "video",
    // 審計 B9：預設若 1080p@$0.15×6s≈28；改送 720p 並 points≈$0.10×5s×31≈16
    points: 16, cost: "480p $0.05/秒、720p $0.10/秒、1080p $0.15/秒;站內鎖 720p;按秒計費,點數為 5 秒@720p 基準", verified: true,
    strengths: "Wan 新一代;畫質提升並加入原生音訊,仍親民價",
    bestFor: "開源價又要帶音效的療癒 B-roll",
    input: (p, f) => ({ prompt: p, aspect_ratio: wideOrTall(f), resolution: "720p" }),
  },
  {
    // 審計 #116：目錄 fal-ai/wan/v2.6/text-to-video 與 wan-26 皆 404 → 實端點 **wan/v2.6**（無 fal-ai/ 前綴、無 /text-to-video）
    // P0：default resolution=1080p（$0.15/秒）vs points 取首價 720p $0.10×5s≈16
    id: "fal-ai/wan/v2.6/text-to-video",
    endpoint: "wan/v2.6",
    label: "Wan 2.6(開源)", category: "text-to-video", tier: "economy", kind: "video",
    points: 16, cost: "$0.10/秒(720p)、$0.15/秒(1080p);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "Wan 最新多模態世代;音畫一體、開源質感天花板",
    bestFor: "正式一點又要控成本的敘事片",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/hunyuan-video-v1.5/text-to-video", label: "Hunyuan Video 1.5(騰訊)", category: "text-to-video", tier: "economy", kind: "video",
    points: 12, cost: "$0.075/秒;按秒計費,點數為 6 秒基準", verified: true,
    strengths: "Hunyuan 升級版;畫質與時序穩定度提升",
    bestFor: "莊嚴療癒風的空景與慢運鏡",
    // 審計 #117：OpenAPI aspect_ratio 僅 16:9|9:16；1:1 改送 16:9
    input: (p, f) => ({ prompt: p, aspect_ratio: wideOrTall(f) }),
  },
  {
    id: "fal-ai/pika/v2.2/text-to-video", label: "Pika 2.2", category: "text-to-video", tier: "economy", kind: "video",
    points: 10, cost: "$0.2/5秒(720p)、$0.45/5秒(1080p)", verified: true,
    strengths: "創意特效與關鍵影格過渡;風格化強",
    bestFor: "活潑轉場、片頭特效、社群短片",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    // 審計 #119：OpenAPI aspect_ratio 無 1:1（同 Ray-2）→ 1:1 映射 16:9 防 422；預設 540p／5s 對齊 $0.2
    id: "fal-ai/luma-dream-machine/ray-2-flash", label: "Luma Ray 2 Flash", category: "text-to-video", tier: "economy", kind: "video",
    points: 6, cost: "$0.2/支", verified: true,
    strengths: "Ray 2 的平價版;保留 Luma 柔順運鏡美感",
    bestFor: "意境空鏡的日常主力、快迭代",
    input: (p, f) => ({ prompt: p, aspect_ratio: wideOrTall(f) }),
  },
  {
    // 審計 #120：OpenAPI about 已 deprecated→轉 seedance 1.0 pro fast（Pricing will change）；aspect 含 1:1；本輪維持 id/points
    id: "fal-ai/bytedance/seedance/v1/lite/text-to-video", label: "Seedance 1.0 Lite(字節)", category: "text-to-video", tier: "economy", kind: "video",
    points: 6, cost: "$0.18/支(720p 5秒)", verified: true,
    strengths: "Seedance 720p 經濟版;寫實傾向、每支超划算",
    bestFor: "寫實敘事鏡頭的量產與草稿",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/pixverse/v5.5/text-to-video", label: "PixVerse v5.5", category: "text-to-video", tier: "economy", kind: "video",
    points: 9, cost: "$0.15(360/540p)–$0.40(1080p)/5秒;含音 +$0.05", verified: true,
    strengths: "多解析度分層、內建特效模板、直式友善",
    bestFor: "9:16 動態背景、金句卡動態化",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    // 審計 #122：OpenAPI 200 確認 endpoint 活躍（非推定死鏈）；aspect 含 1:1；預設 720p/5s/無音 vs points@1080p 錨見卡
    id: "fal-ai/pixverse/v6/text-to-video", label: "PixVerse V6", category: "text-to-video", tier: "economy", kind: "video",
    points: 14, cost: "$0.090/秒(無音)、$0.115/秒(含音,1080p);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "音畫一次生成(配樂+音效+對白同提示);1080p",
    bestFor: "一鍵出有背景音樂的直式短片、預告",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/kling-video/v1.6/standard/text-to-video", label: "Kling 1.6 Standard", category: "text-to-video", tier: "budget", kind: "video",
    points: 9, cost: "$0.056/秒(standard;pro 約 $0.095/秒);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "Kling 舊世代低價版;動態仍可用",
    bestFor: "試鏡頭、抓動作節奏的草稿",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f), duration: "5" }),
  },
  {
    // 另有子型號 slug fal-ai/wan/v2.1/1.3b/text-to-video → OpenAPI 404；活躍端為 fal-ai/wan-t2v
    // 審計 #124：OpenAPI aspect_ratio 僅 16:9|9:16；1:1 改送 16:9 防 422（同 hunyuan）
    // 預設 resolution=720p（非 cost 文案 480p）— 價差待帳單 P2
    id: "fal-ai/wan-t2v", label: "Wan 2.1(開源)", category: "text-to-video", tier: "budget", kind: "video",
    points: 6, cost: "$0.2/支(1.3B 480p);wan-pro 版 $0.8/5秒", verified: true,
    strengths: "前代開源輕量版極省;品質基本堪用",
    bestFor: "最省的開源試鏡頭、既有 2.1 LoRA",
    input: (p, f) => ({ prompt: p, aspect_ratio: wideOrTall(f) }),
  },
  {
    id: "fal-ai/hunyuan-video", label: "Hunyuan Video(騰訊開源)", category: "text-to-video", tier: "budget", kind: "video",
    points: 12, cost: "$0.40/支", verified: true,
    strengths: "騰訊開源大模型;動態自然、開源生態豐",
    bestFor: "日常空鏡、抽象動態;自訓 LoRA 底模",
    // 審計 #125：OpenAPI aspect_ratio 僅 16:9|9:16；1:1 改送 16:9 防 422（同 v1.5）
    input: (p, f) => ({ prompt: p, aspect_ratio: wideOrTall(f) }),
  },
  {
    // 審計 #126：OpenAPI MochiV1Input **無** aspect_ratio（僅 prompt/negative/seed/frames/expansion）
    // 原 aspect(f) 為死欄且誤導「比例可控」；改只送 prompt（比例固定由模型側）
    id: "fal-ai/mochi-v1", label: "Mochi 1(Genmo 開源)", category: "text-to-video", tier: "budget", kind: "video",
    points: 12, cost: "$0.4/支", verified: true,
    strengths: "開源、動態流暢、寫實傾向;按支平價",
    bestFor: "寫實空鏡試做;優先序在 Wan/LTX 之後",
    input: (p) => ({ prompt: p }),
  },
  {
    id: "fal-ai/cogvideox-5b", label: "CogVideoX-5B(智譜開源)", category: "text-to-video", tier: "budget", kind: "video",
    points: 6, cost: "$0.2/支", verified: true,
    strengths: "開源老將,按支超低價;品質基礎但穩定",
    bestFor: "教學練習、海量試驗、佔位動態",
    // 審計 #127：OpenAPI **無** aspect_ratio；用 video_size（ImageSize enum／預設 720×480）
    input: (p, f) => ({ prompt: p, video_size: imageSize(f) }),
  },
  {
    // LoRA 推論(W2 打磨,研究表「必補」):wan-22 系訓練成果的使用處;來源欄=LoRA 檔網址
    // 審計 #128：OpenAPI required 僅 prompt；loras[] 可選；aspect 含 1:1；def resolution 720p
    // path 空時勿送 {path:undefined}（防髒 payload）；needs=zip 擋空 probe
    id: "fal-ai/wan/v2.2-a14b/text-to-video/lora", label: "Wan 2.2 掛 LoRA 成片", category: "text-to-video", tier: "economy", kind: "video",
    needs: "zip", points: 16, cost: "$0.1/秒(Wan 2.2 掛 LoRA;基底 480p $0.04、580p $0.06、720p $0.08/秒);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "Wan 2.2 訓練成果的文生影端點;與站內主力工作流同底模",
    bestFor: "用自家影像風 LoRA 出片(提示詞含觸發詞)",
    sourceHint: "訓練成果 LoRA 檔網址(.safetensors)",
    input: (p, f, s) => ({
      prompt: p,
      aspect_ratio: aspect(f),
      ...(s ? { loras: [{ path: s, scale: 1 }] } : {}),
    }),
  },

  /* ═══ 3b. 圖生影片 image-to-video(W2 新類別:分鏡圖成片的結構性缺口,產品建議 #1) ═══ */
  {
    // 審計 #129：OpenAPI required start_image_url（非 image_url；v2.5 才是 image_url）
    // generate_audio 官方 def true（2× 價）；站內關音以對齊 points≈11@5s 關音
    id: "fal-ai/kling-video/v2.6/pro/image-to-video", label: "Kling 2.6 Pro(圖生)", category: "image-to-video", tier: "flagship", kind: "video",
    needs: "image", points: 11, cost: "$0.07/秒(關音訊)、$0.14/秒(開音訊);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "i2v 動作流暢與運鏡頂級;原生音效/人聲支援中英",
    bestFor: "分鏡圖轉電影感鏡頭、對外形象片",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, start_image_url: s, generate_audio: false }),
  },
  {
    id: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", label: "Kling 2.5 Turbo Pro(圖生)", category: "image-to-video", tier: "flagship", kind: "video",
    needs: "image", points: 11, cost: "$0.07/秒(5秒$0.35);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "動作自然度/成本甜蜜點;人物走動、衣物飄動穩",
    bestFor: "大量把分鏡圖動起來又要專業感",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // slug 推定(fal生態研究:另有 v3 turbo/pro、v3/4k 變體),真實模式首跑需確認
    id: "fal-ai/kling-video/v3/pro/image-to-video", label: "Kling v3 Pro(圖生)", category: "image-to-video", tier: "flagship", kind: "video",
    needs: "image", points: 17, cost: "約$0.112/秒(關音訊)起、$0.168/秒(開);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "Kling 最新世代;頂規運鏡與物理一致性,含音訊",
    bestFor: "對外主視覺的象徵性長鏡頭,精用",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/veo3.1/image-to-video", label: "Veo 3.1 圖生(Google)", category: "image-to-video", tier: "flagship", kind: "video",
    needs: "image", points: 31, cost: "$0.20/秒(720p/1080p 無音)、$0.40/秒(含音)、4k $0.40–0.60;按秒計費,點數為 5 秒基準", verified: false,
    strengths: "物理正確+原生音訊的質感天花板;成本高",
    bestFor: "對外形象片最關鍵的一兩個鏡頭",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/veo2/image-to-video", label: "Veo 2 圖生(Google)", category: "image-to-video", tier: "flagship", kind: "video",
    needs: "image", points: 39, cost: "$2.50/5秒 + $0.50/追加秒", verified: true,
    strengths: "Veo 前代 i2v;質感佳、成本略低於 3.1",
    bestFor: "Google 系質感、預算比 3.1 寬鬆時",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/minimax/hailuo-2.3/pro/image-to-video", label: "Hailuo 2.3 Pro(圖生)", category: "image-to-video", tier: "flagship", kind: "video",
    needs: "image", points: 15, cost: "$0.49/支(1080p,約6秒)", verified: true,
    strengths: "人物表演與情緒動作最自然;少鬼影變形",
    bestFor: "人像照活起來:表情、眼神、合掌",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/bytedance/seedance/v1.5/pro/image-to-video", label: "Seedance 1.5 Pro 圖生(字節)", category: "image-to-video", tier: "flagship", kind: "video",
    needs: "image", points: 8, cost: "≈$0.26/支(720p 5秒,含音;1080p 更高)", verified: true,
    strengths: "多鏡頭敘事一致性強;支援原生音訊",
    bestFor: "一張圖延展成有分鏡感的連貫段落",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/luma-dream-machine/ray-2/image-to-video", label: "Luma Ray-2(圖生)", category: "image-to-video", tier: "flagship", kind: "video",
    needs: "image", points: 16, cost: "$0.50/支", verified: true,
    strengths: "唯美光影氛圍與自然運動;靜謐基調最契合",
    bestFor: "莊嚴療癒空景動態:晨光、香煙、波光",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // slug 推定(fal生態研究:新款,價格以 Wan 2.5 級距參考;doc 原文即無 fal-ai 前綴),真實模式首跑需確認
    id: "wan/v2.6/image-to-video", label: "Wan 2.6 圖生(開源)", category: "image-to-video", tier: "flagship", kind: "video",
    needs: "image", points: 8, cost: "約$0.05/秒(Wan 2.5 級距參考);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "Wan 最新世代;HD、最長約15秒、原生音訊",
    bestFor: "較長單鏡頭又要開源可控成本",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/wan/v2.2-a14b/image-to-video", label: "Wan 2.2 圖生(開源)", category: "image-to-video", tier: "economy", kind: "video",
    needs: "image", points: 6, cost: "480p $0.04/秒–720p $0.08/秒;站內鎖 480p;按秒計費,點數為 5 秒@480p 基準", verified: true, recommended: true,
    strengths: "開源 14B 的 i2v 版;性價比與可控性最佳的日常主力",
    bestFor: "把 FLUX/Seedream 分鏡圖批量動起來",
    sourceHint: "作為首格的圖(素材庫或網址)",
    // 審計 B9：OpenAPI 預設 720p 會使 points=6 低估約 2× → 站內鎖 480p 對齊經濟估點
    input: (p, _f, s) => ({ prompt: p, image_url: s, resolution: "480p" }),
  },
  {
    id: "fal-ai/minimax/hailuo-2.3/standard/image-to-video", label: "Hailuo 2.3 Standard(圖生)", category: "image-to-video", tier: "economy", kind: "video",
    needs: "image", points: 9, cost: "$0.28/6秒(768p)", verified: false,
    strengths: "人物強項的 768p 經濟版;情緒鏡頭仍在水準上",
    bestFor: "日常見證短片的主角動態",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video", label: "Hailuo 2.3 Fast Pro(圖生)", category: "image-to-video", tier: "economy", kind: "video",
    needs: "image", points: 10, cost: "$0.33/支", verified: false,
    strengths: "Hailuo Pro 加速版;快出片、成本更低",
    bestFor: "候選分鏡圖快速動起來挑方向",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // slug 推定(fal生態研究 🔸),真實模式首跑需確認
    id: "fal-ai/bytedance/seedance/v1/lite/image-to-video", label: "Seedance 1.0 Lite 圖生(字節)", category: "image-to-video", tier: "economy", kind: "video",
    needs: "image", points: 6, cost: "$0.18/支(720p 5秒)", verified: false,
    strengths: "Seedance 輕量經濟版;字節系運鏡風格省錢款",
    bestFor: "日常量產動態預覽",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/luma-dream-machine/ray-2-flash/image-to-video", label: "Luma Ray-2 Flash(圖生)", category: "image-to-video", tier: "economy", kind: "video",
    needs: "image", points: 6, cost: "$0.20/支", verified: false,
    strengths: "Ray-2 的快速經濟版;同樣唯美氛圍半價出片",
    bestFor: "佛像圖、海報做呼吸感微動態",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/hunyuan-video-image-to-video", label: "Hunyuan 圖生(騰訊開源)", category: "image-to-video", tier: "economy", kind: "video",
    needs: "image", points: 12, cost: "$0.40/支", verified: false,
    strengths: "動態多樣、視覺質感高;一致性略輸商用款",
    bestFor: "開源偏好、要豐富運動幅度的場景",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/pixverse/v5/image-to-video", label: "PixVerse v5(圖生)", category: "image-to-video", tier: "economy", kind: "video",
    needs: "image", points: 9, cost: "5秒 $0.15(360/540p)、$0.2(720p)、$0.4(1080p)", verified: false,
    strengths: "模板化特效/轉場;社群風格化、價格分層清楚",
    bestFor: "活動宣傳、Shorts/Reels 吸睛動態",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // 審計零成本：OpenAPI queue 404（無替代 slug）；勿 live 直至官方路徑確認
    id: "fal-ai/runway-gen3/turbo/image-to-video", label: "Runway Gen-3 Turbo(圖生)", category: "image-to-video", tier: "economy", kind: "video",
    needs: "image", points: 12, cost: "約$0.05–0.10/秒(依版本);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "⚠OpenAPI 404 端點未上線;Runway 系運鏡語言成熟(上線後可用)",
    bestFor: "分鏡圖轉有導演感鏡頭的原型（端點上線前勿選）",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/minimax/video-01/image-to-video", label: "Video-01 圖生(MiniMax)", category: "image-to-video", tier: "economy", kind: "video",
    needs: "image", points: 16, cost: "$0.50/支", verified: false,
    strengths: "MiniMax 前代 i2v;穩定的人物/場景動態",
    bestFor: "固定價、單支計費的簡單需求",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // 參數名依 fal 慣例推定(subject_reference),首跑確認;真人臉照需本人授權(產品建議 #12)
    id: "fal-ai/minimax/video-01-subject-reference", label: "Video-01 人物參考成片(MiniMax)", category: "image-to-video", tier: "economy", kind: "video",
    needs: "image", points: 16, cost: "$0.50/支", verified: false,
    strengths: "單張臉照鎖定人物的影片生成;跨鏡頭同一張臉",
    bestFor: "見證故事的主角一致成片(需本人授權)",
    sourceHint: "人物臉部照片(需授權)",
    input: (p, _f, s) => ({ prompt: p, subject_reference_image_url: s }),
  },
  {
    id: "fal-ai/wan-i2v", label: "Wan 2.1 圖生(開源)", category: "image-to-video", tier: "economy", kind: "video",
    needs: "image", points: 9, cost: "$0.20–0.40/支(480p–720p)", verified: false,
    strengths: "Wan 2.1 經典 i2v;穩定便宜的入門款",
    bestFor: "預算最緊時讓分鏡圖有基本動態",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/ltx-video-v095/image-to-video", label: "LTX v0.9.5 圖生(開源)", category: "image-to-video", tier: "budget", kind: "video",
    needs: "image", points: 1, cost: "$0.04/支", verified: false,
    strengths: "全站最低成本 i2v;秒級生成",
    bestFor: "海量預覽看節奏,選圖再上旗艦",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/framepack", label: "FramePack 長片圖生(開源)", category: "image-to-video", tier: "budget", kind: "video",
    needs: "image", points: 5, cost: "$0.0333/秒(可到約180幀);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "自迴歸長片 i2v;超過一般 5–6 秒上限仍極省",
    bestFor: "莊嚴圖延展成較長療癒空景循環",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/stable-video", label: "Stable Video Diffusion(圖生)", category: "image-to-video", tier: "budget", kind: "video",
    needs: "image", points: 2, cost: "$0.075/支", verified: false,
    strengths: "細膩可信的微動態;幾乎靜止但有生命感",
    bestFor: "佛像/山水海報的呼吸式微動",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    // slug 推定(fal生態研究 🔸:SVD 加速蒸餾版,價格推估),真實模式首跑需確認
    id: "fal-ai/fast-svd-lcm", label: "SVD Turbo/LCM(圖生)", category: "image-to-video", tier: "budget", kind: "video",
    needs: "image", points: 1, cost: "約$0.02–0.05/支", verified: false,
    strengths: "SVD 加速蒸餾版;更快更省的微動預覽",
    bestFor: "大量粗看哪張圖動起來耐看",
    sourceHint: "作為首格的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },

  /* ═══ 4. 影片轉影片 video-to-video ═══ */
  {
    id: "fal-ai/topaz/upscale/video", label: "Topaz 影片升級", category: "video-to-video", tier: "flagship", kind: "video",
    needs: "video", points: 7, cost: "$0.01–0.08/秒(依解析度);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "業界標準升頻;低清舊素材救星、可倍幀",
    bestFor: "歷史開示影片修復、AI 生成影片升 4K",
    sourceHint: "要升級的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 目錄錯誤修正(fal生態研究 #9):實際定價 $5/分,原標 $0.7–2/分嚴重低估
    id: "fal-ai/sync-lipsync/v2/pro", label: "Lipsync v2 Pro 對嘴", category: "video-to-video", tier: "flagship", kind: "video",
    needs: "video", points: 155, cost: "$5/分;按影片長度計費,點數以 1 分鐘短片估,較長影片實際費用更高", verified: true,
    strengths: "最新一代對嘴;把配音精準貼合人物口型",
    bestFor: "虛擬主持人、配音替換",
    sourceHint: "要對嘴的人物影片", secondaryNeeds: "audio", secondarySourceHint: "要套用的配音音訊",
    input: (_p, _f, s, s2) => ({ video_url: s, audio_url: s2 }),
  },
  {
    // 現值更新(W2 打磨):研究表為 ≈$0.10/秒(720p 2x、1080p 4x),原標 $0.5–1/支 查無佐證
    id: "fal-ai/luma-dream-machine/ray-2/modify", label: "Ray-2 Modify 重繪", category: "video-to-video", tier: "flagship", kind: "video",
    needs: "video", points: 16, cost: "≈$0.10/秒(720p 2x、1080p 4x);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "整段影片風格轉換/元素替換",
    bestFor: "把實拍轉動畫風、統一系列視覺",
    sourceHint: "要重繪的影片網址",
    input: (p, _f, s) => ({ video_url: s, prompt: p }),
  },
  {
    id: "fal-ai/luma-dream-machine/ray-2-flash/modify", label: "Ray-2 Flash Modify 重繪", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 8, cost: "約$0.05/秒級(低於旗艦 Modify);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "Modify 的速度版;先快速試風格方向再上旗艦",
    bestFor: "風格轉換的低成本試跑、量產統一調性",
    sourceHint: "要重繪的影片網址",
    input: (p, _f, s) => ({ video_url: s, prompt: p }),
  },
  {
    id: "fal-ai/sync-lipsync", label: "Lipsync 1.9 對嘴", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 22, cost: "$0.7/分;按影片長度計費,點數以 1 分鐘短片估,較長影片實際費用更高", verified: true,
    strengths: "成熟穩定的對嘴;成本較低",
    bestFor: "一般對嘴需求",
    sourceHint: "要對嘴的人物影片", secondaryNeeds: "audio", secondarySourceHint: "要套用的配音音訊",
    input: (_p, _f, s, s2) => ({ video_url: s, audio_url: s2 }),
  },
  {
    id: "fal-ai/video-upscaler", label: "影片升頻(輕量)", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 16, cost: "$0.1/秒;按秒計費,點數為 6 秒基準", verified: true,
    strengths: "輕量升頻;速度快",
    bestFor: "日常素材小幅提升畫質",
    sourceHint: "要升頻的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 目錄錯誤修正(fal生態研究 #9):命名空間已遷移到 bria/*
    // 現值更新(W2 打磨):研究表為 ≈$0.1/秒(🔸推定,高於 BEN2/realtime 版);原 $0.01/秒 查無佐證
    id: "fal-ai/bria/video/background-removal", endpoint: "bria/video/background-removal", label: "影片去背", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 16, cost: "≈$0.1/秒(推定,以 fal 現場為準);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "自動去除影片背景(綠幕效果)",
    bestFor: "人物合成到新場景",
    sourceHint: "要去背的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 目錄錯誤修正(fal生態研究 #9):amt-interpolation 端點查無官方佐證,換成已驗證的 RIFE;舊條目移 LEGACY 保相容
    id: "fal-ai/rife/video", label: "RIFE 補幀(流暢化)", category: "video-to-video", tier: "budget", kind: "video",
    needs: "video", points: 2, cost: "$0.0013/運算秒(極低);點數為 6 秒基準", verified: true, recommended: true,
    strengths: "開源即時補幀讓影片更順(24→48/60fps),也可做慢動作",
    bestFor: "AI 生成影片的卡頓修飾、老影片流暢感重建",
    sourceHint: "要補幀的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  /* —— W2 全量擴充(fal生態研究):以下 video-to-video 新增(對嘴/去背/放大/風格轉換) —— */
  {
    // 審計 B9：官方 $8/分（非目錄 $5+）→ points 155→248；$5×31=155 低估 ~37%
    id: "fal-ai/sync-lipsync/v3", label: "Sync-3 對嘴(新旗艦)", category: "video-to-video", tier: "flagship", kind: "video",
    needs: "video", points: 248, cost: "$8/分;按影片長度計費,點數以 1 分鐘短片估,較長影片實際費用更高", verified: false,
    strengths: "sync.so 最新一代;對嘴自然度天花板",
    bestFor: "對外正式的多語開示對嘴",
    sourceHint: "要對嘴的人物影片", secondaryNeeds: "audio", secondarySourceHint: "要套用的配音音訊",
    input: (_p, _f, s, s2) => ({ video_url: s, audio_url: s2 }),
  },
  {
    id: "fal-ai/sync-lipsync/v2", label: "Lipsync v2 對嘴(標準)", category: "video-to-video", tier: "flagship", kind: "video",
    needs: "video", points: 93, cost: "$3/分;按影片長度計費,點數以 1 分鐘短片估,較長影片實際費用更高", verified: false,
    strengths: "新一代對嘴標準版;品質接近 Pro 省 4 成",
    bestFor: "多語版開示的日常出片",
    sourceHint: "要對嘴的人物影片", secondaryNeeds: "audio", secondarySourceHint: "要套用的配音音訊",
    input: (_p, _f, s, s2) => ({ video_url: s, audio_url: s2 }),
  },
  {
    // 價格未定(依時長計費、長片分段);暫依 Lucy Edit 級距 ≈$0.1/秒估點
    id: "decart/lucy-restyle", label: "Lucy Restyle 長片風格轉換", category: "video-to-video", tier: "flagship", kind: "video",
    needs: "video", points: 19, cost: "依時長計費(以 fal 現場為準);點數為 6 秒基準,長片實際費用高於扣點", verified: false,
    strengths: "長達 30 分鐘整體風格轉換;保留身份與動作連貫",
    bestFor: "整段長片開示轉統一美術風格",
    sourceHint: "要轉換風格的影片網址",
    input: (p, _f, s) => ({ video_url: s, prompt: p }),
  },
  {
    id: "fal-ai/seedvr/upscale/video", label: "SeedVR2 影片放大(字節)", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 12, cost: "$0.001/百萬像素(寬×高×幀數);點數以 6 秒 1080p 30fps 估", verified: false,
    strengths: "擴散式放大單價極低、可到 4K;批次修復划算",
    bestFor: "整批歷史影音放大;Topaz 留成品",
    sourceHint: "要放大的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    id: "fal-ai/ben/v2/video", label: "BEN2 影片去背", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 5, cost: "$0.001/百萬像素(幾乎零成本);點數以 6 秒 720p 30fps 估", verified: false,
    strengths: "自動去背/綠幕效果;單價極低的去背主力",
    bestFor: "人物去背合成到禪堂、金句字卡",
    sourceHint: "要去背的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 依 ×0.1×31 規則為 1 點,但比照既有對嘴條目(0.7/分→8點)保守上調防長片低估
    id: "veed/lipsync", label: "VEED 對嘴", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 12, cost: "$0.4/分;按影片長度計費,點數以 1 分鐘短片估,較長影片實際費用更高", verified: false,
    strengths: "商用對嘴,便宜穩定;1.9 與 Sync 標準間的性價比",
    bestFor: "量大時的中階對嘴",
    sourceHint: "要對嘴的人物影片", secondaryNeeds: "audio", secondarySourceHint: "要套用的配音音訊",
    input: (_p, _f, s, s2) => ({ video_url: s, audio_url: s2 }),
  },
  {
    // 現值更新(W2 打磨):採研究「去背/分割」表的精確價($0.015–0.0225/30幀),與 fast/綠幕姊妹條目同基準
    id: "veed/video-background-removal", label: "VEED 影片去背(商用)", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 4, cost: "$0.015–0.0225/30幀(30fps≈每秒);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "商用等級去背,穩定",
    bestFor: "對外正式合成的穩定去背",
    sourceHint: "要去背的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 審計 #168：基底 `decart/lucy-edit` OpenAPI 404 → 實端點分檔 dev/fast/pro；economy 映射 **fast**
    // 點數取 $0.05–0.15/秒中價×5s；P0 扁平不隨片長；pro 姊妹見卡
    id: "decart/lucy-edit",
    endpoint: "decart/lucy-edit/fast",
    label: "Lucy Edit 文字改影片", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 16, cost: "約$0.05–0.15/秒(dev/fast/pro 三檔);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "文字指令換裝/換物/風格;保留身份與動作",
    bestFor: "口語修改:換服裝、換背景成佛堂",
    sourceHint: "要修改的影片網址",
    input: (p, _f, s) => ({ video_url: s, prompt: p }),
  },
  {
    // 價格依 Wan 秒計費級距估(≈$0.04–0.08/秒取中價)
    id: "fal-ai/wan-vace-14b/outpainting", label: "Wan VACE 影片外擴", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 9, cost: "依 Wan 秒計費(≈$0.04–0.08/秒);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "補出畫面外內容、改變畫幅比例",
    bestFor: "舊 4:3 開示外擴 16:9、直橫式互轉",
    sourceHint: "要外擴的影片網址",
    input: (p, _f, s) => ({ video_url: s, prompt: p }),
  },
  {
    id: "fal-ai/latentsync", label: "LatentSync 對嘴(字節開源)", category: "video-to-video", tier: "budget", kind: "video",
    needs: "video", points: 6, cost: "$0.20/≤40秒,之後 $0.005/秒;長片實際費用高於扣點", verified: false,
    strengths: "極低成本對嘴;真人與動畫皆可",
    bestFor: "大量草稿對嘴、內部預覽",
    sourceHint: "要對嘴的人物影片", secondaryNeeds: "audio", secondarySourceHint: "要套用的配音音訊",
    input: (_p, _f, s, s2) => ({ video_url: s, audio_url: s2 }),
  },
  {
    // 價格推估(fal生態研究:端點已查證、單價 ≈$0.10–0.20/次為推估)
    id: "fal-ai/musetalk", label: "MuseTalk 對嘴(保守型)", category: "video-to-video", tier: "budget", kind: "video",
    needs: "video", points: 5, cost: "≈$0.10–0.20/次(推估)", verified: false,
    strengths: "只改嘴部區域、不重繪全臉;失真風險低",
    bestFor: "師父影像不能失真的保守對嘴",
    sourceHint: "要對嘴的人物影片", secondaryNeeds: "audio", secondarySourceHint: "要套用的配音音訊",
    // 審計 #171：OpenAPI required source_video_url（非 video_url）+ audio_url
    input: (_p, _f, s, s2) => ({ source_video_url: s, audio_url: s2 }),
  },
  /* ── W2 全量擴充:去背/字幕/去物(fal生態研究 §506–539、§613–648) ── */
  {
    // 審計 #172：官方 $0.0042/秒（與 base 同價）；OpenAPI required video_url；預設 webm_vp9
    id: "bria/video/background-removal/v3", label: "Bria VRMBG 3.0 影片去背", category: "video-to-video", tier: "flagship", kind: "video",
    needs: "video", points: 3, cost: "$0.0042/秒;按秒計費,點數為 6 秒基準", verified: false,
    strengths: "Bria 第三代影片去背;更準、時序穩少閃爍",
    bestFor: "開示剪輯、見證短片等正式成品的去背首選",
    sourceHint: "要去背的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 審計 #173 P0：裸 id …/realtime 是 WebRTC 即時串流（無 batch video_url、輸出 ICE）
    // → 站內 queue 無法用。映到 batch 端點 bria/video/background-removal（同 $0.0042/秒）
    id: "bria/video/background-removal/realtime",
    endpoint: "bria/video/background-removal",
    label: "Bria VRMBG 高速版", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 1, cost: "$0.0042/秒;按秒計費,點數為 6 秒基準", verified: false,
    strengths: "VRMBG 高速版;單價極低可放心試錯",
    bestFor: "日常大量影片去背主力;正式成品再上 v3",
    sourceHint: "要去背的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    id: "veed/video-background-removal/fast", label: "VEED 影片去背 Fast", category: "video-to-video", tier: "budget", kind: "video",
    needs: "video", points: 2, cost: "$0.008–0.012/30幀;按秒計費,點數為 6 秒基準", verified: false,
    strengths: "VEED 半價快速版",
    bestFor: "預覽構圖、內部試片;定案再跑標準版",
    sourceHint: "要去背的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    id: "veed/video-background-removal/green-screen", label: "VEED 綠幕摳像", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 5, cost: "$0.025/30幀;按秒計費,點數為 6 秒基準", verified: false,
    strengths: "真綠幕專用:chroma key+自動去綠色溢光",
    bestFor: "有架綠幕拍攝的素材,比通用去背乾淨",
    sourceHint: "綠幕拍攝的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 按算秒計費,確切價未查到,首跑校準
    id: "fal-ai/birefnet/v2/video", label: "BiRefNet v2 影片去背", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 2, cost: "按算秒計費(確切價未查到);點數為 6 秒基準", verified: false,
    strengths: "BiRefNet 逐幀影片去背(開源)",
    bestFor: "數秒短片段物件去背的低成本選項",
    sourceHint: "要去背的短影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 文件價格未查到;中文效果未驗證,首跑必驗(建議先用 auto-subtitle)
    id: "fal-ai/auto-caption", label: "自動字幕燒錄(Auto-Caption)", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 2, cost: "查不到精確價", verified: false,
    strengths: "影片自動上字幕並燒錄(限 100MB mp4)",
    bestFor: "短影音快速上字卡;中文效果須實測",
    sourceHint: "要上字幕的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 文件價格未查到;Google Fonts 含 Noto Sans TC,中文斷句/逐字高亮首跑必驗
    id: "fal-ai/workflow-utilities/auto-subtitle", label: "逐字字幕燒錄(Auto-Subtitle)", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 2, cost: "查不到精確價", verified: false,
    strengths: "轉錄+卡拉OK式逐字高亮字幕;Google Fonts 含繁中 Noto",
    bestFor: "開示剪輯/Shorts 字幕一條龍;中文首跑必驗",
    sourceHint: "要上字幕的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 文件價格未查到,首跑校準;中文字幕效果待實測
    id: "veed/subtitles", label: "VEED 商用字幕", category: "video-to-video", tier: "flagship", kind: "video",
    needs: "video", points: 3, cost: "查不到精確價", verified: false,
    strengths: "VEED 商用字幕 API;多語字幕成熟、樣式化燒錄",
    bestFor: "對外發布影片的字幕品質要求",
    sourceHint: "要上字幕的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 去浮水印/台標僅限自有素材(產品建議 #12,UI 需明示)
    // 審計零成本：OpenAPI queue 404 — 端點可能下架或改名
    id: "fal-ai/bria/video/eraser", label: "Bria 影片去物件", category: "video-to-video", tier: "flagship", kind: "video",
    needs: "video", points: 22, cost: "$0.14/秒(限 5 秒/次);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "⚠OpenAPI 404;文字描述移除影片中物件/日期戳(上線前勿選)",
    bestFor: "短片段去雜物去台標;限自有素材",
    sourceHint: "要清理的影片網址(5 秒內)",
    input: (p, _f, s) => ({ prompt: p, video_url: s }),
  },

  /* ═══ 5. 大型語言模型 llm(NVIDIA NIM,單一端點多型號;LLM 文字整站遷移 NIM,媒體維持 fal) ═══
     endpoint 一律 "nvidia-nim":generationCore 據此分流到 nimSubmit/nimStatus(不走 fal 佇列)。
     計費為 NVIDIA NIM 按 token;短任務單次成本遠低於 1 點,固定扣 1 點與原 any-llm 同口徑。 */
  {
    id: "nvidia-nim#deepseek-r1", endpoint: "nvidia-nim", label: "DeepSeek R1", category: "llm", tier: "flagship", kind: "text",
    points: 0, cost: "免費(NVIDIA NIM 免費額度)", verified: false,
    strengths: "深度推理鏈旗艦;複雜任務拆解、長鏈邏輯最強",
    bestFor: "腳本結構規劃、需要想清楚再答的複雜任務",
    input: llmInput("deepseek-ai/deepseek-r1"),
  },
  {
    id: "nvidia-nim#llama-3.1-405b", endpoint: "nvidia-nim", label: "Llama 3.1 405B", category: "llm", tier: "flagship", kind: "text",
    points: 0, cost: "免費(NVIDIA NIM 免費額度)", verified: false,
    strengths: "Meta 開源最大檔;寫作品質與指令遵循頂尖",
    bestFor: "正式腳本撰寫、開示摘要、長文彙整",
    input: llmInput("meta/llama-3.1-405b-instruct"),
  },
  {
    id: "nvidia-nim#nemotron-4-340b", endpoint: "nvidia-nim", label: "Nemotron-4 340B", category: "llm", tier: "flagship", kind: "text",
    points: 0, cost: "免費(NVIDIA NIM 免費額度)", verified: false,
    strengths: "NVIDIA 自家旗艦;指令對齊佳、輸出穩定",
    bestFor: "腦力激盪、多版本文案",
    input: llmInput("nvidia/nemotron-4-340b-instruct"),
  },
  {
    id: "nvidia-nim#llama-3.1-70b", endpoint: "nvidia-nim", label: "Llama 3.1 70B", category: "llm", tier: "economy", kind: "text",
    points: 0, cost: "免費(NVIDIA NIM 免費額度)", verified: false, recommended: true,
    strengths: "品質/成本平衡的日常主力(後端自動 LLM 亦預設此檔)",
    bestFor: "標題、短文案、日常改寫",
    input: llmInput("meta/llama-3.1-70b-instruct"),
  },
  {
    id: "nvidia-nim#qwen2.5-72b", endpoint: "nvidia-nim", label: "Qwen2.5 72B(中文)", category: "llm", tier: "economy", kind: "text",
    points: 0, cost: "免費(NVIDIA NIM 免費額度)", verified: false,
    strengths: "阿里通義開源檔;中文語感第一梯隊、繁中穩定",
    bestFor: "中文金句、弘法文案、中文改寫潤飾",
    input: llmInput("qwen/qwen2.5-72b-instruct"),
  },
  {
    id: "nvidia-nim#mistral-large-2", endpoint: "nvidia-nim", label: "Mistral Large 2", category: "llm", tier: "economy", kind: "text",
    points: 0, cost: "免費(NVIDIA NIM 免費額度)", verified: false,
    strengths: "歐系旗艦;多語能力佳、風格精煉",
    bestFor: "多語版本文案、翻譯初稿",
    input: llmInput("mistralai/mistral-large-2-instruct"),
  },
  {
    id: "nvidia-nim#llama-3.1-8b", endpoint: "nvidia-nim", label: "Llama 3.1 8B", category: "llm", tier: "budget", kind: "text",
    points: 0, cost: "免費(NVIDIA NIM 免費額度)", verified: false,
    strengths: "最低成本文字生成;速度極快",
    bestFor: "大量簡單任務(標籤、分類)",
    input: llmInput("meta/llama-3.1-8b-instruct"),
  },

  /* ═══ 6. 圖片轉文字 vision ═══ */
  {
    id: "fal-ai/any-llm/vision#gemini-2.5-pro", endpoint: "fal-ai/any-llm/vision", label: "Gemini 2.5 Pro 視覺", category: "vision", tier: "flagship", kind: "text",
    needs: "image", points: 1, cost: "$0.01/次", verified: true,
    strengths: "看圖推理最強之一;繁中描述自然",
    bestFor: "素材整理描述、畫面內容盤點",
    sourceHint: "要理解的圖片",
    input: llmVisionInput("google/gemini-2.5-pro"),
  },
  {
    id: "fal-ai/any-llm/vision#claude-sonnet-4.5", endpoint: "fal-ai/any-llm/vision", label: "Claude Sonnet 4.5 視覺", category: "vision", tier: "flagship", kind: "text",
    needs: "image", points: 1, cost: "$0.01/次", verified: true,
    strengths: "細節觀察與文字轉寫嚴謹",
    bestFor: "圖表解讀、文件照片整理",
    sourceHint: "要理解的圖片",
    input: llmVisionInput("anthropic/claude-sonnet-4.5"),
  },
  {
    id: "fal-ai/any-llm/vision#gpt-5", endpoint: "fal-ai/any-llm/vision", label: "GPT-5 視覺", category: "vision", tier: "flagship", kind: "text",
    needs: "image", points: 1, cost: "$0.01/次", verified: false,
    strengths: "視覺問答全能",
    bestFor: "看圖回答特定問題",
    sourceHint: "要理解的圖片",
    input: llmVisionInput("openai/gpt-5"),
  },
  {
    id: "fal-ai/moondream-next", label: "Moondream Next", category: "vision", tier: "economy", kind: "text",
    needs: "image", points: 1, cost: "≈$0.005/次", verified: true, recommended: true,
    strengths: "多任務視覺小鋼炮;描述/指認/偵測",
    bestFor: "批量素材自動標注",
    sourceHint: "要理解的圖片",
    input: (p, _f, s) => ({ image_url: s, prompt: p || "Describe this image in detail." }),
  },
  {
    id: "fal-ai/florence-2-large/more-detailed-caption", label: "Florence-2 詳細描述", category: "vision", tier: "economy", kind: "text",
    needs: "image", points: 1, cost: "≈$0.003/次", verified: true,
    strengths: "微軟開源;固定產出高細節英文描述",
    bestFor: "素材庫自動建檔(再用 LLM 翻中)",
    sourceHint: "要描述的圖片",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/florence-2-large/ocr", label: "Florence-2 OCR 擷取", category: "vision", tier: "economy", kind: "text",
    needs: "image", points: 1, cost: "≈$0.003/次", verified: true,
    strengths: "圖中文字擷取",
    bestFor: "掃描稿、簡報截圖轉文字",
    sourceHint: "含文字的圖片",
    input: (_p, _f, s) => ({ image_url: s }),
  },
  {
    id: "fal-ai/moondream2", label: "Moondream2(極小)", category: "vision", tier: "budget", kind: "text",
    needs: "image", points: 1, cost: "≈$0.001/次", verified: true,
    strengths: "極小模型、極低成本",
    bestFor: "海量圖片粗略分類",
    sourceHint: "要理解的圖片",
    input: (p, _f, s) => ({ image_url: s, prompt: p || "Describe this image." }),
  },
  /* —— W2 全量擴充(fal生態研究):以下 vision 新增 —— */
  {
    id: "fal-ai/any-llm/vision#gemini-2.5-flash", endpoint: "fal-ai/any-llm/vision", label: "Gemini 2.5 Flash 視覺", category: "vision", tier: "economy", kind: "text",
    needs: "image", points: 1, cost: "$0.01/次", verified: false,
    strengths: "高性價比看圖;繁中描述自然、中文字辨識佳",
    bestFor: "素材庫批量看圖生繁中描述",
    sourceHint: "要理解的圖片",
    input: llmVisionInput("google/gemini-2.5-flash"),
  },
  {
    id: "fal-ai/got-ocr/v2", label: "GOT-OCR 2.0", category: "vision", tier: "economy", kind: "text",
    needs: "image", points: 1, cost: "官方單價未查得;量級≈每次數角新台幣", verified: false,
    strengths: "專用 OCR;中文/表格/公式/複雜版面遠勝 Florence-2",
    bestFor: "手稿、經文掃描、含表格文件轉文字",
    sourceHint: "含文字的圖片",
    input: (_p, _f, s) => ({ image_url: s }),
  },

  /* ═══ 7. 語音轉文字 speech-to-text ═══ */
  {
    // 目錄錯誤修正(fal生態研究 #9):Scribe 定價重查為 $0.008/分
    id: "fal-ai/elevenlabs/speech-to-text", label: "ElevenLabs Scribe", category: "speech-to-text", tier: "flagship", kind: "text",
    needs: "audio", points: 2, cost: "$0.008/分(約 $0.48/小時)", verified: true, recommended: true,
    strengths: "商用最準梯隊;自動分講者、97+ 語言;長錄音實際費用最低",
    bestFor: "開示錄音、多人座談逐字稿",
    sourceHint: "音訊檔網址(mp3/wav/m4a)",
    input: (_p, _f, s) => ({ audio_url: s, language_code: "zho" }),
  },
  {
    // 目錄錯誤修正(fal生態研究 #9):Whisper 按「運算秒」計費而非音訊秒
    id: "fal-ai/whisper", label: "Whisper large-v3", category: "speech-to-text", tier: "flagship", kind: "text",
    needs: "audio", points: 2, cost: "≈$0.0008/運算秒(非音訊長度);長錄音實際費用依運算時間,高於扣點", verified: true,
    strengths: "OpenAI 開源標竿;含時間戳、可分講者",
    bestFor: "帶時間軸的字幕稿",
    sourceHint: "音訊檔網址",
    input: (_p, _f, s) => ({ audio_url: s, task: "transcribe", language: "zh", chunk_level: "segment" }),
  },
  {
    id: "fal-ai/wizper", label: "Wizper(加速 v3)", category: "speech-to-text", tier: "flagship", kind: "text",
    needs: "audio", points: 1, cost: "≈$0.0008/運算秒(推定,官方未單列);長錄音實際費用遠高於扣點,長稿建議改用 Scribe", verified: true,
    strengths: "fal 自家加速版 Whisper v3;同級品質、數倍速度",
    bestFor: "長錄音快速出稿",
    sourceHint: "音訊檔網址",
    input: (_p, _f, s) => ({ audio_url: s, task: "transcribe", language: "zh" }),
  },
  {
    id: "fal-ai/whisper#translate", endpoint: "fal-ai/whisper", label: "Whisper 翻譯(→英)", category: "speech-to-text", tier: "economy", kind: "text",
    needs: "audio", points: 2, cost: "同 Whisper", verified: true,
    strengths: "轉錄同時翻成英文",
    bestFor: "國際版字幕初稿",
    sourceHint: "音訊檔網址",
    input: (_p, _f, s) => ({ audio_url: s, task: "translate" }),
  },
  {
    id: "fal-ai/whisper#chapters", endpoint: "fal-ai/whisper", label: "Whisper 長檔分段", category: "speech-to-text", tier: "economy", kind: "text",
    needs: "audio", points: 2, cost: "同 Whisper", verified: true,
    strengths: "長錄音自動分段落(word 級時間戳)",
    bestFor: "一小時以上開示的結構化整理",
    sourceHint: "音訊檔網址",
    input: (_p, _f, s) => ({ audio_url: s, task: "transcribe", language: "zh", chunk_level: "word" }),
  },
  {
    // 現值更新(W2 打磨):keyterms 為 Scribe v2 功能,端點改指 v2;價格依研究 #9 重查為 $0.008/分
    id: "fal-ai/elevenlabs/speech-to-text#keyterms", endpoint: "fal-ai/elevenlabs/speech-to-text/scribe-v2", label: "Scribe 關鍵詞強化", category: "speech-to-text", tier: "economy", kind: "text",
    needs: "audio", points: 2, cost: "$0.008/分(≈$0.48/小時)", verified: false,
    strengths: "提示專有名詞(佛學術語)提升辨識",
    bestFor: "術語密集的開示(提示詞欄填術語、逗號分隔)",
    sourceHint: "音訊檔網址",
    input: (p, _f, s) => ({ audio_url: s, language_code: "zho", keyterms: p ? p.split(/[,、，]/).map((t) => t.trim()).filter(Boolean) : undefined }),
  },
  {
    id: "fal-ai/wizper#draft", endpoint: "fal-ai/wizper", label: "Wizper 快速草稿", category: "speech-to-text", tier: "budget", kind: "text",
    needs: "audio", points: 1, cost: "≈$0.0008/運算秒(推定,官方未單列)", verified: true,
    strengths: "最快最省的初稿",
    bestFor: "先看內容再決定精修",
    sourceHint: "音訊檔網址",
    input: (_p, _f, s) => ({ audio_url: s, task: "transcribe" }),
  },
  /* —— W2 全量擴充(fal生態研究):以下 speech-to-text 新增 —— */
  {
    id: "fal-ai/elevenlabs/speech-to-text/scribe-v2", label: "ElevenLabs Scribe v2", category: "speech-to-text", tier: "flagship", kind: "text",
    needs: "audio", points: 2, cost: "$0.008/分(≈$0.48/小時)", verified: false,
    strengths: "最新旗艦逐字稿;比 v1 便宜近四倍、32 人講者分離",
    bestFor: "開示逐字稿最上游首選、法會座談",
    sourceHint: "音訊檔網址(mp3/wav/m4a)",
    input: (_p, _f, s) => ({ audio_url: s, language_code: "zho" }),
  },
  {
    id: "fal-ai/speech-to-text", label: "fal 原生轉錄", category: "speech-to-text", tier: "economy", kind: "text",
    needs: "audio", points: 2, cost: "$0.0008/音訊秒($0.048/分);長錄音實際費用高於扣點", verified: false,
    strengths: "Whisper v3 基底;按音訊長度計費、成本可預估",
    bestFor: "批量轉錄、成本透明的報價",
    sourceHint: "音訊檔網址(mp3/wav/m4a)",
    input: (_p, _f, s) => ({ audio_url: s }),
  },
  {
    id: "fal-ai/speech-to-text/turbo", label: "fal 原生轉錄 Turbo", category: "speech-to-text", tier: "economy", kind: "text",
    needs: "audio", points: 2, cost: "$0.0008/音訊秒(同價、快 8 倍);長錄音實際費用高於扣點", verified: false,
    strengths: "解碼快 8 倍、價格相同;先全部出稿看內容",
    bestFor: "海量開示快速草稿(正式稿升 Scribe)",
    sourceHint: "音訊檔網址(mp3/wav/m4a)",
    input: (_p, _f, s) => ({ audio_url: s }),
  },
  {
    // 串流端點走 queue 模式是否可用待首跑確認;失敗自動退點
    id: "fal-ai/speech-to-text/stream", label: "fal 即時串流轉錄", category: "speech-to-text", tier: "economy", kind: "text",
    needs: "audio", points: 2, cost: "$0.0008/音訊秒;長錄音實際費用高於扣點", verified: false,
    strengths: "邊講邊出字的即時轉錄;fal STT 唯一即時選項",
    bestFor: "直播開示、法會現場輔助字幕",
    sourceHint: "音訊檔網址(mp3/wav/m4a)",
    input: (_p, _f, s) => ({ audio_url: s }),
  },

  /* ═══ 8. 文字轉語音 text-to-speech ═══ */
  {
    id: "fal-ai/elevenlabs/tts/eleven-v3", label: "ElevenLabs v3", category: "text-to-speech", tier: "flagship", kind: "audio",
    points: 3, cost: "$0.10/千字", verified: true,
    strengths: "情感表現力當前最強;70+ 語言含中文、可標註語氣",
    bestFor: "正式旁白、情感朗讀(見證故事)",
    input: (p) => ({ text: p }),
  },
  {
    id: "fal-ai/minimax/speech-02-hd", label: "MiniMax Speech 02 HD", category: "text-to-speech", tier: "flagship", kind: "audio",
    points: 3, cost: "$0.10/千字", verified: false,
    strengths: "中文語音頂級自然度;聲線豐富",
    bestFor: "中文旁白主力、長篇朗讀",
    input: (p) => ({ text: p }),
  },
  {
    id: "fal-ai/elevenlabs/tts/multilingual-v2", label: "ElevenLabs Multilingual v2", category: "text-to-speech", tier: "flagship", kind: "audio",
    points: 3, cost: "$0.10/千字", verified: true,
    strengths: "穩定成熟的多語旗艦;29 語",
    bestFor: "多語版本影片配音",
    input: (p) => ({ text: p }),
  },
  {
    id: "fal-ai/elevenlabs/tts/turbo-v2.5", label: "ElevenLabs Turbo 2.5", category: "text-to-speech", tier: "economy", kind: "audio",
    points: 2, cost: "$0.05/千字", verified: true, recommended: true,
    strengths: "半價+低延遲;品質仍佳",
    bestFor: "日常影片旁白",
    input: (p) => ({ text: p }),
  },
  {
    // 檔位修正(W2 打磨):研究表列旗艦(產品建議 #3 的「經濟主力」指性價比,非檔位)
    id: "fal-ai/qwen-3-tts/text-to-speech/1.7b", label: "Qwen 3 TTS(中文)", category: "text-to-speech", tier: "flagship", kind: "audio",
    points: 3, cost: "$0.09/千字", verified: false,
    strengths: "阿里通義原生中文 TTS;韻律與句讀像真人,中文第一梯隊、比 MiniMax 更省",
    bestFor: "中文旁白日更量產、金句語音、見證旁白",
    // 審計 L2：同 0.6b 需 voice 或 embedding
    input: (p) => ({ text: p, voice: "Vivian", language: "Chinese" }),
  },
  {
    id: "fal-ai/dia-tts", label: "Dia 對話語音", category: "text-to-speech", tier: "economy", kind: "audio",
    points: 2, cost: "$0.04/千字", verified: false,
    strengths: "多角色對話生成(含笑聲、停頓等非語言聲)",
    bestFor: "情境短劇、雙人對談",
    input: (p) => ({ text: p }),
  },
  {
    // 審計 L2：英文-only 端點拒非 ASCII；站內中文稿走 multilingual 子路徑
    id: "fal-ai/chatterbox/text-to-speech",
    endpoint: "fal-ai/chatterbox/text-to-speech/multilingual",
    label: "Chatterbox", category: "text-to-speech", tier: "economy", kind: "audio",
    points: 1, cost: "$0.025/千字", verified: false,
    strengths: "開源;情感強度可調;多語(含中文)走 multilingual 端點",
    bestFor: "預算型旁白",
    input: (p) => ({ text: p }),
  },
  {
    id: "fal-ai/kokoro/mandarin-chinese", label: "Kokoro 中文", category: "text-to-speech", tier: "budget", kind: "audio",
    points: 1, cost: "$0.02/千字", verified: true,
    strengths: "極低成本中文語音;82M 小模型、速度快",
    bestFor: "草稿配音、內部預覽",
    input: (p) => ({ prompt: p, voice: "zf_xiaoxiao" }),
  },
  /* —— W2 全量擴充(fal生態研究):以下 text-to-speech 新增(含克隆/多講者) —— */
  {
    // 審計 #216：OpenAPI required=`prompt`（非 02-hd 的 `text`）；output_format 預設 hex → 站內 extractResult 需 url
    id: "fal-ai/minimax/speech-2.6-hd", label: "MiniMax Speech 2.6 HD", category: "text-to-speech", tier: "flagship", kind: "audio",
    points: 3, cost: "推估同 02 HD 約 $0.10/千字", verified: false,
    strengths: "MiniMax 最新旗艦;情感/停頓/語氣控制最完整,300+ 聲線",
    bestFor: "見證故事、開示重配的中文旁白首選",
    input: (p) => ({ prompt: p, output_format: "url" }),
  },
  {
    id: "fal-ai/qwen-3-tts/text-to-speech/0.6b", label: "Qwen 3 TTS(輕量)", category: "text-to-speech", tier: "economy", kind: "audio",
    points: 2, cost: "$0.07/千字", verified: false,
    strengths: "Qwen3 輕量版;更快更省,中文仍遠勝傳統合成音",
    bestFor: "草稿旁白、社群短影音口白",
    // 審計 L2：OpenAPI 需 voice 或 speaker_voice_embedding_file_url（缺則 422）
    input: (p) => ({ text: p, voice: "Vivian", language: "Chinese" }),
  },
  {
    // 審計 #218：OpenAPI required=`audio_url`+`prompt`（非 text）；零樣本音色來自參考音；缺任一必填 → 422
    id: "fal-ai/index-tts-2/text-to-speech", label: "Index TTS 2.0(中文可控)", category: "text-to-speech", tier: "flagship", kind: "audio",
    needs: "audio", points: 1, cost: "$0.002/秒(≈$0.12/分),按秒計費", verified: false,
    strengths: "拼音校正破音字+精準時長控制;WER 最低、咬字最準",
    bestFor: "影片對嘴配音、佛學術語密集稿",
    sourceHint: "參考聲線樣音網址(mp3/wav; zero-shot 音色)",
    input: (p, _f, s) => ({ prompt: p, audio_url: s }),
  },
  {
    id: "fal-ai/minimax/voice-clone", label: "MiniMax 語音克隆", category: "text-to-speech", tier: "flagship", kind: "audio",
    needs: "audio", points: 47, cost: "克隆 $1.50/次+預覽音 $0.30/千字;克隆後 7 天內需用一次 TTS 以永久保留", verified: false,
    strengths: "10 秒樣音複製中文聲線;承襲 MiniMax 旗艦品質",
    bestFor: "建立會方專屬旁白聲線",
    sourceHint: "10 秒以上樣音網址(mp3/wav)",
    input: (p, _f, s) => ({ audio_url: s, text: p }),
  },
  {
    // 審計 B9：OpenAPI required 僅 audio_url；output=speaker_embedding（safetensors）非 audio
    // ⚠ 非端到端 TTS：樣音→embedding，需另接 qwen-3-tts/text-to-speech/* 才出音；verified 勿開
    id: "fal-ai/qwen-3-tts/clone-voice/1.7b", label: "Qwen 3 語音克隆", category: "text-to-speech", tier: "economy", kind: "audio",
    needs: "audio", points: 1, cost: "$0.0008/分(參考樣音長度；上限5分；產出 embedding 非音檔)", verified: false,
    strengths: "⚠非端到端TTS：樣音→speaker embedding(safetensors)，需再接 Qwen TTS；非一次出克隆旁白",
    bestFor: "低成本註冊聲線 embedding（再另步合成旁白）",
    sourceHint: "參考樣音網址(mp3/wav；建議≤5分乾淨人聲)",
    // OpenAPI: audio_url required；optional reference_text（樣音逐字稿，非旁白）— 不送幽靈 text
    input: (p, _f, s) => {
      const body: Record<string, string> = { audio_url: s! };
      const ref = (p ?? "").trim();
      if (ref) body.reference_text = ref;
      return body;
    },
  },
  {
    // 審計 #221：OpenAPI required=`prompt`+`preview_text`；官方 $3/次+預覽字費；points 3 嚴重低估→回寫佇列 93
    id: "fal-ai/minimax/voice-design", label: "MiniMax 聲音設計", category: "text-to-speech", tier: "flagship", kind: "audio",
    // 審計 B9：$3/次×31≈93；原 points=3 嚴重低估
    points: 93, cost: "$3/次+預覽$0.03/千字", verified: false,
    strengths: "文字描述訂做全新聲線(如溫暖沉穩中年男聲)",
    bestFor: "不克隆真人的專屬旁白聲、規避授權",
    // preview_text 為必填試念句；主欄 prompt 為聲線描述
    input: (p) => ({
      prompt: p,
      preview_text: "阿彌陀佛。願以此功德，普及於一切。",
    }),
  },
  {
    // 審計 #222：OpenAPI required=`gen_text`+`ref_audio_url`+`model_type`（enum F5-TTS|E2-TTS，無 default）
    // 缺 model_type → 422；輸出 audio_url 為 AudioFile 物件（見 fal.extractResult）
    id: "fal-ai/f5-tts", label: "F5-TTS(克隆)", category: "text-to-speech", tier: "economy", kind: "audio",
    needs: "audio", points: 2, cost: "$0.05/千字", verified: false,
    strengths: "參考音克隆式 TTS;中英雙語、可商用、便宜",
    bestFor: "預算型克隆旁白、英文為主稿件",
    sourceHint: "參考樣音網址(mp3/wav)",
    input: (p, _f, s) => ({ gen_text: p, ref_audio_url: s, model_type: "F5-TTS" }),
  },
  {
    // 審計 #223：OpenAPI required=`script`+`speakers`（非 text/prompt）；缺 speakers → 422
    // speakers[] 每槽 preset 或 audio_url；官方 example 雙人 Frank/Carter；站內預設雙中文聲
    // script 建議 "Speaker N:" 前綴（N 自 0）；至多 4 講者
    id: "fal-ai/vibevoice", label: "VibeVoice 多講者", category: "text-to-speech", tier: "economy", kind: "audio",
    points: 1, cost: "$0.04/分鐘(四捨五入到 15 秒)", verified: false,
    strengths: "微軟原生多講者(至 4 人)長對話;按分鐘計超省",
    bestFor: "對談短劇、Podcast 式開示問答",
    // 審計 L2：speakers 數須對齊 script 的 Speaker N；單句預設 1 講者（雙人請在稿內用 Speaker 0/1:）
    input: (p) => {
      const multi = /Speaker\s*\d+\s*:/i.test(p);
      const script = multi ? p : `Speaker 0: ${p}`;
      const speakers = multi
        ? [{ preset: "Bowen [ZH]" as const }, { preset: "Xinran [ZH]" as const }]
        : [{ preset: "Bowen [ZH]" as const }];
      return { script, speakers };
    },
  },
  {
    // 端點推定(fal生態研究 🔸):/7b 子路徑與價格未親驗
    id: "fal-ai/vibevoice/7b", label: "VibeVoice 7B(多講者)", category: "text-to-speech", tier: "economy", kind: "audio",
    points: 2, cost: "推估高於 1.5B(按分鐘)", verified: false,
    strengths: "VibeVoice 高品質版;多人對談更自然",
    bestFor: "正式對外的多人敘事音訊",
    // 同 vibevoice：required speakers
    input: (p) => ({ script: p, speakers: [{ preset: "Bowen [ZH]" }] }),
  },
  {
    // 審計 L2：OpenAPI 僅列 text，但 live 422 要求 ref_audio_url + ref_text → 標 needs=audio
    id: "fal-ai/dia-tts/voice-clone", label: "Dia 語音克隆", category: "text-to-speech", tier: "economy", kind: "audio",
    needs: "audio", points: 2, cost: "≈同 Dia $0.04/千字", verified: false,
    strengths: "需樣音；live 要求 ref_audio_url+ref_text（OpenAPI 文件可能滯後）;英文情境為主",
    bestFor: "有參考樣音的英文對話 TTS",
    sourceHint: "參考樣音網址（mp3/wav）與對應 ref_text",
    input: (p, _f, s) => ({ text: p, ref_audio_url: s, ref_text: p }),
  },
  {
    id: "fal-ai/elevenlabs/text-to-dialogue/eleven-v3", label: "ElevenLabs v3 多人對話", category: "text-to-speech", tier: "flagship", kind: "audio",
    points: 3, cost: "按字計費", verified: false,
    strengths: "情感化多人對話、角色聲線與非語言提示控制",
    bestFor: "兩人對談、訪談式見證、Podcast",
    input: (p) => ({
      inputs: (p.split(/\r?\n+/).map((text) => text.trim()).filter(Boolean).length
        ? p.split(/\r?\n+/).map((text) => text.trim()).filter(Boolean)
        : [p]
      ).map((text, index) => ({ text, voice: index % 2 === 0 ? "Aria" : "Charlotte" })),
    }),
  },
  {
    id: "fal-ai/gemini-tts", label: "Gemini TTS", category: "text-to-speech", tier: "economy", kind: "audio",
    points: 2, cost: "依 Gemini TTS 用量", verified: false,
    strengths: "多語、自然語言控制語氣/速度/口音;支援多人聲",
    bestFor: "中文旁白、快速批次生成、主持人對談",
    input: (p) => ({ prompt: p, language_code: "Chinese Mandarin (Taiwan)", output_format: "mp3" }),
  },
  {
    id: "fal-ai/zonos", label: "Zonos 語音克隆", category: "text-to-speech", tier: "economy", kind: "audio",
    needs: "audio", points: 1, cost: "按字/秒計費(fal 頁未明列)", verified: false,
    strengths: "開源克隆任意人聲;支援 mp3/wav/m4a 多格式",
    bestFor: "低成本克隆試驗(中文中等)",
    sourceHint: "參考樣音網址(mp3/wav/m4a)",
    input: (p, _f, s) => ({ prompt: p, reference_audio_url: s }),
  },
  {
    id: "fal-ai/orpheus-tts", label: "Orpheus(英文)", category: "text-to-speech", tier: "economy", kind: "audio",
    points: 1, cost: "按字計費(fal 頁未明列)", verified: false,
    strengths: "Llama 基底高表現力開源 TTS;支援情感標記",
    bestFor: "英文旁白、國際版內容",
    input: (p) => ({ text: p }),
  },

  /* ═══ 9. 文字轉音頻(音樂/音效) text-to-audio ═══ */
  {
    id: "fal-ai/lyria2", label: "Lyria 2(Google)", category: "text-to-audio", tier: "flagship", kind: "audio",
    points: 3, cost: "$0.10/30秒", verified: true,
    // 審計 L2：prompt 僅接受英文（中文 422 Unsupported language）
    strengths: "48kHz 錄音室級音質;器樂氛圍最佳;⚠僅英文提示詞",
    bestFor: "英文描述的禪修背景樂、片頭配樂（中文請改 MiniMax / Stable Audio）",
    input: (p) => ({ prompt: p }),
  },
  {
    // 現值更新(W2 打磨):研究表為 約$0.80/分(≈25點/分);原 $0.15 下限查無佐證,偏低 -39 校準到位
    id: "fal-ai/elevenlabs/music", label: "ElevenLabs Music", category: "text-to-audio", tier: "flagship", kind: "audio",
    points: 74, cost: "約 $0.80/分(近期降價中,以 fal 現場為準);點數以 3 分鐘估,較長樂曲實際費用更高", verified: false,
    strengths: "授權資料訓練(版權安全);結構化歌曲",
    bestFor: "對外發布影片的配樂(版權安心)",
    input: (p) => ({ prompt: p }),
  },
  {
    id: "fal-ai/stable-audio-25/text-to-audio", label: "Stable Audio 2.5", category: "text-to-audio", tier: "flagship", kind: "audio",
    points: 6, cost: "$0.20/次", verified: false,
    strengths: "長度與參數控制精細;音樂+音效兼修",
    bestFor: "指定長度的配樂段落",
    input: (p) => ({ prompt: p, seconds_total: 30 }),
  },
  {
    // 審計 #233：OpenAPI MinimaxMusicInput required=["prompt","reference_audio_url"]（參考曲>15s wav/mp3）
    // 原僅送 prompt → 必 422；純文生曲請用 minimax-music/v2.6（#237，required 僅 prompt）
    id: "fal-ai/minimax-music", label: "MiniMax Music", category: "text-to-audio", tier: "economy", kind: "audio",
    needs: "audio", points: 1, cost: "$0.03/首", verified: false, recommended: true,
    strengths: "參考曲風格遷移的完整歌曲(可含人聲);需>15s 樣曲",
    bestFor: "有參考曲的主題曲 demo、風格遷移配樂",
    sourceHint: "參考歌曲網址(.wav/.mp3，須長於 15 秒，含音樂與人聲)",
    input: (p, _f, s) => ({ prompt: p, reference_audio_url: s }),
  },
  {
    id: "fal-ai/elevenlabs/sound-effects/v2", label: "ElevenLabs 音效 v2", category: "text-to-audio", tier: "economy", kind: "audio",
    points: 1, cost: "≈$0.01/次", verified: true,
    strengths: "描述即得音效(鐘聲、翻書、腳步)",
    bestFor: "剪輯用單發音效",
    input: (p) => ({ text: p }),
  },
  {
    id: "cassetteai/sound-effects-generator", label: "Cassette 音效", category: "text-to-audio", tier: "economy", kind: "audio",
    points: 1, cost: "≈$0.005/次", verified: true,
    strengths: "1 秒生成 30 秒內音效",
    bestFor: "批量音效試做",
    input: (p) => ({ prompt: p, duration: 10 }),
  },
  {
    // 審計 #236：OpenAPI AceStepInput required=["tags"]（描述可寫 comma genre tags；說明亦接受 prompt 別名）
    // 站內改送 tags 對齊 schema，避免缺 required 422；duration 等用官方預設 60s
    id: "fal-ai/ace-step", label: "ACE-Step(開源)", category: "text-to-audio", tier: "budget", kind: "audio",
    points: 1, cost: "$0.0002/秒(另有 $0.005/秒 來源,以首帳單為準)", verified: true,
    strengths: "全站最低成本音樂生成",
    bestFor: "氛圍底噪、練習用",
    input: (p) => ({ tags: p }),
  },
  /* —— W2 全量擴充(fal生態研究):以下 text-to-audio 新增(MusicGen 因非商用授權不收,產品建議 #12) —— */
  {
    // 端點推定(fal生態研究 🔸):/v2.6 子路徑與價格未親驗
    id: "fal-ai/minimax-music/v2.6", label: "MiniMax Music 2.6", category: "text-to-audio", tier: "flagship", kind: "audio",
    points: 5, cost: "約 $0.15/次(推定)", verified: false,
    strengths: "完整演唱歌曲;風格描述 10–2000 字、可自動填詞、可切純器樂",
    bestFor: "高品質中文主題曲、片尾曲",
    // 審計 L2：OpenAPI prompt minLength=10；空 lyrics 字串易 422 → 預設器樂、不送空 lyrics
    input: (p) => {
      const prompt = p.trim().length >= 10 ? p.trim() : `${p.trim()}, soft warm piano, slow tempo, ambient`;
      return { prompt, is_instrumental: true };
    },
  },
  {
    // 端點推定(fal生態研究 🔸):/v2 子路徑未親驗(另有 /v2.5)
    id: "fal-ai/minimax-music/v2", label: "MiniMax Music v2", category: "text-to-audio", tier: "economy", kind: "audio",
    points: 1, cost: "約 $0.03/次(推定)", verified: false,
    strengths: "風格+歌詞雙輸入、可開器樂模式;44.1kHz",
    bestFor: "精準指定曲風的中文演唱",
    // 審計 L2：OpenAPI required prompt + lyrics_prompt
    input: (p) => ({ prompt: p, lyrics_prompt: p }),
  },
  {
    id: "sonilo/v1.1/text-to-music", label: "Sonilo V1.1 商用配樂", category: "text-to-audio", tier: "economy", kind: "audio",
    points: 7, cost: "$0.0025/秒(預設 90 秒≈$0.225)", verified: false,
    strengths: "商用授權安全、精準時長、單一提示詞即可生成完整配樂",
    bestFor: "活動影片、Podcast、短片背景配樂",
    input: (p) => ({ prompt: p, duration: 90, num_samples: 1 }),
  },
  {
    id: "fal-ai/diffrhythm", label: "DiffRhythm(歌詞轉歌)", category: "text-to-audio", tier: "budget", kind: "audio",
    points: 1, cost: "$0.01/10秒(≈$0.001/秒)", verified: false,
    strengths: "中文歌詞+逐行時間戳;30 秒內生成、最長 285 秒",
    bestFor: "金句 MV 對字幕/對嘴、多版嘗試",
    input: (p) => ({ prompt: p }),
  },
  {
    // 端點推定(fal生態研究 🔸):cassetteai music-generator 未親驗
    id: "cassetteai/music-generator", label: "Cassette 音樂", category: "text-to-audio", tier: "budget", kind: "audio",
    points: 1, cost: "$0.02/輸出分鐘(推定)", verified: false,
    strengths: "極快極便宜的純器樂;一次生十版讓組員挑",
    bestFor: "批量候選背景樂、短片墊底樂",
    input: (p) => ({ prompt: p, duration: 60 }),
  },
  {
    id: "fal-ai/mmaudio-v2", label: "MMAudio V2(影片配音)", category: "text-to-audio", tier: "budget", kind: "audio",
    needs: "video", points: 1, cost: "$0.001/秒", verified: false,
    strengths: "分析畫面自動生成對時音效/環境音/Foley",
    bestFor: "無聲 AI 影片補同步環境音",
    sourceHint: "要配音的影片網址(mp4)",
    input: (p, _f, s) => ({ video_url: s, prompt: p }),
  },
  {
    id: "fal-ai/mmaudio-v2/text-to-audio", label: "MMAudio V2 文字轉音", category: "text-to-audio", tier: "budget", kind: "audio",
    points: 1, cost: "$0.001/秒", verified: false,
    strengths: "MMAudio 純文字版;描述即得環境音/音效",
    bestFor: "低成本環境音床、Foley 試做",
    input: (p) => ({ prompt: p }),
  },
  {
    // 價格推定(fal生態研究 🔸):$0.05/秒未親驗,整首成本偏高
    id: "fal-ai/yue", label: "YuE(開源演唱)", category: "text-to-audio", tier: "economy", kind: "audio",
    points: 8, cost: "$0.05/秒(推定);整首實際費用可能高於扣點,審慎使用", verified: false,
    strengths: "開源歌詞轉歌;中英雙語演唱、結構完整但較慢",
    bestFor: "開源可控的中文主題曲備援",
    input: (p) => ({ prompt: p }),
  },
  {
    // 端點推定(fal生態研究 🔸):stable-audio 開源版價格未明列
    id: "fal-ai/stable-audio", label: "Stable Audio Open(開源)", category: "text-to-audio", tier: "budget", kind: "audio",
    points: 1, cost: "低(開源版,品質低於 2.5)", verified: false,
    strengths: "開源版文字轉音頻;音效/短氛圍為主",
    bestFor: "內部音效試做(正式升 2.5)",
    input: (p) => ({ prompt: p }),
  },
  {
    // 影生音效:輸入影片、輸出音訊;與 MMAudio 同掛本類(無 video-to-audio 類別)
    id: "fal-ai/thinksound", label: "ThinkSound 影生音效", category: "text-to-audio", tier: "economy", kind: "audio",
    needs: "video", points: 2, cost: "官方價未查到(同型約 $0.05/次)", verified: false,
    strengths: "帶推理的影生音效;可用提示詞引導要什麼聲音",
    bestFor: "指定「只要木魚聲與誦經迴響」式的音效方向",
    sourceHint: "要配音效的影片網址",
    input: (p, _f, s) => ({ prompt: p, video_url: s }),
  },
  {
    // 影生音效:輸入影片、輸出音訊
    id: "fal-ai/hunyuan-video-foley", label: "混元 Foley 影生音效", category: "text-to-audio", tier: "flagship", kind: "audio",
    needs: "video", points: 2, cost: "$0.01/秒;按秒計費,點數為 6 秒基準", verified: false,
    strengths: "騰訊高保真 Foley;動作與聲音對位準,評測勝同類",
    bestFor: "正式成品音效層:倒水、開門、腳步擬音",
    sourceHint: "要擬音的影片網址",
    // 審計：OpenAPI required video_url + text_prompt（非 prompt）
    input: (p, _f, s) => ({ text_prompt: p, video_url: s }),
  },

  /* ═══ 10. 訓練 training(LoRA;來源=素材 zip 網址,提示詞=觸發詞) ═══ */
  {
    // 現值更新(W2 打磨):研究表明言「目錄現標 $6.4/千步已過時」,實為 $0.008/步
    id: "fal-ai/flux-2-trainer", label: "FLUX.2 訓練器", category: "training", tier: "flagship", kind: "text",
    needs: "zip", points: 248, cost: "$8/千步(V2 版 $5/千步)", verified: true,
    strengths: "最新 FLUX.2 基底;風格/人物/主題客製",
    bestFor: "打造「本會專屬視覺風格」模型",
    sourceHint: "訓練圖包 zip 網址(10–30 張圖)",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    id: "fal-ai/flux-2-trainer/edit", label: "FLUX.2 編輯訓練器", category: "training", tier: "flagship", kind: "text",
    needs: "zip", points: 230, cost: "$0.009/步", verified: true,
    strengths: "訓練「編輯行為」(前後對圖);客製修圖模型",
    bestFor: "固定修圖流程自動化",
    sourceHint: "前後對照圖包 zip 網址",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "EDIT" }),
  },
  {
    // 現值更新(W2 打磨):研究表明言「目錄現標 $4 已過時」,實為 $2.5/千步
    id: "fal-ai/flux-kontext-trainer", label: "Kontext 訓練器", category: "training", tier: "flagship", kind: "text",
    needs: "zip", points: 78, cost: "$2.5/千步(最低 500 步 $1.25)", verified: true,
    strengths: "Kontext 基底;角色一致性微調",
    bestFor: "固定講者/吉祥物的一致形象",
    sourceHint: "角色圖包 zip 網址",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "CHAR" }),
  },
  {
    id: "fal-ai/flux-lora-portrait-trainer", label: "人像 LoRA 訓練器", category: "training", tier: "economy", kind: "text",
    needs: "zip", points: 80, cost: "$0.0024/步(千步起)", verified: true,
    strengths: "人像特化;少量照片即可",
    bestFor: "特定人物的莊嚴人像風",
    sourceHint: "人像圖包 zip 網址",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "PERSON" }),
  },
  {
    id: "fal-ai/qwen-image-trainer", label: "Qwen Image 訓練器(中文)", category: "training", tier: "economy", kind: "text",
    needs: "zip", points: 62, cost: "$0.002/步(千步≈$2,最低 250 步)", verified: false,
    strengths: "在中文字渲染最強的開源底模上訓練風格/人物 LoRA;唯一「自家風格+中文不錯字」兼得的路線",
    bestFor: "本會專屬風格的中文金句卡/海報/字卡",
    sourceHint: "訓練圖包 zip 網址(10–30 張圖)",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    id: "fal-ai/turbo-flux-trainer", label: "Turbo FLUX 訓練器", category: "training", tier: "economy", kind: "text",
    needs: "zip", points: 80, cost: "$2.4/千步", verified: true,
    strengths: "訓練速度快、費用可控",
    bestFor: "快速迭代風格試驗",
    sourceHint: "訓練圖包 zip 網址",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    id: "fal-ai/flux-krea-trainer", label: "Krea 訓練器", category: "training", tier: "economy", kind: "text",
    needs: "zip", points: 62, cost: "$2/次", verified: true,
    strengths: "美感取向的 Krea 基底",
    bestFor: "唯美系視覺風格",
    sourceHint: "訓練圖包 zip 網址",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    id: "fal-ai/flux-lora-fast-training", label: "FLUX LoRA 快速訓練", category: "training", tier: "budget", kind: "text",
    needs: "zip", points: 62, cost: "≈$2/次", verified: true, recommended: true,
    strengths: "經典入門訓練器;幾分鐘出模型",
    bestFor: "第一次嘗試訓練",
    sourceHint: "訓練圖包 zip 網址",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  /* ── W2 全量擴充:訓練(fal生態研究 §540–576) ── */
  {
    id: "fal-ai/krea-2-trainer", label: "Krea 2 訓練器", category: "training", tier: "economy", kind: "text",
    needs: "zip", points: 93, cost: "$0.003/步(最低 100 步;千步≈$3)", verified: false,
    strengths: "新一代 Krea 2 底模 LoRA;美感系升級版",
    bestFor: "療癒風主力底模升級後的風格 LoRA",
    sourceHint: "訓練圖包 zip 網址(10–30 張圖)",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    id: "fal-ai/flux-2-klein-9b-base-trainer", label: "FLUX.2 klein 9B 訓練器", category: "training", tier: "economy", kind: "text",
    needs: "zip", points: 133, cost: "$0.0043/步(千步≈$4.3)", verified: false,
    strengths: "FLUX.2 小型化底模 LoRA;訓練與生成都更便宜快速",
    bestFor: "金句卡日更等高頻量產線的風格 LoRA",
    sourceHint: "訓練圖包 zip 網址(10–30 張圖)",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    id: "fal-ai/qwen-image-2512-trainer", label: "Qwen 2512 訓練器(中文)", category: "training", tier: "budget", kind: "text",
    needs: "zip", points: 47, cost: "$0.0015/步(千步≈$1.5;V2 版 $0.95/千步)", verified: false,
    strengths: "新版 Qwen 底模 LoRA;全站最便宜正式風格訓練之一",
    bestFor: "季度視覺主題 LoRA;中文字最強路線",
    sourceHint: "訓練圖包 zip 網址(10–30 張圖)",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    id: "fal-ai/qwen-image-edit-trainer", label: "Qwen 編輯訓練器(中文)", category: "training", tier: "economy", kind: "text",
    needs: "zip", points: 124, cost: "$4/千步(最低 100 步=$0.4)", verified: false,
    strengths: "訓練 Qwen 編輯 LoRA;中文語境的固定修圖行為",
    bestFor: "照片→本會風格成品的中文系修圖模型",
    sourceHint: "前後對照圖包 zip 網址",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "EDIT" }),
  },
  {
    id: "fal-ai/z-image-trainer", label: "Z-Image 訓練器(試水溫)", category: "training", tier: "budget", kind: "text",
    needs: "zip", points: 70, cost: "$2.26/千步(最低 100 步=$0.226)", verified: false,
    strengths: "通義 Z-Image Turbo 上訓練;最低 100 步約 7 點",
    bestFor: "先驗證素材包能否練出風格再上正式訓練",
    sourceHint: "訓練圖包 zip 網址",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    id: "fal-ai/wan-22-image-trainer", label: "Wan 2.2 圖像訓練器", category: "training", tier: "economy", kind: "text",
    needs: "zip", points: 140, cost: "$0.0045/步(千步≈$4.5)", verified: false,
    strengths: "Wan 2.2 文生圖 LoRA;圖影同底模、風格可通用",
    bestFor: "「圖卡+影片」系列視覺完全統一",
    sourceHint: "訓練圖包 zip 網址(10–30 張圖)",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    id: "fal-ai/wan-22-trainer/t2v-a14b", label: "Wan 2.2 文生影訓練器", category: "training", tier: "flagship", kind: "text",
    needs: "zip", points: 124, cost: "$0.004/步(千步≈$4)", verified: false,
    strengths: "影片模型 LoRA(文生影);角色/風格一致影片終極解",
    bestFor: "吉祥物、本會影像質感練進影片模型",
    sourceHint: "訓練包 zip(15–30 支短片或圖,附 .txt 描述,只能全影片或全圖)",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    id: "fal-ai/wan-22-trainer/i2v-a14b", label: "Wan 2.2 圖生影訓練器", category: "training", tier: "flagship", kind: "text",
    needs: "zip", points: 155, cost: "$0.005/步(千步≈$5)", verified: false,
    strengths: "圖生影方向 LoRA;把固定動態/運鏡風格練成模型",
    bestFor: "老照片動起來的統一莊嚴節奏",
    sourceHint: "訓練包 zip(短片或圖+.txt 描述)",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    // 價格為第三方整理推定(🔸);僅沿用 Wan 2.1 舊工作流時需要
    id: "fal-ai/wan-trainer", label: "Wan 2.1 訓練器(舊代)", category: "training", tier: "economy", kind: "text",
    needs: "zip", points: 155, cost: "$0.005/步(第三方整理,官方未查到)", verified: false,
    strengths: "上一代 Wan 2.1 LoRA;圖+影混合素材可收",
    bestFor: "沿用 Wan 2.1 舊工作流;新專案用 2.2 系",
    sourceHint: "訓練包 zip(圖+短片可混)",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    id: "fal-ai/hunyuan-video-lora-training", label: "混元影片 LoRA 訓練", category: "training", tier: "economy", kind: "text",
    needs: "zip", points: 155, cost: "$5/次(1000 步基準,隨步數線性)", verified: false,
    strengths: "最少 4 張圖教會影片模型一個人物/物件;自動生成描述",
    bestFor: "門檻最低的影片人物 LoRA 驗證",
    sourceHint: "人物/物件圖包 zip(最少 4 張,越多越好)",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "CHAR" }),
  },
  {
    id: "fal-ai/ltx2-video-trainer", label: "LTX-2 影片訓練器", category: "training", tier: "flagship", kind: "text",
    needs: "zip", points: 298, cost: "$0.0048/步(預設 2000 步≈$9.6)", verified: false,
    strengths: "LTX-2 影片 LoRA;長片自動按場景切成訓練樣本",
    bestFor: "用歷年活動影音資產練出本會影像風",
    sourceHint: "訓練包 zip(15–30 個媒體檔,長片可收)",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
];

/* ═══ 11. 工作流 workflow(站內串鏈,逐步執行、各步各自扣點) ═══ */
export interface WorkflowStep {
  modelId: string;
  /** 步驟提示詞模板;{prompt}=使用者輸入、{prev}=上一步結果(文字則貼入、媒體則作為來源) */
  promptTemplate: string;
  /** 上一步結果作為此步的來源輸入 */
  usePrevAsSource?: boolean;
  note: string;
}
export interface WorkflowPreset {
  id: string;
  label: string;
  tier: ModelTier;
  points: number; // 各步合計(模組載入時由檔尾迴圈依 steps 自動加總覆寫,勿手填;字面值僅供閱讀)
  strengths: string;
  bestFor: string;
  steps: WorkflowStep[];
}

export const WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    id: "wf/full-short-flagship", label: "完整短片(旗艦)", tier: "flagship", points: 39,
    strengths: "LLM 潤飾腳本 → 旗艦文生圖定調 → Veo 3.1 成片;三步到位",
    bestFor: "正式對外的 15 秒形象短片",
    steps: [
      { modelId: "nvidia-nim#llama-3.1-405b", promptTemplate: "把以下構想潤飾成一段 40 字內的影片畫面描述(供文生影片模型使用,繁體中文):{prompt}", note: "腳本潤飾" },
      { modelId: "fal-ai/bytedance/seedream/v4.5/text-to-image", promptTemplate: "{prev}", note: "先出定調圖" },
      { modelId: "fal-ai/veo3.1", promptTemplate: "{prev}", note: "生成成片鏡頭" },
    ],
  },
  {
    id: "wf/brand-storyboard-flagship", label: "品牌繪本(旗艦)", tier: "flagship", points: 6,
    strengths: "LLM 出分鏡文案 → 旗艦出圖 → 編輯統一風格",
    bestFor: "系列感的三格分鏡圖",
    steps: [
      { modelId: "nvidia-nim#llama-3.1-405b", promptTemplate: "把主題「{prompt}」化為一句電影感畫面描述(40 字內,繁體中文)", note: "分鏡文案" },
      { modelId: "fal-ai/nano-banana-2", promptTemplate: "{prev}", note: "生成主圖" },
      { modelId: "fal-ai/nano-banana-2/edit", promptTemplate: "保持構圖不變,將整體色調調整為溫暖的琥珀色晨光", usePrevAsSource: true, note: "統一調性" },
    ],
  },
  {
    id: "wf/quote-card-flagship", label: "金句卡(旗艦)", tier: "flagship", points: 2,
    strengths: "LLM 摘句 → Ideogram 文字卡;中文排版強",
    bestFor: "每日金句社群圖",
    steps: [
      { modelId: "nvidia-nim#qwen2.5-72b", promptTemplate: "從以下內容擷取一句 20 字內的金句(只回金句本身):{prompt}", note: "摘金句" },
      { modelId: "fal-ai/ideogram/v3", promptTemplate: "極簡禪意海報,溫暖米色背景,優雅繁體中文書法字:「{prev}」", note: "生成文字卡" },
    ],
  },
  {
    id: "wf/full-short-economy", label: "完整短片(經濟)", tier: "economy", points: 9,
    strengths: "同「完整短片」流程,改用經濟模型;成本 1/4",
    bestFor: "日常內部短片",
    steps: [
      { modelId: "nvidia-nim#llama-3.1-70b", promptTemplate: "把以下構想潤飾成一段 40 字內的影片畫面描述(繁體中文):{prompt}", note: "腳本潤飾" },
      { modelId: "fal-ai/flux/dev", promptTemplate: "{prev}", note: "定調圖" },
      { modelId: "fal-ai/wan/v2.2-a14b/text-to-video", promptTemplate: "{prev}", note: "成片鏡頭" },
    ],
  },
  {
    id: "wf/narrated-scene-economy", label: "有聲場景(經濟)", tier: "economy", points: 10,
    strengths: "場景影片+中文旁白一次出;剪輯直接可用",
    bestFor: "開示引言、活動預告",
    steps: [
      { modelId: "fal-ai/wan/v2.2-a14b/text-to-video", promptTemplate: "{prompt}", note: "場景影片" },
      { modelId: "fal-ai/elevenlabs/tts/turbo-v2.5", promptTemplate: "{prompt}", note: "旁白配音" },
    ],
  },
  {
    id: "wf/quote-card-economy", label: "金句卡(經濟)", tier: "economy", points: 1,
    strengths: "Flash 摘句+FLUX dev 出圖",
    bestFor: "高頻率的日更金句",
    steps: [
      { modelId: "nvidia-nim#qwen2.5-72b", promptTemplate: "從以下內容擷取一句 20 字內的金句(只回金句本身):{prompt}", note: "摘金句" },
      { modelId: "fal-ai/flux/dev", promptTemplate: "極簡禪意海報構圖,溫暖米色背景,大面留白,主題:{prev}", note: "生成底圖" },
    ],
  },
  {
    id: "wf/draft-minimal", label: "極簡兩步(最低成本)", tier: "budget", points: 2,
    strengths: "Schnell 圖+Kokoro 旁白;2 點跑完整概念",
    bestFor: "提案前的快速概念驗證",
    steps: [
      { modelId: "fal-ai/flux/schnell", promptTemplate: "{prompt}", note: "概念圖" },
      { modelId: "fal-ai/kokoro/mandarin-chinese", promptTemplate: "{prompt}", note: "草稿旁白" },
    ],
  },
];

/** 舊版模型(既有資料相容;不出現在挑選器) */
export const LEGACY_MODELS: ModelEntry[] = [
  // ── fal any-llm 系列(LLM 已整站遷移 NVIDIA NIM;保留供既有生成紀錄/工作流歷史對得上標籤與點數,
  //    在途舊生成也仍能沿 fal 佇列輪詢收尾) ──
  {
    id: "fal-ai/any-llm#claude-sonnet-4.5", endpoint: "fal-ai/any-llm", label: "Claude Sonnet 4.5(舊)", category: "llm", tier: "flagship", kind: "text",
    points: 1, cost: "$0.01/次", verified: true,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    input: llmInput("anthropic/claude-sonnet-4.5"),
  },
  {
    id: "fal-ai/any-llm#gpt-5", endpoint: "fal-ai/any-llm", label: "GPT-5(舊)", category: "llm", tier: "flagship", kind: "text",
    points: 1, cost: "$0.01/次", verified: false,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    input: llmInput("openai/gpt-5"),
  },
  {
    id: "fal-ai/any-llm#gemini-2.5-pro", endpoint: "fal-ai/any-llm", label: "Gemini 2.5 Pro(舊)", category: "llm", tier: "flagship", kind: "text",
    points: 1, cost: "$0.01/次", verified: true,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    input: llmInput("google/gemini-2.5-pro"),
  },
  {
    id: "fal-ai/any-llm#gemini-2.5-flash", endpoint: "fal-ai/any-llm", label: "Gemini 2.5 Flash(舊)", category: "llm", tier: "economy", kind: "text",
    points: 1, cost: "$0.01/次", verified: true,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    input: llmInput("google/gemini-2.5-flash"),
  },
  {
    id: "fal-ai/any-llm#gpt-5-mini", endpoint: "fal-ai/any-llm", label: "GPT-5 mini(舊)", category: "llm", tier: "economy", kind: "text",
    points: 1, cost: "$0.01/次", verified: false,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    input: llmInput("openai/gpt-5-mini"),
  },
  {
    id: "fal-ai/any-llm#llama-4-maverick", endpoint: "fal-ai/any-llm", label: "Llama 4 Maverick(舊)", category: "llm", tier: "economy", kind: "text",
    points: 1, cost: "$0.01/次", verified: false,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    input: llmInput("meta-llama/llama-4-maverick"),
  },
  {
    id: "fal-ai/any-llm#gemini-2.5-flash-lite", endpoint: "fal-ai/any-llm", label: "Gemini 2.5 Flash Lite(舊)", category: "llm", tier: "budget", kind: "text",
    points: 1, cost: "$0.01/次", verified: false,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    input: llmInput("google/gemini-2.5-flash-lite"),
  },
  // W2 擴充期短暫上架的 any-llm 型號(未曾驗證):LLM 整站遷移 NIM 後一併移入舊版目錄
  {
    id: "fal-ai/any-llm#claude-opus-4.5", endpoint: "fal-ai/any-llm", label: "Claude Opus 4.5(舊)", category: "llm", tier: "flagship", kind: "text",
    points: 2, cost: "premium 層按 token", verified: false,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    input: llmInput("anthropic/claude-opus-4.5"),
  },
  {
    id: "fal-ai/any-llm#llama-4-scout", endpoint: "fal-ai/any-llm", label: "Llama 4 Scout(舊)", category: "llm", tier: "budget", kind: "text",
    points: 1, cost: "$0.01/次", verified: false,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    input: llmInput("meta-llama/llama-4-scout"),
  },
  {
    id: "fal-ai/any-llm#deepseek-r1", endpoint: "fal-ai/any-llm", label: "DeepSeek R1(fal 舊)", category: "llm", tier: "economy", kind: "text",
    points: 1, cost: "$0.01/次", verified: false,
    strengths: "舊版目錄項(NIM 版見 nvidia-nim#deepseek-r1)", bestFor: "既有紀錄相容",
    input: llmInput("deepseek/deepseek-r1"),
  },
  {
    id: "fal-ai/any-llm#deepseek-v3", endpoint: "fal-ai/any-llm", label: "DeepSeek V3(舊)", category: "llm", tier: "economy", kind: "text",
    points: 1, cost: "$0.01/次", verified: false,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    input: llmInput("deepseek/deepseek-chat"),
  },
  {
    id: "fal-ai/any-llm#qwen2.5-72b", endpoint: "fal-ai/any-llm", label: "Qwen(通義千問)(fal 舊)", category: "llm", tier: "economy", kind: "text",
    points: 1, cost: "$0.01/次", verified: false,
    strengths: "舊版目錄項(NIM 版見 nvidia-nim#qwen2.5-72b)", bestFor: "既有紀錄相容",
    input: llmInput("qwen/qwen2.5-72b-instruct"),
  },
  {
    id: "fal-ai/any-llm#claude-haiku-4.5", endpoint: "fal-ai/any-llm", label: "Claude Haiku 4.5(舊)", category: "llm", tier: "economy", kind: "text",
    points: 1, cost: "$0.01/次", verified: false,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    input: llmInput("anthropic/claude-haiku-4.5"),
  },
  {
    id: "fal-ai/kling-video/v2.1/standard/text-to-video", label: "影片 5 秒 · Kling 2.1(舊)", category: "text-to-video", tier: "economy", kind: "video",
    points: 12, cost: "$0.05/秒", verified: true,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f), duration: "5" }),
  },
  {
    // 端點 id 查無官方佐證(fal生態研究 #9),挑選器改列已驗證的 fal-ai/rife/video;此條僅供既有紀錄相容
    id: "fal-ai/amt-interpolation", label: "補幀(流暢化)(舊)", category: "video-to-video", tier: "budget", kind: "video",
    needs: "video", points: 4, cost: "≈$0.02/秒;按秒計費,點數為 6 秒基準", verified: false,
    strengths: "舊版目錄項", bestFor: "既有紀錄相容",
    sourceHint: "要補幀的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * 模型指南「決策層」— 深度優化:讓創作者用「我要做什麼(情境)」或「我要什麼風格」
 * 直接查到該用哪個模型,不必先懂 11 類 × 3 檔的分類法。
 *   ‧ SCENARIO_RECIPES:情境配方——「什麼情節/類型 → 首選＋替代模型＋為什麼」
 *   ‧ STYLE_SHOWDOWNS:風格 PK——「同一產出、不同風格/需求,哪個模型最強」
 * pickIds / winnerId / runnerUpId 皆引用上方 MODELS 的 id;models.test.ts 的引用完整性
 * 測試保證它們永遠指向現存模型(改 id 時測試會擋),文案則沿用各模型 strengths 的既有定調。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 情境分組:決策層「看情境」的頂層導覽,對齊創作者的心智(先分大方向再挑情境) */
export const SCENARIO_GROUPS = [
  { id: "image", label: "靜態圖・字卡", hint: "海報、金句卡、分鏡圖、人像" },
  { id: "edit", label: "改圖・去背・合成", hint: "修改既有圖、換背景、去雜物、角色一致" },
  { id: "restore", label: "老照片・放大修復", hint: "修老照、上色、忠實放大" },
  { id: "video", label: "動態影片", hint: "分鏡成片、對嘴、字幕、去背" },
  { id: "audio", label: "配音・配樂・音效", hint: "逐字稿、旁白、主題曲、音效" },
  { id: "text", label: "文字・看圖・訓練", hint: "腳本文案、OCR、專屬風格訓練" },
] as const;
export type ScenarioGroup = (typeof SCENARIO_GROUPS)[number]["id"];

export interface ScenarioRecipe {
  id: string;
  group: ScenarioGroup;
  /** 情境標題:「我要做…」的白話說法 */
  scene: string;
  /** 一句話說清楚這個情境是什麼、什麼時候用 */
  intent: string;
  /** 首選 + 替代,依序;第一個是首選(pickIds[0]) */
  pickIds: string[];
  /** 為什麼首選它——決定性理由(沿用該模型的既有定調) */
  why: string;
}

/** 情境配方:每一條回答「這個情節/類型該用哪個模型」 */
export const SCENARIO_RECIPES: ScenarioRecipe[] = [
  /* ── 靜態圖・字卡 ── */
  {
    id: "sc-quote-card", group: "image", scene: "中文金句卡・書法字卡",
    intent: "打字生成一張含中文標語的卡片,字要正、不能亂碼。",
    pickIds: ["fal-ai/qwen-image-2/text-to-image", "fal-ai/bytedance/seedream/v4.5/text-to-image", "openai/gpt-image-2"],
    why: "Qwen 中文渲染 SOTA、亂碼錯字率最低,繁簡書法與直排都穩——中文字卡的第一主力。",
  },
  {
    id: "sc-cn-poster", group: "image", scene: "中文長版海報(密集文字)",
    intent: "正式交付、多段中文並存的主視覺海報。",
    // 審計 B9：seedream/v5 OpenAPI 404 → 改 v4.5（已驗證路徑）
    pickIds: ["fal-ai/qwen-image-2/pro/text-to-image", "fal-ai/bytedance/seedream/v4.5/text-to-image", "fal-ai/qwen-image-max/text-to-image"],
    why: "Qwen 2.0 Pro 是通義最高保真檔,長段中文、書法字、直排都穩,交付級版面控制最放心。",
  },
  {
    id: "sc-guofeng", group: "image", scene: "國風・水墨・禪意大圖",
    intent: "佛法/禪意題材的水墨、書法、工筆風主視覺。",
    pickIds: ["fal-ai/hunyuan-image/v3", "fal-ai/qwen-image-2/pro/text-to-image"],
    why: "混元中文理解與藝術表現強,國風/書法/水墨題材最對味。",
  },
  {
    id: "sc-portrait", group: "image", scene: "寫實莊嚴人物寫真",
    intent: "法師/志工的寫實人像,膚質要自然、幾乎零瑕疵。",
    pickIds: ["fal-ai/imagen4/preview/ultra", "fal-ai/flux-pro/v1.1-ultra", "fal-ai/nano-banana-2"],
    why: "Imagen 4 Ultra 寫實膚質與提示還原度極高、幾乎零瑕疵,交付級人物寫真首選。",
  },
  {
    id: "sc-hero-visual", group: "image", scene: "高質感宣傳主視覺",
    intent: "活動主視覺,要頂級構圖與光影質感。",
    pickIds: ["fal-ai/flux-2/pro", "fal-ai/nano-banana-pro"],
    why: "FLUX.2 [pro] 構圖與光影頂級、提示詞遵循極準,正式成品主視覺的天花板之一。",
  },
  {
    id: "sc-design-poster", group: "image", scene: "設計感/英文排版海報",
    intent: "以字體排版與設計感為主的海報(英文為主)。",
    pickIds: ["fal-ai/ideogram/v3", "fal-ai/ideogram/v4", "fal-ai/recraft/v3/text-to-image"],
    why: "Ideogram 是文字排版之王,海報級字型渲染、設計感強;中文為主請改用 Qwen。",
  },
  {
    id: "sc-fast-explore", group: "image", scene: "快速大量試構圖",
    intent: "腦力激盪期,秒級刷很多方向找感覺。",
    pickIds: ["fal-ai/flux/schnell", "fal-ai/sana", "fal-ai/imagen4/preview/fast"],
    why: "FLUX.1 [schnell] 1–2 秒出圖,最適合大量迭代找方向,對了再用旗艦重做。",
  },
  {
    id: "sc-storyboard-draft", group: "image", scene: "日常分鏡草稿(可訓風格)",
    intent: "量大的分鏡草圖,之後可訓練專屬風格搭配。",
    pickIds: ["fal-ai/flux/dev", "fal-ai/flux-2"],
    why: "FLUX.1 [dev] 品質/成本平衡、生態最豐,可再搭自家 LoRA——站內日常主力。",
  },

  /* ── 改圖・去背・合成 ── */
  {
    id: "sc-nl-edit", group: "edit", scene: "口語改圖・多圖合成",
    intent: "用一句話改既有圖(換背景、加東西、把多張合成)。",
    pickIds: ["fal-ai/nano-banana-2/edit", "fal-ai/bytedance/seedream/v4.5/edit"],
    why: "Nano Banana 2 免遮罩自然語言編輯,最多 14 張參考合成,知道該改什麼、不該動什麼。",
  },
  {
    id: "sc-text-edit", group: "edit", scene: "中文字卡改字不跑版",
    intent: "既有卡片換字/換橫幅,中文要正、版面不亂。",
    pickIds: ["fal-ai/qwen-image-edit-plus", "fal-ai/qwen-image-edit", "fal-ai/bytedance/seededit/v3/edit-image"],
    why: "Qwen 編輯強化版多圖輸入、文字編輯優於基礎版,改字不跑版。",
  },
  {
    id: "sc-to-ink", group: "edit", scene: "實照轉水墨/工筆莊嚴風",
    intent: "把一張實拍照轉成水墨/工筆等風格,還能疊中文字。",
    pickIds: ["fal-ai/qwen-image-2/edit", "fal-ai/nano-banana-2/edit"],
    why: "Qwen 2.0 Edit 風格轉換＋物件增刪＋中文字疊加一站完成,實照轉莊嚴風最順。",
  },
  {
    id: "sc-char-consistency", group: "edit", scene: "同一角色連續分鏡",
    intent: "見證故事同一主角演到底、系列圖臉要一致。",
    pickIds: ["fal-ai/ideogram/character", "fal-ai/flux-pro/kontext/max", "fal-ai/flux-pro/kontext"],
    why: "Ideogram 角色一致單張參考照就能跨場景鎖同一張臉,最適合產出一整組同主角的新分鏡;要對既有構圖精修角色則用 Kontext [max]。",
  },
  {
    id: "sc-bg-replace", group: "edit", scene: "換禪堂/蓮花背景(對外安心)",
    intent: "一鍵把背景換成禪堂/晨光,對外發布要版權安全。",
    pickIds: ["fal-ai/bria/background/replace", "fal-ai/nano-banana-2/edit"],
    why: "Bria 以授權資料訓練、商用版權安全、結果穩定,對外發布最放心。",
  },
  {
    id: "sc-cutout", group: "edit", scene: "去背成透明素材",
    intent: "人物/結緣品摳成透明 PNG,供卡片海報排版。",
    pickIds: ["fal-ai/bria/background/remove", "fal-ai/birefnet/v2", "fal-ai/ideogram/remove-background"],
    why: "Bria RMBG 2.0 商用授權、邊緣髮絲細緻,去背素材品質最穩。",
  },
  {
    id: "sc-declutter", group: "edit", scene: "清雜物/路人",
    intent: "活動照去掉雜物路人,讓開示/合影畫面乾淨莊嚴。",
    pickIds: ["fal-ai/image-editing/object-removal", "fal-ai/finegrain-eraser"],
    why: "一鍵免畫遮罩,移除雜物後自動補背景;印刷級關鍵去物再上 Finegrain。",
  },

  /* ── 老照片・放大修復 ── */
  {
    id: "sc-old-photo", group: "restore", scene: "老照片修復",
    intent: "泛黃/刮痕/殘缺的先人遺照或舊照救援。",
    pickIds: ["fal-ai/image-editing/photo-restoration", "fal-ai/image-apps-v2/photo-restoration", "fal-ai/codeformer"],
    why: "一鍵去刮痕污漬、去模糊、補殘缺並上色,免提示詞(中文題字修後請校對)。",
  },
  {
    id: "sc-colorize", group: "restore", scene: "黑白遺照上色",
    intent: "黑白照重獲色彩,又不能亂改細節。",
    pickIds: ["fal-ai/ddcolor", "fal-ai/image-editing/photo-restoration"],
    why: "DDColor 只加色不動細節、忠實低風險,中文題字安全。",
  },
  {
    id: "sc-text-upscale", group: "restore", scene: "字卡/書法忠實放大",
    intent: "含中文字/書法的字卡要放大,又不能走樣。",
    pickIds: ["fal-ai/thera", "fal-ai/aura-sr", "fal-ai/recraft/upscale/crisp"],
    why: "Thera 數學上無鋸齒、幾乎零幻覺,中文字不會被重繪成亂碼——含字放大首選。",
  },
  {
    id: "sc-ai-upscale", group: "restore", scene: "AI 圖放大到 4K/印刷",
    intent: "生成圖放大到印刷級,並補生細節。",
    pickIds: ["fal-ai/clarity-upscaler", "fal-ai/topaz/upscale/image"],
    why: "Clarity 放大同時補生細節到交付級;含中文字的圖改用 Thera 忠實放大。",
  },
  {
    id: "sc-portrait-upscale", group: "restore", scene: "人像特寫極致放大",
    intent: "法師肖像大圖輸出,臉部細節要極致。",
    pickIds: ["clarityai/crystal-upscaler", "fal-ai/topaz/upscale/image"],
    why: "Crystal 人像特化,皮膚紋理/虹膜/髮絲細節可到 10K。",
  },
  {
    id: "sc-print-upscale", group: "restore", scene: "印刷級大尺寸放大",
    intent: "海報/展場輸出,要自然無 AI 塑膠感。",
    pickIds: ["fal-ai/topaz/upscale/image", "fal-ai/seedvr/upscale/image"],
    why: "Topaz 業界標準照片級放大、自然無 AI 感,印刷首選;整批跨頁大圖用 SeedVR2 更省。",
  },

  /* ── 動態影片 ── */
  {
    id: "sc-animate-storyboard", group: "video", scene: "把分鏡圖變會動的鏡頭",
    intent: "已有 FLUX/Seedream 分鏡圖,要批量動起來。",
    pickIds: ["fal-ai/wan/v2.2-a14b/image-to-video", "fal-ai/kling-video/v2.5-turbo/pro/image-to-video"],
    why: "Wan 2.2 圖生性價比與可控性最佳,是把分鏡圖動起來的日常主力。",
  },
  {
    id: "sc-hero-shot", group: "video", scene: "對外形象片關鍵鏡頭",
    intent: "最重要的一兩個鏡頭要電影感＋原生音效。",
    pickIds: ["fal-ai/veo3.1/image-to-video", "fal-ai/kling-video/v2.6/pro/image-to-video"],
    why: "Veo 3.1 圖生是物理正確＋原生音訊的質感天花板,對外形象片最關鍵的一兩個鏡頭首選;量大要控成本用 Kling 2.6 Pro。",
  },
  {
    id: "sc-witness-emotion", group: "video", scene: "見證故事人物特寫",
    intent: "主角要會演、有情緒(表情、眼神、合掌)。",
    pickIds: ["fal-ai/minimax/hailuo-2.3/pro/image-to-video", "fal-ai/kling-video/v2.6/pro/image-to-video"],
    why: "Hailuo 2.3 Pro 人物表演與情緒動作最自然、少鬼影變形,人像活起來最傳神;運鏡感更強用 Kling 2.6 Pro。",
  },
  {
    id: "sc-zen-broll", group: "video", scene: "莊嚴療癒空景動態",
    intent: "晨光、香煙、波光等靜謐空鏡的呼吸感動態。",
    pickIds: ["fal-ai/luma-dream-machine/ray-2/image-to-video", "fal-ai/luma-dream-machine/ray-2-flash/image-to-video", "fal-ai/stable-video"],
    why: "Luma Ray-2 唯美光影與自然運動,靜謐基調最契合療癒空景。",
  },
  {
    id: "sc-t2v-sound", group: "video", scene: "打字直接生成短片(含聲音)",
    intent: "沒有分鏡圖,直接一句話生一段有聲短片。",
    pickIds: ["fal-ai/veo3.1", "fal-ai/kling-video/v2.6/pro/text-to-video", "fal-ai/wan/v2.5/text-to-video"],
    why: "Veo 3.1 當前最強之一,物理正確、可含原生音效與對白;要開源價又帶音訊用 Wan 2.5。",
  },
  {
    id: "sc-micro-motion", group: "video", scene: "佛像/海報呼吸感微動",
    intent: "讓一張莊嚴圖有若有似無的微動,幾乎靜止但有生命感。",
    pickIds: ["fal-ai/stable-video", "fal-ai/framepack"],
    why: "Stable Video Diffusion 細膩可信的微動態,佛像/山水海報最合適;要長循環改用 FramePack。",
  },
  {
    id: "sc-lipsync", group: "video", scene: "開示配音替換/對嘴",
    intent: "把新配音精準貼合人物口型。",
    pickIds: ["fal-ai/sync-lipsync/v3", "fal-ai/sync-lipsync/v2", "fal-ai/musetalk"],
    why: "Sync-3 對嘴自然度天花板;師父影像不能失真時,改用只改嘴部的 MuseTalk 保守型。",
  },
  {
    id: "sc-video-restore", group: "video", scene: "舊開示影片修復升 4K",
    intent: "低清歷史開示影片救援、升頻補幀。",
    pickIds: ["fal-ai/topaz/upscale/video", "fal-ai/seedvr/upscale/video"],
    why: "Topaz 業界標準升頻、低清舊素材救星、可倍幀;整批修復先用 SeedVR2 省成本。",
  },
  {
    id: "sc-subtitle", group: "video", scene: "影片自動上中文字幕",
    intent: "開示剪輯/Shorts 要轉錄並燒錄字幕。",
    pickIds: ["fal-ai/workflow-utilities/auto-subtitle", "veed/subtitles"],
    why: "轉錄＋卡拉OK式逐字高亮,內建含繁中的 Noto 字型(中文首跑必驗)。",
  },
  {
    id: "sc-video-bg", group: "video", scene: "影片人物去背合成",
    intent: "把人物從影片去背,合成到禪堂/金句字卡。",
    pickIds: ["bria/video/background-removal/v3", "fal-ai/ben/v2/video"],
    why: "Bria VRMBG 3.0 更準、時序穩少閃爍,正式成品去背首選;日常量大先用 BEN2 省。",
  },

  /* ── 配音・配樂・音效 ── */
  {
    id: "sc-transcribe", group: "audio", scene: "開示錄音轉逐字稿",
    intent: "多人座談/法會錄音轉逐字稿,要自動分講者。",
    pickIds: ["fal-ai/elevenlabs/speech-to-text/scribe-v2", "fal-ai/elevenlabs/speech-to-text", "fal-ai/whisper"],
    why: "Scribe v2 是最新旗艦逐字稿,可自動分離最多 32 位講者,多人法會座談逐字稿最上游首選。",
  },
  {
    id: "sc-cn-narration", group: "audio", scene: "中文旁白配音",
    intent: "見證/開示的中文旁白,要自然、有情感。",
    pickIds: ["fal-ai/minimax/speech-2.6-hd", "fal-ai/qwen-3-tts/text-to-speech/1.7b", "fal-ai/elevenlabs/tts/eleven-v3"],
    why: "MiniMax 2.6 HD 情感/停頓/語氣控制最完整、300+ 聲線,中文旁白首選。",
  },
  {
    id: "sc-daily-tts", group: "audio", scene: "中文旁白日更量產(省)",
    intent: "社群短影音口白要量大又省。",
    pickIds: ["fal-ai/qwen-3-tts/text-to-speech/1.7b", "fal-ai/qwen-3-tts/text-to-speech/0.6b", "fal-ai/elevenlabs/tts/turbo-v2.5"],
    why: "Qwen 3 TTS 韻律像真人、中文第一梯隊,日更量產划算;要再省用 0.6b 輕量版(社群短口白量身打造)。",
  },
  {
    id: "sc-term-tts", group: "audio", scene: "術語密集稿・對嘴配音",
    intent: "佛學術語多、破音字多,還要對上口型時長。",
    pickIds: ["fal-ai/index-tts-2/text-to-speech", "fal-ai/minimax/speech-02-hd"],
    why: "Index TTS 2.0 拼音校正破音字＋精準時長控制,WER 最低、咬字最準。",
  },
  {
    id: "sc-voice-clone", group: "audio", scene: "建立會方專屬旁白聲線",
    intent: "用 10 秒樣音複製一條固定旁白聲(需本人授權)。",
    pickIds: ["fal-ai/minimax/voice-clone", "fal-ai/qwen-3-tts/clone-voice/1.7b"],
    // B9：Qwen clone-voice 非端到端 TTS（產出 embedding，需再接 Qwen TTS）
    why: "MiniMax 語音克隆能建立可重複取用的專屬聲線 ID,最適合固定會方旁白聲;想更省可先用 Qwen 3 註冊 speaker embedding（非一次出音,需再接 Qwen TTS）。",
  },
  {
    id: "sc-theme-song", group: "audio", scene: "中文主題曲/片尾曲",
    intent: "完整演唱的中文歌,可自動填詞或切純器樂。",
    pickIds: ["fal-ai/minimax-music/v2.6", "fal-ai/minimax-music", "fal-ai/yue"],
    why: "MiniMax Music 2.6 完整演唱、風格描述至 2000 字、可自動填詞、可切純器樂。",
  },
  {
    id: "sc-safe-bgm", group: "audio", scene: "對外配樂(版權安全)",
    intent: "對外發布影片要版權安心的配樂。",
    pickIds: ["fal-ai/elevenlabs/music", "fal-ai/lyria2"],
    why: "ElevenLabs Music 以授權資料訓練、版權安全、結構化歌曲,對外發布最放心。",
  },
  {
    id: "sc-sfx", group: "audio", scene: "剪輯用音效/擬音",
    intent: "鐘聲、木魚、翻書等單發音效,或替無聲影片補環境音。",
    pickIds: ["fal-ai/elevenlabs/sound-effects/v2", "fal-ai/hunyuan-video-foley", "fal-ai/thinksound"],
    why: "描述即得音效;要對畫面動作同步擬音(倒水、腳步),改用高保真的混元 Foley。",
  },

  /* ── 文字・看圖・訓練 ── */
  {
    id: "sc-script", group: "text", scene: "腳本結構規劃",
    intent: "複雜腳本要先想清楚,長鏈邏輯拆解。",
    pickIds: ["nvidia-nim#deepseek-r1", "nvidia-nim#llama-3.1-405b"],
    why: "DeepSeek R1 深度推理鏈,複雜任務拆解、長鏈邏輯最強。",
  },
  {
    id: "sc-cn-copy", group: "text", scene: "中文金句/弘法文案",
    intent: "中文金句、文案潤飾、繁中改寫。",
    pickIds: ["nvidia-nim#qwen2.5-72b", "nvidia-nim#llama-3.1-70b"],
    why: "Qwen2.5 72B 中文語感第一梯隊、繁中穩定,弘法文案最對味。",
  },
  {
    id: "sc-ocr", group: "text", scene: "經文/掃描稿轉文字",
    intent: "手稿、經文、含表格的掃描件 OCR。",
    pickIds: ["fal-ai/got-ocr/v2", "fal-ai/any-llm/vision#gemini-2.5-pro", "fal-ai/florence-2-large/ocr"],
    why: "GOT-OCR 2.0 中文/表格/公式/複雜版面遠勝 Florence-2;手稿/難字用 Gemini 2.5 Pro 視覺補救。",
  },
  {
    id: "sc-caption", group: "text", scene: "素材批量看圖生繁中描述",
    intent: "素材庫自動建檔、批量看圖生描述。",
    pickIds: ["fal-ai/any-llm/vision#gemini-2.5-flash", "fal-ai/any-llm/vision#gemini-2.5-pro"],
    why: "Gemini 2.5 Flash 看圖性價比高、繁中描述自然、中文字辨識佳;要更深看圖推理升 2.5 Pro。",
  },
  {
    id: "sc-train-style", group: "text", scene: "訓練本會專屬中文風格",
    intent: "用自家素材練「風格＋中文不錯字」兼得的模型。",
    pickIds: ["fal-ai/qwen-image-trainer", "fal-ai/qwen-image-2512-trainer", "fal-ai/z-image-trainer"],
    why: "Qwen Image 訓練器是唯一「自家風格＋中文不錯字」兼得的路線;先驗證素材能否練出風格用通義 Z-Image 試水溫(FLUX 底模中文會錯字,不列入)。",
  },
  {
    id: "sc-train-first", group: "text", scene: "第一次嘗試訓練",
    intent: "沒訓練過,想先快速試出一個模型看看。",
    pickIds: ["fal-ai/flux-lora-fast-training", "fal-ai/z-image-trainer"],
    why: "FLUX LoRA 快速訓練是經典入門訓練器,幾分鐘出模型;更省先用 Z-Image 試水溫。",
  },

  /* —— W3 補遺:多代理研究＋上網驗證後補上的高價值缺口情境 —— */
  {
    id: "sc-real-face", group: "edit", scene: "真人講者/法師授權入畫",
    intent: "把一張授權過的真人臉,放進生成的禪堂/海報/金句底圖(須本人授權)。",
    pickIds: ["fal-ai/ideogram/character", "fal-ai/flux-pulid", "fal-ai/minimax/image-01/subject-reference"],
    why: "Ideogram 角色一致用單張參考照就能跨場景鎖同一張臉,是把授權真人放進生成畫面的旗艦(提示詞英文)。",
  },
  {
    id: "sc-reframe-vertical", group: "video", scene: "橫式開示轉直式 Shorts",
    intent: "一支 16:9 開示要同時上 YouTube 與 Shorts,換比例又不裁掉法師。",
    pickIds: ["fal-ai/wan-vace-14b/outpainting", "fal-ai/bria/expand"],
    why: "Wan VACE 影片外擴能往上下補畫面把 16:9 轉直式、主體不裁切;靜態縮圖/首格用 Bria 擴圖。",
  },
  {
    id: "sc-line-sticker", group: "image", scene: "LINE 結緣貼圖/Q 版大頭貼",
    intent: "把志工大頭照做成貼紙風,上架 LINE 結緣貼圖。",
    pickIds: ["fal-ai/face-to-sticker", "fal-ai/bria/background/remove", "fal-ai/nano-banana-2/edit"],
    why: "Face to Sticker 一鍵把一張臉變 Q 版貼紙風,再去背成透明 PNG 即可上架,社群互動量產線首選。",
  },
  {
    id: "sc-product-shot", group: "edit", scene: "結緣品/義賣商品情境圖",
    intent: "佛珠、香品、書籍做成攝影棚級莊嚴擺拍圖,用於義賣頁。",
    pickIds: ["fal-ai/bria/product-shot", "fal-ai/bria/background/replace", "pixelcut/background-removal"],
    why: "Bria Product Shot 去背＋生成情境擺拍且版權安全,義賣/結緣頁的商品主視覺首選。",
  },
  {
    id: "sc-headshot", group: "edit", scene: "統一講者/義工形象照",
    intent: "把生活照一鍵莊重化、統一背景,做講師卡/義工證。",
    pickIds: ["fal-ai/image-apps-v2/headshot-photo", "easel-ai/easel-avatar"],
    why: "Headshot Photo 把生活照轉專業形象照並統一背景,免逐一重拍,講者牆/簡介卡最省事。",
  },
  {
    id: "sc-panel-podcast", group: "audio", scene: "多講者座談/問答 Podcast",
    intent: "座談、法師問答、對話式 Podcast 的多角色配音。",
    pickIds: ["fal-ai/vibevoice/7b", "fal-ai/elevenlabs/text-to-dialogue/eleven-v3", "fal-ai/dia-tts"],
    why: "VibeVoice 7B 原生多講者長對話最自然,座談/問答式弘法音訊首選;高情感英文對話用 ElevenLabs v3。",
  },
];

export interface StyleShowdownAxis {
  /** 風格 / 需求維度 */
  axis: string;
  /** 這個維度的挑選重點 */
  note: string;
  /** 這維度最強的模型 id */
  winnerId: string;
  /** 次選 id(可選) */
  runnerUpId?: string;
}
export interface StyleShowdown {
  id: string;
  title: string;
  /** 這張 PK 表所屬的產出家族(顯示副標用;影片表刻意跨文生/圖生) */
  category: ModelCategory;
  subtitle: string;
  axes: StyleShowdownAxis[];
}

/** 風格 PK:同一產出、不同風格/需求下,哪個模型最強(＋次選) */
export const STYLE_SHOWDOWNS: StyleShowdown[] = [
  {
    id: "sh-image", title: "文生圖 PK:哪個風格用哪個模型", category: "text-to-image",
    subtitle: "同樣打字出圖,依你要的風格挑首選——省的先試方向,對了再上旗艦。",
    axes: [
      { axis: "中文字準(金句/書法)", note: "標語要正、不能亂碼", winnerId: "fal-ai/qwen-image-2/text-to-image", runnerUpId: "fal-ai/bytedance/seedream/v4.5/text-to-image" },
      { axis: "寫實人像/膚質", note: "法師、志工寫真", winnerId: "fal-ai/imagen4/preview/ultra", runnerUpId: "fal-ai/flux-pro/v1.1-ultra" },
      { axis: "國風/水墨/藝術", note: "禪意、書法、工筆題材", winnerId: "fal-ai/hunyuan-image/v3", runnerUpId: "fal-ai/qwen-image-2/pro/text-to-image" },
      { axis: "構圖/光影/質感", note: "宣傳主視覺", winnerId: "fal-ai/flux-2/pro", runnerUpId: "fal-ai/nano-banana-pro" },
      { axis: "排版/設計/英文海報", note: "字體設計感(中文另用 Qwen)", winnerId: "fal-ai/ideogram/v3", runnerUpId: "fal-ai/ideogram/v4" },
      { axis: "複雜指令理解", note: "多條件、敘事型畫面", winnerId: "fal-ai/nano-banana-pro", runnerUpId: "openai/gpt-image-2" },
      { axis: "最省/秒級試方向", note: "大量刷草稿找感覺", winnerId: "fal-ai/flux/schnell", runnerUpId: "fal-ai/sana" },
    ],
  },
  {
    id: "sh-video", title: "影片 PK:哪種鏡頭用哪個模型", category: "image-to-video",
    subtitle: "影片是成本大戶——先用最省的試節奏,關鍵鏡頭再上旗艦。",
    axes: [
      { axis: "分鏡圖動起來(日常主力)", note: "量大、要可控成本", winnerId: "fal-ai/wan/v2.2-a14b/image-to-video", runnerUpId: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video" },
      { axis: "人物會演/情緒", note: "見證故事特寫", winnerId: "fal-ai/minimax/hailuo-2.3/pro/image-to-video", runnerUpId: "fal-ai/kling-video/v2.6/pro/image-to-video" },
      { axis: "電影感運鏡/物理", note: "對外關鍵鏡頭", winnerId: "fal-ai/veo3.1", runnerUpId: "fal-ai/kling-video/o3/pro/text-to-video" },
      { axis: "唯美療癒空鏡", note: "晨光、香煙、波光", winnerId: "fal-ai/luma-dream-machine/ray-2", runnerUpId: "fal-ai/hunyuan-video-v1.5/text-to-video" },
      { axis: "含原生音效對白", note: "一次帶聲音出片(含對白)", winnerId: "fal-ai/veo3.1", runnerUpId: "fal-ai/pixverse/v6/text-to-video" },
      { axis: "最省試鏡頭", note: "先看節奏再上旗艦", winnerId: "fal-ai/ltx-video", runnerUpId: "fal-ai/wan-t2v" },
    ],
  },
  {
    id: "sh-tts", title: "中文配音 PK:哪種取向用哪個模型", category: "text-to-speech",
    subtitle: "中文旁白挑首選:要情感/要省/要咬字準/要克隆,各有主力。",
    axes: [
      { axis: "中文最自然/情感", note: "見證、開示旁白", winnerId: "fal-ai/minimax/speech-2.6-hd", runnerUpId: "fal-ai/minimax/speech-02-hd" },
      { axis: "日更量產最省", note: "社群短影音口白", winnerId: "fal-ai/qwen-3-tts/text-to-speech/1.7b", runnerUpId: "fal-ai/qwen-3-tts/text-to-speech/0.6b" },
      { axis: "咬字/術語/對嘴時長", note: "佛學術語密集稿", winnerId: "fal-ai/index-tts-2/text-to-speech", runnerUpId: "fal-ai/minimax/speech-02-hd" },
      { axis: "專屬聲線克隆", note: "固定旁白聲(需授權；Qwen 為 embedding 非端到端 TTS)", winnerId: "fal-ai/minimax/voice-clone", runnerUpId: "fal-ai/qwen-3-tts/clone-voice/1.7b" },
      { axis: "多人對談", note: "問答、Podcast 式", winnerId: "fal-ai/vibevoice/7b", runnerUpId: "fal-ai/dia-tts" },
    ],
  },
];

export function getModel(id: string): ModelEntry | undefined {
  return MODELS.find((m) => m.id === id) ?? LEGACY_MODELS.find((m) => m.id === id);
}

/** 匯率假設（與 scripts/audit-model-pricing.ts 一致）：1 點 ≈ NT$1、USD×31——校準與動態估點同一基準 */
export const USD_TO_TWD = 31;

/* ── 實價點數（2026-08-01 定案）：fal 模型全面以官方 USD 實價 × USD_TO_TWD 直接計點 ──
   cost 字串是價格單一真相；能機械換算的（$ 金額＋可辨識單位）一律在模組載入時覆寫手填 points，
   讓「顯示＝扣點＝退點」都等於實價台幣（1 點 = NT$1）。無 $ 金額（NIM 免費檔）或單位不可
   機械換算（千字／tokens／算力秒／訓練步數）保留人工校準值——誠實原則：換算不了就不硬給。
   單位用量假設與 scripts/audit-model-pricing.ts 同一套（該腳本改 import 本處函式，不再各自維護）。 */

/** 影片單鏡假設秒數（與 money.ts DEFAULT_VIDEO_SECONDS_FOR_POINTS、modelLiveSync 對齊） */
export const PRICE_VIDEO_SECONDS = 5;
/** 轉錄單檔假設分鐘 */
export const PRICE_AUDIO_MINUTES = 10;
/** 配樂單首假設分鐘 */
export const PRICE_MUSIC_MINUTES = 3;
/** 對嘴／影片處理單支假設分鐘 */
export const PRICE_V2V_MINUTES = 1;

/** 「/分」的典型用量因類別而異：轉錄整檔開示、配樂一首、對嘴一支短片，長度天差地遠 */
function priceMinutesFor(category: ModelCategory): number {
  if (category === "speech-to-text") return PRICE_AUDIO_MINUTES;
  if (category === "text-to-audio") return PRICE_MUSIC_MINUTES;
  if (category === "video-to-video") return PRICE_V2V_MINUTES;
  return 1;
}

export interface ParsedRealCost {
  /** 解析出的 USD 中值（範圍取中點）；null＝無 $ 金額 */
  usdMid: number | null;
  /** 單次生成的用量倍數；null＝單位不可機械換算 */
  multiplier: number | null;
  unitNote: string;
}

/** 從 "$0.06–0.16/張(依解析度)" 這類 cost 字串解析 USD 中值與單次用量倍數 */
export function parseRealCost(cost: string, category: ModelCategory): ParsedRealCost {
  // 金額：$a 或 $a–b（同時容忍 - 與 ~ 當範圍號）
  const m = cost.match(/\$\s*([0-9]+(?:\.[0-9]+)?)(?:\s*[–\-~]\s*([0-9]+(?:\.[0-9]+)?))?/);
  if (!m) return { usdMid: null, multiplier: null, unitNote: "無 $ 金額" };
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : lo;
  const usdMid = (lo + hi) / 2;

  const unitMatch = cost.match(/\/\s*([^\s（(]+)/);
  if (!unitMatch) return { usdMid, multiplier: 1, unitNote: "×1（未標單位，視為每次）" };
  const unit = unitMatch[1];
  const isVideoCat = category === "text-to-video" || category === "image-to-video" || category === "video-to-video";
  if (/^(張|圖|次|支|首|段|call)/i.test(unit)) return { usdMid, multiplier: 1, unitNote: "×1（每次一件）" };
  if (/^(MP|百萬像素)/i.test(unit)) {
    // 影片的「百萬像素」＝寬×高×幀數（一支 6 秒 1080p 30fps ≈ 373MP），1MP 假設會嚴重低收 → 需人工
    if (isVideoCat) return { usdMid, multiplier: null, unitNote: "影片按總像素×幀數計費，需人工換算" };
    return { usdMid, multiplier: 1, unitNote: "×1MP（16:9 標準輸出 ≈ 1MP）" };
  }
  if (/^秒/.test(unit)) {
    // 配樂／音效的「/秒」：單曲長度依模型預設（90–180 秒），5 秒單鏡假設會嚴重低收 → 需人工
    if (category === "text-to-audio") return { usdMid, multiplier: null, unitNote: "單曲秒數依模型預設，需人工換算" };
    return { usdMid, multiplier: PRICE_VIDEO_SECONDS, unitNote: `×${PRICE_VIDEO_SECONDS} 秒（單鏡假設）` };
  }
  // 「/5秒」「/6秒」＝單支 N 秒短片的固定價 → 一次生成就是一支，×1
  if (/^[0-9]+(?:\.[0-9]+)?\s*秒/.test(unit)) {
    return { usdMid, multiplier: 1, unitNote: `×1（單支 ${unit.match(/^[0-9.]+/)?.[0]} 秒固定價）` };
  }
  if (/^分(鐘)?/.test(unit)) {
    const mul = priceMinutesFor(category);
    return { usdMid, multiplier: mul, unitNote: `×${mul} 分鐘（類別典型用量）` };
  }
  return { usdMid, multiplier: null, unitNote: `單位「/${unit}」需人工換算` };
}

/** 官方實價 → 單次點數（NT$ 四捨五入、下限 1 點）；null＝不可機械換算（呼叫端保留手動校準值） */
export function realPricePoints(
  m: Pick<ModelEntry, "cost" | "category">,
  usdToTwdRate = USD_TO_TWD,
): number | null {
  const p = parseRealCost(m.cost, m.category);
  if (p.usdMid === null || p.multiplier === null) return null;
  return Math.max(1, Math.round(p.usdMid * p.multiplier * usdToTwdRate));
}

/* fal 模型全面覆寫為實價點數。nvidia-nim 走 NVIDIA 免費額度、cost 無 $ 金額，自然跳過（雙保險仍明列）。
   必須在 MODELS/LEGACY_MODELS 之後、下方 WORKFLOW_PRESETS 合計重算之前執行——工作流總點數吃覆寫後單價。 */
for (const m of [...MODELS, ...LEGACY_MODELS]) {
  if (m.endpoint === "nvidia-nim") continue;
  const pts = realPricePoints(m);
  if (pts !== null) m.points = pts;
}

/**
 * 「按字計費」文字轉語音模型的每千字點數率（僅 text-to-speech 且「首個」報價單位為千字者）。
 * 這類模型的計費量＝待朗讀文字長度，送出前就已知（prompt 本身即朗讀文字，TTS 不注入世界觀），
 * 故可逐次精確估點，取代扁平 points（原本僅對「約 1000 字」一種長度才等於真實成本）。
 * 只認「首個」報價：voice-clone 的「$1.50/次＋預覽音 $0.30/千字」首報價為 /次 → 判為 flat，不誤入動態。
 * 模組載入時建一次快取（純衍生自 cost 字串，零額外資料源）。
 */
const ttsUsdPerKChar: Map<string, number> = (() => {
  const map = new Map<string, number>();
  for (const m of MODELS) {
    if (m.category !== "text-to-speech") continue;
    const first = m.cost.match(/\$\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*([^\s;,、(（]+)/); // 首個 $價/單位
    if (first && first[2].startsWith("千字")) map.set(m.id, Number(first[1]));
  }
  return map;
})();

/** 逐次估點的輸入脈絡（送出前已知的計費量） */
export interface EstimateContext {
  /** 待計費文字字元數（TTS：即 prompt 長度＝朗讀文字量） */
  promptChars?: number;
  /** 與 Fal 餘額硬上限共用的即時 USD/TWD；未傳時使用安全後備常數。 */
  usdToTwdRate?: number;
}

/**
 * 逐次估點：按字計費的 TTS 依實際文字長度算真實成本（下限 1 點）；其餘一律回扁平 model.points。
 * 呼叫端（generationCore）一次算好 est 貫穿 pointsEst／審核門檻／扣點／退點，前後端共用同一函式，
 * 確保顯示＝扣點＝退點三者永遠一致（reserve/refund 對稱）。無 promptChars 時退回扁平值（等同舊行為）。
 */
export function estimatePoints(model: ModelEntry, ctx?: EstimateContext): number {
  const rate = ctx?.usdToTwdRate ?? USD_TO_TWD;
  const usdPerK = ttsUsdPerKChar.get(model.id);
  if (usdPerK != null && ctx?.promptChars != null && ctx.promptChars > 0) {
    return Math.max(1, Math.round((usdPerK * rate * ctx.promptChars) / 1000));
  }
  const dynamic = realPricePoints(model, rate);
  if (dynamic != null) return dynamic;
  // 無法從 cost 機械解析的人工校準價仍隨同一匯率等比例調整。
  return Math.max(1, Math.round(model.points * (rate / USD_TO_TWD)));
}

/* 為什麼:工作流合計點數曾多條與單步實扣不符(UI 顯示夠用、中途才被額度擋下的斷鏈),
   故模組載入時一律由單步模型註冊表推導覆寫,單步點數改動後下游(workflows API/catalog/文件)自動同步。
   注意:必須放在 MODELS/WORKFLOW_PRESETS/LEGACY_MODELS 初始化之後,否則 getModel 會踩 const 的 TDZ。 */
// 修 R5-V2-01：含「按千字」TTS 步的工作流，用扁平 model.points 加總會嚴重低估（turbo-v2.5 扁平 2 點，
// 但 8000 字旁白實扣 12 點）——顯示總價低於實扣、且影片步先扣款後 TTS 步才因額度不足中鏈斷點。
// 改以「提示詞上限（8000 字，同 workflows.ts 上限）」的最壞情況估點覆寫，讓顯示總價 ≥ 實扣、不再誤導與斷鏈。
const WORKFLOW_MAX_PROMPT_CHARS = 8000;
for (const w of WORKFLOW_PRESETS) {
  w.points = w.steps.reduce((sum, st) => {
    const m = getModel(st.modelId);
    if (!m) return sum;
    return sum + estimatePoints(m, { promptChars: WORKFLOW_MAX_PROMPT_CHARS });
  }, 0);
}

export function getWorkflow(id: string): WorkflowPreset | undefined {
  return WORKFLOW_PRESETS.find((w) => w.id === id);
}

/** 佇列端點(nvidia-nim/any-llm 系列共用端點) */
export function endpointOf(model: ModelEntry): string {
  return model.endpoint ?? model.id;
}

/** 是否走 NVIDIA NIM(LLM 文字類):generationCore 據此把送出/輪詢分流到 nimSubmit/nimStatus */
export function isNimModel(model: ModelEntry): boolean {
  return endpointOf(model) === "nvidia-nim";
}

/** 平台 → 格式自動帶入(夥伴不用懂比例) */
export const PLATFORMS = [
  { id: "youtube", label: "YouTube(橫式)", format: "16:9" as ProjectFormat },
  { id: "shorts", label: "Shorts / Reels(直式)", format: "9:16" as ProjectFormat },
  { id: "social", label: "社群貼文(方形)", format: "1:1" as ProjectFormat },
];

export const PROJECT_KINDS = [
  { id: "witness", label: "見證故事" },
  { id: "teaching", label: "開示剪輯" },
  { id: "short", label: "短影音" },
  { id: "promo", label: "活動宣傳" },
  { id: "recap", label: "活動回顧" },
] as const;
