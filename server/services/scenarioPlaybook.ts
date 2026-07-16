/**
 * 情境對應手冊（《fal生態研究》scenario playbook 落地，2026-07）：
 * 「我要做什麼」→ 推薦模型鏈＋用法＋替代。餵給 AI 專案助手的 scenario_guide 工具，
 * 讓助手回答「做金句卡用哪個模型」這類問題時有站內目錄背書，而不是憑 LLM 記憶亂猜。
 * 條目為研究摘要的濃縮版；模型細節以 shared/models.ts 目錄現值為準（助手可再用 find_model 查點數）。
 */
export interface ScenarioEntry {
  key: string;
  title: string;
  /** 關鍵字（搜尋比對用，含同義口語） */
  keywords: string[];
  recommend: string;
  usage: string;
  alternative: string;
}

export const SCENARIO_PLAYBOOK: ScenarioEntry[] = [
  {
    key: "quote-card",
    title: "每日金句卡・繁體中文書法/直排字",
    keywords: ["金句卡", "字卡", "中文字", "書法", "法語", "每日一句"],
    recommend: "Qwen Image 2.0（量產,約1點/張）→ 成品級升 Qwen Image 2.0 Pro 或 GPT Image 2（逐字零錯字）",
    usage: "直接打中文描述＋要放的字句即可。中文字渲染是多數模型的死穴，務必鎖 Qwen/Seedream/GPT Image 梯隊，絕不要用 FLUX/Imagen/Ideogram 寫中文。放大字卡只用忠實型放大器（Thera），生成式放大會把字改亂碼。",
    alternative: "Seedream 4.5（多文字區塊版面）；草稿試構圖用 FLUX.1 schnell/Sana（每張不到 0.2 點）",
  },
  {
    key: "poster",
    title: "含中文標題的活動海報/募款文宣",
    keywords: ["海報", "文宣", "活動", "募款", "多文字"],
    recommend: "Seedream 4.5（或 5.0 Pro）出主視覺；向量 logo/字標另走 Recraft V3（SVG 可印刷，但不寫中文字）",
    usage: "Seedream 管中文版面、Recraft 管圖形識別——分工而非二選一。印大圖接 Topaz Image 或 SeedVR 放大；含中文字部分鎖忠實型放大。",
    alternative: "GPT Image 2（中英日並存、逐字精準，最貴留給零錯字的對外正式物）",
  },
  {
    key: "portrait",
    title: "莊嚴人物寫真/志工紀實感主視覺",
    keywords: ["人物", "寫真", "人像", "紀實", "莊嚴"],
    recommend: "Imagen 4 Ultra 或 FLUX1.1 [pro] ultra（約2點）；經濟檔 Imagen 4 Fast",
    usage: "膚質光影最乾淨的兩檔，打字即出。注意：涉及師父本人形象時改走「真實照片＋編輯/打光」路線，不要憑空生成師父。",
    alternative: "FLUX.2 [pro] / Nano Banana 2（指令理解更強，適合敘事定調圖）",
  },
  {
    key: "consistent-character",
    title: "見證故事・主角跨十多個分鏡同一張臉",
    keywords: ["同一張臉", "角色一致", "跨鏡", "見證故事", "主角", "一致性"],
    recommend: "三步鏈：(1) Ideogram Character（單張參考照→全片同人）或 Nano Banana 2 Edit 定角色分鏡圖 →(2) Kling 2.5 Turbo Pro i2v 或 Hailuo 2.3 Pro i2v 動起來 →(3) MMAudio V2 補環境音",
    usage: "關鍵觀念：純文生影片做不到跨鏡同臉，一定要「先出圖鎖角色、再圖生影片」。長期反覆用的固定角色才升級訓練 LoRA；一次性故事用 Ideogram Character 更划算。",
    alternative: "影片端直接參考：Vidu Q1 reference-to-video（日常）/ Kling O1（正式）",
  },
  {
    key: "transcribe",
    title: "師父開示錄音→逐字稿→可剪輯大綱",
    keywords: ["逐字稿", "轉錄", "開示", "錄音", "轉文字", "字幕稿"],
    recommend: "ElevenLabs Scribe（$0.008/分，一小時開示約 15 點）→ 簡轉繁＋術語校對 → Gemini 2.5 Pro 一次讀完出分段大綱與金句",
    usage: "一小時開示轉錄極便宜卻省數倍人力。多數引擎預設吐簡體且佛學名詞會誤字，務必過後處理＋人工校對。",
    alternative: "快速草稿用 Wizper；帶時間戳字幕稿用 Whisper large-v3",
  },
  {
    key: "narration",
    title: "開示逐字稿/見證文稿→中文旁白配音",
    keywords: ["旁白", "配音", "中文語音", "唸稿", "TTS"],
    recommend: "MiniMax Speech 02 HD（中文原生第一梯隊，帶情緒）或 ElevenLabs v3（語氣標記可導演性最強）",
    usage: "1 分鐘中文旁白約 1 點，放心多次試聽 A/B。要「會方招牌聲」用 MiniMax Voice Clone 一次克隆長期複用——真人聲音克隆需書面授權。",
    alternative: "日更量產用 Qwen 3 TTS（更省中文同級）；草稿試聽 Kokoro 中文",
  },
  {
    key: "morph-card",
    title: "金句卡動態版：A 畫面漸變到 B 的象徵敘事",
    keywords: ["漸變", "動態卡", "首尾", "含苞", "綻放", "轉場"],
    recommend: "Qwen/Seedream 出首尾兩張卡 → Kling O1 first-last-frame（高質感）或 Wan-FLF2V（低成本量試）",
    usage: "首尾影格控制是「指定象徵結局」的唯一途徑。幾乎靜止的呼吸感微動改用 SVD（1–3 點）。（註：首尾影格需要兩張輸入，目前請在工作台分兩步做）",
    alternative: "直式社群動態背景：PixVerse v5.5",
  },
  {
    key: "broll",
    title: "療癒空鏡/禪意 B-roll（晨光、蓮花、雲海、水面）",
    keywords: ["空鏡", "B-roll", "禪意", "晨光", "蓮花", "風景影片"],
    recommend: "日常量產：Wan 2.2 / Seedance Lite；質感檔：Seedance Pro 或 Luma Ray 2（運鏡最貼莊嚴療癒調性）",
    usage: "選好比例後打中文描述即可。切記：影片模型畫面內寫不出正確中文字，字卡一律文生圖另做再疊。一次 5–10 秒，長片分鏡拼接。",
    alternative: "帶原生環境音的成片鏡頭：Veo 3.1（貴精用）或 Kling 2.6 Pro（便宜得多）",
  },
  {
    key: "music",
    title: "莊嚴/療癒配樂與中文主題曲",
    keywords: ["配樂", "音樂", "主題曲", "音效", "鐘聲", "BGM"],
    recommend: "純器樂墊底樂：Lyria 2 或 Stable Audio 2.5（可指定長度）；中文人聲主題曲：MiniMax Music；單發音效（鐘磬木魚流水）：ElevenLabs 音效 v2",
    usage: "用中文描述「莊嚴/療癒/古箏/60秒」即可。對外公開發布且版權要最保險用 ElevenLabs Music。",
    alternative: "量產多版讓組員挑：CassetteAI；金句對字幕 MV：DiffRhythm（極便宜）",
  },
  {
    key: "photo-restore",
    title: "老照片復活（見證故事/道場沿革/紀念影片）",
    keywords: ["老照片", "修復", "黑白", "上色", "翻拍", "泛黃"],
    recommend: "一鍵版：老照片一鍵修復（photo-restoration，免提示詞）；精修鏈：CodeFormer 修臉 → DDColor 上色 → Thera 忠實放大",
    usage: "整條鏈每張不到 1 點，把黑白遺照、模糊老照救成可用素材。修臉用保守檔以保留本人身分；涉及往生者需家屬同意。",
    alternative: "極糊素材起死回生用 Clarity/SUPIR 生成式修復，但會微改五官，見證照慎用",
  },
  {
    key: "video-restore",
    title: "珍貴歷史開示影帶修復重製",
    keywords: ["影帶", "舊影片", "修復影片", "升級畫質", "4K"],
    recommend: "關鍵成品：Topaz 影片升級；整批舊素材：SeedVR2（打量便宜）；卡頓順化：RIFE 補幀",
    usage: "按長度×解析度計費，長片實際費用高於固定扣點。策略：先 SeedVR2 批量粗修全庫，挑出要上架的再過 Topaz。",
    alternative: "趕時間小修：影片升頻（輕量）",
  },
  {
    key: "multilingual",
    title: "多語弘法：中文開示做成英/日語版（保留影像只改口型）",
    keywords: ["多語", "英文版", "日語", "翻譯", "對嘴", "口型"],
    recommend: "三步鏈：Claude Sonnet 4.5 翻譯（保留佛教語感）→ ElevenLabs Multilingual v2 配外語音 → Lipsync v2 Pro 對嘴",
    usage: "對嘴與語言無關、音訊驅動。倫理紅線：只限「本人影像＋本人授權的另語言配音」，不得假冒發言。",
    alternative: "英文字幕初稿：Whisper 翻譯（→英）；日常量產降 Lipsync 1.9",
  },
  {
    key: "background-removal",
    title: "人物去背合成到莊嚴場景（無棚無綠幕）",
    keywords: ["去背", "合成", "換背景", "摳圖", "綠幕"],
    recommend: "圖：BiRefNet v2 去背（髮絲/袈裟邊緣最乾淨）→ Nano Banana 2 Edit 以透明 PNG＋場景描述合成；影片：Bria 影片去背",
    usage: "去背只裁切不重繪，師父面容一個像素都不會被 AI 改動——宗教影像莊重性的決定性保證。",
    alternative: "不想兩步：Bria 換背景一步到位；指定物件摳圖：SAM 3",
  },
  {
    key: "photo-cleanup",
    title: "活動照整理：清雜物/路人、改比例、統一光感",
    keywords: ["清雜物", "路人", "擴圖", "改比例", "打光", "整理照片"],
    recommend: "清雜物：object-removal（免遮罩一鍵）；直式轉 16:9 不裁人：Bria Expand 擴圖；統一莊嚴光感：IC-Light V2 重新打光",
    usage: "三顆都是「丟圖即得」的一鍵功能，是志工日常勞務的直接替代。IC-Light 讓合成拼貼不露餡。",
    alternative: "影片版清雜物：Bria Video Eraser（按秒計費，精用）",
  },
  {
    key: "brand-lora",
    title: "本會品牌一致：專屬視覺風格＋固定聲線資產化",
    keywords: ["品牌", "風格訓練", "LoRA", "專屬風格", "聲線", "克隆"],
    recommend: "中文字卡風格：qwen-image-trainer（自家風格＋中文不錯字兼得）；人物形象：flux-lora-portrait-trainer；聲線：MiniMax Voice Clone",
    usage: "定位是「管理員訓練 3–5 顆、全員像選濾鏡一樣用」，不是人人訓練。訓練一次投資、全員攤提。",
    alternative: "低預算先驗證素材包：z-image-trainer（100 步約 7 點）",
  },
  {
    key: "avatar",
    title: "虛擬主持人：「每週佛法小知識」說話頭像",
    keywords: ["虛擬主持人", "頭像", "說話", "主播"],
    recommend: "MiniMax/Qwen TTS 出中文語音 → Kling AI Avatar（中文對嘴甜蜜點；需頭像＋音訊兩個輸入，目前請分步操作）",
    usage: "30 秒約 50 點屬中價功能。肖像限「預製頭像或已授權志工照」；不建議用師父肖像做虛擬頭像。",
    alternative: "旗艦全身手勢：OmniHuman",
  },
  {
    key: "post-production",
    title: "無聲 AI 影片→成品：補音＋字幕",
    keywords: ["補音", "環境音", "字幕", "後製", "無聲"],
    recommend: "MMAudio V2 補對畫面同步的環境音（極便宜）→ 字幕燒錄工具上中文字幕",
    usage: "這條鏈讓便宜的 Wan 影片用 1/10 價格逼近 Veo 有聲體驗。",
    alternative: "正式成品擬音層：HunyuanVideo-Foley",
  },
  {
    key: "script-writing",
    title: "腳本/分鏡/金句文案/翻譯（每一步的黏著劑）",
    keywords: ["腳本", "文案", "翻譯", "金句", "大綱", "潤稿"],
    recommend: "日常預設：Gemini 2.5 Flash（快省繁中自然）；正式稿與教義分寸審閱：Claude Sonnet 4.5；長逐字稿一次讀：Gemini 2.5 Pro",
    usage: "按 token 計費，短提示約 1 點/次；讀整份逐字稿的長任務走 Gemini Pro。",
    alternative: "中文味＋省錢：Qwen 系；海量打標籤：Gemini Flash Lite",
  },
  {
    key: "asset-catalog",
    title: "素材庫活化：上千張照片看圖建檔＋中文 OCR",
    keywords: ["看圖", "建檔", "OCR", "掃描", "手稿", "整理素材"],
    recommend: "批量看圖生繁中描述：Gemini 2.5 Flash 視覺；師父手稿/經文掃描：GOT-OCR 2.0",
    usage: "讓沉睡素材變可搜尋的知識庫。任何中文看圖/OCR 都不要用 Florence-2（偏拉丁字）。",
    alternative: "最準：Gemini 2.5 Pro 視覺；英文極省粗篩：Moondream",
  },
  {
    key: "sketch-to-final",
    title: "手繪分鏡草圖/實景照→成品圖（構圖不跑）",
    keywords: ["草圖", "手繪", "線稿", "照片轉圖", "構圖"],
    recommend: "flux-lora-canny（線稿）/ flux-lora-depth（照片結構），1 點/張可疊自訓風格 LoRA",
    usage: "把「照我的草圖畫」的構圖鎖住再上風格。連續分鏡推進用 qwen-image-edit 系（中文指令易用性最高）。",
    alternative: "品質檔：flux-pro canny/depth",
  },
  {
    key: "image-to-video",
    title: "分鏡圖動起來（圖生影片）",
    keywords: ["圖生影片", "動起來", "分鏡動態", "i2v"],
    recommend: "日常主力：Wan 2.2 A14B 圖生影片（性價比最佳）；人物動態：Kling 2.5 Turbo Pro / Hailuo 2.3 Pro；快速預覽：LTX",
    usage: "先出圖鎖構圖角色，再讓它動——比純文生影片可控得多。一次 5–10 秒。",
    alternative: "頂規對外鏡頭：Kling 2.6 Pro（可直出中英語音）",
  },
];

/** 關鍵字搜尋：比對標題與 keywords，回最相關前 N 條 */
export function searchPlaybook(query: string, limit = 2): ScenarioEntry[] {
  const q = query.toLowerCase();
  const scored = SCENARIO_PLAYBOOK.map((e) => {
    let score = 0;
    if (e.title.toLowerCase().includes(q)) score += 3;
    for (const k of e.keywords) {
      if (q.includes(k.toLowerCase()) || k.toLowerCase().includes(q)) score += 2;
    }
    if (e.recommend.toLowerCase().includes(q)) score += 1;
    return { e, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.e);
}
