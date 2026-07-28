# Aios 品牌資產

產品對外名稱：**Aios** · 副標：**AI 創作作業系統**

## 現況（issue #139）

原始彩色立體 `Aios` Logo 母版**尚未**加入本 repo。

目前入庫的 PNG 為**暫代資產**（沿用既有金環 mark），用途是：

1. 打通 `BrandLogo` 路徑與 PWA／favicon 尺寸，避免 404
2. 讓元件／manifest 可獨立 build 與測試
3. **不是**最終品牌造型——補入原圖後應重新裁切並覆蓋下列檔案

## 尚待補入

| 檔案 | 說明 |
|------|------|
| `source/aios-logo-original.png` | 使用者提供的母版（含留白亦可） |
| `logo-aios-color.png` | 完整橫式彩色 Logo、透明底、裁掉大面積留白 |
| `logo-aios-light.png` | 淺色介面可用 |
| `logo-aios-dark.png` | 深色介面可用 |
| `logo-aios-mono.png` | 單色完整 wordmark |
| `icon-aios-*.png` | 以前方彩色 **A** 為標記（非整張橫式 Logo 縮小） |
| `mark-aios-mono.png` | 單色 A 標記 |

補入後請將 `client/src/brand.ts` 的 `BRAND_FULL_LOGO_READY` 設為 `true`，並更新對應路徑。

## 路徑慣例

- 元件與文件：`/brand/*`
- PWA／快捷方式：既有 `/icons/icon-*.png`（與 manifest 對齊，避免重複路徑）
- favicon：`/favicon-16x16.png`、`/favicon-32x32.png`、`/favicon.ico`
- Apple touch：`/apple-touch-icon.png` 與 `/brand/apple-touch-icon.png`
