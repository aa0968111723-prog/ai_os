# Aios 品牌資產

產品對外名稱：**Aios** · 副標：**AI 創作作業系統**

Vite 靜態根目錄為 `client/public/`，網址路徑為 `/brand/*`。

## 可直接使用

| 檔案 | 用途 |
|------|------|
| `logo-aios-color.png` | 完整橫式彩色 Logo（透明底，~720px 寬） |
| `logo-aios-color@2x.png` | Retina 2× 完整 Logo |
| `logo-aios-color-v2.png` / `logo-aios-color-v2@2x.png` | 重新製作的乾淨透明高解析正式資產；目前網站優先使用 |
| `icon-aios-v2-*.png` | 乾淨透明的高解析 A 標記；目前網站與 PWA 優先使用（`/icons/icon-v2-*.png` 由 `icon-aios-v2-1024.png` 產出） |
| `logo-aios-light.png` / `logo-aios-dark.png` | 淺／深介面（目前同彩色透明底） |
| `logo-aios-mono.png` | 單色完整 wordmark 剪影 |
| `logo-aios-color-embedded.svg` | 內嵌 WebP 的 SVG 備援（非重繪向量） |
| `icon-aios-*.png` | 前方彩色 **A** 標記（App Icon） |
| `mark-aios-mono.png` | 單色 A 標記 |
| `apple-touch-icon.png` | Apple touch |
| `source/aios-logo-original.webp` | 使用者提供裁切母版（WebP） |
| `source/aios-logo-color-cropped.png` | 去背後裁切 PNG |

PWA／favicon 另見（**現行為 v2；v1 已停用，僅為舊快取相容保留檔案**）：

- `/icons/icon-v2-96.png`、`icon-v2-192.png`、`icon-v2-512.png`、`icon-v2-1024.png` 與各自的 maskable
- `/favicon-v2-16x16.png`、`/favicon-v2-32x32.png`、`/favicon-v2.ico`
- `/apple-touch-icon-v2.png`

## 換圖示時必做（否則手機開屏會停在舊圖）

`client/public/sw.js` 會把 `/icons/*` 快取起來，`manifest.webmanifest` 決定安裝後的
App 圖示與 Android 開屏畫面。換版時：

1. 更新 `manifest.webmanifest` 的 `icons`。
2. 同步 `sw.js` 的 `PRECACHE_URLS`。
3. **一定要調高 `sw.js` 的 `CACHE_VERSION`**，舊 shell 快取才會被丟掉；漏了這步，
   已安裝的 PWA 會一直沿用舊圖示。
4. 順手檢查其他硬編路徑：`offline.html`、`InstallAppBanner.tsx`、`src-tauri/tauri.conf.json`。

`manifest.webmanifest` 在 sw 走 network-first（不是 cache-first），這樣換圖才追得上；
`/icons/*` 走 stale-while-revalidate。

Android 開屏是拿 manifest 圖示直接畫的，因此 `icon-v2-1024.png` 要在清單裡，
高 DPI 手機才會「縮小」而不是「放大」圖示。

## 元件

路徑與 `BRAND_FULL_LOGO_READY` 集中在 `client/src/brand.ts`，UI 請用 `<BrandLogo />`，勿各頁硬編。

## 來源與限制

- v1 彩色立體外觀來自使用者提供母版；v2 以母版為身分參考重製、移除米色底與外部投影，再以色鍵去背保留透明邊緣。
- `logo-aios-color-embedded.svg` 因早期僅能寫文字檔，把 WebP 內嵌於 SVG；正式介面優先用 PNG。
- App Icon 取字標前方 **A**，非整張橫式 Logo 縮小。
