import {
  BRAND_FULL_ASPECT,
  BRAND_FULL_LOGO_READY,
  BRAND_LOGO_SRC,
  BRAND_MARK_SRC,
  BRAND_NAME,
  BRAND_SIZE_PX,
  BRAND_TAGLINE,
  type BrandSize,
  type BrandTone,
  type BrandVariant,
} from "../brand";

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
};

/**
 * 品牌 Logo 單一入口。路徑集中在 `client/src/brand.ts`。
 * - mark：方型標記（favicon／頂欄／收合）
 * - full：完整品牌；原圖未就緒時用 mark + 文字 wordmark，避免把方圖硬縮成橫式 Logo
 */
export function BrandLogo({
  variant = "full",
  tone = "color",
  size = "md",
  animated: _animated = false,
  showTagline = false,
  className = "",
  decorative = false,
}: BrandLogoProps) {
  const dims = BRAND_SIZE_PX[size];
  const markSrc = BRAND_MARK_SRC[tone];
  const logoSrc = BRAND_LOGO_SRC[tone];
  const alt = decorative ? "" : BRAND_NAME;
  const ariaHidden = decorative || undefined;

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
      />
    );
  }

  // 完整 Logo 原圖就緒：單張橫式 PNG
  if (BRAND_FULL_LOGO_READY) {
    const height = dims.fullHeight;
    // 實圖約 1.97:1；固定高度避免 CLS
    const width = Math.round(height * BRAND_FULL_ASPECT);
    const fullLabel = showTagline ? `${BRAND_NAME} · ${BRAND_TAGLINE}` : BRAND_NAME;
    return (
      <span
        className={`brand-logo brand-logo--full brand-logo--img brand-logo--${size} brand-logo--tone-${tone} ${className}`.trim()}
        style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : fullLabel}
        aria-hidden={ariaHidden}
      >
        <img
          src={logoSrc}
          alt=""
          width={width}
          height={height}
          draggable={false}
          aria-hidden
          decoding="async"
          style={{ width, height, objectFit: "contain" }}
        />
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
      />
      <span className="brand-logo__text">
        <span className="brand-logo__name">{BRAND_NAME}</span>
        {showTagline ? <span className="brand-logo__tagline">{BRAND_TAGLINE}</span> : null}
      </span>
    </span>
  );
}
