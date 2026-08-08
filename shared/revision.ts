/**
 * 樂觀併發控制（Optimistic Concurrency）的前後端共用契約。
 *
 * 要解的問題只有一個，但它是多人協作裡最貴的一個：**靜默覆蓋**。
 *
 * 在此之前，`scenes.update`／`story.save`／角色・造型・場景卡・道具的 update 全都是
 * 「讀出來 → 改 → 欄位寫回」，`WHERE id = ?` 沒有任何併發條件。兩個人同時改同一格，
 * 後寫的人贏，先寫的人**沒有任何訊號**——畫面上不會紅、不會跳、下一次輪詢回來時
 * 他自己打的字就是不見了。故事編輯器（autosave 每 800ms 送一次全文）尤其致命：
 * 兩人同時打字時，其中一人整段內容會被對方的全文覆蓋掉，而且是每 800ms 覆蓋一次。
 *
 * 契約：
 *  1. 讀取一律回 `rev`（整數，從 0 開始）。
 *  2. mutation 收 optional 的 `expectedRev`，以及 optional 的 `baseline`
 *     （＝我開始編輯時，我要改的那些欄位長什麼樣）。
 *  3. rev 相符 → 直接套用，`rev = rev + 1`。
 *  4. rev 不符 → **不是立刻失敗**，先做逐欄三方比對（見 classifyRevisionPatch）：
 *     我動的欄位若在別人那一版裡沒被動過，兩份修改根本不衝突，直接合併套上去；
 *     只有「同一個欄位、兩份不同的值」才丟結構化 CONFLICT 要人決定。
 *  5. `expectedRev` 不給＝維持舊行為（仍會 rev+1）。
 *
 * 為什麼 expectedRev 是 optional：強制會讓每一支既有呼叫端（agent effect、解析落庫、
 * 匯入、背景 runner）在漏帶時整個壞掉，而那些路徑本來就不是併發熱點。防護要加在真正
 * 會撞的地方——人在編輯框裡打字——而不是加在所有地方然後因為太痛被整個關掉。
 *
 * 為什麼要 baseline 而不是只比 rev：只比 rev 的系統會把「A 改提示詞、B 改旁白」
 * 誤判成衝突，逼使用者為一件根本沒衝突的事做選擇。假警報多了，人就會開始無腦點
 * 「用我的」——那時這套機制反而變成資料遺失的幫兇。
 */

/** 目前納入 revision 契約的實體。新增時同步加 `rev` 欄與 migration。 */
export const REVISION_ENTITIES = [
  "scene",
  "story",
  "storyScene",
  "character",
  "characterLook",
  "scenePreset",
  "prop",
] as const;

export type RevisionEntity = (typeof REVISION_ENTITIES)[number];

/** 衝突時回給前端的結構化 payload（掛在 tRPC 錯誤的 `data.conflict`） */
export interface RevisionConflict<T = Record<string, unknown>> {
  reason: "REVISION_CONFLICT";
  /** 實體種類，供前端挑對應的文案與「查看新版」導向 */
  entity: RevisionEntity;
  entityId: string;
  /** 呼叫端以為的版本 */
  expectedRev: number;
  /** 資料庫現在的版本 */
  currentRev: number;
  /** 現值（衝突當下重讀）——前端要能直接顯示「別人改成什麼」而不必再打一支查詢 */
  currentData: T;
  /** 真正撞在一起的欄位（同一欄、兩份不同的值）。UI 的「比較差異」就攤這幾欄。 */
  contestedFields: string[];
  /** 我改了、而別人沒動的欄位——「重新套用我的修改」只會送這幾欄，不會連帶蓋掉別人的 */
  mergeableFields: string[];
  /** 誰改的（查得到才給；查不到為 null，前端退回「有夥伴」的說法） */
  updatedBy: { userId: string; name: string } | null;
  updatedAt: string | null;
}

/** 給人看的實體名（衝突提示用；「這一鏡」比「scene」有用得多） */
const ENTITY_LABEL: Record<RevisionEntity, string> = {
  scene: "這一鏡",
  story: "這份故事",
  storyScene: "這一場",
  character: "這個角色",
  characterLook: "這個造型",
  scenePreset: "這個場景卡",
  prop: "這個道具",
};

export function revisionEntityLabel(entity: RevisionEntity): string {
  return ENTITY_LABEL[entity] ?? "這筆資料";
}

