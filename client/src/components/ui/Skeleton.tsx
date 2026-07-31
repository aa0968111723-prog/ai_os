import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * 載入骨架。計畫第 7 條：「>1s 的載入用 skeleton/shimmer 取代『載入中…』純文字」。
 *
 * 預設帶 `aria-hidden`，避免讀屏軟體把裝飾方塊念出來——呼叫端應在外層放
 * `aria-live` 的一句話狀態，視覺與語音各司其職。
 *
 * **但呼叫端給了 `role` 或 `aria-label` 時就不強加 `aria-hidden`**：站內有幾處骨架
 * 本身就是播報載入的元素（`role="status" aria-label="載入中"`），若被硬設成
 * aria-hidden，兩個屬性互相矛盾，讀屏使用者會完全收不到「正在載入」的訊息。
 */
export function Skeleton({
  width,
  height,
  radius,
  className,
  style,
  ...rest
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "style">) {
  const announces = "role" in rest || "aria-label" in rest;
  return (
    <div
      {...(announces ? {} : { "aria-hidden": "true" as const })}
      className={cx("skeleton", className)}
      style={{ width, height, borderRadius: radius, ...style }}
      {...rest}
    />
  );
}
