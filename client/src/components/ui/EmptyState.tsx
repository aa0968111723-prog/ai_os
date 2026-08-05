import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * 空狀態。計畫要求「空狀態要有意義＋下一步指引」，所以 `title` 與 `description` 都是必填，
 * `action` 強烈建議帶——一個沒有下一步的空狀態等於死路。
 *
 * 視覺對齊 ribbon-light：柔光米白卡＋品牌色光暈；主 CTA 請用 `<Button variant="primary">`。
 *
 * 說明用純 `<p>`（`.empty-state p` 已定義 fg-secondary），刻意**不**包成 `<Hint>`：
 * 1. 與站內原本就用純 `<p>` 的空狀態 DOM 相容。
 * 2. 空狀態的說明本來就是「唯一的內容」，精簡模式把它收成「？」只會留下一片空白。
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
      <p>{description}</p>
      {action}
    </div>
  );
}
