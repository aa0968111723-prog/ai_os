/**
 * Aios 品牌單一來源：名稱、副標、資產路徑。
 * 元件請從此檔讀取，勿在各頁硬編 logo 路徑。
 *
 * 原始彩色立體 Logo 母版尚未入庫時，mark／icon 使用現有金環作為暫代資產；
 * 完整橫式 wordmark 以文字 fallback 呈現，待原圖補入後改走 PNG。
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

/** 完整 Logo 資產（橫式 wordmark；原圖補入前可能不存在或為暫代） */
export const BRAND_LOGO_SRC: Record<BrandTone, string> = {
  color: "/brand/logo-aios-color.png",
  light: "/brand/logo-aios-light.png",
  dark: "/brand/logo-aios-dark.png",
  monochrome: "/brand/logo-aios-mono.png",
};

/**
 * 品牌標記（A 標／暫代金環）。
 * PWA／favicon 沿用既有 /icons/* 路徑；元件與文件用 /brand/*。
 */
export const BRAND_MARK_SRC: Record<BrandTone, string> = {
  color: "/brand/icon-aios-512.png",
  light: "/brand/icon-aios-512.png",
  dark: "/brand/icon-aios-512.png",
  monochrome: "/brand/mark-aios-mono.png",
};

/** 原圖補入前：full 變體以文字 wordmark 為主，不把正方形 mark 當橫式 Logo 硬縮 */
export const BRAND_FULL_LOGO_READY = false;

export const BRAND_SIZE_PX: Record<BrandSize, { mark: number; fullHeight: number }> = {
  xs: { mark: 16, fullHeight: 20 },
  sm: { mark: 22, fullHeight: 28 },
  md: { mark: 32, fullHeight: 36 },
  lg: { mark: 48, fullHeight: 56 },
  hero: { mark: 72, fullHeight: 88 },
};
