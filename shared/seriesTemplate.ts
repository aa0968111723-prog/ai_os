/**
 * 短影音「母版系列」契約（前後端共用，零漂移）——
 * 落地 `docs/product/短影音母版自動化-剪輯組SOP.md` 的第 1／2 期。
 *
 * 為什麼要有母版：相同結構的短影音（例如每週 60 秒開示）不該每集從零想流程。
 * 母版＝**固定骨架**（時長／比例／5 段結構／禁忌／交付路徑），每集只改 4 格變數。
 *
 * ★ 本檔只放**純資料與純函式**：識別靠「專案標題約定」，不新增資料表欄位——
 *   SOP 本身就是以命名規則定義母版與本集（`【母版】週更開示60秒`／`週更開示60秒｜日期｜主題`），
 *   沿用同一把尺，前端不必等後端補欄位就能判斷，也不必為此開 migration。
 *
 * ★ 邊界（SOP §5「必須人工」）：本檔不提供任何「自動定稿／自動上架」的路徑。
 *   自動化只到備料；開示合規與成片定稿一律由人自行確認後交付。
 */

import { z } from "zod";

/** 母版專案的標題前綴——同時是「這是母版本體、不是某一集」的唯一識別 */
export const MASTER_TITLE_PREFIX = "【母版】";

/** 本集標題的分隔符（全形直線，與 SOP 命名一致：`系列｜日期｜主題`） */
export const EPISODE_TITLE_SEP = "｜";

/** 專案標題上限（與 projects.create 的 zod 上限同源，超過時主題會被裁切） */
export const PROJECT_TITLE_MAX = 80;

/** 母版 5 段骨架的其中一段 */
export interface SeriesSegment {
  /** 1～5，同時是分鏡 orderIndex */
  no: number;
  /** 段名（會成為分鏡標題） */
  title: string;
  startSec: number;
  endSec: number;
  /** 這一段要達成什麼（寫進分鏡提示詞的骨架） */
  intent: string;
  /** 旁白草稿的提示（組員／代理據此寫詞） */
  voiceoverHint: string;
}

/** 每集只填的 4 格變數定義（順序即表單順序） */
export interface SeriesVariableDef {
  key: EpisodeVariableKey;
  label: string;
  hint: string;
  required: boolean;
}

export interface SeriesTemplate {
  id: string;
  /** 系列名（本集標題的第一段；母版標題＝前綴＋系列名） */
  seriesName: string;
  /** 一句話說明這條系列在做什麼 */
  purpose: string;
  /** 建議內容類型（該組沒有這個選項時由後端退回第一個啟用選項） */
  kind: string;
  totalSec: number;
  /** 畫面比例（SOP 寫死直式） */
  aspect: string;
  /** 母版筆記的「寫死規格」表 */
  spec: ReadonlyArray<{ field: string; value: string }>;
  segments: readonly SeriesSegment[];
  variables: readonly SeriesVariableDef[];
  /** 交付前自查（組員操作卡 §4） */
  preflight: readonly string[];
}

export type EpisodeVariableKey = "topic" | "sourceQuote" | "taboo" | "dueDate";

