import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx";

/**
 * 標籤貼紙。計畫 §24.3 要求「區分可互動的 Chip 與純展示的 Badge/Pill」——
 * 這個元件用型別把那條規範變成強制：給了 `onClick` 就自動成為可互動 chip。
 *
 * 可互動時補上 `role="button"`、`tabIndex`、Enter／Space 鍵盤啟動。
 * 全站現況是裸 `<span className="chip pick">` 搭 onClick——滑鼠可點、鍵盤按不到；
 * 換成這個元件即自動修好，且 class 輸出不變（`chip pick`／`chip pick on`）。
 */
export function Chip({
  selected = false,
  onClick,
  as: Tag = "span",
  className,
  children,
  ...rest
}: {
  /** 選取態 → 加 `on` */
  selected?: boolean;
  onClick?: () => void;
  as?: "span" | "div" | "li";
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "onClick" | "children" | "className">) {
  const interactive = typeof onClick === "function";

  // 只在 interactive 時掛上，故 onClick 必定存在。
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.();
    }
  }

  return (
    <Tag
      className={cx("chip", interactive && "pick", selected && "on", className)}
      {...(interactive
        ? {
            role: "button",
            tabIndex: 0,
            "aria-pressed": selected,
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
