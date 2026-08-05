import { useState } from "react";
import { illustrationBase, type IllustrationKey } from "../illustrations";
import "./empty-illustration.css";

/**
 * 空狀態插畫：給 EmptyState 的 icon 槽使用。
 * 裝飾性（alt 空）。預設 140 — 與 serif 標題比例更穩。
 * 優先 SVG（向量、可經 git 推送）；缺檔時回退 160.png → sq-512.png。
 * WebP 仍可選（本機補資產後自動被 picture 使用）。
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
  const svg = `${base}.svg`;
  const webp1x = `${base}-160.webp`;
  const webp2x = `${base}-320.webp`;
  const png160 = `${base}-160.png`;
  const legacy = `${base}-sq-512.png`;
  const [src, setSrc] = useState(svg);

  const showWebp = src === svg || src === png160;

  return (
    <picture className={className ? `empty-illustration ${className}` : "empty-illustration"}>
      {showWebp && (
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
          if (src === svg) setSrc(png160);
          else if (src === png160) setSrc(legacy);
        }}
      />
    </picture>
  );
}
