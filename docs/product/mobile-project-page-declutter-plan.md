# 計畫：手機專案頁減負（UX 優先）

> 狀態：**Phase 1 Implemented**（[PR #191](https://github.com/aa0968111723-prog/ai_os/pull/191) · `feat/ux-m1-mobile-project-declutter`）  
> Phase 2／3：仍為可選後續，未開工  
> 範圍：`/p/:id` 專案頁在 **≤820px / ≤560px** 的資訊架構與預設呈現  
> 原則：**以使用者體驗為優先**——功能不刪、預設不擋路；桌機維持現況

## 1. 問題

手機開專案頁資訊量過大：

1. 首屏同時出現：標題、協作在場、交付導引、「從這裡開始」、水平 Toc
2. ① 專案上下文全展開（世界觀、角色、場景、知識、資料庫、素材、回收桶、成員）
3. 留言板在單欄下串進長頁中段，拉長「到生成框」的距離
4. 系統 `mobile-nav` 與頁內 Toc 導覽重疊

結果：真正要做的事（**直接生成**）往往要滑很久才出現。

現有 CSS 已有 ≤560px 字級／間距調整，但**沒有改資訊架構**。

## 2. 目標（可量化）

| 指標 | 目標 |
|------|------|
| 進專案 → 看到生成提示詞框 | **≤ 1～2 次滑動**（約 390×844 視窗） |
| 首屏主任務 | 基調摘要 + 創作工作台 |
| 功能完整性 | **不刪**任何能力；改預設收合／抽屜 |
| 桌機（≥821px） | **行為與版面不變**（除非共用元件無條件改動——禁止） |
| 無障礙 | 收合區可鍵盤操作；`aria-expanded` 正確 |

## 3. 非目標

- 不刪世界觀、定裝、知識庫、素材、留言、協作
- 不一次重寫 `ProjectPage.tsx` 整頁
- 不強制桌機同步收合
- 不改後端 API／權限模型
- 不做完整三 tab 資訊架構重做（屬 Phase 2，可另開 PR）

## 4. 決策原則（UX 優先）

| 優先 | 次要 |
|------|------|
| 進頁就能生成／排分鏡 | 一次秀齊所有設定 |
| 首屏乾淨、可預期 | 功能完整展開 |
| 少滑動、少選擇 | 桌機版面原樣搬到手機 |
| 需要時再打開 | 生怕找不到而全攤開 |

主線敘事（手機）：

> **基調（一行摘要）→ ② 創作工作台 → ③ 分鏡／交付**  
> 其餘進「更多／收合／sheet」

## 5. 分階段交付

### Phase 1 — 預設收合 + 留言 sheet（本計畫主交付，建議先實作）

**觸發條件：** `window.matchMedia("(max-width: 820px)")` 或既有 mobile breakpoint（與 `styles.css` 對齊，建議以 **820px** 為「單欄」界、**560px** 為「小手機」微調）。

| 區塊 | 手機預設 | 實作提示 |
|------|----------|----------|
| 「從這裡開始」 | **收合**（只留進度 `n/4` + 展開） | 覆寫 `onboardCollapsed` 預設：小螢幕預設 `true`；仍尊重使用者已寫入 localStorage 的偏好 |
| 協作在場名單 | 收成「N 人在線」chip，點開看名單／鏡像 | 不拿掉 WebSocket；只收 UI |
| 交付導引長句 | 隱藏或改成 ③ 區內一行 | 減少首屏噪音 |
| ① 角色／場景／知識／資料庫／素材／回收桶 | **預設收合**（`<details>` 或 accordion） | 摘要條 chips 仍可一鍵展開並捲到目標 |
| 世界觀主卡 | **展開**（logline + 主軸／調性／風格）；進階維持收合 | 生成依賴基調 |
| 成員權限 | 維持收合 | 已是 details |
| 留言 `MessagePanel` | **不進主長流**；右下／底欄上「留言」FAB → **bottom sheet** | 未讀 badge 掛 FAB；關閉後不佔捲動高度 |
| 水平 Toc | 可保留精簡版或僅在捲動時 sticky 三幕 | 避免與 `mobile-nav` 搶到底 |

**檔案預估：**

| 路徑 | 變更 |
|------|------|
| `client/src/pages/ProjectPage.tsx` | 小螢幕預設收合、留言 portal/sheet 狀態 |
| `client/src/components/MessagePanel.tsx`（或薄包裝） | 支援 sheet 模式 props |
| `client/src/styles.css` | `.project-page--mobile-compact`、sheet、accordion |
| 既有 collapsible 子元件（CharacterCards 等） | 可選：接受 `defaultCollapsed` prop |
| Playwright / e2e-ui | 加 390 寬：生成框在視口附近的 smoke |

**驗收（Phase 1）：**

- [x] 390×844：載入專案後，不展開任何卡即可在 1～2 滑內看到 `#gen-prompt` 或工作台主輸入 — **PR #191**
- [x] 桌機 ≥821px 版面／預設展開與現況一致 — **PR #191**
- [x] 留言可開啟 sheet 送出；未讀 badge 可見 — **PR #191**
- [x] 摘要 chip 點擊仍可展開並捲到對應區塊 — **PR #191**
- [x] 使用者若曾展開並記住偏好，重整後尊重 localStorage（若該區塊有持久化） — **PR #191**
- [x] typecheck + 相關 client 測試通過 — **PR #191 CI**

### Phase 2 — 手機三頁籤（可選，另 PR）

僅在 Phase 1 仍嫌擠時啟動：

1. **創作**（預設）— 精簡基調 + CreationWorkbench  
2. **分鏡** — SceneList／交付  
3. **更多** — 完整上下文、素材、知識、回收桶、權限  

留言維持 sheet。Toc 可併入 tab 或移除水平條。

### Phase 3 — 工作台內再減負（可選）

- 資源抽屜手機全屏 sheet  
- 四模式說明預設收合  
- 成本摘要一行展開  

## 6. 技術約束

1. **媒體查詢雙軌：** CSS 控版面；JS 控「預設 open/closed」與是否 mount 留言於 sheet（避免隱藏但仍佔 DOM 高度的坑）。
2. **勿用 `display:none` 砍掉協作/權限** 若會影響 a11y 或測試；優先 `<details open={false}>` / 條件渲染 sheet 內容。
3. **不改 tRPC 契約。**
4. **與** `docs/product/site-wide-uiux-optimization-plan.md` **對齊用語**；本文件是專案頁手機的具體切片，不取代全站計畫。
5. **回滾：** 還原前端 commit 即可；無 migration。

## 7. 風險

| 風險 | 緩解 |
|------|------|
| 使用者找不到素材／知識 | 摘要條 + 「更多上下文」明確入口；空狀態文案 |
| 留言 sheet 被 `mobile-nav` 擋住 | sheet 高度與 bottom padding 避開 nav；FAB 上移 |
| 預設收合讓新手更慌 | 保留「從這裡開始」收合列上的下一步提示一行 |
| 與 CreationWorkbench 錨點衝突 | `revealWorkbenchAnchor` 路徑回歸測一次 |

## 8. 建議 PR 拆分

| PR | 內容 | 狀態 |
|----|------|------|
| **#186** | 僅本計畫文件 | Merged |
| **UX-M1 #191** | Phase 1 實作（收合 + 留言 sheet） | **Merged** |
| UX-M2 | Phase 2 三 tab（可選） | 未開 |
| UX-M3 | 工作台內減負（可選） | 未開 |

## 9. 完成定義（計畫審過後）

- [x] 產品／開發確認 Phase 1 範圍  
- [x] 開 UX-M1 實作 PR — **[#191](https://github.com/aa0968111723-prog/ai_os/pull/191)**  
- [x] 390 與桌機雙驗收通過  
- [x] 本文件狀態改為 Phase 1 Implemented，並連到實作 PR  


## 10. 關聯

- `client/src/pages/ProjectPage.tsx` — 三幕長頁組裝  
- `client/src/app/components/MobileNavigation.tsx` — 系統底欄  
- `client/src/styles.css` — `.project-page` / `.toc-layout` 響應式  
- `docs/product/site-wide-uiux-optimization-plan.md` — 全站 UX  
- 使用者決策：以使用者體驗為優先；先出計畫再實作  
