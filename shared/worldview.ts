import { z } from "zod";

/**
 * 世界觀（專案定盤星）— 業界 brief 驗證過的分層設計：
 * 快速層 5 欄（1 分鐘填完）＋進階層（摺疊，可後補）。
 *
 * Chips 策略：
 * - **視覺風格＝媒材家族 × 主風格 × 可選質感**（家族互斥；主風格准單選；同家族質感 0～1）。
 *   儲存仍為 `styles: string[]`（[主風格, 質感?]）；跨家族舊資料注入只吃可解析的主風格。
 * - 主軸／調性可複選：陣列**順序＝優先序**（index 0＝主要）；UI 軟上限；注入硬截斷。
 * - 圖影：風格 look(+同家族 texture)、調性 2；LLM／導演標主要並截斷。
 */
// 上限：字串欄位單值 500 字、陣列最多 30 項且逐項 100 字——世界觀整份會注入付費 LLM，無上限＝可被塞爆與注入
export const worldviewSchema = z.object({
  // 快速層
  logline: z.string().max(500).default(""), // 一句話故事
  message: z.string().max(500).default(""), // 一句關鍵訊息（一片一訊息）
  audience: z.string().max(500).default(""), // 目標觀眾
  themes: z.array(z.string().max(100)).max(30).default([]), // 訊息主軸（苦→修行→轉變→感恩…）
  tones: z.array(z.string().max(100)).max(30).default([]), // 調性 chips
  // 進階層（可後補）
  acts: z
    .object({
      hook: z.string().max(500).default(""),
      turn: z.string().max(500).default(""),
      cta: z.string().max(500).default(""),
    })
    .default({ hook: "", turn: "", cta: "" }),
  people: z.array(z.string().max(100)).max(30).default([]),
  styles: z.array(z.string().max(100)).max(30).default([]),
  references: z.array(z.string().max(100)).max(30).default([]), // 參考影片連結
  taboos: z.array(z.string().max(100)).max(30).default(DEFAULT_TABOOS()), // 禁忌事項（含預設禁語）
});

export type Worldview = z.infer<typeof worldviewSchema>;

/** 預設禁語：醫療宣稱風險（盲點掃描 #4 定案） */
export function DEFAULT_TABOOS(): string[] {
  return ["不得使用「治癒/治療/療效」等醫療宣稱字眼", "不影射真實人物形象", "引用開示僅供建議，須組長審核後才可使用"];
}

export const TONE_OPTIONS = ["莊嚴", "溫暖", "真誠", "療癒", "活潑", "簡約"];
export const THEME_OPTIONS = ["苦→修行→轉變→感恩", "禪修日常", "佛法入門", "活動紀實", "感恩分享"];

/**
 * UI／正規化上限：風格 look+質感 ≤2；調性／主軸 2（軟警告，助手套用時截斷）。
 */
export const CHIP_SOFT_MAX = {
  themes: 2,
  tones: 2,
  styles: 2,
} as const;

/** 圖／影正向注入硬截斷（風格經 stylesForVisualInject 再截；避免跨家族互撞） */
export const VISUAL_INJECT_MAX = {
  tones: 2,
  styles: 2,
} as const;

/** LLM 生成附加：同樣收斂，避免 token 與敘事方向過散 */
export const LLM_INJECT_MAX = {
  themes: 2,
  tones: 2,
  styles: 2,
} as const;

export const TONE_EN: Record<string, string> = {
  "莊嚴": "solemn, majestic",
  "溫暖": "warm, gentle",
  "真誠": "sincere, heartfelt",
  "療癒": "soothing, healing",
  "活潑": "lively, vibrant",
  "簡約": "clean, minimal",
};

/** 媒材家族：互斥；跨家族並選畫面易沖 */
export type StyleMediaFamily = "photo" | "illustrate" | "anime" | "3d" | "graphic" | "craft";

/** look＝主風格（家族內互斥）；texture＝同家族可選質感（0～1） */
export type StyleLookRole = "look" | "texture";

export const STYLE_FAMILY_ORDER: StyleMediaFamily[] = [
  "photo",
  "illustrate",
  "anime",
  "3d",
  "graphic",
  "craft",
];

export const STYLE_FAMILY_META: Record<
  StyleMediaFamily,
  { label: string; hint: string; emoji: string; defaultStyle: string }
> = {
  photo: { label: "寫實", hint: "攝影／紀實感", emoji: "📸", defaultStyle: "寫實攝影" },
  illustrate: { label: "插畫", hint: "手繪／繪本", emoji: "🎨", defaultStyle: "手繪插畫" },
  anime: { label: "動畫", hint: "賽璐璐／日系動漫", emoji: "🌸", defaultStyle: "日系動畫" },
  "3d": { label: "3D", hint: "立體渲染", emoji: "🧊", defaultStyle: "3D 動畫" },
  graphic: { label: "圖形", hint: "向量／平面設計", emoji: "🔷", defaultStyle: "扁平向量" },
  craft: { label: "工藝", hint: "實體材質手作", emoji: "🧶", defaultStyle: "剪紙拼貼" },
};

/**
 * 內建視覺風格的**單一真相表**：一列＝一個風格。
 *
 * 清單（STYLE_OPTIONS）、媒材家族對照、look/texture 角色、英文錨點全部由這張表衍生。
 * 原本是四份各自維護的 Record，加一個畫風要記得同步改四個地方——漏掉家族對照就變成
 * 「選得到但被當自訂值」，漏掉英文錨點就是「中文詞被模型當雜訊忽略、畫風錨不住」。
 *
 * en＝送進模型的英文錨點：FLUX/SDXL 等圖像影片模型以英文語彙訓練為主，純中文風格詞
 * 常被當雜訊忽略——視覺類別注入時附上英文對應，畫風才真正錨得住。
 * 只映射內建選項；組長自訂的 chips 沒有對應就維持原文注入（不猜翻譯）。
 *
 * 排序＝UI 出卡順序：家族分段，段內 look 在前、texture 在後；有實拍縮圖的排家族最前面。
 * 跨家族並選容易畫面互沖（寫實 vs 插畫 vs 3D）；同家族內 look + texture 可並存注入。
 */
