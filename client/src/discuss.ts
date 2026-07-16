/**
 * 「在留言中討論」跨元件事件匯流排:分鏡格/素材卡/生成列各自散落在 ProjectPage 深處,
 * 與 MessagePanel 之間用一顆 CustomEvent 溝通(免把 callback 逐層鑽過三個大元件)。
 * MessagePanel 掛監聽:收到後把引用卡放進輸入區、捲到留言面板、聚焦輸入框。
 */
export type DiscussRef = { refType: "scene" | "asset" | "generation"; refId: string; title: string };

export const DISCUSS_EVENT = "aios:discuss";

export function discussInMessages(ref: DiscussRef): void {
  window.dispatchEvent(new CustomEvent<DiscussRef>(DISCUSS_EVENT, { detail: ref }));
}

/** 跳到被引用的作品:各列表已掛 id={`${refType}-${refId}`} 錨點;找得到就捲過去+短暫高亮 */
export function jumpToRef(refType: string, refId: string): boolean {
  const el = document.getElementById(`${refType}-${refId}`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash-target");
  // 強制 reflow 讓動畫可重播(連點兩次也會再閃一次)
  void el.offsetWidth;
  el.classList.add("flash-target");
  window.setTimeout(() => el.classList.remove("flash-target"), 2400);
  return true;
}
