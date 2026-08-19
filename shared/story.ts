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

/* ── 作者備註行（劇本標注工具的「註記」）─────────────────────────
 * 編劇在稿子裡寫給自己或夥伴的話（「這裡待補」「跟導演確認」），
 * 不是故事內容。它必須存在故事全文裡（不然版本、協作、複製貼上都會掉），
 * 但**不可以**被解析成角色／場景／鏡頭——否則備註會長出假的分鏡。
 * 所以前綴定義放共用層：編輯器插入它、解析引擎剔除它，兩邊吃同一份真相。 */
export const STORY_NOTE_PREFIX = "註：";
/** 也接受的等價寫法（半形冒號、程式碼慣例的 //） */
const STORY_NOTE_PATTERN = /^\s*(?:註[:：]|\/\/)/;

export function isStoryNoteLine(line: string): boolean {
  return STORY_NOTE_PATTERN.test(line);
}

/**
 * 送進解析前剔除備註行。整行拿掉、不留空行——留空行等於在段落中間插一個分段，
 * 而「空行＝換一場戲」是解析的分場依據，會把一場戲硬生生切成兩場。
 */
export function stripStoryNotes(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !isStoryNoteLine(line))
    .join("\n");
}

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

/**
 * 兩個名字是否指同一實體：**只認正規化鍵完全相等**。
 * 刻意不做前後綴猜測（「紅傘」←→「紅色雨傘」一律不算同一件）——
 * 縮寫與代稱的歸併是語意問題，交給 LLM 的 aliases／existingRef 去判斷並標信心，
 * 規則層猜錯會把兩件道具靜默併成一件，比漏併難發現得多。
 */
export function sameEntityName(a: string, b: string): boolean {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (!ka || !kb) return false;
  return ka === kb;
}

/* ── 轉分鏡的逐場 diff（PE 計畫 §22／§33） ─────────────────────
 *
 * 為什麼要 diff 而不是一律 append：使用者改了故事、重新解析、再按一次「產生分鏡」，
 * 舊做法會把同一場再建一次，分鏡中心出現兩個「第一幕」。但也**不能**反過來拿新計畫
 * 覆蓋舊場——那會清掉使用者在分鏡上調過的鏡頭語言、造型、生成結果。
 *
 * 折衷：以場名配對。
 *  - 配不到既有場        → create：整場連鏡一起建
 *  - 配到、但底下沒有活鏡 → fill：只補鏡（沒有東西會被蓋掉）
 *  - 配到、底下有鏡      → reuse：完全不動（使用者的編輯優先於 AI 的新計畫）
 */

export interface StoryboardPlanScene {
  title: string;
  shots: unknown[];
}
export interface ExistingStoryScene {
  id: string;
  title: string;
  /** 這一場底下還活著的鏡數（軟刪不算） */
  liveShots: number;
}

export interface StoryboardSceneDiff {
  title: string;
  action: "create" | "fill" | "reuse";
  /** create 以外會帶既有場 id */
  storySceneId?: string;
  /** 這次會新增幾鏡（reuse＝0） */
  shots: number;
}

/**
 * 逐場比對計畫與既有分鏡。純函式：同一份輸入永遠得到同一份計畫，
 * 預覽（使用者看到的數字）與實際套用（materializeStoryboard）共用它，兩邊不會說不同的話。
 */
export function diffStoryboardPlan(
  planScenes: StoryboardPlanScene[],
  existing: ExistingStoryScene[],
): StoryboardSceneDiff[] {
  // 一個既有場只能被一個計畫場認領，避免同名兩場都指到同一個既有場
  const claimed = new Set<string>();
  return planScenes.map((sc) => {
    const key = nameKey(sc.title);
    const match = existing.find((e) => !claimed.has(e.id) && nameKey(e.title) === key);
    if (!match) return { title: sc.title, action: "create" as const, shots: sc.shots.length };
    claimed.add(match.id);
    if (match.liveShots > 0) {
      return { title: sc.title, action: "reuse" as const, storySceneId: match.id, shots: 0 };
    }
    return { title: sc.title, action: "fill" as const, storySceneId: match.id, shots: sc.shots.length };
  });
}

/** 預覽摘要：「新增 3 場 12 鏡・補 1 場 4 鏡・沿用 8 場」 */
export function summarizeStoryboardDiff(diff: StoryboardSceneDiff[]): {
  createScenes: number;
  fillScenes: number;
  reuseScenes: number;
  newShots: number;
} {
  return {
    createScenes: diff.filter((d) => d.action === "create").length,
    fillScenes: diff.filter((d) => d.action === "fill").length,
    reuseScenes: diff.filter((d) => d.action === "reuse").length,
    newShots: diff.reduce((n, d) => n + d.shots, 0),
  };
}

/**
 * Live: 0場 5 未分場鏡 + 產生分鏡 prepended 21 → 26, orphans still at the tail.
 * Adopt orphans into the plan (or attach leftovers to a scene). Never grow 5→26.
 */
