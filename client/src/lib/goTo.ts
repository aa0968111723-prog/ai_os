import { useEffect, useRef } from "react";
import { navigate } from "wouter/use-browser-location";

/**
 * 帶「揭示意圖」的導航：跳到某頁並讓那一頁把某個東西指出來。
 *
 * ## 為什麼需要這一層（不是為了美觀，是為了修一個死鍵）
 *
 * 站內的深連結契約是 `?focus=<anchorId>`：目的頁掛載時讀網址、捲到那個錨點、閃一下。
 * 消費者有四處，全部是**掛載時讀一次**：
 *  - `CreationWorkbench`（agent-run-*）、`SceneList`（pending／scene-*）
 *  - `ProjectPage`（scene-／generation-／pending／messages）、`PlannerPage`（note-／schedule-）
 *
 * 而 wouter 的 `usePathname` 用 `useSyncExternalStore`，snapshot 是
 * `location.pathname`——**不含 search**（node_modules/wouter/src/use-browser-location.js:42）。
 * 所以從 `/p/A` 導航到 `/p/A?focus=X` 時：網址列真的變了，但 snapshot 字串沒變，
 * React 直接 bail out，零 re-render、零 remount，`?focus=` 一個消費者都不會重跑。
 * `/p/:id` 的 Route 又以 `key={params.id}` 掛載（AppRoutes），key 不含 search，也不會重建。
 *
 * 結果是：**只有在使用者已經在目的頁上時，深連結按鈕會靜默失效**。實際踩到的兩顆：
 *  - 代理動態列點「正在跑的那份計畫」（AgentActivityHud）——你人在那個專案頁時按了沒反應
 *  - 頂欄待辦徽章點某個專案（PendingApprovalsBadge）——同理
 * 兩顆都不會報錯、不會有 console 訊息，測試也測不到（它們只斷言 navigate 被呼叫）。
 *
 * ## 解法：雙軌，跟站內既有的交棒範本同形狀
 *
 * 軌一（既有，不動）：pathname 變了 → 重新掛載 → 消費者從網址讀 `?focus=`。
 * 軌二（新增）：pathname 沒變 → 不會重新掛載 → 補派一顆 `aios:reveal` 事件，
 * 已經掛載的消費者自己補收。
 *
 * `?focus=` 一律仍寫進網址（軌一要用，而且可分享、可重整、桌面 deep link 也走它）。
 */
export const REVEAL_EVENT = "aios:reveal";

export interface RevealDetail {
  /** 與 `?focus=` 同語意的錨點 id（不含 #） */
  focus: string;
}

/**
 * 導航到 path；帶 focus 時同時走網址與事件兩軌。
 *
 * 刻意用 wouter 的 module-level `navigate` 而不是 `useLocation()[1]`：兩者是同一個函式
 * （`useBrowserLocation` 的第二個回傳值就是它，use-browser-location.js:62），而 module-level
 * 版本讓這支能在非元件的地方（事件處理器、Service Worker 訊息）直接呼叫。
 * 全 app 沒有任何 `<Router base>`，所以 base 為空字串、兩者行為一致。
 */
export function goTo(path: string, opts?: { focus?: string; replace?: boolean }): void {
  const focus = opts?.focus;
  const targetPath = path.split(/[?#]/)[0]!;
  // 一定要在 navigate **之前**比：navigate 是同步改 history，之後再比就永遠相等。
  const samePage = typeof window !== "undefined" && targetPath === window.location.pathname;
  const url = focus
    ? `${path}${path.includes("?") ? "&" : "?"}focus=${encodeURIComponent(focus)}`
    : path;
  navigate(url, { replace: opts?.replace });
  if (focus && samePage) {
    window.dispatchEvent(new CustomEvent<RevealDetail>(REVEAL_EVENT, { detail: { focus } }));
  }
}

/**
 * 接收揭示意圖：掛載時讀一次網址的 `?focus=`，之後每次 `aios:reveal` 再讀一次。
 *
 * handler 可以回傳一個清理函式（語意同 useEffect）——輪詢錨點的計時器要收得掉，
 * 而且**下一次揭示進來時要先收掉上一次的**，否則連按兩次會有兩個計時器同時在搶捲動位置。
 *
 * handler 不需要用 useCallback 包：內部走 ref，換了 handler 也不會重新訂閱。
 * 這是刻意的——要求每個呼叫端自己記得 useCallback，遲早有人忘記，
 * 而忘記的症狀是每次 render 都重新訂閱一次事件，沒有任何錯誤訊息。
 */
export function useRevealFocus(handler: (focus: string) => void | (() => void)): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    let cleanup: void | (() => void);
    const run = (focus: string) => {
      if (typeof cleanup === "function") cleanup();
      cleanup = handlerRef.current(focus);
    };
    const initial = new URLSearchParams(window.location.search).get("focus");
    if (initial) run(initial);
    const onReveal = (event: Event) => {
      const focus = (event as CustomEvent<RevealDetail>).detail?.focus;
      if (focus) run(focus);
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => {
      window.removeEventListener(REVEAL_EVENT, onReveal);
      if (typeof cleanup === "function") cleanup();
    };
  }, []);
}

/**
 * `<Link href="…?focus=…">` 的軌二補丁。
 *
 * 為什麼不把那些 Link 換成 button：`<a href>` 有中鍵開新分頁、右鍵複製網址、
 * 讀屏念成「連結」這些不該犧牲的行為。所以連結照留，只在「點的就是目前這一頁」時
 * 補派事件——wouter 會照常 pushState，只是不會 re-render。
 */
export function revealOnSamePageClick(href: string): void {
  const [pathPart, queryPart = ""] = href.split("#")[0]!.split("?");
  if (typeof window === "undefined" || pathPart !== window.location.pathname) return;
  const focus = new URLSearchParams(queryPart).get("focus");
  if (focus) window.dispatchEvent(new CustomEvent<RevealDetail>(REVEAL_EVENT, { detail: { focus } }));
}
