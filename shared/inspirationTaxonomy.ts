/**
 * 靈感頻道自動細化分類（inspiration taxonomy）。
 *
 * 為什麼要這一層：
 *   靈感頻道原本只有 mediaKind（提示詞／圖片／影片／音訊／設定卡）五格粗篩。
 *   五格在貼文破百之後等於沒有篩選——使用者想找的是「夜景霓虹的城市空拍」，
 *   不是「圖片」。要讓別人的素材真的被再用，分類必須細到「找得到同一種感覺」。
 *
 * 為什麼不叫 LLM 分類：
 *   1. 發布是同步動作，等一次模型回應要 1～3 秒，且要花點數；
 *   2. 同一段 prompt 兩次分類結果可能不同，篩選面就不可信；
 *   3. 分類規則要能被測試斷言——字典是資料，模型不是。
 *   因此這裡是**純函式 + 中英雙語關鍵詞字典**：零延遲、零成本、可重現、可測。
 *   之後若要接模型，正確作法是模型只補 `tags`（作者標籤），不覆寫 autoTags。
 *
 * 分類是**多面向（facet）**而非單一樹：一張圖同時可以是
 *   題材＝城市、風格＝賽博龐克、氛圍＝孤獨、光線＝霓虹、鏡頭＝空拍。
 *   單一分類樹逼人二選一，facet 不會。
 *
 * 標籤格式一律 `facet:value`（例：`subject:city`），存進 community_posts.auto_tags，
 * 用 jsonb `@>` 做篩選。改字典時務必 **bump TAXONOMY_VERSION**——
 * 舊列的 taxonomy_version 落後就會被自動重算（見 server/services/communityTaxonomy.ts）。
 */

/** 字典版本。改動任何 keyword／value／facet 都要 +1，否則舊貼文不會被重新分類。 */
export const TAXONOMY_VERSION = 1;

export type FacetId = "modality" | "subject" | "style" | "mood" | "light" | "shot" | "usage";

export type FacetValueDef = {
  /** value id，與 facet 組成 `facet:value` 標籤 */
  id: string;
  /** 中文顯示名（頻道篩選 chip 直接用） */
  label: string;
  /**
   * 命中詞。含 CJK 的詞走子字串比對；純拉丁詞走字界比對
   * （避免 "3d" 命中 "a3db"、"ink" 命中 "thinking"）。
   */
  keywords: string[];
};

export type FacetDef = {
  id: FacetId;
  label: string;
  /** 這個面向最多掛幾個值（超過就取分數最高的前 N 個） */
  maxValues: number;
  /** 有多細就多細：只有 modality 是從 mediaKind 推的，其餘都靠文字 */
  derived?: boolean;
  values: FacetValueDef[];
};

/**
 * 面向宣告順序＝標籤輸出順序＝篩選列顯示順序。
 * 「主分類」的挑選也吃這個順序（見 PRIMARY_FACET_ORDER）。
 */