const STYLE_DEFS: readonly {
  name: string;
  family: StyleMediaFamily;
  role: StyleLookRole;
  en: string;
}[] = [
  // ── 寫實：攝影／紀實 ──
  { name: "寫實攝影", family: "photo", role: "look", en: "photorealistic photography" },
  {
    name: "電影感光影",
    family: "photo",
    role: "look",
    en: "cinematic film still, anamorphic lighting, shallow depth of field",
  },
  {
    name: "紀實抓拍",
    family: "photo",
    role: "look",
    en: "candid documentary photojournalism, available light",
  },
  {
    name: "空氣感人像",
    family: "photo",
    role: "look",
    en: "airy portrait photography, soft natural light, creamy bokeh",
  },
  {
    name: "逆光剪影",
    family: "photo",
    role: "look",
    en: "backlit silhouette photography, rim light, atmospheric haze",
  },
  { name: "膠片質感", family: "photo", role: "texture", en: "analog film grain" },
  {
    name: "柔光暈影",
    family: "photo",
    role: "texture",
    en: "soft bloom, hazy glow, gentle vignette",
  },
  {
    name: "黑白單色",
    family: "photo",
    role: "texture",
    en: "black and white monochrome, rich tonal range",
  },

  // ── 插畫：手繪／繪本 ──
  { name: "日系水彩", family: "illustrate", role: "look", en: "Japanese watercolor illustration" },
  { name: "手繪插畫", family: "illustrate", role: "look", en: "hand-drawn illustration" },
  { name: "極簡線條", family: "illustrate", role: "look", en: "minimalist line art" },
  {
    name: "水墨禪意",
    family: "illustrate",
    role: "look",
    en: "Chinese ink wash painting, zen minimalism",
  },
  {
    name: "厚塗油畫",
    family: "illustrate",
    role: "look",
    en: "impasto oil painting, thick painterly brush strokes",
  },
  {
    name: "粉彩蠟筆",
    family: "illustrate",
    role: "look",
    en: "soft pastel and crayon illustration, chalky texture",
  },
  {
    name: "淡彩速寫",
    family: "illustrate",
    role: "look",
    en: "loose ink sketch with light watercolor wash, urban sketching",
  },
  {
    name: "紙纖理",
    family: "illustrate",
    role: "texture",
    en: "textured watercolor paper grain, visible fibers",
  },
  {
    name: "暈染邊緣",
    family: "illustrate",
    role: "texture",
    en: "wet-on-wet bleeding wash edges, pigment blooms",
  },

  // ── 動畫：賽璐璐／日系動漫 ──
  {
    name: "日系動畫",
    family: "anime",
    role: "look",
    en: "anime cel shading, clean line art, vivid key light",
  },
  {
    name: "劇場版動畫",
    family: "anime",
    role: "look",
    en: "theatrical anime feature film, lush painted backgrounds",
  },
  {
    name: "黑白漫畫",
    family: "anime",
    role: "look",
    en: "black and white manga, screentone shading, ink hatching",
  },
  {
    name: "Q 版角色",
    family: "anime",
    role: "look",
    en: "chibi character art, super deformed proportions",
  },
  {
    name: "復古卡通",
    family: "anime",
    role: "look",
    en: "retro 1930s rubber hose cartoon, bouncy shapes",
  },
  {
    name: "動態速度線",
    family: "anime",
    role: "texture",
    en: "manga speed lines, motion streaks",
  },
  {
    name: "賽璐璐高光",
    family: "anime",
    role: "texture",
    en: "glossy cel highlights, rim light, specular sheen",
  },

  // ── 3D：立體渲染 ──
  { name: "3D 動畫", family: "3d", role: "look", en: "3D animated render" },
  {
    name: "寫實 CG 渲染",
    family: "3d",
    role: "look",
    en: "photorealistic CGI render, physically based shading, ray tracing",
  },
  {
    name: "黏土定格",
    family: "3d",
    role: "look",
    en: "claymation stop-motion, handmade plasticine",
  },
  {
    name: "等距小場景",
    family: "3d",
    role: "look",
    en: "isometric miniature diorama, tilt-shift",
  },
  { name: "低多邊形", family: "3d", role: "look", en: "low poly 3D, faceted geometry, flat shading" },
  {
    name: "公仔玩具",
    family: "3d",
    role: "look",
    en: "vinyl designer toy figure render, glossy plastic",
  },
  {
    name: "陶土霧面",
    family: "3d",
    role: "texture",
    en: "matte clay material, soft subsurface scattering",
  },
  {
    name: "玻璃通透",
    family: "3d",
    role: "texture",
    en: "translucent glass and jelly material, refraction",
  },

  // ── 圖形：向量／平面設計 ──
  {
    name: "扁平向量",
    family: "graphic",
    role: "look",
    en: "flat vector illustration, clean geometric shapes",
  },
  {
    name: "幾何構成",
    family: "graphic",
    role: "look",
    en: "geometric abstract composition, bauhaus shapes",
  },
  {
    name: "極簡海報",
    family: "graphic",
    role: "look",
    en: "minimal swiss poster design, generous negative space",
  },
  { name: "漸層光暈", family: "graphic", role: "look", en: "smooth gradient mesh, aurora glow" },
  {
    name: "復古印刷",
    family: "graphic",
    role: "look",
    en: "retro mid-century print poster, limited palette",
  },
  {
    name: "網點印刷",
    family: "graphic",
    role: "texture",
    en: "risograph halftone dots, offset misregistration",
  },
  {
    name: "顆粒噪點",
    family: "graphic",
    role: "texture",
    en: "fine grain noise overlay, dithered speckle",
  },

  // ── 工藝：實體材質手作 ──
  {
    name: "剪紙拼貼",
    family: "craft",
    role: "look",
    en: "layered paper cut collage, papercraft depth",
  },
  {
    name: "木刻版畫",
    family: "craft",
    role: "look",
    en: "woodblock print, carved linework, relief printmaking",
  },
  { name: "刺繡織品", family: "craft", role: "look", en: "embroidered textile art, stitched thread" },
  { name: "沙畫流動", family: "craft", role: "look", en: "sand art on a lightbox, flowing grains" },
  {
    name: "皮影戲",
    family: "craft",
    role: "look",
    en: "shadow puppet theatre, backlit cut-out silhouettes",
  },
  {
    name: "布紋織理",
    family: "craft",
    role: "texture",
    en: "woven fabric weave texture, canvas grain",
  },
  {
    name: "手作毛邊",
    family: "craft",
    role: "texture",
    en: "torn handmade paper, deckle edges",
  },
];

// Visual Creative starter looks participate in family/texture semantics but do
// not expand ProjectPage's curated gallery (which has its own visual assets).
const VISUAL_CHOICE_STYLE_DEFS: readonly (typeof STYLE_DEFS)[number][] = [
  { name: "治癒繪本風", family: "illustrate", role: "look", en: "healing picture-book illustration, warm gentle colors" },
  { name: "電影感動畫", family: "anime", role: "look", en: "cinematic animation, filmic lighting and composition" },
  { name: "柔和水彩", family: "illustrate", role: "look", en: "soft watercolor washes, gentle pigment edges" },
  { name: "圖像漫畫", family: "graphic", role: "look", en: "graphic manga, clean linework and panel composition" },
  { name: "寫實電影", family: "photo", role: "look", en: "realistic cinematic film still" },
  { name: "粗略分鏡", family: "graphic", role: "look", en: "rough storyboard sketch, quick visual blocking" },
  { name: "柔焦夢境", family: "photo", role: "look", en: "dreamy soft-focus photography" },
  { name: "高對比", family: "graphic", role: "look", en: "high-contrast graphic lighting" },
];

/** 視覺風格內建清單：注入每次圖像/影片生成與 AI 導演建議，維持整支片畫風一致 */
export const STYLE_OPTIONS: string[] = STYLE_DEFS.map((d) => d.name);

export const STYLE_EN: Record<string, string> = Object.fromEntries(
  [...STYLE_DEFS, ...VISUAL_CHOICE_STYLE_DEFS].map((d) => [d.name, d.en]),
);

export const STYLE_MEDIA_FAMILY: Record<string, StyleMediaFamily> = Object.fromEntries(
  [...STYLE_DEFS, ...VISUAL_CHOICE_STYLE_DEFS].map((d) => [d.name, d.family]),
);

export const STYLE_LOOK_ROLE: Record<string, StyleLookRole> = Object.fromEntries(
  [...STYLE_DEFS, ...VISUAL_CHOICE_STYLE_DEFS].map((d) => [d.name, d.role]),
);

