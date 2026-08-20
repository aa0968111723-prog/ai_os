/**
 * AIOS Orb 狀態機（Companion App 的唯一互動主體）。
 *
 * ## 為什麼是 shared/ 的純函式，而不是元件內的 useState
 *
 * Orb 同時被三個地方讀：Companion 首頁的大球、分頁列的小球、Android 桌面 Widget
 * （後者根本不在瀏覽器裡跑 React）。三處各寫一份「什麼時候該轉、什麼時候該亮」，
 * 保證會在第三個月各自漂移。這裡把狀態與其推導集中成純資料，元件只負責畫。
 *
 * ## 與既有 lib/orbState 的關係
 *
 * `client/src/lib/orbState.ts` 是**手機 Web 底欄那顆小球**的四態 CSS 開關
 * （idle/thinking/speaking/error），由 `<html data-orb-state>` 驅動，桌機無感。
 * 那個不動——它服務的是既有手機 Web 殼層，動它就是動既有產品。
 * 本檔是 Companion App 的八態機，`companionOrbToLegacy()` 把八態投影回四態，
 * 讓兩顆球在同一個 App 內不會講不同的話。
 *
 * ## 不變式
 *
 * 1. **狀態只描述「AI 現在在幹嘛」**，不描述導航、不描述權限、不描述資料。
 * 2. **一次性回饋自動退場**：success/error/notification 有 TTL，逾時回 idle
 *    （沒有人希望球在口袋裡紅一整晚）。
 * 3. **executing 帶進度**，其餘狀態的 progress 一律 undefined——不要讓「思考中」
 *    也長出一條假的進度環。
 * 4. **降級是狀態的屬性，不是元件的 if**：`orbMotionPlan()` 決定這一格裝置
 *    能播多少東西，元件照著畫即可。
 */

export const ORB_STATES = [
  "idle",
  "listening",
  "thinking",
  "executing",
  "waiting_confirmation",
  "success",
  "error",
  "notification",
] as const;
export type OrbState = typeof ORB_STATES[number];

/** 一次性回饋的存活時間（ms）；不在表內＝持續狀態，要靠新訊號才會換。 */
export const ORB_TRANSIENT_MS: Partial<Record<OrbState, number>> = {
  success: 2200,
  error: 3200,
  notification: 4000,
};

/** 逾時之後退回哪裡。全部回 idle——待機是唯一的靜止點。 */
export const ORB_TRANSIENT_FALLBACK: OrbState = "idle";

export function isTransientOrbState(state: OrbState): boolean {
  return ORB_TRANSIENT_MS[state] !== undefined;
}

/**
 * 狀態優先序（數字大者勝）。
 *
 * 訊號會同時到：語音還開著、上一輪剛成功、又有一個新通知進來。與其讓最後
 * 寫入的人贏（結果取決於 React 排程順序），不如明訂誰蓋得過誰。
 *
 * 語音（listening）最高：那是使用者**正按著螢幕**的當下，任何背景訊號都不該
 * 把球從「我在聽」搶走——那會讓人以為錄音斷了。
 */
const ORB_PRIORITY: Record<OrbState, number> = {
  listening: 100,
  waiting_confirmation: 80,
  error: 70,
  executing: 60,
  thinking: 50,
  success: 40,
  notification: 30,
  idle: 0,
};

export function orbPriority(state: OrbState): number {
  return ORB_PRIORITY[state];
}

/** 兩個同時成立的狀態要顯示哪一個。相同優先序時取後到的（較新的事實）。 */
export function resolveOrbState(current: OrbState, incoming: OrbState): OrbState {
  return ORB_PRIORITY[incoming] >= ORB_PRIORITY[current] ? incoming : current;
}

export interface OrbSignals {
  /** 麥克風正在收音 */
  listening?: boolean;
  /** 助手這一輪還在跑（模型或工具） */
  thinking?: boolean;
  /** 有已註冊的長任務在跑（生成／修復／agent run） */
  executing?: boolean;
  /** 0–1；只有 executing 時有意義 */
  progress?: number;
  /** 有待使用者拍板的提議或審核 */
  awaitingConfirmation?: boolean;
  /** 這一輪剛剛驗證成功 */
  justSucceeded?: boolean;
  /** 這一輪失敗，或有失敗中的任務 */
  failed?: boolean;
  /** 有未讀的主動提醒 */
  unreadNotifications?: number;
}

