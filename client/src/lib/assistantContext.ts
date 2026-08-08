import { useSyncExternalStore } from "react";
import type { ViewSection } from "@shared/viewState";

/**
 * 助手的頁面感知上下文（Page / Entity / Selection awareness）。
 *
 * ## 為什麼是模組級單例而不是 React Context Provider
 *
 * 站內零 `createContext` 使用（全庫 grep 為 0）——既有的跨頁狀態一律是模組級單例
 * （`lib/orbState.ts` 就是同一形狀：模組變數＋imperative setter）。加一層 Provider
 * 會動到 AppShell 的元件樹，而 `ProjectPage.hookOrder.test.tsx` 正在守 React #310
 * 的 hook 順序契約；為了一個「頁面回報我是誰」的功能去動樹形，風險與收益不成比例。
 *
 * 讀取端用 `useSyncExternalStore`（React 19 內建）訂閱，語義與 Provider 相同但零樹形改動。
 *
 * ## 為什麼分兩層
 *
 * 「我在哪一頁」與「我正在看哪一個東西」是**不同的擁有者**：
 * 頁面（ProjectPage）知道路由與專案，但打開哪一鏡是 StoryboardStage 的 local state；
 * 素材多選在 AssetLibrary 手上。單層 slot 會讓兩個註冊者互相覆蓋（後註冊的贏），
 * 於是「捲到分鏡段」會把「打開第 3 鏡」清掉。兩層各自擁有、各自清除，合成成一份快照。
 *
 * ## 不變式
 *
 * 1. **這裡只放指標，不放資料**：entityId／selectedEntityIds 是「指哪一個」，
 *    真正內容一律由助手用既有唯讀工具去查（Context = pointer，Tool = truth）。
 *    絕不把整份腳本、整個 store 塞進來。
 * 2. **永遠只是提示，不是授權**：送到後端後，projectId／entityId 一律重新過
 *    requireGroup／專案查詢／ACL；偽造 context 頂多讓助手查到本來就有權看的東西。
 * 3. **不得殘留**：註冊者以 useEffect 的 cleanup 撤銷自己那一層；換專案、換頁、
 *    取消選取、元件卸載都自動歸零（token 比對，見下方 register*）。
 */

/**
 * 頁面類型。專案頁的四段（story／storyboard／production／final／settings）
 * **刻意沿用 `shared/viewState.ts` 的 `ViewSection` 字面值**——協作跟隨模式已經在用
 * 同一套詞彙描述「在看什麼」，助手再造一套只會讓兩邊對不上。
 */
export type AssistantPageType =
  | ViewSection
  | "home"
  | "project"
  | "studio"
  | "assets"
  | "tasks"
  | "notes"
  | "schedule"
  | "database"
  | "agent_run"
  | "collab"
  | "chat"
  | "community"
  | "other";

/** 使用者當下指涉的實體種類（shot＝分鏡，注意 DB 表名叫 scenes；scene＝一場戲 story_scenes） */
export type AssistantEntityType =
  | "scene"
  | "shot"
  | "asset"
  | "task"
  | "note"
  | "schedule_item"
  | "generation"
  | "agent_run"
  | "database"
  | "script";

/** 頁面層：路由與專案身分（由頁面元件註冊） */
export interface AssistantPageLayer {
  pageType: AssistantPageType;
  projectId?: string;
  /** 人看得懂的專案名（麵包屑用；不進授權判斷） */
  projectTitle?: string;
}

/** 焦點層：正在看／選了什麼（由持有 selection state 的小工具註冊） */
export interface AssistantFocusLayer {
  entityType?: AssistantEntityType;
  entityId?: string;
  /** 顯示名（例：第 3 鏡）——麵包屑與提示詞都用它，不用 id */
  entityLabel?: string;
  /** 使用者明確勾選的多個實體 */
  selectedEntityIds?: string[];
  /** 頁內分頁／模式（例：分鏡的 simple/pro、資料庫的 rows/files） */
  activeTab?: string;
  /** 覆寫頁面層的 pageType（長捲軸頁捲到哪一段時用） */
  pageType?: AssistantPageType;
}

export interface AssistantPageContext extends AssistantPageLayer, AssistantFocusLayer {
  /** 目前路由 pathname（不含 query——避免夾帶 token 類參數） */
  route: string;
  pageType: AssistantPageType;
  /** 最近一次重要操作（讓「剛剛那個」有機會被理解） */
  recentAction?: string;
}

const EMPTY_PAGE: AssistantPageLayer = { pageType: "other" };

