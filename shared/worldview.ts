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
/** 視覺風格內建清單：注入每次圖像/影片生成與 AI 導演建議，維持整支片畫風一致 */
export const STYLE_OPTIONS = ["日系水彩", "寫實攝影", "3D 動畫", "手繪插畫", "極簡線條", "膠片質感", "水墨禪意"];

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

/**
 * 內建 chips 的英文錨點：FLUX/SDXL 等圖像影片模型以英文語彙訓練為主，純中文風格詞
 * 常被當雜訊忽略——視覺類別注入時附上英文對應，畫風才真正錨得住。
 * 只映射內建選項；組長自訂的 chips 沒有對應就維持原文注入（不猜翻譯）。
 */
export const STYLE_EN: Record<string, string> = {
  "日系水彩": "Japanese watercolor illustration",
  "寫實攝影": "photorealistic photography",
  "3D 動畫": "3D animated render",
  "手繪插畫": "hand-drawn illustration",
  "極簡線條": "minimalist line art",
  "膠片質感": "analog film grain",
  "水墨禪意": "Chinese ink wash painting, zen minimalism",
};
export const TONE_EN: Record<string, string> = {
  "莊嚴": "solemn, majestic",
  "溫暖": "warm, gentle",
  "真誠": "sincere, heartfelt",
  "療癒": "soothing, healing",
  "活潑": "lively, vibrant",
  "簡約": "clean, minimal",
};

/** 媒材家族：互斥；跨家族並選畫面易沖 */
export type StyleMediaFamily = "photo" | "illustrate" | "3d";

export const STYLE_FAMILY_ORDER: StyleMediaFamily[] = ["photo", "illustrate", "3d"];

export const STYLE_FAMILY_META: Record<
  StyleMediaFamily,
  { label: string; hint: string; defaultStyle: string }
> = {
  photo: { label: "寫實", hint: "攝影／紀實感", defaultStyle: "寫實攝影" },
  illustrate: { label: "插畫", hint: "手繪／平面", defaultStyle: "手繪插畫" },
  "3d": { label: "3D", hint: "立體渲染", defaultStyle: "3D 動畫" },
};

/**
 * 風格媒材家族：跨家族並選容易畫面互沖（寫實 vs 插畫 vs 3D）。
 * 同家族內 look + texture（如寫實+膠片）可並存注入。
 */
export const STYLE_MEDIA_FAMILY: Record<string, StyleMediaFamily> = {
  "寫實攝影": "photo",
  "膠片質感": "photo",
  "日系水彩": "illustrate",
  "手繪插畫": "illustrate",
  "極簡線條": "illustrate",
  "水墨禪意": "illustrate",
  "3D 動畫": "3d",
};

/** look＝主風格（家族內互斥）；texture＝同家族可選質感（0～1） */
export type StyleLookRole = "look" | "texture";

export const STYLE_LOOK_ROLE: Record<string, StyleLookRole> = {
  "寫實攝影": "look",
  "膠片質感": "texture",
  "日系水彩": "look",
  "手繪插畫": "look",
  "極簡線條": "look",
  "水墨禪意": "look",
  "3D 動畫": "look",
};

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
    warnings.push(`風格橫跨不同媒材（寫實／插畫／3D）——建議只留「${famLabel}」一類`);
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

/** 三幕結構單行（空欄省略） */
export function formatActsLine(acts: Worldview["acts"]): string {
  const parts: string[] = [];
  if (acts.hook.trim()) parts.push(`鉤子：${acts.hook.trim()}`);
  if (acts.turn.trim()) parts.push(`轉折：${acts.turn.trim()}`);
  if (acts.cta.trim()) parts.push(`行動呼籲：${acts.cta.trim()}`);
  return parts.join(" → ");
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

/** 是否正要移除預設弘法禁語（清空或刪掉 DEFAULT 其中一條）——UI 確認用 */
export function removesDefaultTaboos(prev: string[], next: string[]): boolean {
  const defaults = DEFAULT_TABOOS();
  const nextSet = new Set(next);
  return defaults.some((d) => prev.includes(d) && !nextSet.has(d));
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
