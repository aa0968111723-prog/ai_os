import { useState } from "react";
import { STYLE_IMAGE_LQIP } from "../generated/styleImageLqip";

/**
 * 內建畫風的視覺資產與色彩對應。
 *
 * 圖檔由 `npm run assets:styles`（scripts/optimize-style-images.mjs）從 assets-src/styles/
 * 產生：card 400×300、thumb 128×128，各有 webp 與 jpg fallback。
 * 原本這裡直接指到 1024×1024 的原圖（單張 0.7～1.2MB），手機進「創作」分頁要等好幾秒
 * 才看得到圖——現在單張卡片圖約 12～38KB，縮圖約 2～5KB。
 */
export const STYLE_VISUAL_ASSETS: Record<
  string,
  {
    /** 圖檔 basename，對應 /styles/<slug>-card.webp 等變體 */
    slug: string;
    tagline: string;
    color: string;
    icon: string;
  }
> = {
  "寫實攝影": {
    slug: "realistic_photo",
    tagline: "85mm 鏡頭質感・自然光影與細節",
    color: "#eab308",
    icon: "Camera",
  },
  "日系水彩": {
    slug: "jp_watercolor",
    tagline: "柔和透明水彩・粉彩清新日系",
    color: "#06b6d4",
    icon: "Palette",
  },
  "3D 動畫": {
    slug: "3d_animation",
    tagline: "皮克斯迪士尼風・立體光澤與可愛渲染",
    color: "#a855f7",
    icon: "Box",
  },
  "手繪插畫": {
    slug: "hand_drawn",
    tagline: "繪本手感線條・溫馨手作童話風",
    color: "#f97316",
    icon: "Edit3",
  },
  "極簡線條": {
    slug: "minimalist_line",
    tagline: "單線連續輪廓・洗鍊現代禪風",
    color: "#64748b",
    icon: "Feather",
  },
  "膠片質感": {
    slug: "film_grain",
    tagline: "35mm 復古顆粒・溫暖底片光暈",
    color: "#d97706",
    icon: "Film",
  },
  "水墨禪意": {
    slug: "zen_ink",
    tagline: "傳統東方宣紙留白・空靈意境筆觸",
    color: "#475569",
    icon: "Moon",
  },
};

export type StyleVisualAsset = (typeof STYLE_VISUAL_ASSETS)[string];

/** 卡片主圖尺寸（與 optimize-style-images.mjs 的輸出一致，用來鎖定版位避免 CLS） */
export const STYLE_CARD_SIZE = { width: 400, height: 300 } as const;
export const STYLE_THUMB_SIZE = { width: 128, height: 128 } as const;

export function styleAssetOf(name: string | null | undefined): StyleVisualAsset | null {
  return name ? STYLE_VISUAL_ASSETS[name] ?? null : null;
}

/** 內嵌的 24×18 模糊佔位圖；第一幀就有顏色，真圖載入後才淡入 */
export function styleLqipOf(asset: StyleVisualAsset | null | undefined): string | null {
  return asset ? STYLE_IMAGE_LQIP[asset.slug] ?? null : null;
}

interface StyleImageProps {
  asset: StyleVisualAsset | null | undefined;
  alt: string;
  /** card＝400×300 卡片主圖；thumb＝128×128 小縮圖 */
  variant: "card" | "thumb";
  className?: string;
  /** 首屏可見的圖用 eager，其餘維持 lazy */
  eager?: boolean;
}

/**
 * 畫風圖片。webp 優先、jpg fallback，並且：
 * - 寬高寫死（來源尺寸），瀏覽器先保留版位，載入完不會把下面的內容推走
 * - LQIP 當底圖，載入中不是空白而是模糊色塊
 * - 載入失敗時整個 <picture> 收掉，交給外層的漸層底色，不留破圖 icon
 */
export function StyleImage({ asset, alt, variant, className, eager = false }: StyleImageProps) {
  const [failed, setFailed] = useState(false);
  if (!asset || failed) return null;

  const size = variant === "card" ? STYLE_CARD_SIZE : STYLE_THUMB_SIZE;
  const lqip = styleLqipOf(asset);
  const base = `/styles/${asset.slug}-${variant}`;

  return (
    <picture className="style-image">
      <source srcSet={`${base}.webp`} type="image/webp" />
      <img
        // thumb 只產 webp；jpg fallback 只有 card 有，thumb 就退回 card.jpg（仍遠小於原圖）
        src={variant === "card" ? `${base}.jpg` : `/styles/${asset.slug}-card.jpg`}
        alt={alt}
        width={size.width}
        height={size.height}
        className={className}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        style={lqip ? { backgroundImage: `url("${lqip}")`, backgroundSize: "cover" } : undefined}
        onError={() => setFailed(true)}
      />
    </picture>
  );
}
