/**
 * 模型註冊表 v2 — 「沒有模型支撐的選項不出現」的單一真相來源。
 * 11 類,每類至少 旗艦3＋經濟3＋最低成本1;2026-07 依《fal生態研究》修 6 項現值錯誤並補中文命脈梯隊
 * (Qwen Image 2.0/Pro、GPT Image 2、Kolors、Qwen Edit Plus、Qwen 3 TTS、Qwen 訓練器)。
 * 啟動時同步進 model_catalog 資料表供代理查詢。
 * 定案:只接 Fal.ai;1 點 ≈ NT$1(USD×31 估);cost 為官方約略價,實際帳單以 fal 計價頁為準。
 * verified=true 表示模型頁面於 2026-07 逐一查證過;false 為合理推測 ID,真實模式首跑需確認
 * (失敗會自動退點並顯示錯誤,不會白扣)。
 */

export type ModelCategory =
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
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

export type ProjectFormat = "16:9" | "9:16" | "1:1";

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
  /** 每次生成扣點(1 點 ≈ NT$1;訓練類為每次訓練) */
  points: number;
  /** 特性(研究摘要) */
  strengths: string;
  /** 擅長領域 */
  bestFor: string;
  /** 官方約略價 */
  cost: string;
  verified: boolean;
  /** 推薦預設:每個類別恰一個「已驗證、經濟」的日常主力;挑選器預設選它、UI 標「推薦」 */
  recommended?: boolean;
  /** 來源輸入欄位的提示文字 */
  sourceHint?: string;
  input: (prompt: string, format: ProjectFormat, sourceUrl?: string) => Record<string, unknown>;
}

