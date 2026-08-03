import { textEncoderProfileFor } from "./textEncoders";

/**
 * 模型運作圖解的資料層。
 *
 * 內容出自 `docs/模型底層邏輯與運作流程.md`（對照 fal 官方頁與各模型卡整理）。
 *
 * 這一份講的是**這類模型的架構怎麼運作**，不是本次生成的實測資料——
 * 這條界線必須寫在畫面上：使用者若把它當成「這次模型真的這樣想」，
 * 就跟假造注意力圖沒兩樣。真正逐次量測影響力請用消融實測（shared/ablation）。
 */

export type MechanicsFamily =
  | "flux-dual-stream"
  | "dit"
  | "unet"
  | "mllm-render"
  | "layout-specialized"
  | "llm"
  | "unknown";

export interface MechanicsStage {
  key: string;
  title: string;
  /** 一句話：這一關做什麼 */
  summary: string;
  /** 展開後的說明：機制與它對使用者的實際影響 */
  detail: string;
}

export interface ModelMechanics {
  family: MechanicsFamily;
  /** 骨幹名稱（給人看） */
  label: string;
  /** 文字條件怎麼進到畫面裡 */
  conditioning: string;
  stages: MechanicsStage[];
  /** 這個家族特別要注意的事 */
  caveat?: string;
}

const LATENT_STAGE: MechanicsStage = {
  key: "latent",
  title: "潛空間去噪",
  summary: "在壓縮過的潛空間裡，一步步把噪聲整理成畫面",
  detail:
    "直接在 1024×1024×3 的像素上生成成本極高，所以模型先把畫面壓進潛空間（VAE 編碼），在那裡反覆去噪，最後才解碼回像素。"
    + "「步數」就是去噪迭代次數：步數少＝快但細節少，步數多＝慢但穩。站內多數模型不暴露這顆旋鈕，吃官方預設。",
};

const DECODE_STAGE: MechanicsStage = {
  key: "decode",
  title: "VAE 解碼成圖",
  summary: "把整理好的潛空間表示還原成看得見的像素",
  detail: "文字 token 到這一步就用不到了；解碼只把潛空間結果還原成影像。畫面裡細小的紋理與文字經常在這一關失真，跟提示詞寫得多好無關。",
};

function encoderStage(modelId: string): MechanicsStage {
  const encoder = textEncoderProfileFor(modelId);
  return {
    key: "encoder",
    title: "文字塔編碼",
    summary: `你的提示詞先過 ${encoder.label}`,
    detail:
      `${encoder.note} 這一關決定「模型到底讀到了哪幾個字」——超出窗口的部分會被截掉，`
      + "寫再多也不會進畫面。上方的文字窗口總覽算的就是這一關。",
  };
}

