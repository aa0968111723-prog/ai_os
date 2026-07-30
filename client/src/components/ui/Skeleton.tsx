import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * 載入骨架。計畫第 7 條：「>1s 的載入用 skeleton/shimmer 取代『載入中…』純文字」。
 *
 * 一律帶 `aria-hidden`＋容器的 `aria-busy`，避免讀屏軟體把裝飾方塊念出來；
 * 呼叫端應在外層放 `aria-live` 的一句話狀態，視覺與語音各司其職。
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
  return (
    <div
      aria-hidden="true"
      className={cx("skeleton", className)}
      style={{ width, height, borderRadius: radius, ...style }}
      {...rest}
    />
  );
}
