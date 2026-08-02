import { MODELS, type ModelEntry } from "./models";
import { SCENARIO_PLAYBOOK, type ScenarioEntry } from "./scenarioPlaybook";

export type ModelPromptConversion = {
  scenarioId: string;
  scenarioTitle: string;
  recommendation: string;
  caution: string;
  modelId: string;
  modelLabel: string;
  category: ModelEntry["category"];
  outputKind: ModelEntry["kind"];
  tier: ModelEntry["tier"];
  points: number;
  cost: string;
  verified: boolean;
  requirements: string[];
  convertedPrompt: string;
  strengths: string;
  bestFor: string;
};

const KEYWORDS: Record<string, string[]> = {
  "quote-card": ["金句", "字卡", "書法", "中文字", "每日一語"],
  poster: ["海報", "文宣", "活動", "募款", "標題"],
  portrait: ["人物", "寫真", "志工", "紀實", "肖像", "師父"],
  "consistent-character": ["一致", "同一張臉", "角色", "多鏡", "分鏡", "定裝"],
  transcribe: ["逐字稿", "轉錄", "錄音", "開示", "摘要"],
  narration: ["旁白", "配音", "語音", "朗讀", "聲音"],
  "quote-motion": ["動態字卡", "漸變", "首尾", "綻放"],
  "b-roll": ["空鏡", "禪意", "晨光", "蓮花", "雲海", "影片", "鏡頭"],
  music: ["配樂", "主題曲", "音效", "音樂", "鐘聲", "木魚"],
  "photo-restore": ["老照片", "修復", "遺照", "黑白", "模糊"],
  "video-restore": ["老影片", "影帶", "補幀", "影片修復", "升級"],
  multilingual: ["翻譯", "多語", "英文", "日文", "對嘴"],
  "bg-removal": ["去背", "合成", "背景"],
  "photo-cleanup": ["清雜物", "路人", "活動照", "改比例", "修圖"],
  "brand-lora": ["品牌", "lora", "訓練", "風格資產"],
  avatar: ["虛擬主持", "頭像", "說話人物"],
  "silent-to-final": ["無聲", "字幕", "補音", "成品"],
  copywriting: ["腳本", "文案", "翻譯", "金句", "改寫"],
  "asset-catalog": ["素材庫", "建檔", "ocr", "看圖", "辨識"],
  "sketch-to-final": ["草圖", "手繪", "構圖", "實景照"],
};

const GENERIC_RECOMMENDATION = /^(?:請|幫我|可以|想)?\s*(?:推薦|建議|選擇|找).*(?:模型|工具)|適合.*專案.*模型/i;
const DEFAULT_SCENARIOS = ["quote-card", "consistent-character", "b-roll"];

function compact(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-Hant").replace(/\s+/g, " ").trim();
}

export function matchCreationScenarios(intent: string, limit = 3): ScenarioEntry[] {
  const normalized = compact(intent);
  if (!normalized || GENERIC_RECOMMENDATION.test(normalized)) {
    return DEFAULT_SCENARIOS.flatMap((id) => {
      const scenario = SCENARIO_PLAYBOOK.find((row) => row.id === id);
      return scenario ? [scenario] : [];
    }).slice(0, limit);
  }

  const ranked = SCENARIO_PLAYBOOK.map((scenario, index) => {
    const title = compact(scenario.title);
    const keywordScore = (KEYWORDS[scenario.id] ?? []).reduce(
      (score, keyword) => score + (normalized.includes(compact(keyword)) ? 3 : 0),
      0,
    );
    const titleScore = title.split(/[\s/()→:]+/).reduce(
      (score, token) => score + (token.length >= 2 && normalized.includes(token) ? 2 : 0),
      0,
    );
    return { scenario, score: keywordScore + titleScore, index };
  }).filter((row) => row.score > 0);

  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  if (ranked.length) return ranked.slice(0, limit).map((row) => row.scenario);
  return DEFAULT_SCENARIOS.flatMap((id) => {
    const scenario = SCENARIO_PLAYBOOK.find((row) => row.id === id);
    return scenario ? [scenario] : [];
  }).slice(0, limit);
}

