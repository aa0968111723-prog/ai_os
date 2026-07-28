# Aios 品牌資產

產品對外名稱：**Aios** · 副標：**AI 創作作業系統**

Vite 靜態根目錄為 `client/public/`，網址路徑為 `/brand/*`。

## 可直接使用

| 檔案 | 用途 |
|------|------|
| `logo-aios-color.png` | 完整橫式彩色 Logo（透明底，~720px 寬） |
| `logo-aios-color@2x.png` | Retina 2× 完整 Logo |
| `logo-aios-light.png` / `logo-aios-dark.png` | 淺／深介面（目前同彩色透明底） |
| `logo-aios-mono.png` | 單色完整 wordmark 剪影 |
| `logo-aios-color-embedded.svg` | 內嵌 WebP 的 SVG 備援（非重繪向量） |
| `icon-aios-*.png` | 前方彩色 **A** 標記（App Icon） |
| `mark-aios-mono.png` | 單色 A 標記 |
| `apple-touch-icon.png` | Apple touch |
| `source/aios-logo-original.webp` | 使用者提供裁切母版（WebP） |
| `source/aios-logo-color-cropped.png` | 去背後裁切 PNG |

PWA／favicon 另見：

- `/icons/icon-192.png`、`icon-512.png`、maskable、`icon-96.png`
- `/favicon-16x16.png`、`/favicon-32x32.png`、`/favicon.ico`
- `/apple-touch-icon.png`

## 元件

路徑與 `BRAND_FULL_LOGO_READY` 集中在 `client/src/brand.ts`，UI 請用 `<BrandLogo />`，勿各頁硬編。

## 來源與限制

- 彩色立體外觀來自使用者提供母版，**未**重新描繪或改字樣。
- `logo-aios-color-embedded.svg` 因早期僅能寫文字檔，把 WebP 內嵌於 SVG；正式介面優先用 PNG。
- App Icon 取字標前方 **A**，非整張橫式 Logo 縮小。