/** 目前只固定一條系列——SOP §1「不要一次上滿」：先做最常做、結構最穩的那一條 */
export const SERIES_TEMPLATES: readonly SeriesTemplate[] = [
  {
    id: "weekly-dharma-60",
    seriesName: "週更開示60秒",
    purpose: "每週一支 60 秒直式短片，把一句開示講清楚。",
    kind: "短影音",
    totalSec: 60,
    aspect: "9:16",
    spec: [
      { field: "時長", value: "約 60 秒" },
      { field: "比例", value: "直式 9:16" },
      { field: "結構", value: "固定 5 段（開場鉤子／一句核心／說明兩點／例子或提醒／收束）" },
      { field: "畫面風格", value: "簡潔、字幕清楚" },
      { field: "禁忌", value: "不斷章取義、不戲謔開示、不用爭議人物畫面" },
      { field: "交付", value: "站內審過 → 進剪映／Premiere／FCP 精修" },
    ],
    segments: [
      {
        no: 1,
        title: "0–5 秒　開場鉤子",
        startSec: 0,
        endSec: 5,
        intent: "用一個畫面或一句問句把人留下來；不破題說完，只給好奇。",
        voiceoverHint: "一句話的鉤子（疑問或反差），不超過 15 字。",
      },
      {
        no: 2,
        title: "5–15 秒　一句核心",
        startSec: 5,
        endSec: 15,
        intent: "本集唯一要記住的那句話，配大字幕；有必留原句時原樣呈現。",
        voiceoverHint: "核心一句（若有「必留原句」，逐字照唸，不改寫、不濃縮）。",
      },
      {
        no: 3,
        title: "15–40 秒　說明兩點",
        startSec: 15,
        endSec: 40,
        intent: "把核心拆成兩個能落地的點，一點一個畫面，不要塞第三點。",
        voiceoverHint: "兩點各 2～3 句，口語、具體、不說教。",
      },
      {
        no: 4,
        title: "40–55 秒　例子或提醒",
        startSec: 40,
        endSec: 55,
        intent: "用一個生活場景讓人對上號，或給一個當下就能做的提醒。",
        voiceoverHint: "一個小例子或一句提醒，貼近日常，不影射真實個案。",
      },
      {
        no: 5,
        title: "55–60 秒　收束",
        startSec: 55,
        endSec: 60,
        intent: "收回核心句、留白給後製字卡；不硬推行動呼籲。",
        voiceoverHint: "收束一句，可與第 2 段核心呼應。",
      },
    ],
    variables: [
      { key: "topic", label: "本集主題", hint: "一句話，例：忙的時候更要留一點空隙", required: true },
      { key: "sourceQuote", label: "必留原句／出處", hint: "有開示原文就貼上；沒有請填「無」", required: true },
      { key: "taboo", label: "本集禁忌", hint: "例：不提某事、不用某類畫面；沒有請填「無」", required: true },
      { key: "dueDate", label: "截止日期", hint: "精修／上架日（YYYY-MM-DD）", required: true },
    ],
    preflight: [
      "掛在「本集專案」，不是母版",
      "5 段都有內容",
      "看過預估點數",
      "原句／禁忌有遵守",
    ],
  },
] as const;

const TEMPLATE_BY_ID = new Map(SERIES_TEMPLATES.map((t) => [t.id, t]));

export function listSeriesTemplates(): readonly SeriesTemplate[] {
  return SERIES_TEMPLATES;
}

export function getSeriesTemplate(id: string): SeriesTemplate | undefined {
  return TEMPLATE_BY_ID.get(id);
}

export const seriesTemplateIdSchema = z
  .string()
  .refine((v) => TEMPLATE_BY_ID.has(v), { message: "沒有這條母版系列" });

/** 母版本體的專案標題（同組唯一，建立時據此去重） */
export function masterTitle(template: SeriesTemplate): string {
  return `${MASTER_TITLE_PREFIX}${template.seriesName}`;
}

/** 這個標題是不是某條母版本體？（母版不是某一集，不直接出片） */
export function isMasterTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed.startsWith(MASTER_TITLE_PREFIX)) return false;
  const rest = trimmed.slice(MASTER_TITLE_PREFIX.length).trim();
  return SERIES_TEMPLATES.some((t) => t.seriesName === rest);
}

/** 依標題找出母版對應的系列（不是母版就回 undefined） */
export function masterTemplateOfTitle(title: string): SeriesTemplate | undefined {
  const rest = title.trim().slice(MASTER_TITLE_PREFIX.length).trim();
  if (!title.trim().startsWith(MASTER_TITLE_PREFIX)) return undefined;
  return SERIES_TEMPLATES.find((t) => t.seriesName === rest);
}

/** 截止日期：只收 YYYY-MM-DD，且必須是真實存在的日期（擋 2026-02-31） */
const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "截止日期請填 YYYY-MM-DD")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "沒有這個日期");

