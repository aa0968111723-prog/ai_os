/**
 * 圖上定點標注的座標換算（前後端共用純函式，無 DOM、無 I/O）。
 *
 * 為什麼這件事必須是一支有測試的共用純函式，而不是寫在元件裡：
 *
 * 單格工作室的舞台是 `object-fit: contain`（styles.css 的 `.scene-studio__media`，
 * 而且 ≤900px 時 max-height 還會再降一級）。**contain 表示元素框裡有 letterbox 留白，
 * 元素的 rect ≠ 畫面的內容框。** 直接用 `(clientX - rect.left) / rect.width` 算，
 * 只要素材長寬比與元素框長寬比不同——16:9 的素材配手機直式版面幾乎必然如此——
 * 所有標注都會**系統性偏移**。
 *
 * 而這種錯的可怕之處在於它沒有症狀：圓點畫得出來、點得到、存得進去，只是位置
 * 一律偏掉一點點。沒有人會回報「標注偏了 8%」，只會覺得「這個功能怪怪的」。
 * 換一台裝置、換一個視窗大小，偏移量還會變——連重現都困難。
 *
 * 所以座標一律相對「媒體內容框」而非元素框，且正反向共用同一組換算。
 *
 * `assets` 表沒有 width/height 欄位（generation.ts 只有 meta jsonb），所以內在尺寸
 * 只能在瀏覽器端從 naturalWidth／videoWidth 拿——這也是為什麼換算不能挪到伺服器。
 */

/** 元素在視窗中的位置與大小（getBoundingClientRect 的子集） */
export interface MediaBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 素材的內在像素尺寸（img.naturalWidth／video.videoWidth） */
export interface MediaIntrinsic {
  w: number;
  h: number;
}

/** 相對媒體內容框的比例座標，兩軸皆 0..1 */
export interface MediaPoint {
  ax: number;
  ay: number;
}

/**
 * `object-fit: contain` 之下，媒體實際被畫在元素框裡的哪一塊。
 * 尺寸不合法（尚未載入、除零）時回 null——呼叫端據此「不收點」，而不是收一個亂數。
 */
export function containedBox(box: MediaBox, intrinsic: MediaIntrinsic): MediaBox | null {
  if (!(intrinsic.w > 0) || !(intrinsic.h > 0)) return null;
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const scale = Math.min(box.width / intrinsic.w, box.height / intrinsic.h);
  const width = intrinsic.w * scale;
  const height = intrinsic.h * scale;
  return {
    // contain 置中：兩側（或上下）各分一半留白
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  };
}

/**
 * 點擊座標 → 比例座標。
 *
 * 回 null 的兩種情況都不該被當成「標在角落」：
 * - 素材還沒載入（intrinsic 為 0）：此時無從得知內容框在哪，收下的點必定是錯的；
 * - 點在 letterbox 留白上：那裡不是畫面，標了也指不到任何東西。
 *
 * 刻意不 clamp 到 [0,1]：clamp 會把「點在留白上」悄悄變成「點在邊緣」，
 * 使用者看到圓點跑到畫面邊上卻不知道為什麼。寧可不收。
 */
export function mediaPointFromEvent(
  box: MediaBox,
  intrinsic: MediaIntrinsic,
  ev: { clientX: number; clientY: number },
): MediaPoint | null {
  const inner = containedBox(box, intrinsic);
  if (!inner) return null;
  const ax = (ev.clientX - inner.left) / inner.width;
  const ay = (ev.clientY - inner.top) / inner.height;
  if (ax < 0 || ax > 1 || ay < 0 || ay > 1) return null;
  return { ax, ay };
}

/**
 * 比例座標 → 視窗座標（畫圓點用）。與 mediaPointFromEvent 共用 containedBox，
 * 兩支換算永遠對稱——各寫一份遲早會在某次改版後對不上，而症狀同樣是「偏一點點」。
 */
export function eventPointFromMedia(
  box: MediaBox,
  intrinsic: MediaIntrinsic,
  point: MediaPoint,
): { x: number; y: number } | null {
  const inner = containedBox(box, intrinsic);
  if (!inner) return null;
  return {
    x: inner.left + point.ax * inner.width,
    y: inner.top + point.ay * inner.height,
  };
}
