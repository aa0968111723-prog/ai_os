/**
 * Story-first 重構（PE 計畫 v1.0）共用模型：
 * 故事是來源、Shot 是製作中心、世界資料（角色/場景/道具/造型）可重用。
 *
 * 這裡只放「client 與 server 都要用」的純函式與 Zod schema——
 * 解析管線本體（EXTRACT→NORMALIZE→RESOLVE→CONFIDENCE→DIFF→SAVE）在 server/services/storyParse.ts。
 */
import { z } from "zod";

/* ── 限制（單一真相：client 表單與 server 驗證都吃這份） ─────────────── */

/** 故事全文上限（與知識庫 MAX_CONTENT 同級距；超過的長片腳本請拆集數） */
export const STORY_MAX_CHARS = 60_000;
/** 單次送進解析模型的字元預算（與拆分鏡 SCRIPT_MODEL_BUDGET 同值；超過會截斷並回報） */
export const STORY_PARSE_BUDGET = 12_000;
/** 一場戲（story scene）標題上限 */
export const STORY_SCENE_TITLE_MAX = 60;
/** 造型（Look）名稱／服裝描述上限 */
export const LOOK_NAME_MAX = 40;
export const LOOK_COSTUME_MAX = 500;
/** 每專案 Look 上限（與其他卡片同一守門思路） */
export const MAX_PROJECT_LOOKS = 100;

/* ── 信心分級（PE 計畫 §06）────────────────────────────────
 *  ≥ AUTO：自動套用（活動紀錄可查）
 *  ≥ FLAG：先套用但標記「可能需要確認」
 *  < FLAG：暫不落庫，只出最小確認卡 */
export const CONFIDENCE_AUTO = 0.9;
export const CONFIDENCE_FLAG = 0.7;

export type ConfidenceBucket = "auto" | "flag" | "confirm";

export function bucketConfidence(confidence: number): ConfidenceBucket {
  if (confidence >= CONFIDENCE_AUTO) return "auto";
  if (confidence >= CONFIDENCE_FLAG) return "flag";
  return "confirm";
}

/* ── 場景狀態（EnvironmentState；PE 計畫把它落在 Scene 層） ─────────────── */

export const environmentStateSchema = z.object({
  /** 天氣：雨天、晴、起霧… */
  weather: z.string().trim().max(40).optional(),
  /** 時間：清晨、黃昏、深夜… */
  timeOfDay: z.string().trim().max(40).optional(),
  /** 情緒／氛圍：平靜、壓抑、療癒… */
  mood: z.string().trim().max(60).optional(),
  /** 其他狀態備註（積水、人潮、燭光…） */
  notes: z.string().trim().max(200).optional(),
});
export type EnvironmentState = z.infer<typeof environmentStateSchema>;

/** 場景狀態 → 注入生成的一句話；空狀態回空字串（呼叫端據此整段略過） */
export function formatEnvironmentState(env: EnvironmentState | null | undefined): string {
  if (!env) return "";
  const parts = [env.weather, env.timeOfDay, env.mood, env.notes]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  return parts.join("、");
}

/* ── 鏡頭語言（Shot Direction；簡單模式只用 shotSize＋秒數，專業模式全開） ─────────────── */

export const shotCameraSchema = z.object({
  /** 鏡別：遠景、全景、中景、特寫、大特寫… */
  shotSize: z.string().trim().max(20).optional(),
  /** 機位角度：平視、低角度、俯視、過肩… */
  angle: z.string().trim().max(20).optional(),
  /** 運鏡：固定、推近、拉遠、跟拍、搖攝… */
  movement: z.string().trim().max(30).optional(),
  /** 焦段：50mm、85mm、廣角… */
  focalLength: z.string().trim().max(20).optional(),
  /** 光線：逆光、柔光、頂光、燭光… */
  lighting: z.string().trim().max(60).optional(),
  /** 構圖：三分法、中心對稱、留白… */
  composition: z.string().trim().max(60).optional(),
});
export type ShotCamera = z.infer<typeof shotCameraSchema>;

export const shotPerformanceSchema = z.object({
  /** 表情／情緒：平靜、若有所思、欲言又止… */
  emotion: z.string().trim().max(60).optional(),
  /** 視線：看向遠方、對視、低頭… */
  gaze: z.string().trim().max(60).optional(),
});
export type ShotPerformance = z.infer<typeof shotPerformanceSchema>;