let pageLayer: AssistantPageLayer = EMPTY_PAGE;
let focusLayer: AssistantFocusLayer = {};
let recentAction: string | undefined;
let snapshot: AssistantPageContext = { route: "/", pageType: "other" };
/** 各層目前有效的註冊 token：後註冊者接管，舊 token 的 cleanup 不得清掉新的 */
let pageToken = 0;
let focusToken = 0;
const listeners = new Set<() => void>();

function compose(): AssistantPageContext {
  const sel = focusLayer.selectedEntityIds?.length ? focusLayer.selectedEntityIds : undefined;
  return {
    route: typeof window === "undefined" ? "/" : window.location.pathname,
    ...pageLayer,
    ...focusLayer,
    // 焦點層可覆寫 pageType（捲到哪一段），沒給就用頁面層的
    pageType: focusLayer.pageType ?? pageLayer.pageType,
    selectedEntityIds: sel,
    recentAction,
  };
}

function same(a: AssistantPageContext, b: AssistantPageContext): boolean {
  return (
    a.route === b.route
    && a.pageType === b.pageType
    && a.projectId === b.projectId
    && a.projectTitle === b.projectTitle
    && a.entityType === b.entityType
    && a.entityId === b.entityId
    && a.entityLabel === b.entityLabel
    && a.activeTab === b.activeTab
    && a.recentAction === b.recentAction
    && (a.selectedEntityIds ?? []).length === (b.selectedEntityIds ?? []).length
    && (a.selectedEntityIds ?? []).every((id, i) => id === (b.selectedEntityIds ?? [])[i])
  );
}

/** 重算快照；內容真的變了才通知（同內容重複註冊不觸發重繪） */
function recompute(): void {
  const next = compose();
  if (same(snapshot, next)) return;
  snapshot = next;
  for (const l of listeners) l();
}

/**
 * 頁面回報「我是哪一頁、哪個專案」。回傳撤銷函式——**只有仍持有最新 token 的註冊者撤得掉**：
 * React 的 effect 順序是「新頁 effect → 舊頁 cleanup」，不比對 token 的話，
 * 舊頁卸載時的 cleanup 會把新頁剛註冊好的 context 清成空白（換專案時最明顯）。
 */
export function registerAssistantPage(layer: AssistantPageLayer): () => void {
  const mine = ++pageToken;
  // 焦點只有在「換到另一個地方」時才作廢——同一頁捲動、同一頁改 pageType 都不算。
  // 專案頁是一條長捲軸，捲到分鏡段時 pageType 會變；若每次都清焦點，
  // 打開中的第 3 鏡會在使用者滑一下就消失。真正的作廢條件是身分變了。
  const movedElsewhere = pageLayer.projectId !== layer.projectId;
  pageLayer = layer;
  if (movedElsewhere) {
    focusLayer = {};
    recentAction = undefined;
  }
  recompute();
  return () => {
    if (pageToken !== mine) return; // 已被後來的頁面接管，不是我該清的
    pageLayer = EMPTY_PAGE;
    focusLayer = {};
    recentAction = undefined;
    recompute();
  };
}

/**
 * 持有 selection 的小工具回報「正在看／選了什麼」。
 * 與頁面層獨立：頁面捲動不會清掉打開中的分鏡，分鏡關掉也不會清掉頁面身分。
 */
export function registerAssistantFocus(layer: AssistantFocusLayer): () => void {
  const mine = ++focusToken;
  focusLayer = layer;
  recompute();
  return () => {
    if (focusToken !== mine) return;
    focusLayer = {};
    recompute();
  };
}

/** 記一筆「剛剛做了什麼」（只保留最近一次；不是事件流，不做 replay） */
export function noteAssistantAction(action: string): void {
  const trimmed = action.trim().slice(0, 60);
  if (!trimmed || recentAction === trimmed) return;
  recentAction = trimmed;
  recompute();
}

export function getAssistantContext(): AssistantPageContext {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER_SNAPSHOT: AssistantPageContext = { route: "/", pageType: "other" };

/** 訂閱目前上下文（助手 UI 用）。SSR/測試無 window 時回穩定的空值。 */
export function useAssistantContext(): AssistantPageContext {
  return useSyncExternalStore(subscribe, getAssistantContext, () => SERVER_SNAPSHOT);
}

/** 測試用：把 store 歸零（正式碼不呼叫——真實的清除來自註冊者的 cleanup） */
export function resetAssistantContextForTest(): void {
  pageLayer = EMPTY_PAGE;
  focusLayer = {};
  recentAction = undefined;
  pageToken = 0;
  focusToken = 0;
  snapshot = { route: "/", pageType: "other" };
  for (const l of listeners) l();
}
