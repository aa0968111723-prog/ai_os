import { useId, useState } from "react";
import { STYLE_IMAGE_LQIP } from "../generated/styleImageLqip";
import { Icon, type IconName } from "./Icon";

/**
 * 內建畫風的視覺資產。
 *
 * 兩種呈現，同一個入口（`<StyleImage>`）：
 * 1. **實拍縮圖**（有 `slug`）——圖檔由 `npm run assets:styles`
 *    （scripts/optimize-style-images.mjs）從 assets-src/styles/ 產生：card 400×300、
 *    thumb 128×128，各有 webp 與 jpg fallback。單張卡片圖約 12～38KB、縮圖 2～5KB。
 * 2. **程序化色票**（沒有 `slug`）——就地畫一張 SVG：家族色漸層＋媒材紋理＋圖示。
 *
 * 為什麼不是每個畫風都配實拍圖：畫風清單從 7 個長到 40+ 個，若每個都塞一張 1024×1024
 * 原圖，光 `assets-src/` 就要多背 30MB 進版控，而它們在畫面上只是 ~160px 寬的選擇卡。
 * 色票零位元組、任何新畫風加進 STYLE_DEFS 就自動有圖，之後想換成實拍圖也只要
 * 補一個 `slug` 並把原圖丟進 assets-src/styles/ 重跑一次腳本。
 */

/** 色票紋理：對應媒材的手感（顆粒／暈染／筆觸線／網點／幾何／多邊面／織紋／光澤） */
export type StyleSwatchPattern =
  | "grain"
  | "wash"
  | "line"
  | "dots"
  | "geo"
  | "poly"
  | "weave"
  | "gloss";

export interface StyleVisualAsset {
  /** 圖檔 basename，對應 /styles/<slug>-card.webp 等變體；沒有＝用程序化色票 */
  slug?: string;
  tagline: string;
  /** 主色（卡片底色漸層起點、外層 fallback 漸層都吃這個） */
  color: string;
  /** 漸層終點；與 color 拉開明度，色票才有層次而不是一塊死色 */
  accent: string;
  icon: IconName;
  swatch: StyleSwatchPattern;
}

