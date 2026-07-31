import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { cx } from "./cx";

/**
 * 標籤貼紙。計畫 §24.3 要求「區分可互動的 Chip 與純展示的 Badge/Pill」——
 * 這個元件用型別把那條規範變成強制：給了 `onClick` 就自動成為可互動 chip。
 *
 * 可互動時補上 `role="button"`、`tabIndex`、Enter／Space 鍵盤啟動。
 * 全站現況是裸 `<span className="chip pick">` 搭 onClick——滑鼠可點、鍵盤按不到；
 * 換成這個元件即自動修好，且 class 輸出不變（`chip pick`／`chip pick on`）。
 *
 * onClick 可接收 MouseEvent（世界觀 chips 用 shiftKey／detail 做「設主要」）。
 * 鍵盤 Enter／Space 會合成 detail:1 且不帶 shift（除非按鍵當下 shift 仍按著）。
 */
export function Chip({
  selected,
  onClick,
  as: Tag = "span",
  className,
  children,
  ...rest
}: {
  /**
   * 選取態 → 加 `on`，並輸出 `aria-pressed`。
   *
   * **不給就代表這不是切換鈕**。站內的互動 chip 分兩種：可切換的篩選／職能選擇，
   * 以及「點一下複製模型 ID」這類一次性動作。若一律輸出 aria-pressed，
   * 後者會被讀屏念成「未按下的切換鈕」——那是對使用者謊報元件性質。
   * 所以 aria-pressed 只在 selected 有明確值時才輸出。
   *
   * 另一種情況：呼叫端自己指定了 `role="radio"／"checkbox"／"switch"`。
   * 那時選取態該由 `aria-checked` 表達，而 `aria-pressed` 只在 `role="button"` 合法——
   * 兩者並存等於同時宣告兩種互相打架的狀態。所以非 button 的 role 一律不輸出 aria-pressed。
   */
  selected?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  /**
   * 刻意不含 "li"：可互動的 Chip 會輸出 role="button"，掛在 <li> 上會蓋掉
   * listitem 角色，外層 <ul> 就不再被讀屏當成清單（項目數也不會被念出來）。
   * 要做「清單裡的可點標籤」請寫 <li><Chip onClick=… /></li>，語意才完整。
   */
  as?: "span" | "div";
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "onClick" | "children" | "className">) {
  const interactive = typeof onClick === "function";
  // 呼叫端指定的 role 會蓋掉下面預設的 "button"（`{...rest}` 排在後面）。
  // aria-pressed 得跟著那個「最終真的會出現在 DOM 上的 role」走，否則會渲染出
  // `role="radio" aria-checked="true" aria-pressed="true"` 這種無效組合。
  const role = (rest as { role?: string }).role ?? (interactive ? "button" : undefined);
  const togglable = selected !== undefined && role === "button";

  // 只在 interactive 時掛上，故 onClick 必定存在。
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      // 合成點擊事件：保留 shiftKey，讓「Shift+Enter 設主要」在鍵盤也可達
      onClick?.({
        shiftKey: event.shiftKey,
        detail: 1,
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
      } as MouseEvent<HTMLElement>);
    }
  }

  return (
    <Tag
      className={cx("chip", interactive && "pick", selected && "on", className)}
      {...(interactive
        ? {
            role: "button",
            tabIndex: 0,
            // 一次性動作（selected 未給）與非 button 的 role 都不輸出 aria-pressed
            // —— 見上方 selected 的說明
            ...(togglable ? { "aria-pressed": selected } : {}),
            onClick,
            onKeyDown: handleKeyDown,
          }
        : {})}
      {...rest}
    >
      {children}
    </Tag>
  );
}