/** 欄位的給人看名字（衝突卡列出「撞在哪」時用；沒登記的就照原名顯示） */
const FIELD_LABEL: Record<string, string> = {
  title: "標題",
  prompt: "畫面提示詞",
  voiceover: "旁白",
  dialogue: "對白",
  action: "動作走位",
  ambience: "環境音",
  music: "配樂",
  durationSec: "秒數",
  content: "內文",
  summary: "摘要",
  appearance: "外觀",
  costume: "服裝",
  notes: "備註",
  name: "名稱",
  environment: "環境狀態",
};

export function revisionFieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field;
}

/**
 * 衝突提示的主文案。**刻意不寫「儲存失敗」**——那句話只告訴使用者「你剛才白做了」，
 * 卻沒告訴他發生什麼事、也沒給他任何出路。這裡一定要說出「是誰、動了什麼」。
 */
export function revisionConflictMessage(conflict: Pick<RevisionConflict, "entity" | "updatedBy">): string {
  const who = conflict.updatedBy?.name?.trim();
  const what = revisionEntityLabel(conflict.entity);
  return who ? `${who} 剛剛更新了${what}` : `有夥伴剛剛更新了${what}`;
}

/** 型別守衛：從 tRPC 錯誤的 `data` 取出衝突 payload（形狀不符一律回 null，不讓壞資料炸畫面） */
export function readRevisionConflict(data: unknown): RevisionConflict | null {
  if (!data || typeof data !== "object") return null;
  const conflict = (data as { conflict?: unknown }).conflict;
  if (!conflict || typeof conflict !== "object") return null;
  const c = conflict as Record<string, unknown>;
  if (c.reason !== "REVISION_CONFLICT") return null;
  if (typeof c.entityId !== "string" || typeof c.expectedRev !== "number" || typeof c.currentRev !== "number") return null;
  if (typeof c.entity !== "string" || !(REVISION_ENTITIES as readonly string[]).includes(c.entity)) return null;
  if (!Array.isArray(c.contestedFields) || !Array.isArray(c.mergeableFields)) return null;
  return conflict as RevisionConflict;
}

export interface RevisionPatchPlan {
  /** 我動了、而別人在這段期間沒動過的欄位——直接套用是安全的 */
  mergeable: string[];
  /** 我動了、別人也動了、而且兩邊的值不一樣——只有這些需要人來決定 */
  contested: string[];
  /** 我送了但值跟現況相同的欄位——沒有任何改動，寫回去也是白寫 */
  noop: string[];
}

/**
 * 逐欄三方比對：`baseline`（我載入時的值）、`patch`（我要改成什麼）、`current`（DB 現值）。
 *
 * 判定（對每個 patch 欄位）：
 *  - patch == current            → noop：別人已經改成跟我一樣，或我根本沒真的改
 *  - baseline == current         → mergeable：別人沒碰這欄，我的修改可以直接落地
 *  - 其餘（baseline != current）  → contested：別人動過這一欄，而且不是我要的值
 *
 * baseline 缺欄（舊客戶端沒送、或那個欄位當時是 undefined）一律當 contested——
 * 無法證明沒被動過時，寧可多問一次，也不要靜默覆蓋。這是整份契約的預設立場。
 */
export function classifyRevisionPatch(
  patch: Record<string, unknown>,
  baseline: Record<string, unknown> | null | undefined,
  current: Record<string, unknown>,
): RevisionPatchPlan {
  const plan: RevisionPatchPlan = { mergeable: [], contested: [], noop: [] };
  for (const field of Object.keys(patch)) {
    const next = patch[field];
    const now = current[field];
    if (sameValue(next, now)) {
      plan.noop.push(field);
      continue;
    }
    if (baseline && field in baseline && sameValue(baseline[field], now)) {
      plan.mergeable.push(field);
      continue;
    }
    plan.contested.push(field);
  }
  return plan;
}

/**
 * 值相等判定。刻意把 `null` 與 `undefined` 視為同一件事：
 * DB 回 null、表單回 undefined、JSON 往返又可能把欄位整個吃掉——若把三者當三種值，
 * 每次載入都會憑空冒出「這欄被改過」的假衝突。
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : new Date(String(a)).getTime();
    const tb = b instanceof Date ? b.getTime() : new Date(String(b)).getTime();
    return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
  }
  if (typeof a === "object" && typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}