function modelRequirements(model: ModelEntry): string[] {
  const result: string[] = [];
  if (model.needs) result.push(model.sourceHint ?? `需要 ${model.needs} 來源素材`);
  if (model.secondaryNeeds) result.push(model.secondarySourceHint ?? `另需 ${model.secondaryNeeds} 來源素材`);
  return result;
}

export function convertPromptForModel(intent: string, scenario: ScenarioEntry, model: ModelEntry): string {
  const source = GENERIC_RECOMMENDATION.test(compact(intent)) || !intent.trim()
    ? scenario.title
    : intent.trim();
  switch (model.category) {
    case "text-to-image": {
      const exactText = scenario.id === "quote-card" || scenario.id === "poster"
        ? "；若畫面含文字，文字必須逐字正確、不可增刪或變形"
        : "";
      return `主題：${source}；構圖：主體清楚、層次分明、保留安全留白；光線與色彩：符合專案既定基調；品質：細節自然、無浮水印${exactText}`;
    }
    case "image-to-image":
      return `保留來源圖的人物身分、五官、主要構圖與關鍵物件，只調整：${source}；不得新增無關人物、文字或改變核心辨識特徵`;
    case "text-to-video":
      return `主體與動作：${source}；鏡頭：穩定中景，緩慢推進；時間連續、動作自然；光線與色彩符合專案基調；畫面不要生成字幕、標誌或浮水印`;
    case "image-to-video":
      return `以來源圖為第一幀並保持人物、服裝、場景與色彩一致；動作：${source}；鏡頭運動平穩，避免臉部漂移、物件變形與突然切景`;
    case "video-to-video":
      return `保留原影片人物身分、時間順序、構圖與動作，只執行：${source}；不得重寫人物五官或加入新主體`;
    case "text-to-speech":
      return source;
    case "text-to-audio":
      return `${source}；整體乾淨、無人聲旁白、長度與情緒符合成片用途`;
    case "speech-to-text":
      return `將來源音訊忠實轉為繁體中文；保留段落與說話順序；佛學、人名與專有名詞不確定時標記待校對，不自行改寫`;
    case "llm":
      return `任務：${source}\n輸出：繁體中文、直接給可使用結果；重要事實標示來源或不確定性；不要輸出隱藏思維過程。`;
    case "vision":
      return `分析來源影像並以繁體中文輸出：主體、場景、畫面文字、可用標籤與不確定項目。任務重點：${source}`;
    case "training":
      return `訓練目標：${source}；資料需同一角色或同一風格、清楚且已授權；排除浮水印、重複圖與錯誤標註`;
    default:
      return source;
  }
}

export function buildProactiveModelConversions(
  intent: string,
  options: { scenarioLimit?: number; modelsPerScenario?: number } = {},
): ModelPromptConversion[] {
  const scenarios = matchCreationScenarios(intent, options.scenarioLimit ?? 3);
  const modelsPerScenario = options.modelsPerScenario ?? 2;
  return scenarios.flatMap((scenario) => scenario.modelIds
    .flatMap((modelId) => {
      const model = MODELS.find((row) => row.id === modelId);
      return model ? [model] : [];
    })
    .sort((a, b) => Number(b.verified) - Number(a.verified) || Number(b.recommended) - Number(a.recommended))
    .slice(0, modelsPerScenario)
    .map((model) => ({
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      recommendation: scenario.recommend,
      caution: scenario.tip,
      modelId: model.id,
      modelLabel: model.label,
      category: model.category,
      outputKind: model.kind,
      tier: model.tier,
      points: model.points,
      cost: model.cost,
      verified: model.verified,
      requirements: modelRequirements(model),
      convertedPrompt: convertPromptForModel(intent, scenario, model),
      strengths: model.strengths,
      bestFor: model.bestFor,
    })));
}