/** 把 chips 轉成「中文(英文)」雙語注入形；無對應者原樣保留 */
export function bilingualChips(values: string[], map: Record<string, string>): string[] {
  return values.map((v) => (map[v] ? `${v}(${map[v]})` : v));
}

export function styleFamilyOf(value: string): StyleMediaFamily | null {
  return STYLE_MEDIA_FAMILY[value] ?? null;
}

export function styleRoleOf(value: string): StyleLookRole | null {
  return STYLE_LOOK_ROLE[value] ?? null;
}

/** 內建選項依家族分組（look 在前、texture 在後） */
export function builtinStylesForFamily(family: StyleMediaFamily): string[] {
  const looks: string[] = [];
  const textures: string[] = [];
  for (const s of STYLE_OPTIONS) {
    if (STYLE_MEDIA_FAMILY[s] !== family) continue;
    if (STYLE_LOOK_ROLE[s] === "texture") textures.push(s);
    else looks.push(s);
  }
  return [...looks, ...textures];
}

export function looksForFamily(family: StyleMediaFamily): string[] {
  return STYLE_OPTIONS.filter(
    (s) => STYLE_MEDIA_FAMILY[s] === family && STYLE_LOOK_ROLE[s] !== "texture",
  );
}

export function texturesForFamily(family: StyleMediaFamily): string[] {
  return STYLE_OPTIONS.filter(
    (s) => STYLE_MEDIA_FAMILY[s] === family && STYLE_LOOK_ROLE[s] === "texture",
  );
}

/** 這批 styles 落在哪些媒材家族（去重、依家族固定順序；自訂值不計） */
export function styleFamiliesOf(styles: string[]): StyleMediaFamily[] {
  const hit = new Set(styles.map((s) => STYLE_MEDIA_FAMILY[s]).filter(Boolean));
  return STYLE_FAMILY_ORDER.filter((f) => hit.has(f));
}

/**
 * 給 AI 提示詞用的風格速查：一行一個家族（主風格／質感）。
 * 從同一張 STYLE_DEFS 衍生——提示詞裡手抄一份清單，加了新畫風就永遠有人忘了同步，
 * 模型只會一直推薦那七個舊詞。
 */
export function styleFamilyCheatsheet(): string {
  return STYLE_FAMILY_ORDER.map((fam) => {
    const meta = STYLE_FAMILY_META[fam];
    const looks = looksForFamily(fam).join("/");
    const textures = texturesForFamily(fam);
    return `${meta.label}(${meta.hint})：${looks}${textures.length ? `；質感：${textures.join("/")}` : ""}`;
  }).join("\n");
}

/** 從 styles 陣列解析家族／主風格／質感／其餘（舊多選或自訂） */
export function parseWorldviewStyleSlots(styles: string[]): {
  family: StyleMediaFamily | null;
  look: string | null;
  texture: string | null;
  customs: string[];
  extras: string[];
} {
  let look: string | null = null;
  let texture: string | null = null;
  const customs: string[] = [];
  const extras: string[] = [];
  for (const s of styles) {
    const fam = STYLE_MEDIA_FAMILY[s];
    const role = STYLE_LOOK_ROLE[s];
    if (!fam) {
      customs.push(s);
      continue;
    }
    if (role === "texture") {
      if (!texture) texture = s;
      else extras.push(s);
    } else {
      if (!look) look = s;
      else extras.push(s);
    }
  }
  const family =
    (look ? STYLE_MEDIA_FAMILY[look] : null) ??
    (texture ? STYLE_MEDIA_FAMILY[texture] : null) ??
    null;
  // 質感與主風格不同家族 → 質感降為 extras
  if (look && texture && STYLE_MEDIA_FAMILY[look] !== STYLE_MEDIA_FAMILY[texture]) {
    extras.push(texture);
    texture = null;
  }
  return { family, look, texture, customs, extras };
}

/** 合成可寫回的 styles：[look, texture?]；皆空則 [] */
export function composeWorldviewStyles(look: string | null, texture: string | null): string[] {
  if (!look && !texture) return [];
  if (!look && texture) {
    const fam = STYLE_MEDIA_FAMILY[texture];
    const def = fam ? STYLE_FAMILY_META[fam].defaultStyle : null;
    if (def && def !== texture) return [def, texture];
    return [texture];
  }
  if (look && texture && STYLE_MEDIA_FAMILY[look] === STYLE_MEDIA_FAMILY[texture]) {
    return [look, texture];
  }
  return look ? [look] : [];
}

/**
 * 正規化 styles：收斂為 look(+同家族 texture) 或單一自訂。
 * 跨家族舊資料只保留第一個可解析主風格（及合法質感）。
 */
export function canonicalizeWorldviewStyles(styles: string[]): string[] {
  const slots = parseWorldviewStyleSlots(styles);
  if (slots.look || slots.texture) {
    return composeWorldviewStyles(slots.look, slots.texture);
  }
  if (slots.customs.length) return [slots.customs[0]!];
  if (styles.length) return [styles[0]!];
  return [];
}

/** 圖影／LLM 實際注入的風格列表（look + 同家族 texture；自訂最多 1） */
export function stylesForVisualInject(styles: string[]): string[] {
  const slots = parseWorldviewStyleSlots(styles);
  if (slots.look || slots.texture) {
    return composeWorldviewStyles(slots.look, slots.texture).slice(0, VISUAL_INJECT_MAX.styles);
  }
  if (slots.customs.length) return slots.customs.slice(0, 1);
  return styles.slice(0, 1);
}

/** 人話：主風格／質感或舊多選主要標 */
export function formatWorldviewStylesLabel(styles: string[]): string {
  if (!styles.length) return "";
  const slots = parseWorldviewStyleSlots(styles);
  if (slots.look && slots.texture) return `主風格:${slots.look}；質感:${slots.texture}`;
  if (slots.look) return slots.look;
  if (slots.texture) return slots.texture;
  if (slots.customs.length === 1 && styles.length === 1) return slots.customs[0]!;
  return formatChipsPrimarySecondary(styles);
}

/** 切換 chip（主軸／調性）：未選→加到尾端；已選→移除（順序＝優先序） */
export function toggleWorldviewChip(current: string[], value: string): string[] {
  if (current.includes(value)) return current.filter((x) => x !== value);
  return [...current, value];
}

/** 選媒材家族：若已在該家族則維持；否則套該家族預設主風格 */
export function selectWorldviewStyleFamily(
  current: string[],
  family: StyleMediaFamily,
): string[] {
  const slots = parseWorldviewStyleSlots(current);
  if (slots.family === family && slots.look) {
    return composeWorldviewStyles(
      slots.look,
      slots.texture && STYLE_MEDIA_FAMILY[slots.texture] === family ? slots.texture : null,
    );
  }
  return [STYLE_FAMILY_META[family].defaultStyle];
}

/** 選主風格（look）：同家族可保留質感；再點同一主風格→清空 */
export function selectWorldviewStyleLook(current: string[], look: string): string[] {
  const slots = parseWorldviewStyleSlots(current);
  if (slots.look === look) return [];
  const fam = STYLE_MEDIA_FAMILY[look];
  const keepTexture =
    fam && slots.texture && STYLE_MEDIA_FAMILY[slots.texture] === fam ? slots.texture : null;
  return composeWorldviewStyles(look, keepTexture);
}

