import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/**
 * 狀態徽記（純展示，不可互動——可互動的請用 Chip）。
 *
 * 計畫 §24.3 指定狀態色：Queued／Running → Gold、Done → Success、Failed → Danger。
 * 這裡把它變成型別：狀態只能從這四個取值，避免各處自己拼 class 拼出第五種狀態色。
 *
 * `.pill.running` 帶脈衝動畫（已受 prefers-reduced-motion 保護）。
 */
export type PillStatus = "queued" | "running" | "done" | "failed" | "neutral";

export function Pill({
  status = "neutral",
  className,
  children,
  ...rest
}: {
  status?: PillStatus;
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children" | "className">) {
  return (
    <span className={cx("pill", status !== "neutral" && status, className)} {...rest}>
      {children}
    </span>
  );
}
