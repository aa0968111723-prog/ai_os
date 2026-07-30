import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * 卡片表面。四種語意對應 styles.css 既有的三個修飾 class：
 *
 * - `default` → `card`：一般卡面（象牙紙）
 * - `primary` → `card card--primary`：主卡，左緣有主色條、較寬內距
 * - `std`     → `card card--std`：低一階陰影，用於次要區塊
 * - `quiet`   → `card card--quiet`：透明底髮絲框；配 `as="details"` 就是可收合區
 *
 * class 輸出與遷移前逐字相同。
 */
export type CardVariant = "default" | "primary" | "std" | "quiet";

const VARIANT_CLASS: Record<CardVariant, string> = {
  default: "",
  primary: "card--primary",
  std: "card--std",
  quiet: "card--quiet",
};

export function Card({
  variant = "default",
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  variant?: CardVariant;
  as?: "div" | "section" | "article" | "details" | "li";
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className">) {
  return (
    <Tag className={cx("card", VARIANT_CLASS[variant], className)} {...rest}>
      {children}
    </Tag>
  );
}