/** 鏡頭語言＋表演 → 注入生成的短句（只列有填的欄位；全空回空字串） */
export function formatShotDirection(
  camera: ShotCamera | null | undefined,
  performance: ShotPerformance | null | undefined,
): string {
  const parts: string[] = [];
  if (camera) {
    const cam = [camera.shotSize, camera.angle, camera.movement, camera.focalLength]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join("、");
    if (cam) parts.push(`鏡頭：${cam}`);
    if (camera.lighting?.trim()) parts.push(`光線：${camera.lighting.trim()}`);
    if (camera.composition?.trim()) parts.push(`構圖：${camera.composition.trim()}`);
  }
  if (performance) {
    const perf = [performance.emotion, performance.gaze]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join("、");
    if (perf) parts.push(`表演：${perf}`);
  }
  return parts.join("；");
}

/* ── 逐鏡上下文指導（PE 計畫 §12）：AI／使用者「只改這一鏡的鏡頭語言」 ─────────────
 * 為什麼要 merge 而不是整份覆寫：助手收到的是「鏡頭再靠近一點」這種單點指令，
 * 整份覆寫會把使用者先前調好的光線／構圖默默清掉——那是靜默資料遺失，不是「沒改到」。 */

/** 欄位中文名（確認卡與活動紀錄都用這份，單一真相） */
export const SHOT_DIRECTION_FIELD_LABEL: Record<string, string> = {
  shotSize: "鏡別",
  angle: "機位",
  movement: "運鏡",
  focalLength: "焦段",
  lighting: "光線",
  composition: "構圖",
  emotion: "情緒",
  gaze: "視線",
};

/**
 * 局部套用鏡頭語言／表演：patch 只帶「要改的欄位」。
 *  - `undefined`／缺鍵＝不動這個欄位
 *  - 空字串＝清掉這個欄位（使用者說「不要運鏡」要有辦法表達）
 * 全部欄位都空 → 回 `null`（與 storyScenes.environment 一致：空狀態存 null，不留空物件）。
 */
export function mergeShotDirection<T extends Record<string, string | undefined>>(
  base: T | null | undefined,
  patch: Partial<T> | null | undefined,
): T | null {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(base ?? {})) {
    if (typeof v === "string" && v.trim()) merged[k] = v.trim();
  }
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === undefined) continue;
    const t = typeof v === "string" ? v.trim() : "";
    if (t) merged[k] = t;
    else delete merged[k];
  }
  return Object.keys(merged).length ? (merged as T) : null;
}

/**
 * 變更預覽（PE 計畫 §14）：把 before→after 講成人看得懂的一句話，
 * 讓「確認」這一步真的看得到會被改掉什麼（沒填過的欄位顯示「－」）。
 * 回空陣列＝這個 patch 其實什麼都沒改（呼叫端據此不給使用者一顆假按鈕）。
 */
export function describeDirectionChange(
  before: Record<string, string | undefined> | null | undefined,
  after: Record<string, string | undefined> | null | undefined,
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: string[] = [];
  for (const k of keys) {
    const b = before?.[k]?.trim() || "";
    const a = after?.[k]?.trim() || "";
    if (b === a) continue;
    const label = SHOT_DIRECTION_FIELD_LABEL[k] ?? k;
    out.push(`${label} ${b || "－"}→${a || "－"}`);
  }
  return out;
}

/** UI 快選選項（不是白名單——欄位仍收自由文字，模型/使用者可寫其他值） */
export const SHOT_SIZE_OPTIONS = ["大遠景", "遠景", "全景", "中景", "中特寫", "特寫", "大特寫"] as const;
export const SHOT_ANGLE_OPTIONS = ["平視", "低角度", "高角度", "俯視", "過肩", "主觀視角"] as const;
export const SHOT_MOVEMENT_OPTIONS = ["固定", "緩推", "緩拉", "跟拍", "橫搖", "升降", "手持"] as const;

/* ── 自動解析：模型輸出 schema（LLM-facing；絕不接受 UUID，全部用代號/名字） ─────────────── */

const confidenceSchema = z.number().min(0).max(1);

/** 既有實體代號（char1/preset1/prop1）；模型認定候選＝某張既有卡時填 */
const existingRefSchema = z.string().trim().max(40).optional();

export const parsedCharacterSchema = z.object({
  name: z.string().trim().min(1).max(40),
  /** 外觀（會進定裝卡 appearance；黑髮、柔和五官…） */
  appearance: z.string().trim().max(1000).optional(),
  /** 同義稱呼（她、那位師姐…）——resolve 用，不落庫 */
  aliases: z.array(z.string().trim().max(40)).max(8).optional(),
  /** 本故事中的服裝／造型（會建 Look，不污染 Identity） */
  costume: z.string().trim().max(LOOK_COSTUME_MAX).optional(),
  existingRef: existingRefSchema,
  confidence: confidenceSchema,
});