export const INSPIRATION_FACETS: readonly FacetDef[] = [
  {
    id: "modality",
    label: "形式",
    maxValues: 1,
    derived: true,
    values: [
      { id: "text", label: "提示詞", keywords: [] },
      { id: "image", label: "圖片", keywords: [] },
      { id: "video", label: "影片", keywords: [] },
      { id: "audio", label: "音訊", keywords: [] },
      { id: "card", label: "設定卡", keywords: [] },
    ],
  },
  {
    id: "subject",
    label: "題材",
    maxValues: 2,
    values: [
      {
        id: "person",
        label: "人物角色",
        keywords: [
          "人物", "人像", "肖像", "女生", "男生", "女子", "男子", "少女", "少年", "老人",
          "角色", "主角", "僧人", "法師", "禪師", "師父", "群眾", "背影", "臉部",
          "portrait", "person", "people", "woman", "man", "girl", "boy",
          "character", "face", "monk", "crowd", "figure",
        ],
      },
      {
        id: "city",
        label: "城市建築",
        keywords: [
          "城市", "都市", "街道", "街景", "巷弄", "建築", "大樓", "高樓", "城鎮",
          "廟宇", "寺院", "禪堂", "教堂", "室內", "房間", "咖啡廳", "地鐵", "天際線",
          "city", "urban", "street", "alley", "building", "architecture", "skyline",
          "temple", "church", "interior", "room", "cafe", "subway", "rooftop",
        ],
      },
      {
        id: "nature",
        label: "自然風景",
        keywords: [
          "風景", "山", "山脈", "海", "海邊", "森林", "樹林", "天空", "雲", "草原",
          "河", "湖", "瀑布", "沙漠", "雪地", "花", "樹", "田野", "星空",
          "landscape", "mountain", "sea", "ocean", "beach", "forest", "woods",
          "sky", "cloud", "meadow", "river", "lake", "waterfall", "desert",
          "snow", "flower", "tree", "field", "nature",
        ],
      },
      {
        id: "animal",
        label: "動物",
        keywords: [
          "動物", "貓", "狗", "鳥", "魚", "龍", "馬", "獅", "鹿", "蝴蝶", "昆蟲",
          "animal", "cat", "dog", "bird", "fish", "dragon", "horse", "lion",
          "deer", "butterfly", "insect", "creature",
        ],
      },
      {
        id: "food",
        label: "食物飲品",
        keywords: [
          "食物", "料理", "美食", "咖啡", "茶", "蛋糕", "麵", "飯", "甜點", "飲料",
          "food", "dish", "meal", "cuisine", "coffee", "tea", "cake",
          "noodle", "dessert", "drink", "cocktail",
        ],
      },
      {
        id: "object",
        label: "物件靜物",
        keywords: [
          "靜物", "物件", "道具", "產品", "器物", "桌面", "書", "樂器", "包裝",
          "still life", "object", "product", "prop", "tool", "instrument",
          "packaging", "gadget", "mockup",
        ],
      },
      {
        id: "vehicle",
        label: "交通載具",
        keywords: [
          "汽車", "機車", "腳踏車", "飛機", "船", "火車", "太空船", "捷運車廂",
          "car", "vehicle", "motorcycle", "bike", "bicycle", "plane", "aircraft",
          "ship", "boat", "train", "spaceship", "spacecraft",
        ],
      },
      {
        id: "abstract",
        label: "抽象圖形",
        keywords: [
          "抽象", "幾何", "圖形", "紋理", "材質", "漸層", "粒子", "流體", "光影圖案",
          "abstract", "geometric", "pattern", "texture", "gradient",
          "particle", "fluid", "generative",
        ],
      },
      {
        id: "typography",
        label: "文字排版",
        keywords: [
          "字體", "字型", "排版", "標題字", "書法字", "招牌", "標誌",
          "typography", "lettering", "typeface", "font", "logo", "title card", "signage",
        ],
      },
      {
        id: "fantasy",
        label: "科幻奇幻",
        keywords: [
          "科幻", "未來", "未來感", "外星", "機甲", "賽博格", "魔法", "奇幻", "神話",
          "仙境", "妖怪", "異世界",
          "sci-fi", "scifi", "science fiction", "futuristic", "alien", "mecha",
          "cyborg", "magic", "fantasy", "mythical", "mythology", "otherworld",
        ],
      },
    ],
  },
  {
    id: "style",
    label: "風格",
    maxValues: 2,
    values: [
      {
        id: "photoreal",
        label: "寫實攝影",
        keywords: [
          "寫實", "實拍", "照片", "攝影", "真實感", "紀實", "人像攝影",
          "photorealistic", "photoreal", "photo", "photography", "photographic",
          "realistic", "dslr", "35mm", "50mm", "documentary",
        ],
      },
      {
        id: "anime",
        label: "動畫二次元",
        keywords: [
          "動畫", "動漫", "二次元", "日系", "賽璐璐", "少女漫", "熱血漫",
          "anime", "manga", "cel shading", "cel-shaded", "ghibli", "2d animation",
        ],
      },
      {
        id: "illustration",
        label: "插畫手繪",
        keywords: [
          "插畫", "手繪", "水彩", "油畫", "素描", "線稿", "鉛筆", "蠟筆", "版畫",
          "illustration", "illustrated", "painting", "painterly", "watercolor",
          "oil painting", "sketch", "line art", "hand drawn", "gouache", "engraving",
        ],
      },
      {
        id: "ink",
        label: "水墨禪畫",
        keywords: [
          "水墨", "國畫", "禪畫", "書法", "潑墨", "工筆", "宣紙",
          "ink wash", "sumi-e", "chinese painting", "calligraphy", "rice paper",
        ],
      },
      {
        id: "cg3d",
        label: "3D／CG",
        keywords: [
          "3d", "cg", "渲染", "建模", "次表面", "光線追蹤",
          "cgi", "render", "rendering", "octane", "blender", "unreal",
          "c4d", "cinema 4d", "ray tracing", "subsurface",
        ],
      },
      {
        id: "cyberpunk",
        label: "賽博龐克",
        keywords: [
          "賽博", "賽博龐克", "電馭叛客", "蒸汽龐克",
          "cyberpunk", "neon noir", "blade runner", "steampunk", "dystopian",
        ],
      },
      {
        id: "retro",
        label: "復古膠片",
        keywords: [
          "復古", "懷舊", "膠片", "底片", "老照片", "顆粒感", "年代感",
          "vintage", "retro", "film grain", "grainy", "polaroid",
          "80s", "90s", "vhs", "analog",
        ],
      },
      {
        id: "minimal",
        label: "極簡乾淨",
        keywords: [
          "極簡", "簡約", "乾淨", "留白", "無印",
          "minimal", "minimalist", "clean", "simple", "flat design", "negative space",
        ],
      },
      {
        id: "pixel",
        label: "像素點陣",
        keywords: ["像素", "點陣", "pixel art", "pixelated", "8-bit", "16-bit", "voxel"],
      },
      {
        id: "collage",
        label: "拼貼混媒",
        keywords: [
          "拼貼", "蒙太奇", "混合媒材", "剪貼",
          "collage", "montage", "mixed media", "cut out", "scrapbook",
        ],
      },
    ],
  },
  {
    id: "mood",
    label: "氛圍",
    maxValues: 2,
    values: [
      {
        id: "warm",
        label: "溫暖療癒",
        keywords: [
          "溫暖", "療癒", "溫柔", "安心", "幸福", "舒服", "暖心", "陪伴",
          "warm", "cozy", "healing", "gentle", "comforting", "heartwarming", "tender",
        ],
      },
      {
        id: "calm",
        label: "寧靜禪意",
        keywords: [
          "寧靜", "平靜", "安靜", "靜謐", "沉靜", "冥想", "禪意", "空靈", "放空",
          "calm", "serene", "peaceful", "tranquil", "zen", "meditative", "quiet", "stillness",
        ],
      },
      {
        id: "lonely",
        label: "孤獨惆悵",
        keywords: [
          "孤獨", "寂寞", "憂鬱", "惆悵", "思念", "一個人", "落寞", "等待",
          "lonely", "loneliness", "melancholy", "melancholic", "solitude",
          "wistful", "nostalgic", "longing", "somber",
        ],
      },
      {
        id: "epic",
        label: "史詩壯闊",
        keywords: [
          "史詩", "壯闊", "宏大", "磅礡", "震撼", "英雄", "遼闊",
          "epic", "grand", "majestic", "monumental", "heroic", "awe",
        ],
      },
      {
        id: "dark",
        label: "黑暗懸疑",
        keywords: [
          "黑暗", "陰暗", "恐怖", "懸疑", "詭異", "壓迫", "不安", "驚悚",
          "dark", "horror", "eerie", "ominous", "creepy", "thriller", "sinister", "haunting",
        ],
      },
      {
        id: "joyful",
        label: "明亮歡快",
        keywords: [
          "歡快", "活潑", "明亮", "熱鬧", "可愛", "俏皮", "繽紛", "慶祝",
          "joyful", "playful", "cheerful", "bright", "lively", "cute",
          "vibrant", "festive", "whimsical",
        ],
      },
      {
        id: "mystic",
        label: "神秘夢幻",
        keywords: [
          "神秘", "夢幻", "超現實", "迷幻", "幻境", "縹緲", "夢境",
          "mysterious", "dreamy", "dreamlike", "surreal", "ethereal",
          "psychedelic", "otherworldly",
        ],
      },
    ],
  },
  {
    id: "light",
    label: "光線色調",
    maxValues: 2,
    values: [
      {
        id: "night",
        label: "夜景",
        keywords: [
          "夜", "夜景", "夜晚", "深夜", "月光", "星空", "凌晨",
          "night", "nighttime", "midnight", "moonlight", "starry", "nocturnal", "after dark",
        ],
      },
      {
        id: "golden",
        label: "黃昏晨光",
        keywords: [
          "黃昏", "夕陽", "日落", "日出", "晨光", "金色光", "魔幻時刻",
          "golden hour", "magic hour", "sunset", "sunrise", "dawn", "dusk", "twilight",
        ],
      },
      {
        id: "neon",
        label: "霓虹螢光",
        keywords: [
          "霓虹", "螢光", "燈牌", "招牌燈", "發光",
          "neon", "glowing", "glow", "fluorescent", "luminous",
        ],
      },
      {
        id: "soft",
        label: "柔光朦朧",
        keywords: [
          "柔光", "散光", "陰天", "霧", "薄霧", "朦朧", "柔和光",
          "soft light", "diffused", "overcast", "foggy", "fog", "hazy", "mist", "misty",
        ],
      },
      {
        id: "contrast",
        label: "高對比逆光",
        keywords: [
          "高對比", "強光影", "硬光", "剪影", "逆光", "光束", "戲劇光",
          "high contrast", "hard light", "silhouette", "backlit", "backlight",
          "chiaroscuro", "dramatic lighting", "god rays",
        ],
      },
      {
        id: "mono",
        label: "黑白單色",
        keywords: [
          "黑白", "單色", "灰階", "無彩度",
          "monochrome", "monochromatic", "black and white", "grayscale", "greyscale", "b&w",
        ],
      },
      {
        id: "cool",
        label: "冷色調",
        keywords: [
          "冷色", "冷調", "偏藍", "青色調", "藍調",
          "cool tone", "cool color", "blue tone", "teal", "cold color", "icy",
        ],
      },
      {
        id: "warmtone",
        label: "暖色調",
        keywords: [
          "暖色", "暖調", "偏黃", "橘調", "琥珀色",
          "warm tone", "warm color", "orange tone", "amber", "sepia",
        ],
      },
    ],
  },
  {
    id: "shot",
    label: "鏡頭視角",
    maxValues: 2,
    values: [
      {
        id: "closeup",
        label: "特寫微距",
        keywords: [
          "特寫", "近景", "大特寫", "微距", "細節鏡頭",
          "close-up", "closeup", "macro", "detail shot", "extreme close",
        ],
      },
      {
        id: "medium",
        label: "中景半身",
        keywords: ["中景", "半身", "腰上", "medium shot", "waist up", "mid shot"],
      },
      {
        id: "wide",
        label: "廣角全景",
        keywords: [
          "全景", "遠景", "廣角", "大景", "寬景", "定場",
          "wide shot", "wide angle", "establishing shot", "panorama", "panoramic", "vista",
        ],
      },
      {
        id: "aerial",
        label: "空拍俯視",
        keywords: [
          "空拍", "俯視", "鳥瞰", "由上往下", "高角度", "無人機",
          "aerial", "drone", "top-down", "top down", "bird's eye", "birds eye", "overhead",
        ],
      },
      {
        id: "lowangle",
        label: "仰角",
        keywords: ["仰角", "由下往上", "低角度", "low angle", "worm's eye", "upward shot"],
      },
      {
        id: "pov",
        label: "主觀視角",
        keywords: ["第一人稱", "主觀視角", "手持", "pov", "first person", "handheld", "over the shoulder"],
      },
    ],
  },
  {
    id: "usage",
    label: "用途",
    maxValues: 2,
    values: [
      {
        id: "dharma",
        label: "弘法禪修",
        keywords: [
          "弘法", "禪修", "禪坐", "靜坐", "打坐", "佛", "菩薩", "法會", "經文",
          "禪學", "印心", "師父開示", "供養",
          "dharma", "buddha", "buddhist", "buddhism", "meditation retreat", "sutra", "chanting",
        ],
      },
      {
        id: "poster",
        label: "海報宣傳",
        keywords: [
          "海報", "宣傳", "文宣", "封面", "主視覺", "傳單", "橫幅",
          "poster", "flyer", "cover art", "key visual", "banner", "promo", "advertisement",
        ],
      },
      {
        id: "character_design",
        label: "角色設定",
        keywords: [
          "角色設定", "設定稿", "人設", "三視圖", "服裝設計", "造型設定",
          "character design", "character sheet", "turnaround", "reference sheet",
          "costume design", "concept art",
        ],
      },
      {
        id: "storyboard",
        label: "分鏡腳本",
        keywords: [
          "分鏡", "腳本", "場景表", "鏡頭表", "劇本",
          "storyboard", "shot list", "scene breakdown", "screenplay", "script",
        ],
      },
      {
        id: "opening",
        label: "片頭轉場",
        keywords: [
          "片頭", "開場", "轉場", "片尾", "字卡",
          "title sequence", "opening", "intro animation", "transition", "end credits",
        ],
      },
      {
        id: "social",
        label: "社群短影音",
        keywords: [
          "社群", "貼文", "限動", "短影音", "直式影片",
          "instagram", "reels", "shorts", "tiktok", "social post", "thumbnail",
        ],
      },
      {
        id: "sound",
        label: "配樂音效",
        keywords: [
          "配樂", "音效", "背景音樂", "旁白", "人聲", "節奏", "環境音",
          "bgm", "sound effect", "soundtrack", "voiceover", "narration",
          "ambient sound", "score",
        ],
      },
    ],
  },
];

