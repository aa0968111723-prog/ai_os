/**
 * 語意視圖狀態（Semantic View State）與 Presenter 跟隨規則。
 *
 * 為什麼不是同步捲動位置：既有的鏡像跟隨同步的是像素——捲動量、游標比例、錨點矩形。
 * 那在兩台同尺寸桌機上很準，但它同步的是「螢幕長什麼樣」，不是「在看什麼東西」。
 * 手機與桌機版面不同，pixel-perfect 從定義上就做不到；而使用者真正要的從來不是
 * 一模一樣的畫面，是**同一個內容物件**：
 *
 *   Bruce 在看：② 分鏡 → 第三場 → Shot 08 → Visual → V3
 *   韋澔 也要到同一個地方，即使他的手機一次只顯示得下一格。
 *
 * 所以這裡描述的是「在看什麼」而不是「捲到哪」。目標是 semantic-perfect collaboration，
 * 不是 pixel-perfect screen sharing。像素層的鏡像仍然保留（同尺寸桌機上它更細膩），
 * 兩者是互補的：viewState 先把人帶到正確的物件，鏡像再對齊細部。
 *
 * 三條不可違反的規則（見 shouldFollow / followPauseReason）：
 *  1. **絕不未經同意切走別人的畫面。** 收到邀請只會出現一張卡，加入了才開始跟。
 *  2. **跟隨者自己一動，立刻暫停。** 不硬拉回去——被搶走滑鼠是最快讓人關掉功能的方式。
 *  3. **主講者離線就明說離線。** 絕不自動改跟另一個人。
 */

/** 專案頁的頂層區塊（與 Story-first 的四階段對齊） */
export const VIEW_SECTIONS = ["story", "storyboard", "production", "final", "settings"] as const;
export type ViewSection = (typeof VIEW_SECTIONS)[number];

/**
 * 一個人「正在看什麼」。全部欄位都是可選的——不同頁面知道的粒度本來就不同，
 * 硬要求填滿只會逼呼叫端塞假值，而假值會把跟隨者帶到錯誤的地方。
 */
