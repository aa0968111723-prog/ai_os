/**
 * 情境手冊(scenario playbook):《fal生態研究》20 條創作情境的濃縮版——
 * 「創作者描述要做什麼 → 該用哪些模型/路線+避雷」的對應表。
 * 用途:(1)AI 專案助手的挑模型知識(W4);(2)之後 ModelsPage 三題精靈的規則庫(P2 #16)。
 * modelIds 只放「已在 shared/models.ts 目錄」的 id(測試守門);目錄外的方案寫在 tip 裡
 * 標「目錄暫缺」,助手可以誠實告知而不是提議一顆會失敗的按鈕。
 */

export interface ScenarioEntry {
  id: string;
  /** 創作者口語的情境名(關鍵字比對用) */
  title: string;
  /** 推薦路線(一句話,含模型名) */
  recommend: string;
  /** 避雷與用法要點 */
  tip: string;
  /** 目錄內可直接生成的模型 id(依推薦順序;空=此情境主力尚未入目錄) */
  modelIds: string[];
}

export const SCENARIO_PLAYBOOK: ScenarioEntry[] = [
  {
    id: "quote-card",
    title: "每日金句卡/繁體中文書法字卡",
    recommend: "Qwen Image 2.0 量產(約1點);成品級升 Qwen Image 2.0 Pro 或 GPT Image 2(逐字零錯字)",
    tip: "畫面要出現中文字只能用 Qwen/Seedream/GPT Image 梯隊;FLUX/Imagen/Ideogram 寫中文會缺筆變形",
    modelIds: ["fal-ai/qwen-image-2/text-to-image", "fal-ai/qwen-image-2/pro/text-to-image", "openai/gpt-image-2"],
  },
  {
    id: "poster",
    title: "含中文標題的活動海報/募款文宣",
    recommend: "Seedream 4.5 出多文字區塊主視覺;零錯字對外正式物用 GPT Image 2",
    tip: "多段文字+多主體的版面交給 Seedream;單價最高的 GPT Image 2 留給對外正式物",
    modelIds: ["fal-ai/bytedance/seedream/v4.5/text-to-image", "openai/gpt-image-2"],
  },
  {
    id: "portrait",
    title: "莊嚴人物寫真/志工紀實感主視覺",
    recommend: "旗艦 FLUX.2 [pro] 或 Nano Banana 2;寫實草稿用 FLUX.1 [dev]",
    tip: "涉及師父本人形象時不要憑空生成——改走真實照片+編輯路線(圖生圖),莊重性才有保證",
    modelIds: ["fal-ai/flux-2/pro", "fal-ai/nano-banana-2", "fal-ai/flux/dev"],
  },
  {
    id: "consistent-character",
    title: "見證故事主角跨多個分鏡同一張臉",
    recommend: "先出圖鎖角色(Nano Banana 2 Edit 或角色定裝卡)→ 逐鏡沿用同一參考",
    tip: "純文生影片做不到跨鏡同臉;長期反覆用的固定角色才值得訓練 LoRA(一次投資全員共用)",
    modelIds: ["fal-ai/nano-banana-2/edit", "fal-ai/flux-pro/kontext"],
  },
  {
    id: "transcribe",
    title: "開示錄音轉逐字稿/可剪輯大綱",
    recommend: "ElevenLabs Scribe(關鍵詞強化版可餵佛學術語)→ Gemini 2.5 Pro 一次讀完出大綱與金句",
    tip: "一小時開示轉錄約 1 點級;多數引擎預設吐簡體且佛學名詞會誤字,出稿後要人工校對一遍",
    modelIds: ["fal-ai/elevenlabs/speech-to-text", "fal-ai/elevenlabs/speech-to-text#keyterms", "fal-ai/any-llm#gemini-2.5-pro"],
  },
  {
    id: "narration",
    title: "文稿配中文旁白(催淚感恩或莊嚴沉穩)",
    recommend: "MiniMax Speech 02 HD(中文第一梯隊)或 ElevenLabs v3(語氣可導演);日更量產用 Qwen 3 TTS",
    tip: "1 分鐘中文旁白約 300 字≈1 點,放心多次試聽 A/B;真人聲音克隆需書面授權",
    modelIds: ["fal-ai/minimax/speech-02-hd", "fal-ai/elevenlabs/tts/eleven-v3", "fal-ai/qwen-3-tts/text-to-speech/1.7b"],
  },
  {
    id: "quote-motion",
    title: "金句卡動態版(A 畫面漸變到 B 的象徵敘事)",
    recommend: "Qwen/Seedream 先出首尾兩張卡;首尾影格生影片的端點目錄暫缺,先以文生影片近似",
    tip: "「含苞→綻放」這類指定結局要靠首尾影格控制(Kling O1/Wan-FLF2V,目錄暫缺——可回報需求)",
    modelIds: ["fal-ai/qwen-image-2/text-to-image", "fal-ai/wan/v2.2-a14b/text-to-video"],
  },
  {
    id: "b-roll",
    title: "療癒空鏡/禪意 B-roll(晨光、蓮花、雲海)",
    recommend: "日常量產 Wan 2.2;要原生環境音(鐘聲氛圍)的正式鏡頭精用 Veo 3.1",
    tip: "影片模型畫面內寫不出正確中文字——字卡一律文生圖另做再疊;先便宜檔試方向,選中才上旗艦",
    modelIds: ["fal-ai/wan/v2.2-a14b/text-to-video", "fal-ai/veo3.1", "fal-ai/ltx-video"],
  },
  {
    id: "music",
    title: "莊嚴/療癒配樂與中文主題曲",
    recommend: "純器樂墊底樂 Lyria 2;中文人聲主題曲 MiniMax Music;單發音效(鐘磬木魚)ElevenLabs 音效",
    tip: "對外公開發布且版權要最保險用 ElevenLabs Music;用中文描述「莊嚴/古箏/60秒」即可",
    modelIds: ["fal-ai/lyria2", "fal-ai/minimax-music", "fal-ai/elevenlabs/sound-effects/v2", "fal-ai/elevenlabs/music"],
  },
  {
    id: "photo-restore",
    title: "老照片修復復活(黑白遺照、翻拍模糊)",
    recommend: "一鍵修復鏈(修臉→上色→放大)端點目錄暫缺;先用圖生圖低強度修補",
    tip: "見證照要用「忠實型」處理保留本人身分;生成式修復會微改五官,慎用並人工檢查",
    modelIds: ["fal-ai/flux/dev/image-to-image"],
  },
  {
    id: "video-restore",
    title: "珍貴歷史開示影帶修復重製",
    recommend: "關鍵成品 Topaz 影片升級;卡頓順化 RIFE 補幀",
    tip: "按長度×解析度計費,長片實際費用高於固定扣點;先挑要上架的片段再精修",
    modelIds: ["fal-ai/topaz/upscale/video", "fal-ai/rife/video"],
  },
  {
    id: "multilingual",
    title: "中文開示做成英/日語版(保留影像只改口型)",
    recommend: "Claude 翻譯(保留佛教語感)→ ElevenLabs Multilingual v2 配外語音 → Lipsync 對嘴",
    tip: "倫理紅線:只限「本人影像+本人授權配音」,不得假冒發言;近景正式片用 Lipsync v2 Pro($5/分)",
    modelIds: ["fal-ai/any-llm#claude-sonnet-4.5", "fal-ai/elevenlabs/tts/multilingual-v2", "fal-ai/sync-lipsync", "fal-ai/sync-lipsync/v2/pro"],
  },
  {
    id: "bg-removal",
    title: "人物去背合成到莊嚴場景",
    recommend: "影片去背後合成;圖片合成用 Nano Banana 2 Edit(場景描述+人物照)",
    tip: "去背只裁切不重繪,師父面容一個像素都不會被 AI 改動——宗教影像莊重性的決定性保證",
    modelIds: ["fal-ai/bria/video/background-removal", "fal-ai/nano-banana-2/edit"],
  },
  {
    id: "photo-cleanup",
    title: "活動照整理(清雜物路人、改比例、統一光感)",
    recommend: "用圖生圖編輯類(Nano Banana 2 Edit/Qwen Edit Plus)口語指令修圖",
    tip: "「把左邊的雜物移除」這類指令 Nano Banana 系理解最好;一鍵清雜物/擴圖端點目錄暫缺",
    modelIds: ["fal-ai/nano-banana-2/edit", "fal-ai/qwen-image-edit-plus"],
  },
  {
    id: "brand-lora",
    title: "本會品牌一致:專屬視覺風格資產化",
    recommend: "中文字卡風格用 Qwen Image 訓練器(唯一「自家風格+中文不錯字」兼得);人物形象用人像 LoRA 訓練器",
    tip: "定位是「管理員訓練 3–5 顆、全員共用」不是人人訓練;訓練一次 60–200 點,長期攤提",
    modelIds: ["fal-ai/qwen-image-trainer", "fal-ai/flux-lora-portrait-trainer"],
  },
  {
    id: "avatar",
    title: "虛擬主持人/說話頭像系列",
    recommend: "TTS 出中文語音 → 對嘴到預製頭像影片(Lipsync)",
    tip: "肖像來源限「預製頭像或已授權志工照」;不建議用師父肖像做虛擬頭像",
    modelIds: ["fal-ai/minimax/speech-02-hd", "fal-ai/sync-lipsync"],
  },
  {
    id: "silent-to-final",
    title: "無聲 AI 影片補音+字幕出成品",
    recommend: "便宜的 Wan 影片+配樂/音效補音,用 1/10 價格逼近 Veo 有聲體驗",
    tip: "自動字幕/合成端點目錄暫缺,音畫合成先在剪輯軟體完成;環境音用音效模型描述生成",
    modelIds: ["fal-ai/wan/v2.2-a14b/text-to-video", "fal-ai/elevenlabs/sound-effects/v2", "fal-ai/lyria2"],
  },
  {
    id: "copywriting",
    title: "腳本/分鏡/金句文案/翻譯",
    recommend: "日常預設 Gemini 2.5 Flash;正式稿與敏感/教義分寸審閱 Claude Sonnet 4.5;長逐字稿一次讀 Gemini 2.5 Pro",
    tip: "「1 點/次」對短提示成立,讀整份長逐字稿建議走 Gemini Pro 並留意點數",
    modelIds: ["fal-ai/any-llm#gemini-2.5-flash", "fal-ai/any-llm#claude-sonnet-4.5", "fal-ai/any-llm#gemini-2.5-pro"],
  },
  {
    id: "asset-catalog",
    title: "素材庫活化:批量看圖建檔+中文 OCR",
    recommend: "批量看圖生繁中描述用 Gemini 視覺;圖中文字擷取有 OCR 模型",
    tip: "中文看圖/OCR 不要用 Florence-2(偏拉丁字);最準用 Gemini 2.5 Pro 視覺",
    modelIds: ["fal-ai/any-llm/vision#gemini-2.5-pro", "fal-ai/florence-2-large/ocr", "fal-ai/moondream-next"],
  },
  {
    id: "sketch-to-final",
    title: "手繪分鏡草圖/實景照→成品圖(構圖不跑)",
    recommend: "以草圖為底的圖生圖(FLUX dev 圖生圖強度可控);連續分鏡推進用 Qwen Edit Plus 中文指令",
    tip: "ControlNet 線稿/深度端點目錄暫缺;草圖重繪把 strength 想成「保守/標準/積極」三檔",
    modelIds: ["fal-ai/flux/dev/image-to-image", "fal-ai/qwen-image-edit-plus"],
  },
];