/** 選質感：切換；無主風格時帶入家族預設主風格 */
export function selectWorldviewStyleTexture(current: string[], texture: string): string[] {
  const slots = parseWorldviewStyleSlots(current);
  if (slots.texture === texture) {
    return composeWorldviewStyles(slots.look, null);
  }
  const fam = STYLE_MEDIA_FAMILY[texture];
  const look =
    slots.look && fam && STYLE_MEDIA_FAMILY[slots.look] === fam
      ? slots.look
      : fam
        ? STYLE_FAMILY_META[fam].defaultStyle
        : null;
  return composeWorldviewStyles(look, texture);
}

/**
 * 視覺風格選擇入口：內建 look／texture 走家族規則；自訂＝准單選取代。
 * 舊多選點內建項會收斂到合法 look(+texture)。
 */
export function selectWorldviewStyle(current: string[], value: string): string[] {
  const role = STYLE_LOOK_ROLE[value];
  const fam = STYLE_MEDIA_FAMILY[value];
  if (fam && role === "texture") return selectWorldviewStyleTexture(current, value);
  if (fam && role === "look") return selectWorldviewStyleLook(current, value);
  // 自訂或未映射：准單選
  if (current.length === 1 && current[0] === value) return [];
  return [value];
}

/** 只保留可注入的主風格（一鍵收斂舊多選／跨家族；質感若合法則保留） */
export function keepPrimaryWorldviewStyle(current: string[]): string[] {
  return canonicalizeWorldviewStyles(current);
}

/** 把已選 chip 提到第一位（設為主要；主軸／調性用） */
export function promoteWorldviewChip(current: string[], value: string): string[] {
  if (!current.includes(value)) return current;
  return [value, ...current.filter((x) => x !== value)];
}

/** 是否橫跨兩個以上媒材家族（寫實／插畫／3D） */
export function hasStyleFamilyConflict(styles: string[]): boolean {
  const families = new Set(
    styles.map((s) => STYLE_MEDIA_FAMILY[s]).filter((f): f is StyleMediaFamily => !!f),
  );
  return families.size > 1;
}

export type WorldviewChipField = "themes" | "tones" | "styles";

/** UI／助手共用：超過軟上限或風格跨家族時的人話警告（空＝健康） */
export function chipSoftWarnings(wv: Pick<Worldview, WorldviewChipField>): string[] {
  const warnings: string[] = [];
  const slots = parseWorldviewStyleSlots(wv.styles);
  const inject = stylesForVisualInject(wv.styles);
  const canonical = canonicalizeWorldviewStyles(wv.styles);
  const needsConverge =
    wv.styles.length > CHIP_SOFT_MAX.styles ||
    hasStyleFamilyConflict(wv.styles) ||
    (wv.styles.length > 0 &&
      (canonical.length !== wv.styles.length || canonical.some((v, i) => v !== wv.styles[i])));

  if (needsConverge && wv.styles.length > 0) {
    const label = inject.length ? inject.join("、") : (wv.styles[0] ?? "");
    warnings.push(
      `視覺風格需收斂（出圖將用「${label}」；請用媒材家族重選，或一鍵只留可注入項）`,
    );
  }
  if (wv.tones.length > CHIP_SOFT_MAX.tones) {
    warnings.push(
      `調性已選 ${wv.tones.length} 個（建議 ≤${CHIP_SOFT_MAX.tones}；出圖只取前 ${VISUAL_INJECT_MAX.tones} 個）`,
    );
  }
  if (wv.themes.length > CHIP_SOFT_MAX.themes) {
    warnings.push(
      `訊息主軸已選 ${wv.themes.length} 個（建議 ≤${CHIP_SOFT_MAX.themes}，過多會讓敘事弧互相拉扯）`,
    );
  }
  if (hasStyleFamilyConflict(wv.styles)) {
    const famLabel = slots.family ? STYLE_FAMILY_META[slots.family].label : "目前主風格所屬";
    // 家族有六個，全部列出來反而看不到重點——只點名這次真的撞在一起的那幾個
    const clashing = styleFamiliesOf(wv.styles).map((f) => STYLE_FAMILY_META[f].label);
    warnings.push(`風格橫跨不同媒材（${clashing.join("／")}）——建議只留「${famLabel}」一類`);
  }
  return warnings;
}

/**
 * 餵給專案助手／代理的選項提示：有警告才回字串，否則空。
 * 引導模型在使用者問基調時建議收斂，而不是替使用者改資料。
 */
export function worldviewChipGuidanceForAi(wv: Pick<Worldview, WorldviewChipField>): string {
  const w = chipSoftWarnings(wv);
  if (!w.length) return "";
  return (
    `【世界觀 chips 提示】${w.join("；")}。` +
    "若使用者問風格／調性／主軸或生成方向飄移，請主動建議收斂（風格：一個媒材家族＋一個主風格，可選一個同家族質感；調性≤2、主軸≤2），" +
    "並說明：圖影注入 look(+質感)；可用 apply_worldview_chips 建議套用（使用者確認後寫入；styles 最多 2 且應同家族）。"
  );
}

/** 有多個時標「主要／備選」；單個原樣。max 可截斷後再格式（截斷後仍標主要） */
export function formatChipsPrimarySecondary(values: string[], max?: number): string {
  if (!values.length) return "";
  const slice = max !== undefined ? values.slice(0, max) : values;
  if (!slice.length) return "";
  if (slice.length === 1) return slice[0]!;
  const [primary, ...rest] = slice;
  const more = values.length > slice.length ? `…(+${values.length - slice.length})` : "";
  return `主要:${primary}；備選:${rest.join("、")}${more}`;
}

/**
 * AI 消費端格式模式（單一真相，避免 agent/director/assistant 各寫一行摘要而分岔）：
 * - brief：單行摘要（代理／專案助手／留言助手）——含進階：觀眾／三幕／人物（截斷）
 * - director：導演建議與拆分鏡（進階全文）
 * - export：交付鏡頭表人話段落（含參考連結）
 * - generation-llm：生成台 LLM 正向附加（themes＋短進階；logline 截斷）
 * 圖影正向仍只走 formatWorldviewVisualPositive（不塞觀眾／三幕／人物長敘事）。
 */
export type WorldviewFormatMode = "brief" | "director" | "export" | "generation-llm";

/** 視覺生成注入 logline 上限（全長塞每鏡會爆 token；截斷後加省略） */
export const LOGLINE_INJECT_MAX = 80;

/**
 * 進階欄位進 brief／LLM 的截斷（導演／export 仍用全文）。
 * 避免助手／每格 LLM 被長三幕與人物表撐爆。
 */
export const ADVANCED_INJECT_MAX = {
  audience: 120,
  actsLine: 220,
  peopleBrief: 5,
  peopleLlm: 3,
} as const;

/** UI／文件共用：欄位被哪些消費端讀到（標籤用） */
export type WorldviewConsumerId = "visual" | "llm" | "brief" | "director" | "export";

export const WORLDVIEW_CONSUMER_LABEL: Record<WorldviewConsumerId, string> = {
  visual: "圖影",
  llm: "文字生成",
  brief: "助手／代理",
  director: "導演",
  export: "匯出",
};

/**
 * 進階（與快速層關鍵欄）誰會讀——ProjectPage 徽章與 wiki 單一真相。
 * visual＝圖影正向；禁忌圖影另走 negative（見 generationCore）。
 */
export const WORLDVIEW_FIELD_READERS: Record<
  string,
  { readers: WorldviewConsumerId[]; note?: string }
