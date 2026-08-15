import {
  BRAND_FULL_ASPECT,
  BRAND_FULL_LOGO_READY,
  BRAND_LOGO_SRC,
  BRAND_LOGO_SRC_2X,
  BRAND_LOGO_SRC_MOBILE,
  BRAND_MARK_SRC,
  BRAND_NAME,
  BRAND_SIZE_PX,
  BRAND_TAGLINE,
  type BrandSize,
  type BrandTone,
  type BrandVariant,
} from "../brand";
import { useMatchMedia } from "../lib/useMatchMedia";

export type BrandLogoProps = {
  variant?: BrandVariant;
  tone?: BrandTone;
  size?: BrandSize;
  /** 預留給 BrandReveal／外層動畫；元件本身不自動播 */
  animated?: boolean;
  showTagline?: boolean;
  className?: string;
  /**
   * 裝飾用途（側欄圖示旁已有文字）時設 true：不掛可讀 alt，改 aria-hidden。
   * 預設 false：提供「Aios」alt。
   */
  decorative?: boolean;
  /**
   * 頂欄等窄位：桌面顯示 full、小螢幕自動切 mark（CSS）。
   * 需同時掛 `.brand-logo--responsive` 樣式。
   */
  responsive?: boolean;
  /** hero／首屏優先載入 */
  priority?: boolean;
};

/**
 * 品牌 Logo 單一入口。路徑集中在 `client/src/brand.ts`。
 * - mark：方型標記（favicon／頂欄窄位／收合）
 * - full：完整橫式 Logo；原圖未就緒時用 mark + 文字 wordmark
 */
export function BrandLogo({
  variant = "full",
  tone = "color",
  size = "md",
  animated: _animated = false,
  showTagline = false,
  className = "",
  decorative = false,
  responsive = false,
  priority = false,
}: BrandLogoProps) {
  // 與 styles.css 463 行的斷點一致：≤560 時 responsive logo 只「顯示」mark。
  // 但 display:none 的 <img> 照樣下載（524KB @2x 全幅 PNG）——手機乾脆不渲染那顆 img。
  const compactBrand = useMatchMedia("(max-width: 560px)");
  const dims = BRAND_SIZE_PX[size];
  const markSrc = BRAND_MARK_SRC[tone];
  const logoSrc = BRAND_LOGO_SRC[tone];
  const logo2x = BRAND_LOGO_SRC_2X[tone];
  const alt = decorative ? "" : BRAND_NAME;
  const ariaHidden = decorative || undefined;
  const loading = priority ? "eager" : "lazy";
  const fetchPriority = priority ? "high" : undefined;

  if (variant === "mark") {
    return (
      <img
        className={`brand-logo brand-logo--mark brand-logo--${size} brand-logo--tone-${tone} ${className}`.trim()}
        src={markSrc}
        alt={alt}
        width={dims.mark}
        height={dims.mark}
        draggable={false}
        aria-hidden={ariaHidden}
        decoding="async"
        loading={loading}
        {...(fetchPriority ? { fetchPriority } : {})}
      />
    );
  }

  // 完整 Logo 原圖就緒：單張橫式 PNG
  if (BRAND_FULL_LOGO_READY) {
    const height = dims.fullHeight;
    const width = Math.round(height * BRAND_FULL_ASPECT);
    const fullLabel = showTagline ? `${BRAND_NAME} · ${BRAND_TAGLINE}` : BRAND_NAME;
    const srcSet = logo2x ? `${logoSrc} 1x, ${logo2x} 2x` : undefined;

    return (
      <span
        className={[
          "brand-logo",
          "brand-logo--full",
          "brand-logo--img",
          `brand-logo--${size}`,
          `brand-logo--tone-${tone}`,
          responsive ? "brand-logo--responsive" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : fullLabel}
        aria-hidden={ariaHidden}
      >
        {/* 窄螢幕：只顯示 A 標記，避免橫式 Logo 擠壓頂欄 */}
        {responsive ? (
          <img
            className="brand-logo__mark-fallback"
            src={markSrc}
            alt=""
            width={dims.mark}
            height={dims.mark}
            draggable={false}
            aria-hidden
            decoding="async"
            loading={loading}
          />
        ) : null}
        {/* ≤560 的 responsive：full-img 被 CSS display:none 但仍會下載整張 524KB @2x PNG——
            直接不渲染（桌機與 >560 的 DOM 維持原狀；斷點放大時 useMatchMedia 會補渲染） */}
        {responsive && compactBrand ? null : (
          /* <picture>＝透明容器（display:contents 保證版面不變）：
             <768 命中 WebP source（62KB，landing hero 在手機是 LCP 元素）；
             桌機不命中 media → 走原本 img src/srcSet，選圖位元不變 */
          <picture style={{ display: "contents" }}>
            {logo2x && <source media="(max-width: 820px)" type="image/webp" srcSet={BRAND_LOGO_SRC_MOBILE} />}
            <img
              className="brand-logo__full-img"
              src={logoSrc}
              srcSet={srcSet}
              alt=""
              width={width}
              height={height}
              draggable={false}
              aria-hidden
              decoding="async"
              loading={loading}
              {...(fetchPriority ? { fetchPriority } : {})}
            />
          </picture>
        )}
        {showTagline ? (
          <span className="brand-logo__tagline" aria-hidden>
            {BRAND_TAGLINE}
          </span>
        ) : null}
      </span>
    );
  }

  // 暫代：標記 + 文字 wordmark（不仿造立體 Logo）
  return (
    <span
      className={`brand-logo brand-logo--full brand-logo--wordmark brand-logo--${size} brand-logo--tone-${tone} ${className}`.trim()}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : showTagline ? `${BRAND_NAME} · ${BRAND_TAGLINE}` : BRAND_NAME}
      aria-hidden={ariaHidden}
    >
      <img
        className="brand-logo__mark-img"
        src={markSrc}
        alt=""
        width={dims.mark}
        height={dims.mark}
        draggable={false}
        aria-hidden
        decoding="async"
        loading={loading}
      />
      <span className="brand-logo__text">
        <span className="brand-logo__name">{BRAND_NAME}</span>
        {showTagline ? <span className="brand-logo__tagline">{BRAND_TAGLINE}</span> : null}
      </span>
    </span>
  );
}