export const CATEGORIES: Array<{ id: ModelCategory; label: string; hint: string }> = [
  { id: "text-to-image", label: "文生圖", hint: "打字生成圖像(分鏡、場景、卡片)" },
  { id: "image-to-image", label: "圖生圖・編輯", hint: "用文字修改既有圖像(換風格、局部修改、合成)" },
  { id: "text-to-video", label: "文生影片", hint: "打字生成短影片(5–10 秒鏡頭)" },
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
const imageSize = (f: ProjectFormat) =>
  f === "9:16" ? "portrait_16_9" : f === "1:1" ? "square_hd" : "landscape_16_9";
const aspect = (f: ProjectFormat) => f;
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
    points: 2, cost: "$0.03/MP", verified: false,
    strengths: "Black Forest Labs 最新旗艦;構圖與光影頂級、提示詞遵循極準",
    bestFor: "正式成品分鏡、需要高質感的宣傳主視覺",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "fal-ai/qwen-image-2/pro/text-to-image", label: "Qwen Image 2.0 Pro", category: "text-to-image", tier: "flagship", kind: "image",
    points: 3, cost: "$0.075/張(原生 2K)", verified: false,
    strengths: "阿里通義最高保真檔;中文渲染上限最高之一,長段中文、書法字、直排都穩",
    bestFor: "正式交付的中文長版海報、書法字與密集中文並存的主視覺",
    input: (p, f) => ({ prompt: p, image_size: imageSize(f) }),
  },
  {
    id: "openai/gpt-image-2", label: "GPT Image 2(OpenAI)", category: "text-to-image", tier: "flagship", kind: "image",
    points: 4, cost: "$0.01–0.41/張(依畫質/解析度)", verified: false,
    strengths: "fal 官方夥伴端點;跨拉丁與 CJK 字元級文字準確、複雜指令理解強",
    bestFor: "要求文字逐字精準的對外物料、中英並存的字卡",
    input: (p, f) => ({ prompt: p, image_size: f === "9:16" ? "1024x1536" : f === "1:1" ? "1024x1024" : "1536x1024" }),
  },
  {
    id: "fal-ai/bytedance/seedream/v4.5/text-to-image", label: "Seedream 4.5", category: "text-to-image", tier: "flagship", kind: "image",
    points: 2, cost: "$0.04/張", verified: true,
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
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
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
    points: 2, cost: "$0.035/張(原生 2K)", verified: false,
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

  /* ═══ 2. 圖生圖・編輯 image-to-image ═══ */
  {
    id: "fal-ai/nano-banana-2/edit", label: "Nano Banana 2 Edit", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 3, cost: "$0.08/張(1K)", verified: true,
    strengths: "免遮罩自然語言編輯;最多 14 張參考圖合成、知道該改什麼不該動什麼",
    bestFor: "「把背景換成禪堂」這類口語修改、多圖合成",
    sourceHint: "要編輯的圖(素材庫或網址)",
    input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
  },
  {
    id: "fal-ai/flux-2/pro/edit", label: "FLUX.2 [pro] Edit", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 2, cost: "$0.03/MP", verified: false,
    strengths: "生產級編輯;最多 9 張參考圖、構圖一致性佳",
    bestFor: "正式成品的精修、系列圖風格統一",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
  },
  {
    id: "fal-ai/bytedance/seedream/v4.5/edit", label: "Seedream 4.5 Edit", category: "image-to-image", tier: "flagship", kind: "image",
    needs: "image", points: 2, cost: "$0.04/張", verified: false,
    strengths: "生成+編輯一體架構;中文指令理解佳",
    bestFor: "中文指令修改、文字元素調整",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_urls: [s] }),
  },
  {
    id: "fal-ai/flux-pro/kontext", label: "FLUX.1 Kontext [pro]", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 2, cost: "$0.04/張", verified: true,
    strengths: "局部編輯與整景轉換兼顧;角色一致性迭代編輯",
    bestFor: "同角色連續分鏡、逐步修圖",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/qwen-image-edit", label: "Qwen Image Edit", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "≈$0.02/張", verified: false,
    strengths: "阿里通義;複雜中文文字渲染與精準編輯",
    bestFor: "中文標題卡修字、低成本批量修改",
    sourceHint: "要編輯的圖",
    input: (p, _f, s) => ({ prompt: p, image_url: s }),
  },
  {
    id: "fal-ai/qwen-image-edit-plus", label: "Qwen Image Edit Plus", category: "image-to-image", tier: "economy", kind: "image",
    needs: "image", points: 1, cost: "≈$0.03/張", verified: false,
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

  /* ═══ 3. 文生影片 text-to-video ═══ */
  {
    id: "fal-ai/veo3.1", label: "Veo 3.1(Google)", category: "text-to-video", tier: "flagship", kind: "video",
    // 為什麼:fal 影片模型按秒計費,固定扣點蓋不住長鏡頭——按秒計費模型一律以「6 秒鏡頭」估點(USD×31;區間價取中價),並在 cost 註明基準讓使用者知道超過 6 秒實際費用更高
    points: 37, cost: "$0.10–0.30/秒(720p–4K);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "當前最強影片模型之一;物理正確、可含原生音效與對白",
    bestFor: "正式成品鏡頭、需要聲音的敘事片段",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/sora-2/text-to-video", label: "Sora 2(OpenAI)", category: "text-to-video", tier: "flagship", kind: "video",
    points: 19, cost: "$0.10/秒(720p);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "細節豐富的動態場景、含音訊;敘事鏡頭語言自然",
    bestFor: "故事性片段、複雜運鏡",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", label: "Kling 2.5 Turbo Pro", category: "text-to-video", tier: "flagship", kind: "video",
    points: 13, cost: "$0.07/秒;按秒計費,點數為 6 秒基準", verified: false,
    strengths: "動作流暢度標竿;快節奏動態場景",
    bestFor: "人物動作、活動紀錄感鏡頭",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f), duration: "5" }),
  },
  {
    id: "fal-ai/veo3.1/fast", label: "Veo 3.1 Fast", category: "text-to-video", tier: "economy", kind: "video",
    points: 19, cost: "$0.10/秒(720p);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "Veo 家族的速度版;迭代快、質感仍佳",
    bestFor: "先看方向再升旗艦重生成",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/wan/v2.2-a14b/text-to-video", label: "Wan 2.2(開源)", category: "text-to-video", tier: "economy", kind: "video",
    points: 8, cost: "≈$0.04–0.08/支", verified: true, recommended: true,
    strengths: "開源 14B;性價比首選、已在站內驗證",
    bestFor: "日常分鏡影片、預算有限時的主力",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/minimax/hailuo-2.3/standard/text-to-video", label: "Hailuo 2.3 Standard", category: "text-to-video", tier: "economy", kind: "video",
    points: 9, cost: "$0.28/6秒(768p);按秒計費,點數為 6 秒基準", verified: false,
    strengths: "MiniMax;人物表演與鏡頭感佳(Pro 版 1080p 已驗證存在)",
    bestFor: "人物特寫、情緒鏡頭",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },
  {
    id: "fal-ai/ltx-video", label: "LTX Video(開源)", category: "text-to-video", tier: "budget", kind: "video",
    points: 3, cost: "$0.04–0.2/支", verified: true,
    strengths: "最低成本影片;秒級生成(新版 LTX-2.3 支援 4K+原生音訊)",
    bestFor: "動態預覽、試鏡頭節奏",
    input: (p, f) => ({ prompt: p, aspect_ratio: aspect(f) }),
  },

  /* ═══ 4. 影片轉影片 video-to-video ═══ */
  {
    id: "fal-ai/topaz/upscale/video", label: "Topaz 影片升級", category: "video-to-video", tier: "flagship", kind: "video",
    needs: "video", points: 8, cost: "$0.01–0.08/秒(依解析度);按秒計費,點數為 6 秒基準", verified: true,
    strengths: "業界標準升頻;低清舊素材救星、可倍幀",
    bestFor: "歷史開示影片修復、AI 生成影片升 4K",
    sourceHint: "要升級的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 目錄錯誤修正(fal生態研究 #9):實際定價 $5/分,原標 $0.7–2/分嚴重低估
    id: "fal-ai/sync-lipsync/v2/pro", label: "Lipsync v2 Pro 對嘴", category: "video-to-video", tier: "flagship", kind: "video",
    needs: "video", points: 16, cost: "$5/分;按影片長度計費,點數為 6 秒基準,長片實際費用高於扣點", verified: true,
    strengths: "最新一代對嘴;把配音精準貼合人物口型",
    bestFor: "虛擬主持人、配音替換",
    sourceHint: "人物影片網址(提示詞欄貼音訊網址)",
    input: (p, _f, s) => ({ video_url: s, audio_url: p.trim() }),
  },
  {
    id: "fal-ai/luma-dream-machine/ray-2/modify", label: "Ray-2 Modify 重繪", category: "video-to-video", tier: "flagship", kind: "video",
    needs: "video", points: 30, cost: "≈$0.5–1/支", verified: false,
    strengths: "整段影片風格轉換/元素替換",
    bestFor: "把實拍轉動畫風、統一系列視覺",
    sourceHint: "要重繪的影片網址",
    input: (p, _f, s) => ({ video_url: s, prompt: p }),
  },
  {
    id: "fal-ai/sync-lipsync", label: "Lipsync 1.9 對嘴", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 8, cost: "$0.7/分;按影片長度計費,長片實際費用高於扣點", verified: true,
    strengths: "成熟穩定的對嘴;成本較低",
    bestFor: "一般對嘴需求",
    sourceHint: "人物影片網址(提示詞欄貼音訊網址)",
    input: (p, _f, s) => ({ video_url: s, audio_url: p.trim() }),
  },
  {
    id: "fal-ai/video-upscaler", label: "影片升頻(輕量)", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 19, cost: "$0.1/秒;按秒計費,點數為 6 秒基準", verified: true,
    strengths: "輕量升頻;速度快",
    bestFor: "日常素材小幅提升畫質",
    sourceHint: "要升頻的影片網址",
    input: (_p, _f, s) => ({ video_url: s }),
  },
  {
    // 目錄錯誤修正(fal生態研究 #9):命名空間已遷移到 bria/*,且單價下修一個量級
    id: "fal-ai/bria/video/background-removal", endpoint: "bria/video/background-removal", label: "影片去背", category: "video-to-video", tier: "economy", kind: "video",
    needs: "video", points: 2, cost: "≈$0.01/秒;按秒計費,點數為 6 秒基準", verified: false,
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

  /* ═══ 5. 大型語言模型 llm(NVIDIA NIM,單一端點多型號;LLM 文字整站遷移 NIM,媒體維持 fal) ═══
     endpoint 一律 "nvidia-nim":generationCore 據此分流到 nimSubmit/nimStatus(不走 fal 佇列)。
     計費為 NVIDIA NIM 按 token;短任務單次成本遠低於 1 點,固定扣 1 點與原 any-llm 同口徑。 */
  {
    id: "nvidia-nim#deepseek-r1", endpoint: "nvidia-nim", label: "DeepSeek R1", category: "llm", tier: "flagship", kind: "text",
    points: 1, cost: "按 token(NIM);短任務 <$0.01/次", verified: false,
    strengths: "深度推理鏈旗艦;複雜任務拆解、長鏈邏輯最強",
    bestFor: "腳本結構規劃、需要想清楚再答的複雜任務",
    input: llmInput("deepseek-ai/deepseek-r1"),
  },
  {
    id: "nvidia-nim#llama-3.1-405b", endpoint: "nvidia-nim", label: "Llama 3.1 405B", category: "llm", tier: "flagship", kind: "text",
    points: 1, cost: "按 token(NIM);短任務 <$0.01/次", verified: false,
    strengths: "Meta 開源最大檔;寫作品質與指令遵循頂尖",
    bestFor: "正式腳本撰寫、開示摘要、長文彙整",
    input: llmInput("meta/llama-3.1-405b-instruct"),
  },
  {
    id: "nvidia-nim#nemotron-4-340b", endpoint: "nvidia-nim", label: "Nemotron-4 340B", category: "llm", tier: "flagship", kind: "text",
    points: 1, cost: "按 token(NIM);短任務 <$0.01/次", verified: false,
    strengths: "NVIDIA 自家旗艦;指令對齊佳、輸出穩定",
    bestFor: "腦力激盪、多版本文案",
    input: llmInput("nvidia/nemotron-4-340b-instruct"),
  },
  {
    id: "nvidia-nim#llama-3.1-70b", endpoint: "nvidia-nim", label: "Llama 3.1 70B", category: "llm", tier: "economy", kind: "text",
    points: 1, cost: "按 token(NIM);短任務 <$0.01/次", verified: false, recommended: true,
    strengths: "品質/成本平衡的日常主力(後端自動 LLM 亦預設此檔)",
    bestFor: "標題、短文案、日常改寫",
    input: llmInput("meta/llama-3.1-70b-instruct"),
  },
  {
    id: "nvidia-nim#qwen2.5-72b", endpoint: "nvidia-nim", label: "Qwen2.5 72B(中文)", category: "llm", tier: "economy", kind: "text",
    points: 1, cost: "按 token(NIM);短任務 <$0.01/次", verified: false,
    strengths: "阿里通義開源檔;中文語感第一梯隊、繁中穩定",
    bestFor: "中文金句、弘法文案、中文改寫潤飾",
    input: llmInput("qwen/qwen2.5-72b-instruct"),
  },
  {
    id: "nvidia-nim#mistral-large-2", endpoint: "nvidia-nim", label: "Mistral Large 2", category: "llm", tier: "economy", kind: "text",
    points: 1, cost: "按 token(NIM);短任務 <$0.01/次", verified: false,
    strengths: "歐系旗艦;多語能力佳、風格精煉",
    bestFor: "多語版本文案、翻譯初稿",
    input: llmInput("mistralai/mistral-large-2-instruct"),
  },
  {
    id: "nvidia-nim#llama-3.1-8b", endpoint: "nvidia-nim", label: "Llama 3.1 8B", category: "llm", tier: "budget", kind: "text",
    points: 1, cost: "按 token(NIM);最低成本檔", verified: false,
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
    needs: "audio", points: 1, cost: "≈$0.0008/音訊秒;長錄音實際費用遠高於扣點,長稿建議改用 Scribe", verified: true,
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
    id: "fal-ai/elevenlabs/speech-to-text#keyterms", endpoint: "fal-ai/elevenlabs/speech-to-text", label: "Scribe 關鍵詞強化", category: "speech-to-text", tier: "economy", kind: "text",
    needs: "audio", points: 2, cost: "$0.22/小時+", verified: false,
    strengths: "提示專有名詞(佛學術語)提升辨識",
    bestFor: "術語密集的開示(提示詞欄填術語、逗號分隔)",
    sourceHint: "音訊檔網址",
    input: (p, _f, s) => ({ audio_url: s, language_code: "zho", keyterms: p ? p.split(/[,、，]/).map((t) => t.trim()).filter(Boolean) : undefined }),
  },
  {
    id: "fal-ai/wizper#draft", endpoint: "fal-ai/wizper", label: "Wizper 快速草稿", category: "speech-to-text", tier: "budget", kind: "text",
    needs: "audio", points: 1, cost: "≈$0.0008/音訊秒", verified: true,
    strengths: "最快最省的初稿",
    bestFor: "先看內容再決定精修",
    sourceHint: "音訊檔網址",
    input: (_p, _f, s) => ({ audio_url: s, task: "transcribe" }),
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
    id: "fal-ai/qwen-3-tts/text-to-speech/1.7b", label: "Qwen 3 TTS(中文)", category: "text-to-speech", tier: "economy", kind: "audio",
    points: 3, cost: "$0.09/千字", verified: false,
    strengths: "阿里通義原生中文 TTS;韻律與句讀像真人,中文第一梯隊、比 MiniMax 更省",
    bestFor: "中文旁白日更量產、金句語音、見證旁白",
    input: (p) => ({ text: p }),
  },
  {
    id: "fal-ai/dia-tts", label: "Dia 對話語音", category: "text-to-speech", tier: "economy", kind: "audio",
    points: 2, cost: "$0.04/千字", verified: false,
    strengths: "多角色對話生成(含笑聲、停頓等非語言聲)",
    bestFor: "情境短劇、雙人對談",
    input: (p) => ({ text: p }),
  },
  {
    id: "fal-ai/chatterbox/text-to-speech", label: "Chatterbox", category: "text-to-speech", tier: "economy", kind: "audio",
    points: 1, cost: "$0.025/千字", verified: false,
    strengths: "開源;情感強度可調",
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

  /* ═══ 9. 文字轉音頻(音樂/音效) text-to-audio ═══ */
  {
    id: "fal-ai/lyria2", label: "Lyria 2(Google)", category: "text-to-audio", tier: "flagship", kind: "audio",
    points: 3, cost: "$0.10/30秒", verified: true,
    strengths: "48kHz 錄音室級音質;器樂氛圍最佳",
    bestFor: "禪修背景樂、片頭配樂",
    input: (p) => ({ prompt: p }),
  },
  {
    id: "fal-ai/elevenlabs/music", label: "ElevenLabs Music", category: "text-to-audio", tier: "flagship", kind: "audio",
    points: 5, cost: "$0.15–0.80/分", verified: false,
    strengths: "授權資料訓練(版權安全);結構化歌曲",
    bestFor: "對外發布影片的配樂(版權安心)",
    input: (p) => ({ prompt: p }),
  },
  {
    id: "fal-ai/stable-audio-25/text-to-audio", label: "Stable Audio 2.5", category: "text-to-audio", tier: "flagship", kind: "audio",
    points: 7, cost: "$0.20/次", verified: false,
    strengths: "長度與參數控制精細;音樂+音效兼修",
    bestFor: "指定長度的配樂段落",
    input: (p) => ({ prompt: p, seconds_total: 30 }),
  },
  {
    id: "fal-ai/minimax-music", label: "MiniMax Music", category: "text-to-audio", tier: "economy", kind: "audio",
    points: 2, cost: "$0.03/首", verified: true, recommended: true,
    strengths: "極高性價比的完整歌曲(可含人聲)",
    bestFor: "主題曲 demo、快速配樂",
    input: (p) => ({ prompt: p }),
  },
  {
    id: "fal-ai/elevenlabs/sound-effects/v2", label: "ElevenLabs 音效 v2", category: "text-to-audio", tier: "economy", kind: "audio",
    points: 2, cost: "≈$0.01/次", verified: true,
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
    id: "fal-ai/ace-step", label: "ACE-Step(開源)", category: "text-to-audio", tier: "budget", kind: "audio",
    points: 1, cost: "$0.0002/秒", verified: true,
    strengths: "全站最低成本音樂生成",
    bestFor: "氛圍底噪、練習用",
    input: (p) => ({ prompt: p }),
  },

  /* ═══ 10. 訓練 training(LoRA;來源=素材 zip 網址,提示詞=觸發詞) ═══ */
  {
    id: "fal-ai/flux-2-trainer", label: "FLUX.2 訓練器", category: "training", tier: "flagship", kind: "text",
    needs: "zip", points: 200, cost: "$6.4/千步", verified: true,
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
    id: "fal-ai/flux-kontext-trainer", label: "Kontext 訓練器", category: "training", tier: "flagship", kind: "text",
    needs: "zip", points: 130, cost: "≈$4/次", verified: true,
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
    needs: "zip", points: 65, cost: "$2/次", verified: true,
    strengths: "美感取向的 Krea 基底",
    bestFor: "唯美系視覺風格",
    sourceHint: "訓練圖包 zip 網址",
    input: (p, _f, s) => ({ images_data_url: s, trigger_word: p.trim() || "STYLE" }),
  },
  {
    id: "fal-ai/flux-lora-fast-training", label: "FLUX LoRA 快速訓練", category: "training", tier: "budget", kind: "text",
    needs: "zip", points: 65, cost: "≈$2/次", verified: true, recommended: true,
    strengths: "經典入門訓練器;幾分鐘出模型",
    bestFor: "第一次嘗試訓練",
    sourceHint: "訓練圖包 zip 網址",
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
    id: "wf/full-short-flagship", label: "完整短片(旗艦)", tier: "flagship", points: 40,
    strengths: "LLM 潤飾腳本 → 旗艦文生圖定調 → Veo 3.1 成片;三步到位",
    bestFor: "正式對外的 15 秒形象短片",
    steps: [
      { modelId: "nvidia-nim#llama-3.1-405b", promptTemplate: "把以下構想潤飾成一段 40 字內的影片畫面描述(供文生影片模型使用,繁體中文):{prompt}", note: "腳本潤飾" },
      { modelId: "fal-ai/bytedance/seedream/v4.5/text-to-image", promptTemplate: "{prev}", note: "先出定調圖" },
      { modelId: "fal-ai/veo3.1", promptTemplate: "{prev}", note: "生成成片鏡頭" },
    ],
  },
  {
    id: "wf/brand-storyboard-flagship", label: "品牌繪本(旗艦)", tier: "flagship", points: 7,
    strengths: "LLM 出分鏡文案 → 旗艦出圖 → 編輯統一風格",
    bestFor: "系列感的三格分鏡圖",
    steps: [
      { modelId: "nvidia-nim#llama-3.1-405b", promptTemplate: "把主題「{prompt}」化為一句電影感畫面描述(40 字內,繁體中文)", note: "分鏡文案" },
      { modelId: "fal-ai/nano-banana-2", promptTemplate: "{prev}", note: "生成主圖" },
      { modelId: "fal-ai/nano-banana-2/edit", promptTemplate: "保持構圖不變,將整體色調調整為溫暖的琥珀色晨光", usePrevAsSource: true, note: "統一調性" },
    ],
  },
  {
    id: "wf/quote-card-flagship", label: "金句卡(旗艦)", tier: "flagship", points: 3,
    strengths: "LLM 摘句 → Ideogram 文字卡;中文排版強",
    bestFor: "每日金句社群圖",
    steps: [
      { modelId: "nvidia-nim#qwen2.5-72b", promptTemplate: "從以下內容擷取一句 20 字內的金句(只回金句本身):{prompt}", note: "摘金句" },
      { modelId: "fal-ai/ideogram/v3", promptTemplate: "極簡禪意海報,溫暖米色背景,優雅繁體中文書法字:「{prev}」", note: "生成文字卡" },
    ],
  },
  {
    id: "wf/full-short-economy", label: "完整短片(經濟)", tier: "economy", points: 10,
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
    id: "wf/quote-card-economy", label: "金句卡(經濟)", tier: "economy", points: 2,
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

export function getModel(id: string): ModelEntry | undefined {
  return MODELS.find((m) => m.id === id) ?? LEGACY_MODELS.find((m) => m.id === id);
}

/* 為什麼:工作流合計點數曾多條與單步實扣不符(UI 顯示夠用、中途才被額度擋下的斷鏈),
   故模組載入時一律由單步模型註冊表推導覆寫,單步點數改動後下游(workflows API/catalog/文件)自動同步。
   注意:必須放在 MODELS/WORKFLOW_PRESETS/LEGACY_MODELS 初始化之後,否則 getModel 會踩 const 的 TDZ。 */
for (const w of WORKFLOW_PRESETS) {
  w.points = w.steps.reduce((sum, st) => sum + (getModel(st.modelId)?.points ?? 0), 0);
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
