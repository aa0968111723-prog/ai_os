/**
 * 底層模型（基座權重）的公開身分資料。
 *
 * 目錄裡的 id 是「fal 端點」，不是「模型本身」——`fal-ai/flux/dev`、`fal-ai/flux-lora`、
 * `fal-ai/flux/dev/image-to-image` 是同一顆 FLUX.1 [dev] 的三個入口，而
 * `fal-ai/any-llm#claude-opus-4.5` 的底層根本不是 fal 的模型。使用者要比較與分析時，
 * 真正要知道的是**這條端點背後是誰家的哪顆權重**：同基座的兩個端點換過去風格不會變，
 * 換基座才會；閉源 API 模型沒有權重可下載，也沒有 LoRA 可掛。
 *
 * 資料來源：`docs/模型底層邏輯與運作流程.md`、`docs/research/model-deep-dive-2026-08/`、
 * `docs/fal生態研究.md`（皆對照 fal 官方頁／llms.txt 整理）。
 *
 * 誠實規則（與 shared/textEncoders 同一條）：**沒有公開來源就不填數字、不宣稱權重狀態**。
 * 不確定的一律 `weights: "unknown"` 並在 note 寫明「官方未公開」，不猜參數量。
 * 這裡講的是模型身分，不是它怎麼跑——運作流程見 `shared/modelMechanics`。
 */

/** 權重取得方式：公開下載／僅 API／未公開說明 */
export type WeightsAccess = "open" | "closed" | "unknown";

export interface ModelBaseSpec {
  /** 家族鍵（測試與 UI 分組用） */
  key: string;
  /** 底層模型／權重名稱（給人看） */
  baseModel: string;
  /** 出品方 */
  developer: string;
  /** 骨幹架構一句話 */
  arch: string;
  /** 參數量——**只有官方／論文公開時才填**，不估算 */
  params?: string;
  weights: WeightsAccess;
  /** 一句話：這顆基座對使用者的實際意義 */
  note: string;
}

export const WEIGHTS_LABEL: Record<WeightsAccess, string> = {
  open: "權重公開",
  closed: "閉源 API",
  unknown: "未公開",
};

export const WEIGHTS_HINT: Record<WeightsAccess, string> = {
  open: "權重可公開取得，社群有 LoRA／微調生態，行為與版本可查",
  closed: "只提供 API，沒有權重可下載；內部結構與版本更動由供應商決定",
  unknown: "官方未載明權重是否公開，站內不猜",
};

interface BaseRule {
  match: RegExp;
  spec: ModelBaseSpec;
}

/* ── FLUX 家族（BFL） ── */
const FLUX1_DEV: ModelBaseSpec = {
  key: "flux1-dev",
  baseModel: "FLUX.1 [dev]",
  developer: "Black Forest Labs",
  arch: "12B rectified-flow transformer（Double／Single-Stream，非 U-Net）",
  params: "12B",
  weights: "open",
  note: "站內圖像主力基座：權重公開所以 LoRA 生態最完整；主端點沒有 negative_prompt 欄位。",
};

/* ── SDXL 家族 ── */
const SDXL_BASE: ModelBaseSpec = {
  key: "sdxl",
  baseModel: "Stable Diffusion XL 1.0",
  developer: "Stability AI",
  arch: "U-Net 潛空間擴散（雙 CLIP 交叉注意力）",
  params: "U-Net 約 2.6B",
  weights: "open",
  note: "最老牌的開源基座：negative_prompt／seed／步數這些旋鈕最齊，但文字窗口只有 77。",
};

/* ── Wan（阿里通義萬相） ── */
const WAN_OPEN: ModelBaseSpec = {
  key: "wan",
  baseModel: "Wan 2.x（通義萬相）",
  developer: "阿里巴巴通義實驗室",
  arch: "時序 DiT（umT5 文字塔；2.2 為 A14B 專家混合）",
  weights: "open",
  note: "少數權重公開的影片基座：可掛 LoRA、吃 negative_prompt，是站內開源影片線的骨幹。",
};