> = {
  logline: { readers: ["visual", "llm", "brief", "director", "export"] },
  message: { readers: ["visual", "llm", "brief", "director", "export"] },
  themes: { readers: ["llm", "brief", "director", "export"], note: "圖影不注入主軸" },
  tones: { readers: ["visual", "llm", "brief", "director", "export"] },
  styles: { readers: ["visual", "llm", "brief", "director", "export"] },
  audience: { readers: ["llm", "brief", "director", "export"], note: "圖影不注入" },
  acts: { readers: ["llm", "brief", "director", "export"], note: "圖影不注入" },
  people: {
    readers: ["llm", "brief", "director", "export"],
    note: "圖影請用角色定裝卡",
  },
  taboos: {
    readers: ["visual", "llm", "brief", "director", "export"],
    note: "圖影走負向；部分模型才支援",
  },
  references: { readers: ["export"], note: "僅交付備註，不進模型" },
};

function clipInject(text: string, max: number): string {
  const t = text.trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 敘事人物注入字串（截斷項數） */
export function formatPeopleInject(people: string[], max: number): string {
  const clean = people.map((p) => p.trim()).filter(Boolean);
  if (!clean.length) return "";
  const slice = clean.slice(0, max);
  const more = clean.length > max ? `…(+${clean.length - max})` : "";
  return `${slice.join("；")}${more}`;
}

/** 三幕有任一欄非空才算「已設」 */
export function hasActs(wv: Pick<Worldview, "acts">): boolean {
  const a = wv.acts;
  return !!(a.hook.trim() || a.turn.trim() || a.cta.trim());
}

/**
 * 基調就緒：一句話或關鍵訊息，且至少一項調性或視覺風格。
 * 只用 logline/message 會顯示「✓」卻沒有可注入畫風——摘要條與 onboarding 共用此判定。
 */
export function isWorldviewReady(wv: Pick<Worldview, "logline" | "message" | "tones" | "styles">): boolean {
  const narrative = !!(wv.logline.trim() || wv.message.trim());
  const style = wv.tones.length > 0 || wv.styles.length > 0;
  return narrative && style;
}

/**
 * 快速層引導四步。
 *
 * 存在的理由：這一區原本 5 個快速欄 + 進階三大段一次全給，沒有先後、也沒有
 * 「你現在該填哪一個」。這裡把它排成有序步驟，並標出「填到哪裡就能出圖」。
 *
 * 刻意**不另立就緒判定**——前三步（非 optional）全完成必然等價於
 * `isWorldviewReady`，由測試鎖住這條等價關係。
 */
export type WorldviewStepId = "story" | "mood" | "look" | "narrative";

export type WorldviewStep = {
  id: WorldviewStepId;
  label: string;
  hint: string;
  done: boolean;
  /** 可略過：不影響「能不能出圖」 */
  optional: boolean;
  /** 捲動定位用的錨點選擇器 */
  anchor: string;
};

export function worldviewGuideSteps(
  wv: Pick<Worldview, "logline" | "message" | "tones" | "styles" | "audience" | "acts">,
): WorldviewStep[] {
  return [
    {
      id: "story",
      label: "這支片在講什麼",
      hint: "一句話就好，例如：粉橘短髮女孩、白帽T的小華在淡大校門口遇見禪定龜龜",
      done: !!(wv.logline.trim() || wv.message.trim()),
      optional: false,
      anchor: "#wv-logline",
    },
    {
      id: "mood",
      label: "想要什麼感覺",
      hint: "挑 1～2 個合得來的，例如溫暖＋真誠",
      done: wv.tones.length > 0,
      optional: false,
      anchor: "#wv-tones",
    },
    {
      id: "look",
      label: "畫面長什麼樣",
      hint: "先選畫法再挑主風格——這一項對出圖最有效",
      done: stylesForVisualInject(wv.styles).length > 0,
      optional: false,
      anchor: "#wv-styles",
    },
    {
      id: "narrative",
      label: "給誰看、怎麼講",
      hint: "可略過。填了寫腳本、拆分鏡會更準；出圖不吃這一段",
      done: !!(wv.audience.trim() || hasActs(wv)),
      optional: true,
      anchor: "#wv-audience",
    },
  ];
}

/** 下一個該填的步驟（必填優先；全填完回 null） */
export function nextWorldviewStep(
  wv: Pick<Worldview, "logline" | "message" | "tones" | "styles" | "audience" | "acts">,
): WorldviewStep | null {
  const steps = worldviewGuideSteps(wv);
  return steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => !s.done) ?? null;
}

/**
 * 欄位「會不會改變我的畫面」的人話摘要（UI 徽章用）。
 * 完整的消費端清單留在 `detail`，由呼叫端收進 HelpTip——
 * 逐欄印出整串「圖影 · 文字生成 · 助手／代理 · 導演 · 匯出」讀起來像規格書，
 * 那是這一區顯得抽象的主因之一。單一真相仍是 WORLDVIEW_FIELD_READERS。
 */
export function worldviewFieldReaderSummary(
  field: string,
): { affectsVisual: boolean; short: string; detail: string } | null {
  const meta = WORLDVIEW_FIELD_READERS[field];
  if (!meta) return null;
  const affectsVisual = meta.readers.includes("visual");
  const detail =
    meta.readers.map((r) => WORLDVIEW_CONSUMER_LABEL[r]).join(" · ") + (meta.note ? `（${meta.note}）` : "");
  return {
    affectsVisual,
    short: affectsVisual ? "會影響出圖" : "出圖不吃，只給文字 AI",
    detail,
  };
}

/** 三幕結構單行（空欄省略） */
export function formatActsLine(acts: Worldview["acts"]): string {
  const parts: string[] = [];
  if (acts.hook.trim()) parts.push(`鉤子：${acts.hook.trim()}`);
  if (acts.turn.trim()) parts.push(`轉折：${acts.turn.trim()}`);
  if (acts.cta.trim()) parts.push(`行動呼籲：${acts.cta.trim()}`);
  return parts.join(" → ");
}

/**
 * 三幕大綱（拆分鏡用）：一幕一段、以空行分隔。
 *
 * 與 formatActsLine 的差別是**用途**，不是格式潔癖：那支是注入 prompt 的單行摘要，
 * 這支是要當「腳本來源」送進拆分鏡的。空行分隔讓假模式的段落切幕能切出三幕
 * （單行版會整份塞成一幕），真模式也讀得出這是三段而不是一句話。
 */
export function formatActsOutline(acts: Worldview["acts"]): string {
  const parts: string[] = [];
  if (acts.hook.trim()) parts.push(`鉤子：${acts.hook.trim()}`);
  if (acts.turn.trim()) parts.push(`轉折：${acts.turn.trim()}`);
  if (acts.cta.trim()) parts.push(`行動呼籲：${acts.cta.trim()}`);
  return parts.join("\n\n");
}

/**
 * 世界觀 → AI／交付用文字（前後端共用）。
 * references 刻意不進模型（URL 對擴散／LLM 敘事弱、且易膨脹）；僅 export 可列備註。
 */
export function formatWorldviewForAi(wv: Worldview, mode: WorldviewFormatMode): string {
  if (mode === "export") return formatWorldviewExport(wv);
  if (mode === "director") return formatWorldviewDirector(wv);
  if (mode === "generation-llm") return formatWorldviewGenerationLlm(wv);
  return formatWorldviewBrief(wv);
}

function joinPipe(parts: string[]): string {
  return parts.filter(Boolean).join("｜");
}

