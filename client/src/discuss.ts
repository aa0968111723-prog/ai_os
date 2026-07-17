/**
 * 「在留言中討論」跨元件事件匯流排:分鏡格/素材卡/生成列各自散落在 ProjectPage 深處,
 * 與 MessagePanel 之間用一顆 CustomEvent 溝通(免把 callback 逐層鑽過三個大元件)。
 * MessagePanel 掛監聽:收到後把引用卡放進輸入區、捲到留言面板、聚焦輸入框。
 */
export type RefKind = "scene" | "asset" | "generation" | "note" | "schedule";
export type DiscussRef = { refType: RefKind; refId: string; title: string };

export const DISCUSS_EVENT = "aios:discuss";

export function discussInMessages(ref: DiscussRef): void {
  window.dispatchEvent(new CustomEvent<DiscussRef>(DISCUSS_EVENT, { detail: ref }));
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