/** 家族比對：與 shared/textEncoders 同樣吃 model id 前綴，順序由具體到一般 */
export function modelMechanicsFor(modelId: string | undefined | null, category?: string): ModelMechanics {
  const id = modelId ?? "";

  // 沒帶 category 時用 id 認 LLM（nvidia-nim#／any-llm／openrouter 都是文字模型端點）
  if (category === "llm" || /nvidia-nim|any-llm|openrouter/.test(id)) {
    return {
      family: "llm",
      label: "自回歸 Transformer",
      conditioning: "整段對話串成同一個序列做自注意力",
      stages: [
        {
          key: "tokenize",
          title: "分詞",
          summary: "文字先被切成 token",
          detail: "模型看到的不是字，是 token。中文的分詞效率因模型而異，這也是同一段話在不同模型上費用不同的原因。",
        },
        {
          key: "attention",
          title: "自注意力",
          summary: "每個位置去問「誰和我有關」，再加權彙整",
          detail:
            "Q·Kᵀ 算出位置之間的相關度，softmax 變成權重，再乘上 V 彙整資訊。第一層起就能全局互通——這就是「注意力」的本體。"
            + "供應商不回傳這些權重，所以站內不會、也不該畫注意力熱圖。",
        },
        {
          key: "decode",
          title: "逐 token 生成",
          summary: "一次吐一個 token，每個都有機率值",
          detail: "每個 token 都伴隨一個機率（logprob）。供應商有回傳時，站內會把它換算成「模型自報信心」顯示——那不是推估，是模型自己的輸出。",
        },
      ],
    };
  }

  if (/^fal-ai\/flux(\/|-pro|-lora|-kontext)/.test(id)) {
    return {
      family: "flux-dual-stream",
      label: "FLUX 雙流 flow transformer（非 U-Net）",
      conditioning: "Joint attention：圖 token 與文 token 串成同一個序列一起做注意力",
      stages: [
        encoderStage(id),
        {
          key: "double-stream",
          title: "Double-Stream",
          summary: "圖與文各有自己的權重，在串接序列上混合",
          detail: "圖、文兩路先各自處理，注意力在串接後的序列上交互——文字不是「外掛」進畫面，而是和畫面 token 平起平坐地一起算。",
        },
        {
          key: "single-stream",
          title: "Single-Stream",
          summary: "圖文改用同一套權重繼續交互",
          detail: "後段合流，圖文共用權重繼續互相影響，最後丟掉文 token 只留畫面表示。",
        },
        LATENT_STAGE,
        DECODE_STAGE,
      ],
      caveat: "FLUX 主端點多半沒有 negative_prompt 欄位——條件注入與舊式 CFG 的假設不同，誤送常直接 422，所以站內用 allowlist 控管。",
    };
  }

  if (/^fal-ai\/(fast-sdxl|fast-lightning-sdxl|lora|playground-v25)/.test(id)) {
    return {
      family: "unet",
      label: "U-Net 擴散骨幹",
      conditioning: "Cross-attention：畫面 token 當 Q，文字 token 當 K/V",
      stages: [
        encoderStage(id),
        {
          key: "cross-attn",
          title: "交叉注意力",
          summary: "畫面每個位置去「查」文字，決定該長什麼樣",
          detail:
            "畫面 token 當 Query 去查文字 token（Key/Value）。文字窗口只有 77，"
            + "所以這條線特別吃不下長提示詞——長句往往前半有效、後半整段消失。",
        },
        LATENT_STAGE,
        DECODE_STAGE,
      ],
      caveat: "SDXL 這條線有穩定的 negative_prompt：擴散模型無法靠正向詞「避免」某物，禁忌要走負向才有用。",
    };
  }

  if (/kling|veo|luma|minimax|pixverse|seedance|wan|hunyuan-video|ltx-video|mochi|cogvideo/.test(id)) {
    return {
      family: "dit",
      label: "時序 DiT（Diffusion Transformer）",
      conditioning: "潛空間切 patch 成 token，以 AdaLN 注入時刻與文字條件",
      stages: [
        encoderStage(id),
        {
          key: "patchify",
          title: "切 patch 成 token",
          summary: "把潛空間切成小塊，當成序列丟進 Transformer",
          detail: "影片模型幾乎都走時序 DiT：除了畫面內的空間關係，還要處理跨影格的時間關係，長距離依賴靠 Transformer 撐。",
        },
        LATENT_STAGE,
        {
          key: "temporal",
          title: "時間一致性",
          summary: "同一個東西必須跨影格保持同一個樣子",
          detail: "影片最難的不是單格好看，是跨影格不變形。這也是為什麼站內的定裝卡只鎖得住文字描述——真正的身份一致性要靠參考圖或首格圖。",
        },
        DECODE_STAGE,
      ],
    };
  }

  if (/nano-banana|gemini/.test(id)) {
    return {
      family: "mllm-render",
      label: "多模態 LLM 渲染",
      conditioning: "先由多模態模型理解意圖，再出圖",
      stages: [
        encoderStage(id),
        {
          key: "reason",
          title: "理解意圖",
          summary: "先像語言模型一樣讀懂你要什麼",
          detail: "這一類不是「提示詞→擴散」那套旋鈕世界：它先理解意圖再渲染，所以長句、口語、指令式描述反而吃得動。",
        },
        {
          key: "render",
          title: "渲染輸出",
          summary: "依理解結果生成畫面",
          detail: "吃 aspect_ratio、可掛參考圖，但沒有 steps／CFG 那些旋鈕；輸出通常帶 SynthID 之類的隱形浮水印。",
        },
      ],
      caveat: "官方未公開文字窗口與內部結構，站內只描述公開的運作方式，不猜細節。",
    };
  }

  if (/ideogram|recraft/.test(id)) {
    return {
      family: "layout-specialized",
      label: "設計／排版特化",
      conditioning: "官方未公開",
      stages: [
        encoderStage(id),
        {
          key: "layout",
          title: "文字與版面特化",
          summary: "針對畫面內文字渲染與版面結構特別最佳化",
          detail: "這一類的強項是把字寫對、把版面排好（海報、招牌、標題），對「畫面內要出現正確文字」的需求明顯優於通用擴散模型。",
        },
      ],
      caveat: "閉源模型：官方未公開骨幹與文字窗口，這裡只描述公開已知的定位，不猜內部結構。",
    };
  }

  return {
    family: "unknown",
    label: "未收錄的模型",
    conditioning: "未知",
    stages: [encoderStage(id)],
    caveat: "站內還沒整理這顆模型的架構資料，只顯示文字窗口這一關可查的部分。",
  };
}