export const STYLE_VISUAL_ASSETS: Record<string, StyleVisualAsset> = {
  /* ── 寫實：攝影／紀實 ── */
  "寫實攝影": {
    slug: "realistic_photo",
    tagline: "85mm 鏡頭質感・自然光影與細節",
    color: "#eab308",
    accent: "#fde68a",
    icon: "Camera",
    swatch: "grain",
  },
  "電影感光影": {
    tagline: "寬銀幕光比・淺景深與冷暖對比",
    color: "#0e7490",
    accent: "#fb923c",
    icon: "Clapperboard",
    swatch: "gloss",
  },
  "紀實抓拍": {
    tagline: "現場自然光・不擺拍的真實瞬間",
    color: "#78716c",
    accent: "#d6d3d1",
    icon: "Aperture",
    swatch: "grain",
  },
  "空氣感人像": {
    tagline: "柔和自然光・通透散景與細膚色",
    color: "#d97a8a",
    accent: "#fbd5da",
    icon: "User",
    swatch: "gloss",
  },
  "逆光剪影": {
    tagline: "背光輪廓・霧感光暈與莊嚴氛圍",
    color: "#f59e0b",
    accent: "#7c2d12",
    icon: "Sun",
    swatch: "gloss",
  },
  "膠片質感": {
    slug: "film_grain",
    tagline: "35mm 復古顆粒・溫暖底片光暈",
    color: "#d97706",
    accent: "#78350f",
    icon: "Film",
    swatch: "grain",
  },
  "柔光暈影": {
    tagline: "柔焦光暈・邊角壓暗的溫潤感",
    color: "#fcd34d",
    accent: "#fffbeb",
    icon: "Sparkles",
    swatch: "gloss",
  },
  "黑白單色": {
    tagline: "去彩留調・黑白層次與顆粒",
    color: "#334155",
    accent: "#cbd5e1",
    icon: "Contrast",
    swatch: "grain",
  },

  /* ── 插畫：手繪／繪本 ── */
  "日系水彩": {
    slug: "jp_watercolor",
    tagline: "柔和透明水彩・粉彩清新日系",
    color: "#06b6d4",
    accent: "#a5f3fc",
    icon: "Droplet",
    swatch: "wash",
  },
  "手繪插畫": {
    slug: "hand_drawn",
    tagline: "繪本手感線條・溫馨手作童話風",
    color: "#f97316",
    accent: "#fed7aa",
    icon: "Pencil",
    swatch: "line",
  },
  "極簡線條": {
    slug: "minimalist_line",
    tagline: "單線連續輪廓・洗鍊現代禪風",
    color: "#64748b",
    accent: "#e2e8f0",
    icon: "Spline",
    swatch: "line",
  },
  "水墨禪意": {
    slug: "zen_ink",
    tagline: "傳統東方宣紙留白・空靈意境筆觸",
    color: "#475569",
    accent: "#cbd5e1",
    icon: "Feather",
    swatch: "wash",
  },
  "厚塗油畫": {
    tagline: "厚重筆觸堆疊・油彩層次與筆刀感",
    color: "#b45309",
    accent: "#fcd34d",
    icon: "Brush",
    swatch: "wash",
  },
  "粉彩蠟筆": {
    tagline: "粉筆磨砂感・柔軟童趣的手繪筆觸",
    color: "#c084fc",
    accent: "#fce7f3",
    icon: "Palette",
    swatch: "grain",
  },
  "淡彩速寫": {
    tagline: "鋼筆速寫打底・淡彩隨性上色",
    color: "#38bdf8",
    accent: "#e0f2fe",
    icon: "PenTool",
    swatch: "line",
  },
  "紙纖理": {
    tagline: "水彩紙纖維紋・帶粗糙手感的紙底",
    color: "#a8a29e",
    accent: "#f5f5f4",
    icon: "FileText",
    swatch: "weave",
  },
  "暈染邊緣": {
    tagline: "濕畫法暈開・顏料自然堆邊",
    color: "#2dd4bf",
    accent: "#ccfbf1",
    icon: "Droplet",
    swatch: "wash",
  },

  /* ── 動畫：賽璐璐／日系動漫 ── */
  "日系動畫": {
    tagline: "乾淨勾線・平塗賽璐璐與鮮明打光",
    color: "#ec4899",
    accent: "#fbcfe8",
    icon: "Flower2",
    swatch: "gloss",
  },
  "劇場版動畫": {
    tagline: "電影級動畫美術・厚塗天空與光線",
    color: "#3b82f6",
    accent: "#fef08a",
    icon: "Clapperboard",
    swatch: "gloss",
  },
  "黑白漫畫": {
    tagline: "網點灰階・墨線排線的漫畫分格感",
    color: "#1f2937",
    accent: "#d1d5db",
    icon: "MessageSquare",
    swatch: "dots",
  },
  "Q 版角色": {
    tagline: "大頭三頭身・圓潤討喜的角色比例",
    color: "#f472b6",
    accent: "#fde68a",
    icon: "Bot",
    swatch: "geo",
  },
  "復古卡通": {
    tagline: "橡皮管四肢・30 年代彈跳卡通感",
    color: "#78350f",
    accent: "#fde68a",
    icon: "Star",
    swatch: "geo",
  },
  "動態速度線": {
    tagline: "集中線與速度殘影・強化動勢",
    color: "#6366f1",
    accent: "#c7d2fe",
    icon: "Wind",
    swatch: "line",
  },
  "賽璐璐高光": {
    tagline: "硬邊高光與輪廓光・角色更立體",
    color: "#22d3ee",
    accent: "#ecfeff",
    icon: "Zap",
    swatch: "gloss",
  },

  /* ── 3D：立體渲染 ── */
  "3D 動畫": {
    slug: "3d_animation",
    tagline: "皮克斯迪士尼風・立體光澤與可愛渲染",
    color: "#a855f7",
    accent: "#e9d5ff",
    icon: "Box",
    swatch: "gloss",
  },
  "寫實 CG 渲染": {
    tagline: "物理級材質・光線追蹤的擬真渲染",
    color: "#0f172a",
    accent: "#64748b",
    icon: "Monitor",
    swatch: "poly",
  },
  "黏土定格": {
    tagline: "手捏黏土偶・逐格拍攝的手作感",
    color: "#c2703f",
    accent: "#f5d0b3",
    icon: "Blocks",
    swatch: "grain",
  },
  "等距小場景": {
    tagline: "45 度等距微縮・移軸模型感",
    color: "#14b8a6",
    accent: "#99f6e4",
    icon: "Package",
    swatch: "geo",
  },
  "低多邊形": {
    tagline: "面塊切割・稜角分明的低面數風格",
    color: "#8b5cf6",
    accent: "#c4b5fd",
    icon: "Shapes",
    swatch: "poly",
  },
  "公仔玩具": {
    tagline: "搪膠公仔・光滑塑料與收藏感",
    color: "#f43f5e",
    accent: "#fecdd3",
    icon: "Gem",
    swatch: "gloss",
  },
  "陶土霧面": {
    tagline: "無反光陶土材質・柔和透光",
    color: "#d6a37a",
    accent: "#f4e3d3",
    icon: "CircleDot",
    swatch: "grain",
  },
  "玻璃通透": {
    tagline: "半透明玻璃果凍・折射與通透光",
    color: "#38bdf8",
    accent: "#f0f9ff",
    icon: "Droplet",
    swatch: "gloss",
  },

  /* ── 圖形：向量／平面設計 ── */
  "扁平向量": {
    tagline: "純色色塊・乾淨俐落的向量圖形",
    color: "#2563eb",
    accent: "#bfdbfe",
    icon: "Shapes",
    swatch: "geo",
  },
  "幾何構成": {
    tagline: "包浩斯式方圓三角・強構成感",
    color: "#dc2626",
    accent: "#fde047",
    icon: "Square",
    swatch: "geo",
  },
  "極簡海報": {
    tagline: "大量留白・瑞士風格網格排版",
    color: "#111827",
    accent: "#f3f4f6",
    icon: "LayoutGrid",
    swatch: "geo",
  },
  "漸層光暈": {
    tagline: "柔順漸層網格・極光般的光暈",
    color: "#8b5cf6",
    accent: "#f472b6",
    icon: "Sparkles",
    swatch: "gloss",
  },
  "復古印刷": {
    tagline: "中世紀海報・限制色版的印刷味",
    color: "#ca8a04",
    accent: "#fef3c7",
    icon: "Stamp",
    swatch: "dots",
  },
  "網點印刷": {
    tagline: "孔版網點・套色微偏移的印刷感",
    color: "#e11d48",
    accent: "#22d3ee",
    icon: "CircleDot",
    swatch: "dots",
  },
  "顆粒噪點": {
    tagline: "細緻噪點顆粒・數位感的雜訊層",
    color: "#6b7280",
    accent: "#e5e7eb",
    icon: "SlidersHorizontal",
    swatch: "grain",
  },

  /* ── 工藝：實體材質手作 ── */
  "剪紙拼貼": {
    tagline: "多層剪紙堆疊・紙張陰影的立體感",
    color: "#f59e0b",
    accent: "#fef3c7",
    icon: "Scissors",
    swatch: "geo",
  },
  "木刻版畫": {
    tagline: "刻刀鑿痕・黑白分明的凸版印刷",
    color: "#7c2d12",
    accent: "#d6d3d1",
    icon: "Stamp",
    swatch: "line",
  },
  "刺繡織品": {
    tagline: "針腳走線・布面上的手工繡感",
    color: "#be185d",
    accent: "#fbcfe8",
    icon: "Layers",
    swatch: "weave",
  },
  "沙畫流動": {
    tagline: "燈箱沙畫・流動沙粒的即興筆觸",
    color: "#d4a373",
    accent: "#faedcd",
    icon: "Wind",
    swatch: "grain",
  },
  "皮影戲": {
    tagline: "背光鏤空剪影・戲台光影的東方感",
    color: "#1c1917",
    accent: "#f59e0b",
    icon: "Moon",
    swatch: "gloss",
  },
  "布紋織理": {
    tagline: "織布經緯紋・帆布般的粗織底",
    color: "#a16207",
    accent: "#fef9c3",
    icon: "Layers",
    swatch: "weave",
  },
  "手作毛邊": {
    tagline: "手撕紙毛邊・不規則的手作邊緣",
    color: "#bfa094",
    accent: "#f5f5f4",
    icon: "FileText",
    swatch: "weave",
  },
};