/** 跨類抉擇心法(五條,注入提示詞用的濃縮版) */
export const PLAYBOOK_PRINCIPLES = [
  "只有三種場合值得上旗艦:對外門面、不可重來的珍貴資產(歷史影像修復/近景對嘴)、版權必須最保險;其餘九成日常用經濟檔,肉眼差距遠小於 5–20 倍價差",
  "影片最貴:先用便宜檔(LTX/Wan)大量試方向,選中的鏡頭才上旗艦;長片分鏡拼接,不要單支拉長秒數",
  "中文鐵律:畫面要有中文字→只能 Qwen/Seedream/GPT Image;影片內寫不出中文字,字卡另做再疊;中文語音→MiniMax/Qwen TTS",
  "涉及師父與真實見證者→優先「真實素材加工」(去背/修復/放大,像素不重繪);「憑空生成」留給不存在的畫面(空鏡/插畫/示意)",
  "角色一致:一次性故事用參考圖;跨影片鏡頭先出圖再生影片;長期反覆用才訓練 LoRA",
];

/** 注入 LLM 提示詞的濃縮文字版(約 3–4KB;gemini flash 窗口下成本可忽略) */
export function scenarioPlaybookText(): string {
  const entries = SCENARIO_PLAYBOOK.map(
    (s) => `- ${s.title}:${s.recommend}。${s.tip}${s.modelIds.length ? `(目錄模型:${s.modelIds.join("、")})` : ""}`,
  );
  return `${entries.join("\n")}\n【心法】\n${PLAYBOOK_PRINCIPLES.map((p) => `- ${p}`).join("\n")}`;
}
