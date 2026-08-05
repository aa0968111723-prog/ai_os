import { illustrationBase, type IllustrationKey } from "../illustrations";

/**
 * 空狀態插畫：給 EmptyState 的 icon 槽使用。
 * 裝飾性（alt 空）。預設 140 — 比 160 略收，和 serif 標題比例更穩。
 * WebP srcset（160/320）+ PNG 後備；進場沿用全域 fade-rise。
 */
export function EmptyIllustration({
  name,
  width = 140,
  height = 140,
  className = "",
}: {
  name: IllustrationKey;
  width?: number;
  height?: number;
  className?: string;
}) {
  const base = illustrationBase(name);
  const webp1x = `${base}-160.webp`;
  const webp2x = `${base}-320.webp`;
  const pngFallback = `${base}-160.png`;
  // 若只有舊版 sq-512，瀏覽器在 webp 404 時會落到 img src；
  // 部署時請同時放入 webp + 160.png（或暫用 sq-512 當 src）。
  const legacy = `${base}-sq-512.png`;

  return (
    <picture className={className ? `empty-illustration ${className}` : "empty-illustration"}>
      <source type="image/webp" srcSet={`${webp1x} 1x, ${webp2x} 2x`} />
      <img
        src={pngFallback}
        // 舊資產尚未換成 160.png 時，可改指向 legacy（部署腳本會兩個都放）
        data-legacy={legacy}
        width={width}
        height={height}
        alt=""
        decoding="async"
        loading="lazy"
        draggable={false}
      />
    </picture>
  );
}