/** 規則由具體到一般；先比中對的就是答案（與 shared/textEncoders 同一套比對慣例）。 */
const RULES: readonly BaseRule[] = [
  /* ───────── FLUX ───────── */
  {
    match: /^fal-ai\/flux-2\/pro/,
    spec: {
      key: "flux2-pro",
      baseModel: "FLUX.2 [pro]",
      developer: "Black Forest Labs",
      arch: "flow transformer；文字塔換成 Mistral-3 系 VLM",
      weights: "closed",
      note: "BFL 生產管線版：零設定（沒有 steps／guidance 可調），只走 API。",
    },
  },
  {
    match: /^fal-ai\/flux-2/,
    spec: {
      key: "flux2",
      baseModel: "FLUX.2（[dev]／[flex] 線）",
      developer: "Black Forest Labs",
      arch: "flow transformer；文字塔換成 Mistral-3 系 VLM",
      weights: "open",
      note: "FLUX.1 的下一代：改用 VLM 讀提示詞，長句與結構化描述吃得比 FLUX.1 好。",
    },
  },
  {
    match: /^fal-ai\/flux\/schnell/,
    spec: {
      key: "flux1-schnell",
      baseModel: "FLUX.1 [schnell]",
      developer: "Black Forest Labs",
      arch: "12B rectified-flow transformer（蒸餾版，1–4 步）",
      params: "12B",
      weights: "open",
      note: "FLUX.1 [dev] 的蒸餾學生：快而便宜，代價是細節上限與可控性低於老師。",
    },
  },
  {
    match: /^fal-ai\/flux-kontext\/dev/,
    spec: {
      key: "flux1-kontext-dev",
      baseModel: "FLUX.1 Kontext [dev]",
      developer: "Black Forest Labs",
      arch: "12B flow transformer（圖像＋指令同序列的編輯版）",
      params: "12B",
      weights: "open",
      note: "指令式編輯的開源版：把原圖與修改指令一起送進同一條序列，不重畫整張。",
    },
  },
  {
    match: /^fal-ai\/flux-pro/,
    spec: {
      key: "flux1-pro",
      baseModel: "FLUX.1 [pro] 系（含 Ultra／Kontext max）",
      developer: "Black Forest Labs",
      arch: "flow transformer（與 FLUX.1 同源的閉源生產版）",
      weights: "closed",
      note: "同一家族的最高品質檔，但只走 API：沒有權重、掛不了社群 LoRA。",
    },
  },
  { match: /^fal-ai\/flux(\/|-lora|-pulid)/, spec: FLUX1_DEV },
  {
    // FLUX.3 走 blackforestlabs/ prefix（BFL 自家端點命名，非 fal-ai/），2026-08-10 上架 image-to-video draft
    match: /^blackforestlabs\/flux-3/,
    spec: {
      key: "flux3",
      baseModel: "FLUX.3（BFL 前沿音訊／視訊模型）",
      developer: "Black Forest Labs",
      arch: "官方未公開",
      weights: "closed",
      note: "BFL 首個圖生影片線：draft 檔 $0.06/秒（720p）快又省，draft cache 可再升級全品質；只走 API、沒有權重。",
    },
  },

  /* ───────── Qwen-Image（阿里） ───────── */
  {
    match: /^fal-ai\/qwen-image-(2|max)/,
    spec: {
      key: "qwen-image-2",
      baseModel: "Qwen-Image 2.0 系（含 Pro／Max）",
      developer: "阿里巴巴通義實驗室",
      arch: "MMDiT 統一生成＋編輯（Qwen2.5-VL 文字塔）",
      weights: "unknown",
      note: "中文字卡與排版的主力；fal 託管的 2.0／Pro／Max 官方未載明權重是否公開。",
    },
  },
  {
    match: /^fal-ai\/qwen-image/,
    spec: {
      key: "qwen-image",
      baseModel: "Qwen-Image",
      developer: "阿里巴巴通義實驗室",
      arch: "MMDiT 統一生成＋編輯（Qwen2.5-VL 文字塔）",
      params: "20B",
      weights: "open",
      note: "權重公開的中文強項基座：生成與編輯同一顆模型，站內編輯線大量用它。",
    },
  },

  /* ───────── SDXL 與同代開源擴散 ───────── */
  { match: /^fal-ai\/fast-lightning-sdxl/, spec: { ...SDXL_BASE, key: "sdxl-lightning", baseModel: "SDXL 1.0 ＋ Lightning 蒸餾", note: "SDXL 的少步蒸餾版（ByteDance Lightning）：幾步就出圖，適合大量試方向。" } },
  { match: /^fal-ai\/(fast-sdxl|lora$|lora\/)/, spec: SDXL_BASE },
  {
    match: /^fal-ai\/playground-v25/,
    spec: {
      key: "playground-v25",
      baseModel: "Playground v2.5",
      developer: "Playground AI",
      arch: "SDXL 架構的重訓權重（U-Net 潛空間擴散）",
      weights: "open",
      note: "與 SDXL 同結構、換一套審美訓練：色彩與構圖偏商業視覺。",
    },
  },
  {
    match: /^fal-ai\/kolors/,
    spec: {
      key: "kolors",
      baseModel: "Kolors（可圖）",
      developer: "快手",
      arch: "SDXL 式 U-Net 擴散 ＋ ChatGLM3 文字塔",
      weights: "open",
      note: "中文原生理解的開源基座：不用先把中文翻成英文，negative_prompt 也吃得穩。",
    },
  },
  {
    match: /^fal-ai\/sana/,
    spec: {
      key: "sana",
      baseModel: "Sana",
      developer: "NVIDIA",
      arch: "線性注意力 DiT（Gemma-2 文字塔）",
      params: "1.6B",
      weights: "open",
      note: "小模型、高解析、極省算力：吃得動長一點的提示詞（窗口 300），品質上限不比旗艦。",
    },
  },
  {
    match: /^fal-ai\/aura-flow/,
    spec: {
      key: "auraflow",
      baseModel: "AuraFlow v0.3",
      developer: "fal",
      arch: "開源 flow transformer（Pile-T5 文字塔）",
      params: "6.8B",
      weights: "open",
      note: "fal 自家的開源 flow 模型；官方 schema 沒有 negative_prompt，站內不送。",
    },
  },
  {
    match: /^fal-ai\/hunyuan-image/,
    spec: {
      key: "hunyuan-image",
      baseModel: "混元圖像（HunyuanImage）",
      developer: "騰訊",
      arch: "DiT 潛空間生成",
      weights: "open",
      note: "騰訊開源圖像線；中文語意與東方題材是強項，文字窗口官方未公開。",
    },
  },

  /* ───────── 閉源圖像 API ───────── */
  {
    match: /nano-banana|gemini-tts|^fal-ai\/gemini/,
    spec: {
      key: "gemini-image",
      baseModel: "Google Gemini 影像／語音（Nano Banana 線）",
      developer: "Google DeepMind",
      arch: "多模態 LLM 先理解意圖再渲染（不是 steps／CFG 那套）",
      weights: "closed",
      note: "口語與指令式長句吃得動，輸出帶 SynthID 隱形浮水印；內部結構官方未公開。",
    },
  },
  {
    match: /imagen/,
    spec: {
      key: "imagen",
      baseModel: "Imagen 4",
      developer: "Google DeepMind",
      arch: "官方未公開",
      weights: "closed",
      note: "只吃 aspect_ratio 選比例，像素由服務決定；沒有 negative_prompt。",
    },
  },
  {
    match: /gpt-image|^openai\//,
    spec: {
      key: "gpt-image",
      baseModel: "GPT-Image-2",
      developer: "OpenAI",
      arch: "官方未公開（可變推理量）",
      weights: "closed",
      note: "畫面內文字渲染最強的一線之一；計價依尺寸×品質檔浮動。",
    },
  },
  {
    match: /ideogram/,
    spec: {
      key: "ideogram",
      baseModel: "Ideogram v3／v4",
      developer: "Ideogram",
      arch: "排版與文字渲染特化（官方未公開骨幹）",
      weights: "closed",
      note: "海報、招牌、標題這種「畫面內要出現正確文字」的需求，明顯優於通用擴散模型。",
    },
  },
  {
    match: /recraft/,
    spec: {
      key: "recraft",
      baseModel: "Recraft v3／v4",
      developer: "Recraft",
      arch: "設計／向量特化（官方未公開骨幹）",
      weights: "closed",
      note: "唯一能直接吐向量（SVG）的一線；品牌識別與圖示是主場。",
    },
  },
  {
    match: /seedream|seededit|seedvr|^fal-ai\/bytedance|^bytedance\//,
    spec: {
      key: "bytedance-seed",
      baseModel: "字節 Seed 系（Seedream／Seedance／SeedVR）",
      developer: "字節跳動 Seed",
      arch: "生成＋編輯一體（官方未公開骨幹）",
      weights: "closed",
      note: "高解析度與一致性表現穩定；沒有 negative_prompt，控制靠提示詞本身。",
    },
  },
  {
    match: /luma-photon/,
    spec: {
      key: "luma-photon",
      baseModel: "Luma Photon",
      developer: "Luma AI",
      arch: "官方未公開",
      weights: "closed",
      note: "與 Ray 影片線同一家；圖像走性價比路線。",
    },
  },

  /* ───────── 影片：開源基座 ───────── */
  {
    match: /^(fal-ai\/)?wan\/v2\.[56]/,
    spec: { ...WAN_OPEN, key: "wan-api", baseModel: "Wan 2.5／2.6（通義萬相）", weights: "unknown", note: "Wan 的最新代：fal 以 API 提供，官方尚未釋出對應權重。" },
  },
  { match: /^(fal-ai\/)?wan/, spec: WAN_OPEN },
  {
    match: /hunyuan-video/,
    spec: {
      key: "hunyuan-video",
      baseModel: "HunyuanVideo（混元影片）",
      developer: "騰訊",
      arch: "時序 DiT",
      params: "13B（初代）",
      weights: "open",
      note: "權重公開的影片基座；初代端點沒有 negative_prompt，只有 1.5 有。",
    },
  },
  {
    match: /ltx-?video|ltx2/,
    spec: {
      key: "ltx-video",
      baseModel: "LTX-Video",
      developer: "Lightricks",
      arch: "時序 DiT（主打即時級推論）",
      weights: "open",
      note: "開源影片線裡最快的一檔：秒級出片，品質換速度。",
    },
  },
  {
    match: /mochi-v1/,
    spec: {
      key: "mochi",
      baseModel: "Mochi 1",
      developer: "Genmo",
      arch: "非對稱 DiT（AsymmDiT）",
      params: "10B",
      weights: "open",
      note: "開源權重（Apache-2.0）；動態表現好，解析度偏低。",
    },
  },
  {
    match: /cogvideox/,
    spec: {
      key: "cogvideox",
      baseModel: "CogVideoX-5B",
      developer: "智譜 AI（THUDM）",
      arch: "時序 DiT",
      params: "5B",
      weights: "open",
      note: "早期開源影片基座；便宜、可控，畫質不比新一代。",
    },
  },
  {
    match: /stable-video|fast-svd/,
    spec: {
      key: "svd",
      baseModel: "Stable Video Diffusion",
      developer: "Stability AI",
      arch: "影像條件擴散（圖生短片）",
      weights: "open",
      note: "老牌圖生影片：只做鏡頭級微動態，不理解複雜提示詞。",
    },
  },
  {
    match: /framepack/,
    spec: {
      key: "framepack",
      baseModel: "FramePack（HunyuanVideo 基座）",
      developer: "社群開源（lllyasviel）",
      arch: "下一段影格預測（把已生成內容壓成固定長度上下文）",
      weights: "open",
      note: "以固定記憶體生長片為目標；長度換取單格畫質。",
    },
  },

  /* ───────── 影片：閉源 API ───────── */
  {
    match: /kling/,
    spec: {
      key: "kling",
      baseModel: "可靈（Kling）",
      developer: "快手",
      arch: "時序 DiT（官方未公開細節）",
      weights: "closed",
      note: "運鏡與人物動作穩定度是目前一線；吃 negative_prompt。",
    },
  },
  {
    match: /veo/,
    spec: {
      key: "veo",
      baseModel: "Veo 2／3.1",
      developer: "Google DeepMind",
      arch: "官方未公開",
      weights: "closed",
      note: "站內唯一能同時生成原生音軌的影片線；單價最高。",
    },
  },
  {
    match: /sora/,
    spec: {
      key: "sora",
      baseModel: "Sora 2",
      developer: "OpenAI",
      arch: "官方未公開",
      weights: "closed",
      note: "物理一致性與長鏡頭是強項；成本高、排隊時間長。",
    },
  },
  {
    match: /luma-dream-machine/,
    spec: {
      key: "luma-ray",
      baseModel: "Ray 2（Dream Machine）",
      developer: "Luma AI",
      arch: "官方未公開",
      weights: "closed",
      note: "flash 檔便宜好用，適合大量鏡頭初稿。",
    },
  },
  {
    match: /minimax|hailuo/,
    spec: {
      key: "minimax",
      baseModel: "海螺（Hailuo）／MiniMax 系",
      developer: "MiniMax",
      arch: "官方未公開",
      weights: "closed",
      note: "影片、語音、音樂共用同一家 API；中文語音線特別強。",
    },
  },
  {
    match: /pixverse/,
    spec: {
      key: "pixverse",
      baseModel: "PixVerse v5／v6",
      developer: "PixVerse",
      arch: "官方未公開",
      weights: "closed",
      note: "價格帶低、吃 negative_prompt，適合社群短影音量產。",
    },
  },
  {
    match: /pika/,
    spec: { key: "pika", baseModel: "Pika 2.2", developer: "Pika Labs", arch: "官方未公開", weights: "closed", note: "特效與轉場模板取向的影片服務。" },
  },
  {
    match: /runway-gen3/,
    spec: { key: "runway", baseModel: "Gen-3 Alpha Turbo", developer: "Runway", arch: "官方未公開", weights: "closed", note: "老牌影片服務；turbo 檔以速度換單格品質。" },
  },
  {
    match: /decart\/lucy/,
    spec: { key: "decart", baseModel: "Lucy（Edit／Restyle）", developer: "Decart", arch: "官方未公開", weights: "closed", note: "影片轉影片改風格／換內容的即時線。" },
  },

  /* ───────── 對嘴與影片工具 ───────── */
  {
    match: /sync-lipsync/,
    spec: { key: "sync", baseModel: "Sync.so lipsync", developer: "Sync Labs", arch: "官方未公開", weights: "closed", note: "對嘴一線服務：要人物影片＋配音音訊兩個來源。" },
  },
  {
    match: /latentsync/,
    spec: { key: "latentsync", baseModel: "LatentSync", developer: "字節跳動（開源）", arch: "潛空間擴散對嘴", weights: "open", note: "開源對嘴：便宜，嘴型精度不比商用一線。" },
  },
  {
    match: /musetalk/,
    spec: { key: "musetalk", baseModel: "MuseTalk", developer: "騰訊（開源）", arch: "潛空間即時對嘴", weights: "open", note: "即時級對嘴，適合口播短片。" },
  },
  {
    match: /^veed\/|veed-/,
    spec: { key: "veed", baseModel: "VEED 影片工具", developer: "VEED", arch: "服務端管線（非單一模型）", weights: "closed", note: "字幕／去背這類成品級工具，不是可調參的生成模型。" },
  },
  {
    match: /^bria\/|^fal-ai\/bria/,
    spec: { key: "bria", baseModel: "Bria 影像模型", developer: "Bria AI", arch: "官方未公開", weights: "closed", note: "主打「全授權訓練資料」的商用線：去背、擴圖、商品圖。" },
  },

  /* ───────── 修復／放大／去背（多為開源） ───────── */
  {
    match: /esrgan/,
    spec: { key: "esrgan", baseModel: "Real-ESRGAN", developer: "騰訊 ARC（開源）", arch: "GAN 放大", weights: "open", note: "老牌通用放大：快、便宜，不會新增細節。" },
  },
  {
    match: /aura-sr/,
    spec: { key: "aura-sr", baseModel: "AuraSR", developer: "fal（開源）", arch: "GigaGAN 式放大", weights: "open", note: "單步 GAN 放大，速度極快。" },
  },
  {
    match: /swin2sr|drct|thera|mix-dehaze|ccsr/,
    spec: { key: "sr-open", baseModel: "開源超解析模型（Swin2SR／DRCT／Thera／CCSR 等）", developer: "學術開源", arch: "Transformer／擴散式超解析", weights: "open", note: "論文級開源放大：各有適用素材，成本低。" },
  },
  {
    match: /supir/,
    spec: { key: "supir", baseModel: "SUPIR", developer: "學術開源", arch: "擴散式修復放大（吃文字條件）", weights: "open", note: "重建型修復：會依理解「補」細節，忠實度不保證。" },
  },
  {
    match: /clarity-upscaler|creative-upscaler|clarityai/,
    spec: { key: "sd-upscale", baseModel: "SD 系分塊重繪放大", developer: "社群／ClarityAI", arch: "擴散重繪（tiled）", weights: "open", note: "會重新畫細節：好看但可能改掉原圖內容。" },
  },
  {
    match: /codeformer|photo-restoration/,
    spec: { key: "face-restore", baseModel: "CodeFormer 系人臉修復", developer: "南洋理工 S-Lab（開源）", arch: "碼本先驗 Transformer", weights: "open", note: "老照片與人臉修復；強度拉高會改變長相。" },
  },
  {
    match: /^fal-ai\/(image-editing|image-apps-v2)\//,
    spec: {
      key: "fal-app",
      baseModel: "fal 影像編輯應用",
      developer: "fal（封裝管線）",
      arch: "fal 封裝的編輯管線，未載明底層採用哪顆模型",
      weights: "unknown",
      note: "這類是「做好一件事」的應用端點，不是可換基座的模型；官方未公開底層權重。",
    },
  },
  {
    match: /topaz/,
    spec: { key: "topaz", baseModel: "Topaz 放大引擎", developer: "Topaz Labs", arch: "官方未公開", weights: "closed", note: "商用畫質一線，單價明顯高於開源放大。" },
  },
  {
    match: /birefnet|^fal-ai\/ben\/|rembg|pixelcut|smoretalk|finegrain/,
    spec: { key: "matting", baseModel: "去背分割模型（BiRefNet／BEN2／rembg 等）", developer: "學術開源與商用服務混合", arch: "二值分割／影像去背", weights: "open", note: "去背屬確定性工具：同一張圖每次結果一致，不吃提示詞。" },
  },
  {
    match: /ddcolor/,
    spec: { key: "ddcolor", baseModel: "DDColor", developer: "阿里（開源）", arch: "雙解碼器上色", weights: "open", note: "黑白上色：顏色是推測的，不是還原。" },
  },
  {
    match: /iclight/,
    spec: { key: "iclight", baseModel: "IC-Light", developer: "社群開源（lllyasviel）", arch: "光照一致性重繪", weights: "open", note: "重打光：換光源而不換主體。" },
  },
  {
    match: /instantid|photomaker|instant-character|face-to-sticker|easel-ai|flux-pulid/,
    spec: { key: "identity", baseModel: "身分保持適配器（InstantID／PhotoMaker／PuLID 等）", developer: "社群開源與商用混合", arch: "在擴散基座上外掛人臉／角色條件", weights: "open", note: "這類不是新基座，是掛在基座上的適配器：換臉不換模型。" },
  },
  {
    match: /image2svg|vectorize/,
    spec: { key: "vectorize", baseModel: "點陣轉向量引擎", developer: "Recraft／社群", arch: "影像向量化（非生成模型）", weights: "unknown", note: "把圖轉成 SVG 路徑，不重新創作內容。" },
  },
  {
    match: /rife|amt-interpolation|video-upscaler|auto-caption|workflow-utilities/,
    spec: { key: "video-utils", baseModel: "影片工具模型（RIFE／AMT 等）", developer: "學術開源", arch: "影格內插／畫質處理", weights: "open", note: "補幀與畫質處理屬工程工具，不改內容。" },
  },

  /* ───────── 視覺理解 ───────── */
  {
    match: /florence-2/,
    spec: { key: "florence", baseModel: "Florence-2", developer: "Microsoft", arch: "視覺語言序列模型", weights: "open", note: "看圖寫描述／OCR 的輕量開源模型：便宜、快，長文理解不如大型 VLM。" },
  },
  {
    match: /moondream/,
    spec: { key: "moondream", baseModel: "Moondream", developer: "Moondream（開源）", arch: "輕量視覺語言模型", weights: "open", note: "手機級小 VLM：問一句答一句，成本極低。" },
  },
  {
    match: /got-ocr/,
    spec: { key: "got-ocr", baseModel: "GOT-OCR 2.0", developer: "StepFun 等（開源）", arch: "端到端 OCR Transformer", weights: "open", note: "版面與公式的 OCR 專用模型，不做語意問答。" },
  },

  /* ───────── 語音轉文字 ───────── */
  {
    match: /elevenlabs\/speech-to-text/,
    spec: { key: "scribe", baseModel: "ElevenLabs Scribe", developer: "ElevenLabs", arch: "官方未公開", weights: "closed", note: "多語轉錄一線，支援關鍵詞提示與講者分離。" },
  },
  {
    match: /whisper|wizper|^fal-ai\/speech-to-text/,
    spec: {
      key: "whisper",
      baseModel: "Whisper large-v3",
      developer: "OpenAI（權重開源）",
      arch: "編碼器–解碼器 Transformer（語音→文字）",
      weights: "open",
      note: "轉錄的公版基座：wizper 是 fal 的加速部署，底層同一顆權重。",
    },
  },

  /* ───────── 語音合成 ───────── */
  {
    match: /elevenlabs/,
    spec: { key: "elevenlabs", baseModel: "ElevenLabs 語音／音效模型", developer: "ElevenLabs", arch: "官方未公開", weights: "closed", note: "情感與多語自然度的一線；單價高於開源 TTS 一個量級。" },
  },
  {
    match: /kokoro/,
    spec: { key: "kokoro", baseModel: "Kokoro", developer: "社群開源", arch: "輕量 TTS（StyleTTS2 系）", params: "82M", weights: "open", note: "極小極便宜的 TTS：音色固定，適合大量旁白草稿。" },
  },
  {
    match: /f5-tts/,
    spec: { key: "f5-tts", baseModel: "F5-TTS", developer: "學術開源", arch: "flow matching DiT 語音合成", weights: "open", note: "開源音色複製：給一段參考音就能仿聲。" },
  },
  {
    match: /dia-tts/,
    spec: { key: "dia", baseModel: "Dia", developer: "Nari Labs（開源）", arch: "自回歸對話語音模型", params: "1.6B", weights: "open", note: "專攻多人對話與情緒標記的開源 TTS。" },
  },
  {
    match: /orpheus/,
    spec: { key: "orpheus", baseModel: "Orpheus TTS", developer: "Canopy Labs（開源）", arch: "Llama 基座的語音 token 生成", weights: "open", note: "語言模型式 TTS：語氣自然，速度中等。" },
  },
  {
    match: /chatterbox/,
    spec: { key: "chatterbox", baseModel: "Chatterbox", developer: "Resemble AI（開源）", arch: "語言模型式 TTS（帶情緒強度控制）", weights: "open", note: "開源裡少見可調情緒強度的 TTS。" },
  },
  {
    match: /vibevoice/,
    spec: { key: "vibevoice", baseModel: "VibeVoice", developer: "Microsoft（開源）", arch: "長篇多講者語音模型", weights: "open", note: "為長對談／podcast 設計：能撐長時間且維持講者一致。" },
  },
  {
    match: /zonos/,
    spec: { key: "zonos", baseModel: "Zonos", developer: "Zyphra（開源）", arch: "多語 TTS（帶音色複製）", weights: "open", note: "開源多語 TTS，可用參考音複製音色。" },
  },
  {
    match: /index-tts/,
    spec: { key: "index-tts", baseModel: "IndexTTS-2", developer: "嗶哩嗶哩（開源）", arch: "自回歸語音模型（時長可控）", weights: "open", note: "中文語音自然度好，且能指定時長對齊字幕。" },
  },
  {
    match: /qwen-3-tts/,
    spec: { key: "qwen-tts", baseModel: "Qwen3-TTS", developer: "阿里巴巴通義實驗室", arch: "語言模型式 TTS", weights: "unknown", note: "中文與方言表現好；fal 端未載明權重是否公開。" },
  },

  /* ───────── 音樂與音效 ───────── */
  {
    match: /stable-audio/,
    spec: { key: "stable-audio", baseModel: "Stable Audio 2.5", developer: "Stability AI", arch: "潛空間音頻擴散（DiT）", weights: "open", note: "結構完整的器樂線；人聲非強項。" },
  },
  {
    match: /ace-step/,
    spec: { key: "ace-step", baseModel: "ACE-Step", developer: "開源社群", arch: "音樂潛空間擴散", weights: "open", note: "開源音樂基座：便宜、可控，音質不比商用一線。" },
  },
  {
    match: /yue|diffrhythm/,
    spec: { key: "song-open", baseModel: "YuE／DiffRhythm 開源歌曲模型", developer: "學術開源", arch: "歌詞條件的音樂生成", weights: "open", note: "能唱詞的開源線：便宜，混音品質參差。" },
  },
  {
    match: /lyria/,
    spec: { key: "lyria", baseModel: "Lyria 2", developer: "Google DeepMind", arch: "官方未公開", weights: "closed", note: "器樂品質高；輸出帶 SynthID。" },
  },
  {
    match: /cassetteai|sonilo/,
    spec: { key: "music-api", baseModel: "商用音樂生成服務", developer: "CassetteAI／Sonilo", arch: "官方未公開", weights: "closed", note: "以速度與授權明確為賣點的商用音樂線。" },
  },
  {
    match: /mmaudio|thinksound|foley/,
    spec: { key: "v2a", baseModel: "影片配音模型（MMAudio／ThinkSound／混元 Foley）", developer: "學術與騰訊開源", arch: "影音同步的音頻生成", weights: "open", note: "看畫面配音效：對嘴不是它的工作，時間對齊才是。" },
  },

  /* ───────── LLM／視覺對話：底層就是子模型本身 ───────── */
  {
    match: /#claude-/,
    spec: { key: "claude", baseModel: "Claude", developer: "Anthropic", arch: "自回歸 Transformer", weights: "closed", note: "長文與指令遵循強；中文寫作穩定。" },
  },
  {
    match: /#gpt-/,
    spec: { key: "gpt", baseModel: "GPT-5 系", developer: "OpenAI", arch: "自回歸 Transformer", weights: "closed", note: "通用能力強；mini 檔便宜很多。" },
  },
  {
    match: /#gemini-/,
    spec: { key: "gemini", baseModel: "Gemini 2.5 系", developer: "Google DeepMind", arch: "自回歸多模態 Transformer", weights: "closed", note: "長上下文與多模態輸入是強項。" },
  },
  {
    match: /#deepseek-/,
    spec: { key: "deepseek", baseModel: "DeepSeek V3／R1", developer: "DeepSeek", arch: "MoE 自回歸 Transformer（R1 為推理型）", weights: "open", note: "權重公開的高性價比線；R1 會先想再答，延遲較長。" },
  },
  {
    match: /#llama-/,
    spec: { key: "llama", baseModel: "Llama 3.1／4", developer: "Meta", arch: "自回歸 Transformer（Llama 4 為 MoE）", weights: "open", note: "權重公開的通用線；中文表現不如同級中文模型。" },
  },
  {
    match: /#qwen/,
    spec: { key: "qwen-llm", baseModel: "Qwen2.5", developer: "阿里巴巴通義實驗室", arch: "自回歸 Transformer", weights: "open", note: "中文任務的高性價比選擇。" },
  },
  {
    match: /#mistral-/,
    spec: { key: "mistral", baseModel: "Mistral Large 2", developer: "Mistral AI", arch: "自回歸 Transformer", weights: "unknown", note: "歐語系與程式碼表現好；權重授權依版本而異。" },
  },
  {
    match: /#nemotron/,
    spec: { key: "nemotron", baseModel: "Nemotron-4 340B", developer: "NVIDIA", arch: "自回歸 Transformer", weights: "open", note: "超大開放權重模型，主要用於合成資料與評測。" },
  },
  {
    match: /#kimi/,
    spec: { key: "kimi", baseModel: "Kimi K3", developer: "月之暗面（Moonshot AI）", arch: "MoE 自回歸 Transformer（原生視覺）", weights: "open", note: "2.8T 開源旗艦；1M context、原生視覺與 agentic 能力。" },
  },

  /* ───────── 訓練器：底層＝被訓練的基座 ───────── */
  {
    match: /flux-2.*trainer/,
    spec: { key: "train-flux2", baseModel: "在 FLUX.2 上訓 LoRA", developer: "Black Forest Labs（基座）", arch: "低秩更新 W′ = W + BA", weights: "open", note: "訓出來的是適配器不是模型：只能配同一顆基座使用。" },
  },
  {
    match: /flux.*(trainer|training)|turbo-flux|krea-2-trainer|flux-kontext-trainer/,
    spec: { key: "train-flux1", baseModel: "在 FLUX.1 上訓 LoRA", developer: "Black Forest Labs（基座）", arch: "低秩更新 W′ = W + BA", weights: "open", note: "站內最通用的風格／角色訓練線；產物掛回 FLUX.1 端點使用。" },
  },
  {
    match: /qwen-image.*trainer/,
    spec: { key: "train-qwen", baseModel: "在 Qwen-Image 上訓 LoRA", developer: "阿里巴巴通義實驗室（基座）", arch: "低秩更新", weights: "open", note: "中文字卡風格訓練；產物配 Qwen-Image 端點。" },
  },
  {
    match: /wan.*trainer|hunyuan-video-lora-training|ltx2-video-trainer/,
    spec: { key: "train-video", baseModel: "在開源影片基座上訓 LoRA（Wan／混元／LTX）", developer: "各基座原廠", arch: "低秩更新", weights: "open", note: "影片 LoRA 訓練成本高；產物只能配同一顆基座。" },
  },
  {
    match: /z-image-trainer/,
    spec: { key: "train-zimage", baseModel: "在 Z-Image 上訓 LoRA", developer: "基座原廠", arch: "低秩更新", weights: "unknown", note: "較新的訓練線；基座細節官方未完整公開。" },
  },
];

