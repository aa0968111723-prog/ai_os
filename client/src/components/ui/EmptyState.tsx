import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * 空狀態。計畫要求「空狀態要有意義＋下一步指引」，所以 `title` 與 `description` 都是必填，
 * `action` 強烈建議帶——一個沒有下一步的空狀態等於死路。
 *
 * 說明用純 `<p>`（`.empty-state p` 已定義 fg-secondary），刻意**不**包成 `<Hint>`：
 * 1. 與站內既有空狀態的 DOM 逐字相同，遷移零視覺變化；
 *    包成 hint 會把 15px 縮成 12px，空狀態的唯一內容不該是最小的字。
 * 2. 空狀態的說明本來就是「唯一的內容」，精簡模式把它收成「？」只會留下一片空白，
 *    那是把問題變嚴重而不是變簡單——所以它根本不該進分層機制。
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
