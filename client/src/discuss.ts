/**
 * 「在留言中討論」跨元件事件匯流排:分鏡格/素材卡/生成列各自散落在 ProjectPage 深處,
 * 與 MessagePanel 之間用一顆 CustomEvent 溝通(免把 callback 逐層鑽過三個大元件)。
 * MessagePanel 掛監聽:收到後把引用卡放進輸入區、捲到留言面板、聚焦輸入框。
 */
export type RefKind = "scene" | "asset" | "generation" | "note" | "schedule";
export type DiscussRef = { refType: RefKind; refId: string; title: string };

export const DISCUSS_EVENT = "aios:discuss";

/**
 * 手機交棒：MessagePanel 在 mobileCompact 時只有留言 sheet 開著才 mount——
 * sheet 關著時事件會發進真空（實測「討論這個」在手機 100% 無反應）。
 * 比照 setPlannerFocus 的交棒模式：先把 ref 暫存，ProjectPage 監聽事件開 sheet，
 * MessagePanel 掛載時 takePendingDiscussRef() 補收。桌機（面板常駐）走原事件路徑，
 * handler 內同步消費暫存避免殘留。
 */
const DISCUSS_PENDING_KEY = "aios:discuss-pending";

export function discussInMessages(ref: DiscussRef): void {
  try { sessionStorage.setItem(DISCUSS_PENDING_KEY, JSON.stringify(ref)); } catch { /* 隱私模式：僅事件路徑 */ }
  window.dispatchEvent(new CustomEvent<DiscussRef>(DISCUSS_EVENT, { detail: ref }));
}

export function takePendingDiscussRef(): DiscussRef | null {
  try {
    const raw = sessionStorage.getItem(DISCUSS_PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DISCUSS_PENDING_KEY);
    const ref = JSON.parse(raw) as DiscussRef;
    return ref && typeof ref.refId === "string" && typeof ref.refType === "string" ? ref : null;
  } catch {
    return null;
  }
}

/** 跳到被引用的作品:各列表已掛 id={`${refType}-${refId}`} 錨點;找得到就捲過去+短暫高亮 */
export function jumpToRef(refType: string, refId: string): boolean {
  return flashAnchor(`${refType}-${refId}`);
}

/** 捲到指定 id 元素並短暫高亮(找不到回 false) */
export function flashAnchor(anchorId: string): boolean {
  const el = document.getElementById(anchorId);
  if (!el) return false;
  // 尊重「減少動態」：前庭功能敏感的人被一段強制平滑捲動打到就是眩暈，
  // 而這條路徑是深連結／通知點擊，使用者沒有預期畫面會自己動。
  const reduced = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  el.classList.remove("flash-target");
  // 強制 reflow 讓動畫可重播(連點兩次也會再閃一次)
  void el.offsetWidth;
  el.classList.add("flash-target");
  window.setTimeout(() => el.classList.remove("flash-target"), 2400);
  return true;
}

/**
 * 輪詢到錨點「真的看得見」再捲＋高亮；回傳取消函式。
 *
 * 為什麼不能直接拿 `flashAnchor` 的回傳值當終止條件：它只在**元素不存在**時回 false。
 * 站內有兩種「找得到但看不見」的常態——手機收合的分鏡列（第 5 格以後 display:none）
 * 與 `hidden` 的 tabpanel（PlanMode 的 role="tabpanel" hidden={!active}）——
 * `getElementById` 照樣找得到它們，於是輪詢會提早停在一個捲不到的目標上，
 * 畫面什麼都沒發生。用 `getClientRects().length` 判斷才是「真的在版面裡」。
 *
 * 這個修正原本只寫在 ProjectPage 的 scene 分支；抽出來讓三處共用同一個正確版本。
 */
export function flashAnchorWhenVisible(
  anchorId: string,
  opts?: { intervalMs?: number; maxTries?: number },
): () => void {
  const intervalMs = opts?.intervalMs ?? 200;
  const maxTries = opts?.maxTries ?? 25;
  let tries = 0;
  const timer = window.setInterval(() => {
    tries += 1;
    const el = document.getElementById(anchorId);
    if (el && el.getClientRects().length > 0) {
      window.clearInterval(timer);
      flashAnchor(anchorId);
    } else if (tries >= maxTries) {
      window.clearInterval(timer);
    }
  }, intervalMs);
  return () => window.clearInterval(timer);
}

/**
 * 跨頁跳轉到 Planner 的某個排程/筆記:note/schedule 住在 /planner(與留言不同頁),
 * 用 sessionStorage 交棒——設好目標後由呼叫端 navigate("/planner"),PlannerPage 掛載時讀取並高亮。
 */
const PLANNER_FOCUS_KEY = "aios:planner-focus";
export function setPlannerFocus(type: "note" | "schedule", id: string): void {
  try { sessionStorage.setItem(PLANNER_FOCUS_KEY, `${type}-${id}`); } catch { /* 隱私模式忽略 */ }
}
export function takePlannerFocus(): string | null {
  try {
    const v = sessionStorage.getItem(PLANNER_FOCUS_KEY);
    if (v) sessionStorage.removeItem(PLANNER_FOCUS_KEY);
    return v;
  } catch {
    return null;
  }
}