/**
 * 每集 4 格變數。四格都必填是刻意的——SOP §2.6 組長第一件事就是「變數是否填齊」，
 * 讓「沒有原句」「沒有禁忌」也要明寫「無」，才分得出「不適用」與「忘了填」。
 */
export const episodeVariablesSchema = z.object({
  topic: z.string().trim().min(1, "請填本集主題").max(40, "主題太長（最多 40 字）"),
  sourceQuote: z.string().trim().min(1, "沒有原句請填「無」").max(500, "原句太長（最多 500 字）"),
  taboo: z.string().trim().min(1, "沒有禁忌請填「無」").max(200, "禁忌太長（最多 200 字）"),
  dueDate: isoDateSchema,
});

export type EpisodeVariables = z.infer<typeof episodeVariablesSchema>;

/**
 * 本集專案標題：`系列｜YYYY-MM-DD｜主題`。
 * 主題過長時只裁主題（系列與日期是找片的索引，不能被裁掉），確保不超過 projects.create 的 80 字上限。
 */
export function buildEpisodeTitle(template: SeriesTemplate, vars: EpisodeVariables): string {
  const prefix = `${template.seriesName}${EPISODE_TITLE_SEP}${vars.dueDate}${EPISODE_TITLE_SEP}`;
  const room = PROJECT_TITLE_MAX - prefix.length;
  const topic = vars.topic.trim();
  return prefix + (topic.length <= room ? topic : topic.slice(0, Math.max(1, room - 1)) + "…");
}

/** 反解本集標題（前端據此顯示「這是母版系列的一集」） */
export function parseEpisodeTitle(
  title: string,
): { template: SeriesTemplate; dueDate: string; topic: string } | null {
  const parts = title.trim().split(EPISODE_TITLE_SEP);
  if (parts.length < 3) return null;
  const template = SERIES_TEMPLATES.find((t) => t.seriesName === parts[0]);
  if (!template) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[1])) return null;
  const topic = parts.slice(2).join(EPISODE_TITLE_SEP).trim();
  if (!topic) return null;
  return { template, dueDate: parts[1], topic };
}

/** 母版筆記（寫死規格；SOP §2.2）——建母版時寫進專案知識庫 */
export function buildMasterNote(template: SeriesTemplate): string {
  const spec = template.spec.map((r) => `- ${r.field}：${r.value}`).join("\n");
  const segments = template.segments
    .map((s) => `${s.no}. ${s.title}——${s.intent}`)
    .join("\n");
  const variables = template.variables.map((v) => `- ${v.label}：${v.hint}`).join("\n");
  return [
    `# ${masterTitle(template)}`,
    "",
    `> ${template.purpose}`,
    "> 這是**母版本體**：只在全系列要改風格／時長時才動它，單集特例一律寫在該集專案，不要改這裡。",
    "",
    "## 固定規格（每集都一樣，不要自己改）",
    spec,
    "",
    "## 5 段骨架",
    segments,
    "",
    "## 每集只填這 4 格",
    variables,
    "",
    "## 每集流程",
    "1. 從母版開一集 → 標題自動成為 `系列｜日期｜主題`",
    "2. 填 4 變數（會寫進本集筆記）",
    "3. 依 5 段在「AI 工作」產出並排分鏡",
    "4. 自查完成後交付 → 剪輯軟體精修",
  ].join("\n");
}

/** 本集筆記（4 格變數 ＋ 跟母版走的提醒；SOP §2.4／組員操作卡 §2） */
export function buildEpisodeNote(template: SeriesTemplate, vars: EpisodeVariables): string {
  const lines = template.variables.map((v) => `- **${v.label}**：${vars[v.key]}`).join("\n");
  const preflight = template.preflight.map((p) => `- [ ] ${p}`).join("\n");
  return [
    `# 本集變數 · ${vars.topic}`,
    "",
    lines,
    "",
    `> 其餘（${template.totalSec} 秒、${template.aspect}、5 段結構）全部跟母版 ${masterTitle(template)}，不要自己改。`,
    "",
    "## 交付前自查",
    preflight,
  ].join("\n");
}

