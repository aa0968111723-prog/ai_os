# Figma Design Library — Aios Design System

| 欄位 | 值 |
|------|-----|
| **Document ID** | FIGMA-DS-2026-07 |
| **Status** | Phase 1–2 完成（tokens + 檔案結構與 Foundations 文件頁）；Phase 3–4 待續 |
| **Figma 檔** | [Aios Design System](https://www.figma.com/design/ZUfpFsC0YLOltnUbMYQzKo) |
| **File key** | `ZUfpFsC0YLOltnUbMYQzKo` |
| **Plan** | `team::1640375764347468262` |
| **來源真相** | `client/src/styles.css`（monastic-calm 設計語言 v2） |
| **關聯** | `docs/uiux-audit/ui-primitives-ratchet.md`、`client/src/components/ui/` |

---

## 1. 方向：Code → Figma，不是反過來

`styles.css` 是唯一真相來源，Figma 是它的可視化與可編輯介面。建立時 Figma 端是空的，
因此**零衝突需要裁決**——所有值都直接來自 code。

日後若在 Figma 改了值，必須手動同步回 `styles.css`；每個變數都帶 `var(--x)` 的 WEB code syntax，
Dev Mode 可直接讀出對應的 CSS 變數名，讓這條回路有跡可循。

## 2. Phase 1 產出（foundations）

| 集合 | 變數數 | 模式 | 說明 |
|------|--------|------|------|
| Primitives | 38 | Value | 依色相族群去重的原始色盤（`ink/` `sand/` `clay/` `healing/` `gold/` `success/` `danger/` `collab/`）。`scopes: []` 隱藏，設計師不該直接碰 |
| Color | 38 | Value | 語意層，全部 alias 到 Primitives，命名對應 CSS 變數 |
| Spacing | 10 | Value | 8pt 網格 + `touch-min` |
| Radius | 5 | Value | 4/8/12/16 + 卡片 14 |
| Typography | 12 | Value | 字級刻度 11–32 |

**Text styles（10）**：Display/H1 40 serif → Micro/狀態記號 11。字級、行高、字重逐一對應
`styles.css` 的實際規則（如 `.empty-state h3` 用 serif 18px、`body` 15px/1.6）。

**Effect styles（6）**：`Elevation/1–4` 對應 `--e1`–`--e4` 四階暖陰影（含負擴散與雙層），
`Inset/頂緣受光`、`Inset/輸入井內凹` 對應 `--hl-top`、`--inset-well`。

### 把 CSS 註解的規則編碼進 scopes

`styles.css` 用註解寫下的使用規則，在 Figma 用 scopes 變成**強制**：

| CSS 變數 | 原註解 | Figma scopes |
|---|---|---|
| `--soft` | 「裝飾線/hover 邊色 only，~3:1 不做文字」 | 只開 `STROKE_COLOR` —— 選色器裡拿不到它當文字色 |
| `--primary-solid` | 實心按鈕底 | 只開 `FRAME_FILL`/`SHAPE_FILL` |
| `--primary-ink` | 淺底上的赤陶文字 | 只開 `TEXT_FILL` |
| Primitives 全部 | — | `[]`，完全隱藏 |

稽核結果：`ALL_SCOPES` 殘留 0、缺 code syntax 0、語意色未 alias 0。

## 3. 落差狀態

| # | 落差 | 狀態 |
|---|------|------|
| 1 | 字重 600 在 Figma 的 Noto Sans TC 不存在（只有 Medium 500 / Bold 700） | **僅影響設計稿近似**。網頁已改用可變字型，600 精確可渲染，實作端無問題。Figma text styles 用 Bold 近似 |
| 2 | 網站沒有 webfont | **已解決**：self-host `@fontsource-variable/noto-sans-tc` + `noto-serif-tc`，`--sans`/`--serif` 以它打頭。Figma 與網頁現在真正同一套字 |
| 3 | 觸控目標 40 vs 計畫要求的 44 | **已解決**：`--touch-min` 提到 44 且規則移出 `@media (max-width: 820px)` 全站生效。Figma 變數 `space/touch-min` 已同步為 44 需重跑（見下方待辦） |
| 4 | 無深色模式 | **維持現狀**：`styles.css` 寫死 `color-scheme: light`，刻意建成單一模式，不憑空造 code 裡不存在的 Dark mode |

> 待辦：Figma 的 `space/touch-min` 仍是建立當時的 40，需重跑同步為 44。

## 4. Phase 2 產出（檔案結構與 Foundations 文件頁）

頁面骨架：`📕 Cover` / `🚀 Getting Started` / `——— FOUNDATIONS ———` /
`🎨 Color` / `🔤 Typography` / `📐 Spacing & Radius` / `🌗 Elevation` / `——— COMPONENTS ———`

四張 Foundations 文件頁都**綁到變數／樣式本身，不是複製的值**——改 token 文件會跟著變：

| 頁 | 內容 |
|----|------|
| 🎨 Color | 38 個語意色票依用途分九組，填色綁 Color 集合變數，每格標出對應的 `var(--x)` |
| 🔤 Typography | 10 個 text style 各配一段實際中文範例（「弘法內容創作與協作」），標字級／行高／字重與 styles.css 出處 |
| 📐 Spacing & Radius | 8pt 間距條依實際 px 等比繪製；圓角方塊四角都綁到 Radius 變數 |
| 🌗 Elevation | 六個 effect style 各一張示範卡，套用的是 style 本身 |

實作時踩到並修正的兩處：
- auto-layout 容器的**預設白底**會在暖沙頁底上露出白色橫條 → 內層一律清空 fills
- Figma 的 `lineHeight.value` 帶浮點雜訊（`112.00000476837166%`）→ 顯示前取整

## 5. 尚未進行

- **Phase 3** 元件：8 個 primitives（Button/Card/Chip/Badge/Pill/Hint/EmptyState/Skeleton）
  ＋ PR #211 劇組 UI 元件（技能卡、已選 chip、待你過目橫幅、支線進度）
- **Phase 4** Code Connect 綁定與無障礙稽核

元件的視覺細節建議在使用者能親自檢視時再進行——那正是「透過 Figma 調整元件細節」的本意。
視覺依據見 `client/gallery.html`（`npm run dev` → <http://localhost:5173/gallery.html>）。
