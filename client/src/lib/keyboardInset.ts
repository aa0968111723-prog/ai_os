/** 虛擬鍵盤佔掉的畫面高度，供 CSS 讀取（`var(--kb-inset)`，永遠是合法長度） */
export const KEYBOARD_INSET_VAR = "--kb-inset";

/**
 * 把虛擬鍵盤高度寫成 CSS 變數，讓貼底面板能自己讓開。
 *
 * 手機上打字時鍵盤會蓋住貼底 sheet 的輸入列與送出鈕，而兩大平台漏的是不同的洞：
 *
 * - **Android／Chrome**：`interactive-widget=resizes-content`（見 index.html 的 viewport meta）
 *   會讓版面視窗跟著鍵盤縮小，`dvh` 與 `bottom: 0` 自動就對了。此時
 *   `innerHeight` 與 `visualViewport.height` 一起縮，本函式算出來≈0，不會重複位移。
 * - **iOS／Safari**：不支援 `interactive-widget`，版面視窗紋風不動，只有
 *   `visualViewport` 會縮。差額就是鍵盤高度，只能靠這裡補。
 *
 * `offsetTop` 要一起扣：瀏覽器為了露出聚焦的輸入框而自行捲動視覺視窗時，
 * 貼底元素被推出去的量等於「鍵盤高度＋捲動位移」。
 */
export function installKeyboardInset(): () => void {
  if (typeof window === "undefined") return () => {};
  const root = document.documentElement;
  const vv = window.visualViewport;
  if (!vv) {
    // 舊瀏覽器沒有 visualViewport：留 0px，貼底面板行為與加這功能之前完全一樣
    root.style.setProperty(KEYBOARD_INSET_VAR, "0px");
    return () => root.style.removeProperty(KEYBOARD_INSET_VAR);
  }
  let last = -1;
  const sync = () => {
    // 負值（例如網址列收合造成視覺視窗比版面視窗高）夾成 0：只讓開，不倒吸
    const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    if (inset === last) return;
    last = inset;
    root.style.setProperty(KEYBOARD_INSET_VAR, `${inset}px`);
  };
  sync();
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  return () => {
    vv.removeEventListener("resize", sync);
    vv.removeEventListener("scroll", sync);
    root.style.removeProperty(KEYBOARD_INSET_VAR);
  };
}