export interface OrbView {
  state: OrbState;
  /** 0–1，僅 executing。四捨五入到 1%，避免每一格進度都重繪。 */
  progress?: number;
  /** 螢幕閱讀器要唸的那句話（Orb 不是純視覺物件） */
  label: string;
  /** 這個狀態會不會自己退場 */
  transient: boolean;
}

const STATE_LABEL: Record<OrbState, string> = {
  idle: "目前待機",
  listening: "正在聆聽",
  thinking: "正在思考",
  executing: "正在執行任務",
  waiting_confirmation: "正在等你決定",
  success: "剛剛完成一件事",
  error: "剛才有一件事沒成功",
  notification: "有新的提醒",
};

/**
 * Screen reader 讀出的完整句子。
 *
 * 格式固定「AIOS 助手，<狀態>，<下一步>」——TalkBack 使用者靠的是句型穩定，
 * 每個狀態換一種講法會讓人每次都要重新聽完才知道發生什麼事。
 */
export function orbAccessibleLabel(state: OrbState, progress?: number): string {
  const pct = state === "executing" && typeof progress === "number"
    ? `，進度 ${Math.round(clamp01(progress) * 100)}%`
    : "";
  const hint = state === "waiting_confirmation"
    ? "，雙擊查看待確認事項"
    : state === "listening"
      ? "，放開結束說話"
      : "，雙擊開始對話";
  return `AIOS 助手，${STATE_LABEL[state]}${pct}${hint}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 訊號 → 狀態。
 *
 * 刻意**不吃「上一個狀態」**：這是一個純投影，同樣的訊號一定得到同樣的球。
 * 一次性回饋的退場由呼叫端的計時器負責（見 ORB_TRANSIENT_MS），不是在這裡
 * 記憶體裡藏一個時間戳——那會讓同一份訊號在不同時刻算出不同結果，測不動。
 */
export function deriveOrbState(signals: OrbSignals): OrbView {
  const state = pickState(signals);
  const progress = state === "executing" && typeof signals.progress === "number"
    ? Math.round(clamp01(signals.progress) * 100) / 100
    : undefined;
  return {
    state,
    ...(progress === undefined ? {} : { progress }),
    label: orbAccessibleLabel(state, progress),
    transient: isTransientOrbState(state),
  };
}

function pickState(s: OrbSignals): OrbState {
  if (s.listening) return "listening";
  if (s.awaitingConfirmation) return "waiting_confirmation";
  if (s.failed) return "error";
  if (s.executing) return "executing";
  if (s.thinking) return "thinking";
  if (s.justSucceeded) return "success";
  if ((s.unreadNotifications ?? 0) > 0) return "notification";
  return "idle";
}

/* ────────────────────────── 動畫降級 ────────────────────────── */

/**
 * 動畫層級。
 *
 * `full` → 粒子＋光流＋呼吸＋漂浮；`reduced` → 只留呼吸與顏色；
 * `still` → 完全不動，只換顏色與一個靜態進度環。
 *
 * 為什麼要三層而不是「有沒有 prefers-reduced-motion」兩層：
 * prefers-reduced-motion 是**偏好**，低階裝置是**能力**。一支 2GB RAM 的
 * Android 沒有設定 reduced-motion，但 60 顆粒子會讓它掉到 15fps；而一位開了
 * reduced-motion 的使用者的旗艦機完全跑得動，只是不想看東西亂飛。
 * 兩者要各自能把層級往下壓，所以取最保守的那個。
 */
export const ORB_MOTION_TIERS = ["full", "reduced", "still"] as const;
export type OrbMotionTier = typeof ORB_MOTION_TIERS[number];

export interface OrbDeviceProfile {
  /** matchMedia("(prefers-reduced-motion: reduce)") */
  prefersReducedMotion?: boolean;
  /** navigator.hardwareConcurrency */
  cores?: number;
  /** navigator.deviceMemory（GB；多數瀏覽器沒有，undefined 不視為低階） */
  memoryGb?: number;
  /** 省電模式／電量低（Battery API 有才填） */
  saveBattery?: boolean;
  /** navigator.connection.saveData */
  saveData?: boolean;
  /** 分頁在背景／App 進背景 */
  backgrounded?: boolean;
  /** 使用者在設定裡明確選的層級，覆蓋所有偵測 */
  userOverride?: OrbMotionTier;
}

export interface OrbMotionPlan {
  tier: OrbMotionTier;
  /** 粒子數；still/reduced 為 0 */
  particles: number;
  /** 呼吸動畫是否播 */
  breathe: boolean;
  /** 漂浮位移（px）；0＝不漂 */
  floatPx: number;
  /** 內部光流旋轉是否播 */
  swirl: boolean;
  /** 目標更新頻率（fps）；用於 rAF 節流 */
  fps: number;
  /** 為什麼是這一層（給診斷面板與測試用，不是給使用者看的行銷字） */
  reason: string;
}

const TIER_ORDER: Record<OrbMotionTier, number> = { full: 2, reduced: 1, still: 0 };

function lowerTier(a: OrbMotionTier, b: OrbMotionTier): OrbMotionTier {
  return TIER_ORDER[a] <= TIER_ORDER[b] ? a : b;
}

/**
 * 裝置能力 → 這一格能播什麼。
 *
 * 背景時一律 still：App 進背景還在燒 GPU 是使用者看不到、卻付得到電費的成本。
 */
export function orbMotionPlan(profile: OrbDeviceProfile = {}): OrbMotionPlan {
  if (profile.backgrounded) return plan("still", "App 在背景，停止所有動畫");
  if (profile.userOverride) return plan(profile.userOverride, "使用者在設定中指定");

  let tier: OrbMotionTier = "full";
  const reasons: string[] = [];
  if (profile.prefersReducedMotion) {
    tier = lowerTier(tier, "reduced");
    reasons.push("系統偏好減少動態");
  }
  if (profile.saveBattery) {
    tier = lowerTier(tier, "reduced");
    reasons.push("省電模式");
  }
  if (profile.saveData) {
    tier = lowerTier(tier, "reduced");
    reasons.push("節省數據");
  }
  if (typeof profile.cores === "number" && profile.cores > 0 && profile.cores <= 4) {
    tier = lowerTier(tier, "reduced");
    reasons.push(`CPU 核心數 ${profile.cores}`);
  }
  if (typeof profile.memoryGb === "number" && profile.memoryGb > 0 && profile.memoryGb <= 2) {
    tier = lowerTier(tier, "still");
    reasons.push(`裝置記憶體 ${profile.memoryGb}GB`);
  }
  return plan(tier, reasons.length ? reasons.join("、") : "裝置能力充足");
}

function plan(tier: OrbMotionTier, reason: string): OrbMotionPlan {
  if (tier === "still") {
    return { tier, particles: 0, breathe: false, floatPx: 0, swirl: false, fps: 0, reason };
  }
  if (tier === "reduced") {
    return { tier, particles: 0, breathe: true, floatPx: 0, swirl: false, fps: 30, reason };
  }
  return { tier, particles: 18, breathe: true, floatPx: 6, swirl: true, fps: 60, reason };
}

/* ────────────────────────── 與既有小球的橋 ────────────────────────── */

export type LegacyOrbState = "idle" | "thinking" | "speaking" | "error";

/** 八態 → 既有手機 Web 底欄小球的四態（見 client/src/lib/orbState.ts）。 */
export function companionOrbToLegacy(state: OrbState): LegacyOrbState {
  switch (state) {
    case "thinking":
    case "executing":
      return "thinking";
    case "listening":
    case "success":
    case "notification":
    case "waiting_confirmation":
      return "speaking";
    case "error":
      return "error";
    case "idle":
      return "idle";
  }
}
