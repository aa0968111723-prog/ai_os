import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * 徽章（膠囊、帶陰影的展示元件）。與 Pill 的分工：
 * Badge 較大、可含圖示與多段內容，常用於頂欄／卡頭；Pill 是單字狀態記號。
 *
 * `tone="mock"` 對應 `.badge.mock`——測試／假資料模式的金色警示，
 * 讓「這不是真的生成」在畫面上一眼可辨。
 */
export function Badge({
  tone = "default",
  className,
  children,
  ...rest
}: {
  tone?: "default" | "mock";
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children" | "className">) {
  return (
    <span className={cx("badge", tone === "mock" && "mock", className)} {...rest}>
      {children}
    </span>
  );
}
