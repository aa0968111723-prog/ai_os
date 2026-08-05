import { ILLUSTRATION, type IllustrationKey } from "../illustrations";

/**
 * 空狀態插畫：給 EmptyState 的 icon 槽使用。
 * 裝飾性（alt 空），尺寸由 width/height 控制，預設 160。
 */
export function EmptyIllustration({
  name,
  width = 160,
  height = 160,
  className = "",
}: {
  name: IllustrationKey;
  width?: number;
  height?: number;
  className?: string;
}) {
  return (
    <img
      className={className}
      src={ILLUSTRATION[name]}
      width={width}
      height={height}
      alt=""
      decoding="async"
      loading="lazy"
      draggable={false}
    />
  );
}
