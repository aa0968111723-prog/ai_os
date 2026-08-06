/**
 * Aios 品牌單一來源：名稱、副標、資產路徑。
 * 元件請從此檔讀取，勿在各頁硬編 logo 路徑。
 *
 * 資產位於 client/public/brand/（Vite 以 /brand/* 提供）。
 * 見 client/public/brand/README.md。
 */

export const BRAND_NAME = "Aios";
export const BRAND_TAGLINE = "AI 創作作業系統";
/** 瀏覽器 tab / PWA 短名 */
export const BRAND_SHORT_NAME = "Aios";
/** 可讀完整標題（tab / splash aria） */
export const BRAND_TITLE = `${BRAND_NAME} · ${BRAND_TAGLINE}`;

export type BrandVariant = "full" | "mark";
export type BrandTone = "color" | "light" | "dark" | "monochrome";
export type BrandSize = "xs" | "sm" | "md" | "lg" | "hero";

/** 完整 Logo 資產（橫式 wordmark） */
export const BRAND_LOGO_SRC: Record<BrandTone, string> = {
  color: "/brand/logo-aios-color-v2.png",
  light: "/brand/logo-aios-color-v2.png",
  dark: "/brand/logo-aios-color-v2.png",
  monochrome: "/brand/logo-aios-mono.png",
};

/** 手機用完整 Logo（1080w WebP，62KB）：landing hero 在手機是 LCP 元素，
 *  DPR 2-3 的 srcSet 會抓 535KB 的 @2x PNG——<picture> 的 ≤820 source 走這張。 */
export const BRAND_LOGO_SRC_MOBILE = "/brand/logo-aios-color-v2-1080.webp";

/** Retina 用 2× 完整 Logo（僅 color；其餘 tone 回退 1×） */
export const BRAND_LOGO_SRC_2X: Partial<Record<BrandTone, string>> = {
  color: "/brand/logo-aios-color-v2@2x.png",
  light: "/brand/logo-aios-color-v2@2x.png",
  dark: "/brand/logo-aios-color-v2@2x.png",
};

/**
 * 品牌標記（前方彩色 A）。
 * PWA／favicon 沿用既有 /icons/* 路徑；元件與文件用 /brand/*。
 */
export const BRAND_MARK_SRC: Record<BrandTone, string> = {
  color: "/brand/icon-aios-v2-512.png",
  light: "/brand/icon-aios-v2-512.png",
  dark: "/brand/icon-aios-v2-512.png",
  monochrome: "/brand/mark-aios-mono.png",
};

/** 完整橫式彩色 Logo 已就緒（來自使用者母版裁切） */
export const BRAND_FULL_LOGO_READY = true;

/**
 * 完整 Logo 寬高比（v2 透明高解析資產為 720×316）。
 * 用於固定尺寸、避免 CLS。
 */
export const BRAND_FULL_ASPECT = 720 / 316;

export const BRAND_SIZE_PX: Record<BrandSize, { mark: number; fullHeight: number }> = {
  xs: { mark: 18, fullHeight: 18 },
  sm: { mark: 24, fullHeight: 26 },
  md: { mark: 32, fullHeight: 34 },
  lg: { mark: 48, fullHeight: 52 },
  hero: { mark: 88, fullHeight: 72 },
};