/**
 * 代理／助手：必含 message 與 taboos；進階含觀眾／三幕／人物（截斷）；
 * chips 標主要／備選並附軟警告。references 不進 brief。
 */
function formatWorldviewBrief(wv: Worldview): string {
  const styleLine = wv.styles.length
    ? `視覺風格：${formatWorldviewStylesLabel(wv.styles)}`
    : "視覺風格：—";
  const toneLine = wv.tones.length
    ? `調性：${formatChipsPrimarySecondary(wv.tones)}`
    : "調性：—";
  const themeLine = wv.themes.length
    ? `訊息主軸：${formatChipsPrimarySecondary(wv.themes)}`
    : "";
  const audience = clipInject(wv.audience, ADVANCED_INJECT_MAX.audience);
  const actsRaw = formatActsLine(wv.acts);
  const acts = actsRaw ? clipInject(actsRaw, ADVANCED_INJECT_MAX.actsLine) : "";
  const people = formatPeopleInject(wv.people, ADVANCED_INJECT_MAX.peopleBrief);
  const soft = chipSoftWarnings(wv);
  return joinPipe([
    `一句話：${wv.logline.trim() || "—"}`,
    `核心訊息：${wv.message.trim() || "—"}`,
    themeLine,
    toneLine,
    styleLine,
    audience ? `目標觀眾：${audience}` : "",
    acts ? `三幕：${acts}` : "",
    people ? `敘事人物：${people}` : "",
    wv.taboos.length ? `禁忌：${wv.taboos.join("；")}` : "",
    soft.length ? `選項提示：${soft.join("；")}` : "",
  ]);
}

/** 導演建議／拆分鏡：敘事決策完整上下文（含觀眾、三幕、敘事人物） */
function formatWorldviewDirector(wv: Worldview): string {
  const lines: string[] = [
    joinPipe([
      `一句話故事：${wv.logline.trim() || "—"}`,
      `關鍵訊息：${wv.message.trim() || "—"}`,
      wv.audience.trim() ? `目標觀眾：${wv.audience.trim()}` : "",
      wv.themes.length
        ? `訊息主軸（敘事弧，第一個為主）：${formatChipsPrimarySecondary(wv.themes)}`
        : "",
      `調性（第一個為主）：${wv.tones.length ? formatChipsPrimarySecondary(wv.tones) : "—"}`,
      `視覺風格（主風格＋可選同家族質感；分鏡以主風格為準）：${
        wv.styles.length ? formatWorldviewStylesLabel(wv.styles) : "—"
      }`,
    ]),
  ];
  const acts = formatActsLine(wv.acts);
  if (acts) lines.push(`三幕結構：${acts}`);
  if (wv.people.length) {
    lines.push(
      `敘事人物（非畫面定裝；畫面一致請用角色卡）：${wv.people.join("；")}`,
    );
  }
  if (wv.taboos.length) lines.push(`禁忌：${wv.taboos.join("；")}`);
  const soft = chipSoftWarnings(wv);
  if (soft.length) lines.push(`選項提示：${soft.join("；")}`);
  return lines.join("\n");
}

/**
 * LLM 生成附加片段（接在 [專案背景] 內）。
 * 含 themes、短進階（觀眾／三幕／人物）；硬截斷控 token。
 * 圖影不走此函式——敘事進階對擴散是雜訊。
 */
function formatWorldviewGenerationLlm(wv: Worldview): string {
  const parts: string[] = [];
  const log = wv.logline.trim();
  if (log) {
    const clipped = log.length > LOGLINE_INJECT_MAX ? `${log.slice(0, LOGLINE_INJECT_MAX)}…` : log;
    parts.push(`故事錨點:${clipped}`);
  }
  const tones = wv.tones.slice(0, LLM_INJECT_MAX.tones);
  if (tones.length) parts.push(`調性:${tones.join("、")}`);
  const styles = stylesForVisualInject(wv.styles).slice(0, LLM_INJECT_MAX.styles);
  if (styles.length) parts.push(`視覺風格:${styles.join("、")}`);
  if (wv.message.trim()) parts.push(`核心訊息:${wv.message.trim()}`);
  const themes = wv.themes.slice(0, LLM_INJECT_MAX.themes);
  if (themes.length) parts.push(`訊息主軸:${themes.join("、")}`);
  const audience = clipInject(wv.audience, ADVANCED_INJECT_MAX.audience);
  if (audience) parts.push(`目標觀眾:${audience}`);
  const actsRaw = formatActsLine(wv.acts);
  const acts = actsRaw ? clipInject(actsRaw, ADVANCED_INJECT_MAX.actsLine) : "";
  if (acts) parts.push(`三幕:${acts}`);
  const people = formatPeopleInject(wv.people, ADVANCED_INJECT_MAX.peopleLlm);
  if (people) parts.push(`敘事人物:${people}`);
  if (wv.taboos.length) parts.push(`避免:${wv.taboos.join(";")}`);
  return parts.join("|");
}

/** 交付鏡頭表：人話 bullet，含主要／備選與軟警告 */
function formatWorldviewExport(wv: Worldview): string {
  const lines = [
    `- 一句話故事：${wv.logline.trim() || "—"}`,
    `- 關鍵訊息：${wv.message.trim() || "—"}`,
    `- 調性：${wv.tones.length ? formatChipsPrimarySecondary(wv.tones) : "—"}`,
    `- 視覺風格：${wv.styles.length ? formatWorldviewStylesLabel(wv.styles) : "—"}`,
  ];
  if (wv.themes.length) lines.push(`- 訊息主軸：${formatChipsPrimarySecondary(wv.themes)}`);
  if (wv.audience.trim()) lines.push(`- 目標觀眾：${wv.audience.trim()}`);
  const acts = formatActsLine(wv.acts);
  if (acts) lines.push(`- 三幕結構：${acts}`);
  if (wv.people.length) lines.push(`- 敘事人物：${wv.people.join("；")}`);
  lines.push(`- 禁忌事項：${wv.taboos.join("；") || "—"}`);
  if (wv.references.length) lines.push(`- 參考連結（備註）：${wv.references.join("；")}`);
  const soft = chipSoftWarnings(wv);
  if (soft.length) lines.push(`- 選項提示：${soft.join("；")}`);
  return lines.join("\n");
}

/**
 * 視覺類別正向注入片段（中英雙語 tones/styles + 短 logline + message）。
 * 風格經 stylesForVisualInject（主風格＋同家族質感）；調性前 VISUAL_INJECT_MAX.tones。
 * 禁忌不放正向——由 generationCore 走 negative_prompt。
 */
export function formatWorldviewVisualPositive(wv: Worldview): string {
  const parts: string[] = [];
  const tones = bilingualChips(wv.tones.slice(0, VISUAL_INJECT_MAX.tones), TONE_EN);
  const styles = bilingualChips(stylesForVisualInject(wv.styles), STYLE_EN);
  if (tones.length) parts.push(`調性:${tones.join("、")}`);
  if (styles.length) parts.push(`視覺風格:${styles.join("、")}`);
  const log = wv.logline.trim();
  if (log) {
    const clipped = log.length > LOGLINE_INJECT_MAX ? `${log.slice(0, LOGLINE_INJECT_MAX)}…` : log;
    parts.push(`故事錨點:${clipped}`);
  }
  if (wv.message.trim()) parts.push(`核心訊息:${wv.message.trim()}`);
  return parts.join("|");
}

