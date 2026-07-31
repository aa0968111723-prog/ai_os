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
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash-target");
  // 強制 reflow 讓動畫可重播(連點兩次也會再閃一次)
  void el.offsetWidth;
  el.classList.add("flash-target");
  window.setTimeout(() => el.classList.remove("flash-target"), 2400);
  return true;
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
