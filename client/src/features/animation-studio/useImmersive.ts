import { type RefObject } from "react";
import { useImmersive as useImmersiveBase } from "../../lib/useImmersive";

/** 沉浸時掛在 <body> 上：全站浮動殼層（頂欄、分頁列、私訊小球、回饋浮標）讓開 */
export const IMMERSIVE_BODY_CLASS = "studio-immersive";

/**
 * 創作室的全螢幕／沉浸模式＝通用的 useImmersive（見 lib/useImmersive）綁上創作室的 body 類別。
 * 行為（原生 Fullscreen ＋ CSS 沉浸兩層、三條退出路徑收斂到同一狀態）都在通用版裡。
 */
export function useImmersive(elementRef: RefObject<HTMLElement | null>) {
  return useImmersiveBase(elementRef, IMMERSIVE_BODY_CLASS);
}