/**
 * 生成提示詞裡的世界觀段落標記。
 * 前端「AI 會收到什麼」預覽與 generationCore 共用同一份——前端若自己再寫一次字串，
 * 兩邊遲早漂移，預覽就會騙人。
 */
export const WORLDVIEW_INJECT_MARKER = "[專案背景]";

/** 定裝卡錨點標記（順序＝伺服器疊加順序：角色→場景→素材） */
export const CARD_ANCHOR_MARKERS = ["[角色定裝]", "[場景設定]", "[素材設定]"] as const;

/**
 * 視覺類別的禁忌 → negative_prompt。
 * 擴散模型無法靠正向提示詞「避免」某物，故禁忌只走負向（見 generationCore 的說明）。
 */
export function formatWorldviewVisualNegative(wv: Pick<Worldview, "taboos">): string {
  return wv.taboos.map((t) => t.trim()).filter(Boolean).join(", ");
}

/** 使用者提示詞 ＋ 世界觀段落的最終組法（buildPositive 與預覽共用） */
export function formatWorldviewInjectedPrompt(userPrompt: string, background: string): string {
  return background ? `${userPrompt}\n\n${WORLDVIEW_INJECT_MARKER} ${background}` : userPrompt;
}

/** 「AI 會收到什麼」預覽的三段內容（皆由既有 formatter 產生，不另組字串） */
export type WorldviewInjectPreview = {
  visual: { positive: string; negative: string };
  llm: { positive: string };
  /** 三段皆空＝AI 只會收到使用者當下打的那句話 */
  empty: boolean;
};

/**
 * 產生預覽內容。刻意只呼叫既有的公開 formatter（與 generationCore 同一條路），
 * 不重組任何字串——這是「預覽不可能說謊」的唯一保證。
 */
export function buildWorldviewInjectPreview(wv: Worldview): WorldviewInjectPreview {
  const visualPositive = formatWorldviewVisualPositive(wv);
  const visualNegative = formatWorldviewVisualNegative(wv);
  const llmPositive = formatWorldviewForAi(wv, "generation-llm");
  return {
    visual: { positive: visualPositive, negative: visualNegative },
    llm: { positive: llmPositive },
    empty: !visualPositive && !visualNegative && !llmPositive,
  };
}

/** 是否正要移除預設弘法禁語（清空或刪掉 DEFAULT 其中一條）——UI 確認用 */
export function removesDefaultTaboos(prev: string[], next: string[]): boolean {
  const defaults = DEFAULT_TABOOS();
  const nextSet = new Set(next);
  return defaults.some((d) => prev.includes(d) && !nextSet.has(d));
}

/** 禁忌是否仍全等於預設合規句（可摺疊成「合規保護已開啟」） */
export function isDefaultTaboosOnly(taboos: string[]): boolean {
  const defaults = DEFAULT_TABOOS();
  if (taboos.length !== defaults.length) return false;
  const set = new Set(taboos);
  return defaults.every((d) => set.has(d));
}

/** 進階設定一鍵範例（依專案 kind；中性可改寫） */
export type WorldviewAdvancedExample = {
  audience: string;
  acts: { hook: string; turn: string; cta: string };
  people: string[];
};

const ADVANCED_EXAMPLE_DEFAULT: WorldviewAdvancedExample = {
  audience: "想在忙碌生活裡找片刻安定的年輕人與家庭",
  acts: {
    hook: "清晨安靜的室內，一位訪客放慢腳步，光線從窗邊柔柔灑落",
    turn: "在整理與等待之間，紛亂的念頭漸漸被安放，呼吸變得平穩",
    cta: "留下一句可帶走的提醒，畫面留白給觀眾自己的心",
  },
  people: ["主角：安靜的訪客，淺色外套", "引導者：溫和語氣，不多話"],
};

const ADVANCED_EXAMPLES_BY_KIND: Record<string, WorldviewAdvancedExample> = {
  witness: {
    audience: "正在經歷低谷、需要真實故事陪伴的朋友",
    acts: {
      hook: "故事主角在最難的時刻現身，現場氛圍先讓人願意聽下去",
      turn: "轉折出現：一次選擇或一句話，心開始鬆動、方向改變",
      cta: "把希望留給觀眾：你可以不孤單，下一步可以很小",
    },
    people: ["見證主角：經歷轉變的人", "陪伴者：傾聽、不多評價"],
  },
  teaching: {
    audience: "初次接觸、想把概念聽懂的聽眾",
    acts: {
      hook: "用生活場景開場，讓抽象觀念先有畫面",
      turn: "一句關鍵提醒對上日常困境，聽眾對上號",
      cta: "給一個今天就能做的小練習或記住的一句話",
    },
    people: ["講者：語氣穩、節奏慢", "聽眾代表：帶著問題進來的人"],
  },
  short: {
    audience: "滑手機 3 秒內要被抓住的社群觀眾",
    acts: {
      hook: "第一秒就有強畫面或一句疑問，停得住拇指",
      turn: "中段給反差或小驚喜，資訊只留一個重點",
      cta: "結尾字幕或口白重複那一個重點，方便分享",
    },
    people: ["出鏡者：表情清楚、動作乾淨"],
  },
  promo: {
    audience: "可能參加活動、但還在猶豫的人",
    acts: {
      hook: "活動最有感的一刻或最美畫面先出現",
      turn: "說清楚為誰、有什麼、為什麼現在",
      cta: "明確行動：報名、轉傳、或記下時間地點",
    },
    people: ["主持人／講者", "參與者代表：真實的現場感受"],
  },
  recap: {
    audience: "參加過想回味、或錯過想補課的人",
    acts: {
      hook: "用最有溫度的現場片段開場",
      turn: "串起當天主軸：人、時刻、一句共同記憶",
      cta: "邀請下次見面，或連到完整內容／相簿",
    },
    people: ["現場主角們：短描述即可"],
  },
};

/**
 * 快速層一鍵範例（依專案 kind）。
 *
 * 進階層早就有「空白欄帶入範例／整段換成範例」，但**最需要範例的快速層反而沒有**——
 * 空專案只有 placeholder，要自己從零想「一句話故事」「調性」「畫風」該填什麼。
 *
 * 硬性規則（由 worldview.test.ts 強制，違反會讓一鍵帶入當場產生孤兒 chip 或軟警告）：
 * - tones／themes／styles 的值必須落在既有 TONE_OPTIONS／THEME_OPTIONS／STYLE_OPTIONS 內
 * - styles 經 canonicalizeWorldviewStyles 後不變（同家族的 look＋質感，不跨家族）
 * - tones／themes 不超過 CHIP_SOFT_MAX
 */
export type WorldviewQuickExample = {
  logline: string;
  message: string;
  themes: string[];
  tones: string[];
  styles: string[];
};

const QUICK_EXAMPLE_DEFAULT: WorldviewQuickExample = {
  logline: "一位訪客走進晨光禪堂，把浮躁的心慢慢放回原位",
  message: "把心安住，日子就有了呼吸",
  themes: ["禪修日常"],
  tones: ["溫暖", "真誠"],
  styles: ["日系水彩"],
};