/** facet id → 定義（避免每次線性搜尋） */
const FACET_BY_ID = new Map<string, FacetDef>(INSPIRATION_FACETS.map((f) => [f.id, f]));

/** `facet:value` → 顯示名（含 facet 名，供 chip／說明使用） */
const VALUE_BY_TAG = new Map<string, { facet: FacetDef; value: FacetValueDef }>();
for (const facet of INSPIRATION_FACETS) {
  for (const value of facet.values) {
    VALUE_BY_TAG.set(`${facet.id}:${value.id}`, { facet, value });
  }
}

/**
 * 主分類挑選順序：使用者第一眼要看到的是「這是什麼」。
 * 題材 > 用途 > 風格 > 氛圍；全都沒命中才退回形式（modality 一定有值）。
 */
const PRIMARY_FACET_ORDER: FacetId[] = ["subject", "usage", "style", "mood", "light", "shot", "modality"];

export type InspirationClassifyInput = {
  /** community_posts.media_kind；決定 modality，且無關鍵詞時的保底分類 */
  mediaKind?: string | null;
  sourceType?: string | null;
  title?: string | null;
  description?: string | null;
  promptText?: string | null;
  /** 作者自填標籤（也納入比對——作者寫「賽博龐克」時不該還要 prompt 再寫一次） */
  tags?: readonly string[] | null;
  /** 上傳素材的原始檔名（常帶 sunset / night 這種線索） */
  fileName?: string | null;
};