/** 類別保底：比不到家族時，至少誠實說明這條線的性質，不留空白也不亂猜。 */
const CATEGORY_FALLBACK: Record<string, ModelBaseSpec> = {
  llm: {
    key: "llm-unknown",
    baseModel: "未收錄的語言模型",
    developer: "未收錄",
    arch: "自回歸 Transformer",
    weights: "unknown",
    note: "站內還沒整理這顆的底層資料；端點可用，但基座身分未經核實。",
  },
  workflow: {
    key: "workflow",
    baseModel: "製作範本（多模型串鏈）",
    developer: "站內編排",
    arch: "不是單一模型：每一步各自呼叫一顆模型",
    weights: "unknown",
    note: "範本的底層要看它串了哪幾顆模型；每步各自扣點。",
  },
};

const UNKNOWN_SPEC: ModelBaseSpec = {
  key: "unknown",
  baseModel: "未收錄的底層模型",
  developer: "未收錄",
  arch: "未收錄",
  weights: "unknown",
  note: "站內還沒整理這顆模型的基座資料——不猜，寧可留白。",
};

/** 這條端點背後是誰家的哪顆權重 */
export function modelBaseSpecFor(modelId: string | undefined | null, category?: string): ModelBaseSpec {
  const id = modelId ?? "";
  if (!id) return category ? (CATEGORY_FALLBACK[category] ?? UNKNOWN_SPEC) : UNKNOWN_SPEC;
  for (const rule of RULES) {
    if (rule.match.test(id)) return rule.spec;
  }
  if (category && CATEGORY_FALLBACK[category]) return CATEGORY_FALLBACK[category];
  return UNKNOWN_SPEC;
}

/** 兩條端點是不是同一顆基座（換過去風格不會變） */
export function sharesBaseModel(a: string, b: string): boolean {
  return modelBaseSpecFor(a).key === modelBaseSpecFor(b).key && modelBaseSpecFor(a).key !== "unknown";
}
