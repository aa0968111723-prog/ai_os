import { useCallback, useEffect, useState, type RefObject } from "react";

/** 沉浸時掛在 <body> 上：全站浮動殼層（頂欄、分頁列、私訊小球、回饋浮標）讓開 */
export const IMMERSIVE_BODY_CLASS = "studio-immersive";

/**
 * 全螢幕／沉浸模式。
 *
 * 兩層而不是只用 Fullscreen API：
 *
 * 1. **原生全螢幕**（`requestFullscreen`）——真的把瀏覽器的網址列與系統列吃掉，
 *    這是「專業工具」與「網頁」的差別。
 * 2. **CSS 沉浸**——iOS Safari 至今不支援對任意元素 requestFullscreen
 *    （`document.fullscreenEnabled` 為 false）。只做第一層的話，iPhone 使用者
 *    按下按鈕會完全沒反應。所以沉浸狀態一律成立，原生全螢幕只是加分。
 *
 * 退出的路徑有三條（按鈕、Esc、系統手勢），全部要收斂到同一個狀態——
 * 少接 `fullscreenchange` 的話，使用者用系統手勢離開全螢幕後，
 * 畫面會卡在「以為還在沉浸」的版面裡。
 */
export function useImmersive(elementRef: RefObject<HTMLElement | null>) {
  const [immersive, setImmersive] = useState(false);

  /** 這台裝置支援原生全螢幕嗎（iOS Safari：否） */
  const nativeSupported =
    typeof document !== "undefined" && (document.fullscreenEnabled ?? false) &&
    typeof Element !== "undefined" && typeof Element.prototype.requestFullscreen === "function";

  const enter = useCallback(() => {
    setImmersive(true);
    const el = elementRef.current;
    if (!el || !nativeSupported) return;
    // 失敗（使用者拒絕、非使用者手勢）不影響 CSS 沉浸——畫面仍然全版
    void el.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
  }, [elementRef, nativeSupported]);

  const exit = useCallback(() => {
    setImmersive(false);
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    if (immersive) exit();
    else enter();
  }, [enter, exit, immersive]);

  // 系統手勢／Esc 離開原生全螢幕時，把 CSS 沉浸一起收掉
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => {
      if (!document.fullscreenElement && immersive && nativeSupported) setImmersive(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [immersive, nativeSupported]);

  // body class 由這裡獨佔管理，並保證離開頁面時一定拆掉——
  // 殘留的話全站的頂欄與分頁列會在別的頁面永久消失
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle(IMMERSIVE_BODY_CLASS, immersive);
    return () => document.body.classList.remove(IMMERSIVE_BODY_CLASS);
  }, [immersive]);

  return { immersive, enter, exit, toggle, nativeSupported };
}