export function planOrphanAdoption(newShots: number, orphanCount: number): {
  adopt: number;
  create: number;
  leftoverAttach: number;
  liveAfter: number;
} {
  const orphans = Math.max(0, orphanCount);
  const planned = Math.max(0, newShots);
  const adopt = Math.min(planned, orphans);
  const create = planned - adopt;
  const leftoverAttach = orphans - adopt;
  return { adopt, create, leftoverAttach, liveAfter: planned + leftoverAttach };
}

/**
 * Live leftover after the first 產生分鏡 already wrote applied.storyboard:
 * 21 new shots + 5 tail orphans = 26. A second click must attach those
 * orphans into existing scenes. Never insert. Never delete. liveAfter stays.
 */
export function planReuseOrphanAttach(liveShots: number, orphanCount: number): {
  attach: number;
  create: number;
  delete: number;
  liveAfter: number;
} {
  const live = Math.max(0, liveShots);
  const attach = Math.max(0, orphanCount);
  return { attach, create: 0, delete: 0, liveAfter: live };
}

/**
 * Heuristic / unmarked scripts have no「場景：」line. Pull a place name from the
 * paragraph so 產生分鏡 does not leave every field as（未定地點）.
 * Known 場景： names win; then a small place-noun list; then「在X堂/室/口…」.
 */
const STORY_PLACE_NOUNS = [
  "校門口",
  "克難坡",
  "禪堂",
  "教室",
  "宿舍",
  "校園",
  "夕陽",
  "超商",
  "禮堂",
  "操場",
  "圖書館",
  "走廊",
  "頂樓",
] as const;

export function inferLocationNameFromText(text: string, knownNames: string[] = []): string | undefined {
  const body = text.trim();
  if (!body) return undefined;
  for (const name of knownNames) {
    if (name && body.includes(name)) return name;
  }
  for (const place of STORY_PLACE_NOUNS) {
    if (body.includes(place)) return place;
  }
  const at = body.match(/在([\u4e00-\u9fff]{2,8}(?:堂|室|口|園|館|坡|樓|門|廳|房))/);
  return at?.[1];
}

/* ── Shot 素材推薦（PE 計畫 §13／§26） ────────────────────────
 *
 * 刻意**不做**語意向量檢索，也刻意不寫「AI 已分析」這種文案——現在沒有那個能力，
 * 假裝有就是騙使用者（§60）。這一版誠實地做「名稱或標籤對得上」：
 * 用這一鏡已經綁定的角色／場景／道具名字去比對素材的標題與標籤，
 * 並把**命中的詞**一起回給 UI，讓推薦理由看得見（「符合：安倢、紅傘」）。
 *
 * 之後要接向量檢索時，換掉的是 buildShotSearchTerms 的來源與這支的分數來源，
 * 回傳形狀（matched/score）不用動——介面先長對，能力再長進來。
 */

export interface AssetLike {
  id: string;
  title: string;
  tags: unknown;
}

export interface AssetSuggestion {
  assetId: string;
  /** 命中的詞（給使用者看推薦理由，不是黑盒分數） */
  matched: string[];
}

/** tags 是 jsonb，實務上可能是字串陣列、也可能被寫成別的東西——只取字串 */
function toTagList(tags: unknown): string[] {
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
}

/**
 * 這一鏡拿哪些詞去找素材：綁定的實體名字（精準、有意義），不是把整段畫面描述斷詞。
 * 中文斷詞在沒有詞庫的情況下只會製造雜訊命中，寧可少而準。
 */
export function buildShotSearchTerms(input: {
  characterNames?: string[];
  locationNames?: string[];
  propNames?: string[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...(input.characterNames ?? []), ...(input.locationNames ?? []), ...(input.propNames ?? [])]) {
    const t = name.trim();
    const key = nameKey(t);
    // 一個字的名字（「傘」）會命中太多不相干素材，門檻設兩個字
    if (!key || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * 依「標題或標籤含有這些詞」挑素材，命中越多詞越前面。
 * 完全沒命中的素材不回——寧可一個都不推薦，也不要推一堆不相干的讓使用者自己過濾。
 */
export function suggestAssetsForShot(terms: string[], assets: AssetLike[], limit = 6): AssetSuggestion[] {
  if (!terms.length) return [];
  const termKeys = terms.map((t) => ({ raw: t, key: nameKey(t) })).filter((t) => t.key);
  const scored: Array<{ s: AssetSuggestion; score: number }> = [];
  for (const asset of assets) {
    const haystack = nameKey([asset.title, ...toTagList(asset.tags)].join(" "));
    if (!haystack) continue;
    const matched = termKeys.filter((t) => haystack.includes(t.key)).map((t) => t.raw);
    if (!matched.length) continue;
    scored.push({ s: { assetId: asset.id, matched }, score: matched.length });
  }
  // 命中詞數多的優先；同分維持原順序（呼叫端已依時間排序，較新的在前）
  return scored
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s);
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