export interface SeriesSceneDraft {
  orderIndex: number;
  title: string;
  durationSec: number;
  prompt: string;
  voiceover: string;
}

/**
 * 5 段分鏡空殼。刻意只給**骨架與提示**、不預先塞成品文案：
 * SOP 要的是「固定骨架 + 每集變數」，旁白與畫面仍要人或代理逐集寫，
 * 空殼直接當定稿會踩到「未審定稿」那條紅線。
 */
export function buildEpisodeScenes(
  template: SeriesTemplate,
  vars?: EpisodeVariables,
): SeriesSceneDraft[] {
  const taboo = vars?.taboo && vars.taboo !== "無" ? `；本集禁忌：${vars.taboo}` : "";
  const topic = vars ? `主題「${vars.topic}」` : "本集主題";
  return template.segments.map((s) => {
    const quoteLine =
      s.no === 2 && vars && vars.sourceQuote !== "無"
        ? `\n必留原句（逐字保留）：${vars.sourceQuote}`
        : "";
    return {
      orderIndex: s.no,
      title: s.title,
      durationSec: s.endSec - s.startSec,
      prompt:
        `【${template.aspect} 直式・${s.title}】${topic}：${s.intent}` +
        `\n畫面簡潔、留白給後製字幕，畫面內不出現可讀文字${taboo}`,
      voiceover: `（待寫）${s.voiceoverHint}${quoteLine}`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * 第 2 期：創作代理計畫（備料串鏈）
 * ------------------------------------------------------------------ */

/** 成功條件——全部達成才算完成（創作代理計畫 §成功條件） */
export const EPISODE_SUCCESS_CRITERIA: readonly string[] = [
  "已讀取本集 4 格變數與母版 5 段結構",
  "5 段皆有旁白草稿＋畫面提示",
  "每段至少有一筆可用素材（或明確標「待補」）",
  "分鏡已依 1→5 排序",
] as const;

export interface EpisodeAgentStep {
  no: number;
  name: string;
  todo: string;
  /** true＝這一步要停下來等人（超點數門檻） */
  waitsForHuman: boolean;
}

/** 6 步驟（創作代理計畫 §步驟清單）——給規劃器當骨架，也可當人工檢查清單 */
export const EPISODE_AGENT_STEPS: readonly EpisodeAgentStep[] = [
  { no: 1, name: "讀取脈絡", todo: "讀專案筆記：主題、原句、禁忌、截止日；套用母版 5 段結構", waitsForHuman: false },
  { no: 2, name: "寫旁白", todo: "依 5 段產出旁白；有「必留原句」必須原樣保留", waitsForHuman: false },
  { no: 3, name: "寫分鏡提示", todo: "每段寫畫面描述（直式、簡潔、符合禁忌）", waitsForHuman: false },
  { no: 4, name: "生成素材", todo: "依提示生成圖／短片／旁白（可並行）；先顯示預估點數", waitsForHuman: true },
  { no: 5, name: "排分鏡", todo: "將素材排入 1→5；缺的標「待補」", waitsForHuman: false },
  { no: 6, name: "整理交付", todo: "整理摘要（主題、點數、5 段狀態）供人工過片", waitsForHuman: true },
] as const;

/** 注入規劃器的母版備料骨架提示（與 rolePlaybooks 的 plannerHint 同一用途） */
export function buildSeriesPlannerHint(): string {
  const steps = EPISODE_AGENT_STEPS.map(
    (s) => `${s.no}. ${s.name}：${s.todo}${s.waitsForHuman ? "（要等人）" : ""}`,
  ).join(" ");
  return (
    "母版備料骨架（本集專案已從母版複製、4 格變數已在筆記中）：" +
    steps +
    " 成功條件：" +
    EPISODE_SUCCESS_CRITERIA.join("；") +
    "。禁止：改母版本體、略過點數預估、未經人工過片就當定稿。" +
    "缺 4 格變數任一格 → missingInformation，不要臆測。"
  );
}
