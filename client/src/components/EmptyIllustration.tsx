import { useState } from "react";
import { illustrationBase, type IllustrationKey } from "../illustrations";
import "./empty-illustration.css";

/**
 * 空狀態插畫：給 EmptyState 的 icon 槽使用。
 * 裝飾性（alt 空）。預設 140 — 與 serif 標題比例更穩。
 * WebP 1x/2x + PNG 後備；缺 160 資產時自動回退 sq-512。
 * 進場動畫由 .empty-illustration + fade-rise 負責。
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
  const png160 = `${base}-160.png`;
  const legacy = `${base}-sq-512.png`;
  const [src, setSrc] = useState(png160);

  return (
    <picture className={className ? `empty-illustration ${className}` : "empty-illustration"}>
      {src === png160 && (
        <source type="image/webp" srcSet={`${webp1x} 1x, ${webp2x} 2x`} />
      )}
      <img
        src={src}
        width={width}
        height={height}
        alt=""
        decoding="async"
        loading="lazy"
        draggable={false}
        onError={() => {
          if (src !== legacy) setSrc(legacy);
        }}
      />
    </picture>
  );
}