const QUICK_EXAMPLES_BY_KIND: Record<string, WorldviewQuickExample> = {
  witness: {
    logline: "陳師姐從憂鬱低谷，靠著每天一次靜坐，慢慢把自己接回來",
    message: "低谷不是終點，是轉彎的地方",
    themes: ["苦→修行→轉變→感恩"],
    tones: ["溫暖", "真誠"],
    styles: ["寫實攝影", "膠片質感"],
  },
  teaching: {
    logline: "一句聽過很多次的話，在某個早晨忽然聽懂了",
    message: "道理不難，難在願意今天就試一次",
    themes: ["佛法入門"],
    tones: ["莊嚴", "溫暖"],
    styles: ["水墨禪意"],
  },
  short: {
    logline: "三十秒裡，一個人從坐不住到坐得住",
    message: "安靜一分鐘，比滑手機一小時有用",
    themes: ["禪修日常"],
    tones: ["活潑", "簡約"],
    styles: ["極簡線條"],
  },
  promo: {
    logline: "禪堂的門推開，這個週末有一場為你留的位子",
    message: "來坐一下，位子一直都在",
    themes: ["活動紀實"],
    tones: ["溫暖", "活潑"],
    styles: ["日系水彩"],
  },
  recap: {
    logline: "那天的光、那些人、那一段一起安靜下來的時間",
    message: "一起走過的路，值得記得",
    themes: ["感恩分享"],
    tones: ["溫暖", "療癒"],
    styles: ["寫實攝影"],
  },
};

/** 依專案 kind 取快速層範例；未知 kind 用中性預設 */
export function worldviewQuickExampleForKind(kind?: string | null): WorldviewQuickExample {
  if (kind && QUICK_EXAMPLES_BY_KIND[kind]) return QUICK_EXAMPLES_BY_KIND[kind]!;
  return QUICK_EXAMPLE_DEFAULT;
}

/** 套用快速層範例：onlyEmpty 時只填空白欄（與 applyWorldviewAdvancedExample 同語義） */
export function applyWorldviewQuickExample(
  current: Worldview,
  kind?: string | null,
  onlyEmpty = true,
): Partial<Pick<Worldview, "logline" | "message" | "themes" | "tones" | "styles">> {
  const ex = worldviewQuickExampleForKind(kind);
  const patch: Partial<Pick<Worldview, "logline" | "message" | "themes" | "tones" | "styles">> = {};
  if (!onlyEmpty || !current.logline.trim()) patch.logline = ex.logline;
  if (!onlyEmpty || !current.message.trim()) patch.message = ex.message;
  if (!onlyEmpty || current.themes.length === 0) patch.themes = [...ex.themes];
  if (!onlyEmpty || current.tones.length === 0) patch.tones = [...ex.tones];
  if (!onlyEmpty || current.styles.length === 0) patch.styles = [...ex.styles];
  return patch;
}

/**
 * 「整份抄這個」：快速層＋進階層合成單一 patch。
 * 必須是一個 patch 一次 mutate——連發多個 mutate 會讓前端的樂觀合併在同一 tick 互相 race。
 */
export function applyWorldviewFullExample(
  current: Worldview,
  kind?: string | null,
  onlyEmpty = true,
): Partial<
  Pick<Worldview, "logline" | "message" | "themes" | "tones" | "styles" | "audience" | "acts" | "people">
> {
  return {
    ...applyWorldviewQuickExample(current, kind, onlyEmpty),
    ...applyWorldviewAdvancedExample(current, kind, onlyEmpty),
  };
}

/** 依專案 kind 取進階範例；未知 kind 用中性預設 */
export function worldviewAdvancedExampleForKind(kind?: string | null): WorldviewAdvancedExample {
  if (kind && ADVANCED_EXAMPLES_BY_KIND[kind]) return ADVANCED_EXAMPLES_BY_KIND[kind]!;
  return ADVANCED_EXAMPLE_DEFAULT;
}

/**
 * 把敘事人物 token 拆成定裝卡欄位。
 * 支援「名＝外觀」「名: 外觀」「名：外觀」「名 - 外觀」；否則整段當名、外觀待補。
 */
export function parsePersonTokenForCharacter(token: string): {
  name: string;
  appearance: string;
  notes: string;
} {
  const raw = token.trim().slice(0, 100);
  // 含全形 ＝／： 與常見分隔符（使用者常從中文輸入法打出）
  const m = raw.match(/^(.{1,40}?)\s*[=＝:：\-–—]\s*(.+)$/);
  if (m) {
    const name = m[1]!.trim().slice(0, 40) || "未命名";
    const appearance = m[2]!.trim().slice(0, 1000) || "待補外觀描述（髮型、服裝、標誌道具）";
    return { name, appearance, notes: "由敘事人物建立，可再補定裝細節" };
  }
  const name = raw.slice(0, 40) || "未命名";
  return {
    name,
    appearance: "待補外觀描述（髮型、服裝、標誌道具）",
    notes: "由敘事人物建立，可再補定裝細節",
  };
}

/**
 * 套用進階範例：onlyEmpty 時只填空白欄；否則覆寫觀眾／三幕／人物（禁忌與參考不動）。
 */
export function applyWorldviewAdvancedExample(
  current: Worldview,
  kind?: string | null,
  onlyEmpty = true,
): Partial<Pick<Worldview, "audience" | "acts" | "people">> {
  const ex = worldviewAdvancedExampleForKind(kind);
  const patch: Partial<Pick<Worldview, "audience" | "acts" | "people">> = {};
  if (!onlyEmpty || !current.audience.trim()) patch.audience = ex.audience;
  if (!onlyEmpty || !hasActs(current)) patch.acts = { ...ex.acts };
  if (!onlyEmpty || current.people.length === 0) patch.people = [...ex.people];
  return patch;
}

/**
 * 助手／API 套用 chips 前正規化：trim、去重；風格 canonicalize（look+質感）；調性／主軸截到上限。
 * 只回傳「有傳入」的欄位（未傳＝不改）；空陣列＝清空該欄。
 */
export function normalizeWorldviewChipsPatch(input: {
  themes?: string[] | undefined;
  tones?: string[] | undefined;
  styles?: string[] | undefined;
}): Partial<Pick<Worldview, WorldviewChipField>> {
  const clean = (arr: string[] | undefined, max: number): string[] | undefined => {
    if (arr === undefined) return undefined;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of arr) {
      const v = String(raw ?? "")
        .trim()
        .slice(0, 100);
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= max) break;
    }
    return out;
  };
  const patch: Partial<Pick<Worldview, WorldviewChipField>> = {};
  const themes = clean(input.themes, CHIP_SOFT_MAX.themes);
  const tones = clean(input.tones, CHIP_SOFT_MAX.tones);
  const stylesRaw = clean(input.styles, 8);
  const styles = stylesRaw === undefined ? undefined : canonicalizeWorldviewStyles(stylesRaw);
  if (themes !== undefined) patch.themes = themes;
  if (tones !== undefined) patch.tones = tones;
  if (styles !== undefined) patch.styles = styles;
  return patch;
}

/** 人話摘要「將套用的 chips」（按鈕 label／確認框用） */
export function summarizeWorldviewChipsPatch(
  patch: Partial<Pick<Worldview, WorldviewChipField>>,
): string {
  const parts: string[] = [];
  if (patch.styles) {
    parts.push(
      patch.styles.length ? `風格「${formatWorldviewStylesLabel(patch.styles)}」` : "清空風格",
    );
  }
  if (patch.tones) {
    parts.push(patch.tones.length ? `調性 ${patch.tones.join("、")}` : "清空調性");
  }
  if (patch.themes) {
    parts.push(patch.themes.length ? `主軸 ${patch.themes.join("、")}` : "清空主軸");
  }
  return parts.join("；") || "（無變更）";
}