export interface ViewState {
  section?: ViewSection;
  /** 哪一場（story_scenes.id） */
  storySceneId?: string;
  /** 哪一鏡（scenes.id） */
  sceneId?: string;
  /** 該物件底下的哪一頁（visual / voice / versions…） */
  tab?: string;
  /** 開著哪個抽屜／面板 */
  drawer?: string;
  /** 開著哪個 modal */
  modal?: string;
  /** 目前的篩選條件（pending / all…） */
  filter?: string;
  /** 看的是哪一版成品（assets.id）——「V2 的眼神不對」與「Shot 08 有問題」不是同一件事 */
  assetId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 自由字串欄的長度上限：協定內全是短標記，超長一律視為異常 */
const MAX_TOKEN = 40;

/**
 * 逐欄夾制。**伺服器與客戶端都要跑這一支**——viewState 會被接收端拿去查表、
 * 拼 query key、甚至當 DOM 選擇器用（`[data-scene-id="…"]`），不驗證等於開放注入。
 * 與 cursor 的 anchor、invalidate 的 scope 同一條原則：不信任 client。
 */
export function sanitizeViewState(raw: unknown): ViewState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: ViewState = {};
  if (typeof r.section === "string" && (VIEW_SECTIONS as readonly string[]).includes(r.section)) {
    out.section = r.section as ViewSection;
  }
  // id 欄一律要求 UUID 形狀：這幾個欄位會直接進 CSS 選擇器與查詢鍵
  for (const key of ["storySceneId", "sceneId", "assetId"] as const) {
    const v = r[key];
    if (typeof v === "string" && UUID_RE.test(v)) out[key] = v;
  }
  // 自由字串欄：限長度與字元集（英數、底線、連字號）——夠用且不可能長成選擇器
  for (const key of ["tab", "drawer", "modal", "filter"] as const) {
    const v = r[key];
    if (typeof v === "string" && v.length > 0 && v.length <= MAX_TOKEN && /^[\w-]+$/.test(v)) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 兩份 viewState 是否指向同一個內容物件（用來判斷「跟到了沒」與「要不要重送」） */
export function sameViewState(a: ViewState | null | undefined, b: ViewState | null | undefined): boolean {
  if (!a || !b) return a === b || (!a && !b);
  const keys: Array<keyof ViewState> = ["section", "storySceneId", "sceneId", "tab", "drawer", "modal", "filter", "assetId"];
  return keys.every((k) => a[k] === b[k]);
}

/** 給人看的「他正在哪」——專案頁點某人時顯示的那一行 */
export function describeViewState(v: ViewState | null | undefined, sceneLabel?: string | null): string {
  if (!v) return "在這個專案裡";
  const SECTION: Record<ViewSection, string> = {
    story: "故事",
    storyboard: "分鏡",
    production: "製作",
    final: "成片",
    settings: "專案設定",
  };
  const parts: string[] = [];
  if (v.section) parts.push(SECTION[v.section]);
  if (sceneLabel) parts.push(sceneLabel);
  else if (v.sceneId) parts.push("某一鏡");
  if (v.tab) parts.push(v.tab);
  return parts.length > 0 ? parts.join(" · ") : "在這個專案裡";
}

/* ── Presenter / Follow 的狀態機 ─────────────────────────── */

export type FollowStatus =
  /** 沒在跟任何人 */
  | "off"
  /** 正在跟隨 */
  | "following"
  /** 跟隨者自己動了手，暫時停住（隨時可一鍵回去） */
  | "paused"
  /** 主講者斷線／離開專案——明確告知，絕不自動改跟別人 */
  | "presenter_gone";

export interface FollowState {
  status: FollowStatus;
  /** 正在跟誰（userId）；presenter_gone 時保留，讓畫面說得出是誰離線了 */
  presenterId: string | null;
  presenterName: string | null;
  /**
   * 鎖定到哪一條連線。同一個人可能 Tab A 開故事、Tab B 開分鏡——
   * 只鎖 userId 的話跟隨者會在兩個分頁的 viewState 之間來回彈跳。
   */
  connId: string | null;
  /** 為什麼暫停（顯示用） */
  pauseReason: PauseReason | null;
}

export type PauseReason = "scroll" | "click" | "navigate" | "manual";

const PAUSE_LABEL: Record<PauseReason, string> = {
  scroll: "你自己捲動了",
  click: "你自己操作了",
  navigate: "你切換到別的地方",
  manual: "你按了暫停",
};

export function pauseLabel(reason: PauseReason | null): string {
  return reason ? PAUSE_LABEL[reason] : "已暫停";
}

export const initialFollowState = (): FollowState => ({
  status: "off",
  presenterId: null,
  presenterName: null,
  connId: null,
  pauseReason: null,
});

/**
 * 跟隨狀態轉移。抽成純函式是因為這裡每一條規則都是「不做會傷害使用者」的規則，
 * 而它們散在 React effect 裡就測不到——而測不到的規則遲早會在某次重構裡消失。
 */
export type FollowEvent =
  /** 使用者按下「加入」——**只有這一個事件會讓人開始被帶著走** */
  | { type: "join"; presenterId: string; presenterName: string; connId: string | null }
  /** 跟隨者自己動了 */
  | { type: "interact"; reason: PauseReason }
  /** 按「回到 Bruce」 */
  | { type: "resume" }
  /** 自己按停止，或主講者「自己」結束主講（他人還在房裡） */
  | { type: "leave" }
  /**
   * 主講者斷線／關掉分頁。與 leave 分開是必要的：
   * 前者要顯示「Bruce 暫時離線」，後者是乾淨退出——兩者的畫面完全不同。
   */
  | { type: "presenter_offline" }
  /** 在場名單更新（用來偵測主講者是否還在） */
  | { type: "peers"; onlineIds: string[] };

export function followReducer(state: FollowState, event: FollowEvent): FollowState {
  switch (event.type) {
    case "join":
      // 這是唯一的入口。收到邀請本身**不會**改變狀態——沒有人會因為別人按了
      // 「帶大家看」就被切走畫面。
      return {
        status: "following",
        presenterId: event.presenterId,
        presenterName: event.presenterName,
        connId: event.connId,
        pauseReason: null,
      };

    case "interact":
      // 只有正在跟的時候才需要暫停；已暫停就維持原因（第一次的原因才是真的原因）
      if (state.status !== "following") return state;
      return { ...state, status: "paused", pauseReason: event.reason };

    case "resume":
      if (state.status !== "paused") return state;
      return { ...state, status: "following", pauseReason: null };

    case "leave":
      return initialFollowState();

    case "presenter_offline":
      if (state.status === "off" || !state.presenterId) return state;
      // presenterId/Name 刻意保留：畫面上要說得出是「誰」離線了
      return { ...state, status: "presenter_gone", connId: null };

    case "peers": {
      if (state.status === "off" || !state.presenterId) return state;
      const stillHere = event.onlineIds.includes(state.presenterId);
      if (stillHere) {
        // 從 presenter_gone 回來（短暫斷線後重連）：回到暫停而不是直接繼續跟——
        // 重連的瞬間對方可能已經在完全不同的地方，直接跳過去會很突兀。
        return state.status === "presenter_gone" ? { ...state, status: "paused", pauseReason: "navigate" } : state;
      }
      // **絕不自動改跟另一個人。** 原本跟 Bruce，Bruce 斷線就說 Bruce 斷線；
      // 自動跟到韋澔身上是使用者從來沒有要求過的事。
      return { ...state, status: "presenter_gone", connId: null };
    }

    default:
      return state;
  }
}

/** 現在該不該把畫面帶到主講者的位置 */
export function shouldFollow(state: FollowState): boolean {
  return state.status === "following" && Boolean(state.presenterId);
}

/**
 * 跟隨者的哪些操作算「我要自己看」。
 *
 * 關鍵在於**聽哪些事件**，而不是事後過濾：
 * `wheel`／`touchmove`／`pointerdown`／`keydown` 只會由真實輸入裝置產生。
 * 程式化捲動（`scrollTo`、`scrollIntoView`——也就是跟隨自己造成的那些）發出的是
 * `scroll`，不是 `wheel`。所以只要不聽 `scroll`，就不會發生「跟隨在跟上的第一幀
 * 把自己暫停掉」這件事。
 *
 * 刻意**不**用 `isTrusted` 當守衛：程式化捲動所發出的 `scroll` 事件，
 * `isTrusted` 同樣是 true（它來自瀏覽器引擎，不是腳本合成的），
 * 拿它來分辨「人的手」與「我們自己捲的」根本分不出來——那是一道看起來很安全、
 * 實際上什麼都沒擋住的守衛。
 *
 * 呼叫端若真的要把 `scroll` 導進來（例如某個容器只拿得到 scroll），
 * 必須自己用 `isProgrammatic` 標明——那份帳本在 client/src/realtime.tsx
 * 的 consumeProgrammaticScroll 已經有了，是唯一可靠的判別方式。
 */
export function followPauseReason(ev: {
  type: string;
  isProgrammatic?: boolean;
}): PauseReason | null {
  if (ev.isProgrammatic) return null;
  if (ev.type === "wheel" || ev.type === "touchmove" || ev.type === "scroll") return "scroll";
  if (ev.type === "click" || ev.type === "pointerdown" || ev.type === "keydown") return "click";
  return null;
}