/** 卡片主圖尺寸（與 optimize-style-images.mjs 的輸出一致，用來鎖定版位避免 CLS） */
export const STYLE_CARD_SIZE = { width: 400, height: 300 } as const;
export const STYLE_THUMB_SIZE = { width: 128, height: 128 } as const;

export function styleAssetOf(name: string | null | undefined): StyleVisualAsset | null {
  return name ? STYLE_VISUAL_ASSETS[name] ?? null : null;
}

/** 內嵌的 24×18 模糊佔位圖；第一幀就有顏色，真圖載入後才淡入（只有實拍圖才有） */
export function styleLqipOf(asset: StyleVisualAsset | null | undefined): string | null {
  return asset?.slug ? STYLE_IMAGE_LQIP[asset.slug] ?? null : null;
}

/** 紋理磚：用 <pattern> 平鋪，畫風多但檔案零成長 */
function swatchTile(pattern: StyleSwatchPattern, id: string, ink: string) {
  switch (pattern) {
    case "wash": // 暈染：大團半透明色暈疊在一起
      return (
        <pattern id={id} width="64" height="64" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="22" r="18" fill={ink} opacity="0.55" />
          <circle cx="48" cy="44" r="13" fill={ink} opacity="0.4" />
          <circle cx="8" cy="54" r="8" fill={ink} opacity="0.3" />
        </pattern>
      );
    case "line": // 筆觸／排線
      return (
        <pattern id={id} width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M-2 10 L10 -2" stroke={ink} strokeWidth="2" opacity="0.7" />
          <path d="M4 16 L16 4" stroke={ink} strokeWidth="2" opacity="0.7" />
        </pattern>
      );
    case "dots": // 網點：兩種大小的圓點
      return (
        <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="3.2" fill={ink} opacity="0.8" />
          <circle cx="12" cy="12" r="1.6" fill={ink} opacity="0.6" />
        </pattern>
      );
    case "geo": // 幾何：方圓三角
      return (
        <pattern id={id} width="48" height="48" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="8" fill={ink} opacity="0.55" />
          <rect x="28" y="4" width="16" height="16" fill={ink} opacity="0.4" />
          <path d="M8 44 L20 26 L32 44 Z" fill={ink} opacity="0.5" />
        </pattern>
      );
    case "poly": // 低面數：切面三角
      return (
        <pattern id={id} width="40" height="36" patternUnits="userSpaceOnUse">
          <path d="M0 36 L20 0 L40 36 Z" fill={ink} opacity="0.45" />
          <path d="M20 0 L40 36 L40 0 Z" fill={ink} opacity="0.25" />
        </pattern>
      );
    case "weave": // 織紋：經緯交錯
      return (
        <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M0 5 H10" stroke={ink} strokeWidth="2.4" opacity="0.5" />
          <path d="M5 0 V10" stroke={ink} strokeWidth="2.4" opacity="0.35" />
        </pattern>
      );
    case "gloss": // 光澤：斜向的柔和亮帶
      return (
        <pattern id={id} width="72" height="72" patternUnits="userSpaceOnUse">
          <path d="M-20 72 L20 -8 L44 -8 L4 72 Z" fill={ink} opacity="0.35" />
          <path d="M36 72 L76 -8 L88 -8 L48 72 Z" fill={ink} opacity="0.2" />
        </pattern>
      );
    case "grain": // 顆粒：散落的細點
    default:
      return (
        <pattern id={id} width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="4" r="1.3" fill={ink} opacity="0.65" />
          <circle cx="11" cy="2" r="0.9" fill={ink} opacity="0.5" />
          <circle cx="15" cy="9" r="1.5" fill={ink} opacity="0.6" />
          <circle cx="6" cy="12" r="1" fill={ink} opacity="0.5" />
          <circle cx="13" cy="16" r="1.2" fill={ink} opacity="0.55" />
          <circle cx="1" cy="15" r="0.8" fill={ink} opacity="0.45" />
        </pattern>
      );
  }
}