export type InspirationTagHit = {
  facet: FacetId;
  facetLabel: string;
  value: string;
  label: string;
  /** `facet:value` */
  tag: string;
  /** 命中的關鍵詞數量（愈高愈確定） */
  score: number;
};

export type InspirationTaxonomy = {
  version: number;
  /** 正規化標籤（`facet:value`），依 facet 宣告順序、同 facet 內依分數 */
  tags: string[];
  /** 主分類標籤；永遠有值（最差是 `modality:<kind>`） */
  category: string;
  /** 主分類中文名（列表用，免得前端再查表） */
  categoryLabel: string;
  /** 逐標籤細節（分數／facet 名），給「為什麼分到這類」與除錯用 */
  hits: InspirationTagHit[];
};

/** 純拉丁關鍵詞的字界比對快取：字典固定，正規表達式只編譯一次 */
const LATIN_PATTERNS = new Map<string, RegExp>();

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 非 ASCII ＝ 中日韓詞：中文沒有空白分詞，只能子字串比對 */
function isNonAscii(text: string): boolean {
  return /[^\x00-\x7f]/.test(text);
}

function matchesKeyword(haystack: string, keyword: string): boolean {
  if (isNonAscii(keyword)) return haystack.includes(keyword);
  let pattern = LATIN_PATTERNS.get(keyword);
  if (!pattern) {
    // 字界不用 \b：關鍵詞可能以符號結尾（"b&w"、"sci-fi"），\b 在那裡的語意會反過來。
    pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(keyword)}(?![a-z0-9])`, "i");
    LATIN_PATTERNS.set(keyword, pattern);
  }
  return pattern.test(haystack);
}

/** 把貼文的所有文字併成一段比對材料（全轉小寫；中文不受影響） */
function buildHaystack(input: InspirationClassifyInput): string {
  return [
    input.title ?? "",
    input.description ?? "",
    input.promptText ?? "",
    (input.tags ?? []).join(" "),
    input.fileName ?? "",
  ]
    .join("\n")
    .toLowerCase();
}

/** mediaKind → modality value id（未知一律當提示詞，與 DB 預設一致） */
function modalityOf(mediaKind?: string | null): string {
  const kind = (mediaKind ?? "").toLowerCase();
  const facet = FACET_BY_ID.get("modality")!;
  return facet.values.some((v) => v.id === kind) ? kind : "text";
}

/**
 * 自動細化分類。純函式：同樣輸入永遠同樣輸出，沒有 IO、沒有時間依賴。
 */
export function classifyInspiration(input: InspirationClassifyInput): InspirationTaxonomy {
  const haystack = buildHaystack(input);
  const hits: InspirationTagHit[] = [];

  for (const facet of INSPIRATION_FACETS) {
    if (facet.derived) continue;
    const scored: InspirationTagHit[] = [];
    for (const value of facet.values) {
      let score = 0;
      for (const keyword of value.keywords) {
        if (matchesKeyword(haystack, keyword)) score += 1;
      }
      if (score > 0) {
        scored.push({
          facet: facet.id,
          facetLabel: facet.label,
          value: value.id,
          label: value.label,
          tag: `${facet.id}:${value.id}`,
          score,
        });
      }
    }
    // 同分時維持字典宣告順序（穩定排序）——分類結果不可以因為 V8 排序細節而漂移
    scored.sort((a, b) => b.score - a.score);
    hits.push(...scored.slice(0, facet.maxValues));
  }

  // modality 從 mediaKind 推，永遠存在：頻道保證每則貼文至少有一個標籤可篩
  const modality = modalityOf(input.mediaKind);
  const modalityFacet = FACET_BY_ID.get("modality")!;
  const modalityValue = modalityFacet.values.find((v) => v.id === modality)!;
  const modalityHit: InspirationTagHit = {
    facet: "modality",
    facetLabel: modalityFacet.label,
    value: modalityValue.id,
    label: modalityValue.label,
    tag: `modality:${modalityValue.id}`,
    score: 1,
  };

  const ordered = [modalityHit, ...hits];
  const category = pickPrimary(ordered);

  return {
    version: TAXONOMY_VERSION,
    tags: ordered.map((h) => h.tag),
    category: category.tag,
    categoryLabel: category.label,
    hits: ordered,
  };
}

/** 依 PRIMARY_FACET_ORDER 找主分類；同 facet 內取分數最高 */
function pickPrimary(hits: InspirationTagHit[]): InspirationTagHit {
  for (const facetId of PRIMARY_FACET_ORDER) {
    const candidates = hits.filter((h) => h.facet === facetId);
    if (candidates.length === 0) continue;
    return candidates.reduce((best, cur) => (cur.score > best.score ? cur : best));
  }
  // PRIMARY_FACET_ORDER 以 modality 收尾，且 modality 一定有值，理論上到不了這裡
  return hits[0];
}

/** `facet:value` → 顯示資訊；未知標籤回 null（字典縮減後舊列不會炸掉畫面） */
export function describeInspirationTag(
  tag: string,
): { facet: FacetId; facetLabel: string; value: string; label: string } | null {
  const found = VALUE_BY_TAG.get(tag);
  if (!found) return null;
  return {
    facet: found.facet.id,
    facetLabel: found.facet.label,
    value: found.value.id,
    label: found.value.label,
  };
}

/** 標籤的中文短名（找不到就回原字串，永遠不吐 undefined 到畫面上） */
export function inspirationTagLabel(tag: string): string {
  return describeInspirationTag(tag)?.label ?? tag;
}

/** 標籤是否為本字典認得的格式（篩選輸入驗證用；擋掉任意字串打進 jsonb 查詢） */
export function isKnownInspirationTag(tag: string): boolean {
  return VALUE_BY_TAG.has(tag);
}

/** 全部合法標籤（zod enum／測試列舉用） */
export function allInspirationTags(): string[] {
  return [...VALUE_BY_TAG.keys()];
}

/**
 * 把一串標籤依 facet 分組，並保持 INSPIRATION_FACETS 的順序。
 * 前端篩選列與卡片標籤都走這裡，確保兩處排序一致。
 */
export function groupInspirationTags(
  tags: readonly string[],
): { facet: FacetDef; tags: { tag: string; label: string }[] }[] {
  const byFacet = new Map<string, { tag: string; label: string }[]>();
  for (const tag of tags) {
    const found = VALUE_BY_TAG.get(tag);
    if (!found) continue;
    const bucket = byFacet.get(found.facet.id) ?? [];
    bucket.push({ tag, label: found.value.label });
    byFacet.set(found.facet.id, bucket);
  }
  return INSPIRATION_FACETS.filter((f) => byFacet.has(f.id)).map((facet) => ({
    facet,
    tags: byFacet.get(facet.id)!,
  }));
}