export const parsedLocationSchema = z.object({
  name: z.string().trim().min(1).max(40),
  /** 地點固定特徵（色板/環境描述；會進場景卡 palette） */
  features: z.string().trim().max(500).optional(),
  lighting: z.string().trim().max(200).optional(),
  aliases: z.array(z.string().trim().max(40)).max(8).optional(),
  existingRef: existingRefSchema,
  confidence: confidenceSchema,
});

export const parsedPropSchema = z.object({
  name: z.string().trim().min(1).max(40),
  appearance: z.string().trim().max(500).optional(),
  aliases: z.array(z.string().trim().max(40)).max(8).optional(),
  /** 這件道具屬於哪個角色（用角色名或 charN 代號；resolve 不到就當獨立道具） */
  ownerRef: z.string().trim().max(40).optional(),
  existingRef: existingRefSchema,
  confidence: confidenceSchema,
});

export const parsedShotSchema = z.object({
  title: z.string().trim().max(60).optional(),
  /** 靜態畫面描述（構圖、光線、氣氛）——直接可用於生成 */
  prompt: z.string().trim().min(1).max(2000),
  /** 動作走位（時間性；只注入影片模型） */
  action: z.string().trim().max(500).optional(),
  dialogue: z.string().trim().max(500).optional(),
  voiceover: z.string().trim().max(500).optional(),
  durationSec: z.number().int().min(1).max(30).optional(),
  /** 這一鏡出現的角色（名字或 charN 代號） */
  characterRefs: z.array(z.string().trim().max(40)).max(12).optional(),
  propRefs: z.array(z.string().trim().max(40)).max(12).optional(),
  /** 表演與鏡別（可選；轉分鏡時寫進 performance/camera） */
  emotion: z.string().trim().max(60).optional(),
  shotSize: z.string().trim().max(20).optional(),
});

export const parsedSceneSchema = z.object({
  title: z.string().trim().min(1).max(STORY_SCENE_TITLE_MAX),
  summary: z.string().trim().max(300).optional(),
  /** 這場戲的地點（名字或 presetN 代號） */
  locationRef: z.string().trim().max(40).optional(),
  environment: environmentStateSchema.optional(),
  /** 對應的故事原文段落（provenance；確認卡顯示用） */
  excerpt: z.string().trim().max(400).optional(),
  shots: z.array(parsedShotSchema).min(1).max(8),
});

/** 整份解析結果（模型輸出）：世界資料＋分鏡計畫 */
export const storyParseModelSchema = z.object({
  characters: z.array(parsedCharacterSchema).max(20).default([]),
  locations: z.array(parsedLocationSchema).max(12).default([]),
  props: z.array(parsedPropSchema).max(20).default([]),
  scenes: z.array(parsedSceneSchema).min(1).max(12),
});
export type StoryParsePlan = z.infer<typeof storyParseModelSchema>;
export type ParsedCharacter = z.infer<typeof parsedCharacterSchema>;
export type ParsedLocation = z.infer<typeof parsedLocationSchema>;
export type ParsedProp = z.infer<typeof parsedPropSchema>;
export type ParsedScene = z.infer<typeof parsedSceneSchema>;
export type ParsedShot = z.infer<typeof parsedShotSchema>;

/* ── 待確認候選（parse_candidates.payload 的形狀） ─────────────── */

export const CANDIDATE_KINDS = ["character", "location", "prop", "look"] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

export const CANDIDATE_KIND_LABEL: Record<CandidateKind, string> = {
  character: "角色",
  location: "場景",
  prop: "道具",
  look: "造型",
};

/* ── 名稱正規化（NORMALIZE/RESOLVE 的共同基準） ─────────────── */

/**
 * 名稱正規化鍵：去頭尾空白、全形空白摺疊、去引號書名號、統一小寫。
 * 「紅色雨傘」vs「 紅色雨傘 」vs「『紅色雨傘』」都收斂到同一鍵——
 * 這是「同一段故事重跑解析不能大量建立重複 Entity」（Idempotency guardrail）的第一道防線。
 */
export function nameKey(raw: string): string {
  return raw
    .replace(/[「」『』《》【】"'（）()]/g, "")
    .replace(/[\s　]+/g, "")
    .toLowerCase();
}

/** 兩個名字是否指同一實體：正規化鍵相等，或一方是另一方的結尾（「紅傘」←→「紅色雨傘」不算；「安倢」←→「小安倢」算尾綴） */
export function sameEntityName(a: string, b: string): boolean {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (!ka || !kb) return false;
  return ka === kb;
}

/* ── 解析摘要（story.get 回給 UI 的 counts 形狀） ─────────────── */

export interface StoryParseSummary {
  characters: number;
  locations: number;
  props: number;
  looks: number;
  storyScenes: number;
  shots: number;
  /** 待確認（<0.70 未落庫）數 */
  pending: number;
  /** 已套用但標記需確認（0.70–0.89）數 */
  flagged: number;
}
