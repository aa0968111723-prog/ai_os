/**
 * ViewState ↔ 專案頁 DOM 的橋接。
 *
 * 專案頁是一條長捲軸（① 故事 → ② 分鏡 → ③ 製作 → ④ 成片 堆疊在同一頁），
 * 不是分頁式的，所以「在看什麼」的真相就是「哪個階段在視野裡、哪一格被打開」。
 * 這支模組負責兩個方向的翻譯，兩邊都盡量重用既有的錨點契約
 * （`data-collab-zone`、`#scene-<id>`、既有的 ?focus= 深連結），
 * **不另外發明一套定位系統**。
 */
import type { ViewSection, ViewState } from "../../../../shared/viewState";

/**
 * 既有的 focus zone → 語意區塊。
 *
 * zone 是既有協定（COLLAB_ZONES）的一部分，已經在跑而且準確——直接沿用，
 * 不為了 viewState 再叫使用者的瀏覽器多算一套「我在哪個區塊」。
 */
const ZONE_TO_SECTION: Record<string, ViewSection> = {
  scenes: "storyboard",
  studio: "production",
  worldview: "settings",
  cards: "settings",
  knowledge: "settings",
  assets: "settings",
  messages: "storyboard",
};

export function sectionFromZone(zone: string | null | undefined): ViewSection | undefined {
  if (!zone) return undefined;
  return ZONE_TO_SECTION[zone];
}

/** 目前這個人在看什麼（送出去給房裡其他人） */
export function buildViewState(input: {
  zone: string | null;
  /** 目前捲到哪一段（detectVisibleSection）；zone 對應得出區塊時以 zone 優先 */
  visibleSection?: ViewSection;
  /** 打開中的單格工作室（scenes.id）；null＝沒開 */
  sceneId?: string | null;
  /** 舞台上正在看的那一版（assets.id）——「V2 的眼神不對」與「Shot 08 有問題」不同 */
  assetId?: string | null;
  tab?: string | null;
  drawer?: string | null;
}): ViewState | null {
  const out: ViewState = {};
  // zone 優先（他真的在某個區塊裡編輯），沒有才退回捲動位置（他只是在瀏覽）
  const section = sectionFromZone(input.zone) ?? input.visibleSection;
  if (section) out.section = section;
  if (input.sceneId) out.sceneId = input.sceneId;
  if (input.assetId) out.assetId = input.assetId;
  if (input.tab) out.tab = input.tab;
  if (input.drawer) out.drawer = input.drawer;
  return Object.keys(out).length > 0 ? out : null;
}

/** 語意區塊 → 頁面上的錨點選擇器（階段標頭的 id 已存在，直接用） */
const SECTION_ANCHOR: Record<ViewSection, string> = {
  story: "#stage-story",
  storyboard: "#stage-board",
  production: "#sec-generations",
  final: "#onboard-delivery",
  settings: "#onboard-worldview",
};

/** 判定順序＝頁面上的先後順序，讓「最後一個已經捲過去的」勝出 */
const SECTION_ORDER: ViewSection[] = ["story", "storyboard", "production", "final"];

/**
 * 目前視野裡是哪一個階段。
 *
 * 專案頁是一條長捲軸（① 故事 → ② 分鏡 → ③ 製作 → ④ 成片 堆疊在同一頁），
 * 所以「我在看哪一段」的真相是捲動位置，不是點過什麼。
 * 只靠 focus zone 的話，使用者純捲動瀏覽時 viewState 永遠不會變——
 * 跟隨者於是停在原地，而畫面上完全看不出哪裡不對。
 *
 * 判準是「標頭已經捲到視窗上緣以上（或剛好在視野內）的最後一個」——
 * 與人的直覺一致：我捲過了②的標頭，我就是在看②。
 */
export function detectVisibleSection(): ViewSection | undefined {
  if (typeof document === "undefined") return undefined;
  const probe = window.innerHeight * 0.4;
  let current: ViewSection | undefined;
  for (const section of SECTION_ORDER) {
    const el = document.querySelector(SECTION_ANCHOR[section]);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) continue; // 隱藏中的區塊 rect 全 0
    if (rect.top <= probe) current = section;
  }
  return current;
}

/**
 * 把跟隨者帶到主講者所在的內容物件。
 *
 * **優先順序是「越具體越優先」**：有 sceneId 就直接去那一格，沒有才退回階段標頭。
 * 這正是 semantic-perfect 與 pixel-perfect 的差別——手機一次只顯示得下一格沒關係，
 * 只要它顯示的是**同一格**。
 *
 * 回傳有沒有真的找到目標，讓呼叫端能決定要不要重試（列表是非同步載入的，
 * 手機收合中的列 getClientRects 為空，第一次找不到很正常）。
 */
export function resolveViewTarget(view: ViewState): Element | null {
  if (view.sceneId) {
    const el = document.getElementById(`scene-${view.sceneId}`);
    // 手機收合中的列 rect 為空——當作還沒準備好，讓呼叫端重試而不是捲到錯的地方
    if (el && el.getClientRects().length > 0) return el;
    if (el) return null;
  }
  if (view.section) {
    const el = document.querySelector(SECTION_ANCHOR[view.section]);
    if (el && el.getClientRects().length > 0) return el;
  }
  return null;
}

/**
 * 導航到目標。用一般的 scrollIntoView 而不是既有鏡像那套 applyScrollDeltaY——
 * 這裡要的是「到得了同一個內容物件」，不是逐像素對齊；兩者刻意分開，
 * 才不會讓語意跟隨繼承像素鏡像的複雜度（與它的 bug）。
 *
 * `behavior: "auto"` 而不是 smooth：跟隨時的平滑捲動會讓連續兩次導航互相打架。
 */
export function navigateToView(view: ViewState): boolean {
  const el = resolveViewTarget(view);
  if (!el) return false;
  el.scrollIntoView({ behavior: "auto", block: "center" });
  return true;
}