/** #rrggbb → sRGB 相對亮度（0＝黑、1＝白）；認不得的格式當中間值，走預設白字 */
function luminanceOf(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.4;
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * lin((n >> 16) & 0xff) + 0.7152 * lin((n >> 8) & 0xff) + 0.0722 * lin(n & 0xff)
  );
}

/**
 * 程序化畫風色票：家族色漸層＋媒材紋理＋圖示。
 * 沒有實拍圖的畫風走這條——卡片一樣是一張看得出媒材差異的圖，而不是一塊空白灰底。
 */
export function StyleSwatch({
  asset,
  alt,
  variant,
  className,
}: {
  asset: StyleVisualAsset;
  alt: string;
  variant: "card" | "thumb";
  className?: string;
}) {
  // useId 讓同一頁多張色票的 <defs> id 不互相蓋掉（漸層／紋理都靠 url(#id) 參照）
  const uid = useId().replace(/:/g, "");
  const gradId = `sg-${uid}`;
  const patId = `sp-${uid}`;
  const size = variant === "card" ? STYLE_CARD_SIZE : STYLE_THUMB_SIZE;
  const iconSize = variant === "card" ? 40 : 22;
  // 圖示落在漸層中段：那一段偏亮（紙纖理、手作毛邊這類淺色票）就得改用深色墨，
  // 否則白圖示配淺底＝看不見
  const midLuminance = (luminanceOf(asset.color) + luminanceOf(asset.accent)) / 2;
  const inkClass = midLuminance > 0.55 ? "style-swatch__icon is-dark-ink" : "style-swatch__icon";

  return (
    <span className={`style-image style-swatch ${className ?? ""}`.trim()} role="img" aria-label={alt}>
      <svg
        viewBox={`0 0 ${size.width} ${size.height}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={asset.color} />
            <stop offset="100%" stopColor={asset.accent} />
          </linearGradient>
          {swatchTile(asset.swatch, patId, asset.color)}
        </defs>
        <rect width="100%" height="100%" fill={`url(#${gradId})`} />
        <rect width="100%" height="100%" fill={`url(#${patId})`} opacity="0.45" />
      </svg>
      <Icon name={asset.icon} size={iconSize} className={inkClass} />
    </span>
  );
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
 * 畫風圖片。有實拍圖就走 <picture>（webp 優先、jpg fallback），並且：
 * - 寬高寫死（來源尺寸），瀏覽器先保留版位，載入完不會把下面的內容推走
 * - LQIP 當底圖，載入中不是空白而是模糊色塊
 * - 載入失敗時退回程序化色票，不留破圖 icon（以前是整個收掉、只剩一塊漸層）
 * 沒有實拍圖的畫風直接畫色票。
 */
export function StyleImage({ asset, alt, variant, className, eager = false }: StyleImageProps) {
  const [failed, setFailed] = useState(false);
  if (!asset) return null;
  if (!asset.slug || failed) {
    return <StyleSwatch asset={asset} alt={alt} variant={variant} className={className} />;
  }

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
