# Empty-state illustrations (Aios ribbon)

精緻空狀態插畫：象牙底 + 3D 玻璃緞帶漸層（紅→橙→琥珀→綠→青）。

## 建議檔名（美觀 + 效能）

每個主題放：

| 檔 | 用途 |
|----|------|
| `{base}-160.webp` | 1x 主圖（約 1–3KB） |
| `{base}-320.webp` | 2x Retina |
| `{base}-160.png` | 不支援 WebP 後備 |
| `{base}-sq-512.png` | 可選：設計原稿 / 後備 |

`base` 對應 `illustrations.ts`：

- `empty-projects` — 無專案
- `empty-messages` — 無訊息
- `empty-media` — 無素材
- `ribbon-mark` — 通用緞帶標記

## 顯示

由 `EmptyIllustration` 以 `<picture>` + `srcset` 載入；CSS 類名 `.empty-illustration`。

**不要**把 UI chrome 小圖示放這裡（那些在 `Icon.tsx`）。
**不要**覆蓋 `client/public/brand/*` logo。
