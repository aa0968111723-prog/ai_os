import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Hint } from "./Hint";

/**
 * 空狀態。計畫要求「空狀態要有意義＋下一步指引」，所以 `title` 與 `description` 都是必填，
 * `action` 強烈建議帶——一個沒有下一步的空狀態等於死路。
 *
 * 說明文字走 `layer="always"`：空狀態的說明就是唯一的內容，
 * 精簡模式把它收成「？」會讓畫面變成一片空白，那是把問題變嚴重而不是變簡單。
 *
 * `icon` 收 ReactNode（而非 IconName）以維持 ui/ 對其他元件零依賴。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...rest
}: {
  icon?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "title" | "className">) {
  return (
    <div className={cx("empty-state", className)} {...rest}>
      {icon}
      <h3>{title}</h3>
      <Hint layer="always">{description}</Hint>
      {action}
    </div>
  );
}
