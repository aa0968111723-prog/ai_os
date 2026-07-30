# Figma Design Library — Aios Design System

| 欄位 | 值 |
|------|-----|
| **Document ID** | FIGMA-DS-2026-07 |
| **Status** | Phase 1 完成（foundations）；Phase 2–4 待續 |
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

## 3. 已知落差（待裁決）

| # | 落差 | 現況 | 影響 |
|---|------|------|------|
| 1 | **字重 600 在 Figma 不存在** | Figma 的 Noto Sans TC 只有 Black/Bold/DemiLight/Light/Medium/Regular/Thin。`styles.css` 的按鈕與標題用 `font-weight: 600` | Text styles 暫用 Bold(700)。Medium 是 500，兩邊都不精確。P5 選定 webfont 時一併解決 |
| 2 | **網站沒有 webfont** | `--sans` 是純 system-ui fallback 堆疊，無 `@font-face`、無 Google Fonts | 每台裝置看到的字不同。Figma 端選 Noto Sans/Serif TC 是因為它**已在站內 fallback 堆疊中**，若 P5 把它正式引入 webfont，Figma 與網頁就會真正一致 |
| 3 | **觸控目標 40 vs 44** | `--touch-min: 40px`，但全站計畫 §4 要求 ≥44px | 已建成變數 `space/touch-min = 40` 保持與 code 一致；差異待產品裁決後兩邊同步 |
| 4 | **無深色模式** | `styles.css` 寫死 `color-scheme: light` | 刻意建成單一模式，不憑空造一個 code 裡不存在的 Dark mode |

## 4. 尚未進行

- **Phase 2** 檔案結構：Cover / Getting Started / Foundations 文件頁
- **Phase 3** 元件：8 個 primitives（Button/Card/Chip/Badge/Pill/Hint/EmptyState/Skeleton）
  ＋ PR #211 劇組 UI 元件（技能卡、已選 chip、待你過目橫幅、支線進度）
- **Phase 4** Code Connect 綁定與無障礙稽核

元件的視覺細節建議在使用者能親自檢視時再進行——那正是「透過 Figma 調整元件細節」的本意。
視覺依據見 `client/gallery.html`（`npm run dev` → <http://localhost:5173/gallery.html>）。
