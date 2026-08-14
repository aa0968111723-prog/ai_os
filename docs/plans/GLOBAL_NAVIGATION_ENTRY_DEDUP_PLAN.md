# 全站導覽與入口去重計畫

> 狀態：Draft plan，待審查後分階段實作  
> 日期：2026-08-14  
> 範圍：專案外的全站殼層、今日頁、筆記排程、更多、帳號選單、全站訊息入口  
> 明確排除：`/p/:id` 專案故事工作台與 PR #730 的實作範圍  
> 原則：功能不刪、資料不搬空、舊路徑不失效；先減少入口，再驗證可達性

## 1. 決策摘要

Aios 的問題不是功能不足，而是同一件事在不同位置重複出現：

- 手機底欄已有「筆記排程」，今日頁又有「安排今天」。
- 今日頁有「整理資料」，更多又有「資料中心」。
- 私訊同時存在於更多、全站浮動私訊球、未讀角標與團隊協作區。
- 「動畫創作室」既是獨立入口，又與專案內動畫製作流程重疊。
- 「怎麼用」與「模型指南」被拆成兩個全站目的地。
- 「共用下載」是獨立目的地，但內容本質屬於資料或說明。
- 頭像選單同時承擔身份、點數、管理、設定、安全、裝置與登出，手機需要長距離捲動。
- 頂欄、底欄、浮動按鈕與頁內 CTA 同時搶主操作。

本計畫把全站資訊架構收斂為：

1. 手機底欄只保留「今天、專案、AI 助手、更多」。
2. 今天頁負責「現在最該做什麼」，不是再做一層功能目錄。
3. 更多只收低頻全站目的地，不再把所有頁面平鋪。
4. 頭像選單只處理「我是誰、我的帳號、我能管理什麼」。
5. 全站私訊只有一個主要入口；專案留言仍保留為情境功能。
6. 舊 route、deep link、資料、權限與真實能力全部保留相容轉接。

## 2. 與既有規格的關係

本文件是「全站殼層與入口所有權」的專項規格，優先於舊文件中與下列項目衝突的敘述：

- 手機底部導覽項目
- 今日頁快捷入口
- `/planner` 的三合一首層呈現
- More sheet 的目的地清單
- Account menu 的第一層內容
- 全站私訊浮動入口

仍需遵守：

- `docs/product/site-wide-uiux-optimization-plan.md` 的品牌、觸控、跨裝置與無障礙原則。
- `docs/data-hub-current-state-2026-08.md` 的資料中心 ACL 與資料狀態不變式。
- 現有 route、權限、PWA、通知、Google Calendar、下載與協作契約。
- PR #730 僅負責專案內故事工作台，本計畫不得修改其核心流程。

## 3. 現況證據與入口所有權

| 現況 | 真正所有者 | 新呈現 | 不可破壞 |
| --- | --- | --- | --- |
| 底欄「筆記排程」＋今日「安排今天」 | 今天 | 今天頁內「今日安排」；`/planner` 保留進階相容頁 | 日曆、清單、Google Calendar、ICS |
| 今日「整理資料」＋更多「資料中心」 | 資料中心 | More 保留一個「資料中心」入口；今日不再重複 | Data Hub ACL、匯入、綁定與 AI 可讀寫界線 |
| Planner 的「知識地圖」 | 資料中心 | 由資料中心承接首要入口；舊 anchor reveal/redirect | 現有資料與節點關聯 |
| Planner 的專案筆記／決議 | 專案情境 | 專案內顯示；群組層筆記保留進階可達 | 既有 Note IDs、權限與連結 |
| More「動畫創作室」 | 專案創作情境 | 不再當全站一級入口；以進階工具或專案情境進入 | `/studio`、白板、順序分鏡能力與 deep link |
| More「靈感頻道」 | AI 助手／資料 | 整合為 AI 助手的靈感／提示詞入口；舊路徑相容 | 社群內容、分享與權限 |
| More「怎麼用」＋「模型指南」 | 說明中心 | 合併為一個「說明中心」目的地與內部分頁 | `/help`、`/models` deep link |
| More「共用下載」 | 資料／說明 | 收入資料中心或進階工具 | `/downloads` 與實際下載功能 |
| More 私訊＋浮動私訊球 | 全站訊息 | 一個主要入口＋未讀狀態 | `/chat`、通知、未讀與對話資料 |
| 專案 `MessagePanel` | 情境留言 | 留在專案／物件情境，不與私訊合併 | 標注、mention、轉筆記／任務／決議 |
| 頭像長選單 | 帳號 | 精簡第一層；安全與資料動作進設定頁 | 改密碼、裝置、匯出、登出所有裝置 |

## 4. 目標資訊架構

### 4.1 手機底欄

固定四個主入口：

1. **今天** — `/dashboard`
2. **專案** — 保留現有 `/dashboard#projects` 相容行為；若未來有獨立 route 再單獨決策
3. **AI 助手** — 現有中央入口與真實 Global Assistant
4. **更多** — 低頻目的地 sheet

移除「筆記排程」作為底欄一級入口，但不得刪除 `/planner`。

規則：

- 目前所在 route 必須有正確 active state。
- 觸控目標至少 44×44px。
- 鍵盤、螢幕閱讀器與 PWA safe area 不退化。
- AI 助手與主要導覽不能覆蓋頁面 CTA。
- More 的未讀角標只能代表可理解的未讀狀態，不能出現無標籤的「0」。

### 4.2 今天頁

今天頁回答一個問題：「我現在先做什麼？」

由上而下：

1. 精簡問候與必要狀態。
2. 一個「下一步」主操作：依狀態顯示繼續最近專案、處理待核或完成今日安排。
3. 今日安排：近期行程、工作清單、到期項目；可展開完整排程。
4. 團隊待處理：新討論、未解標注、待核等摘要。
5. 繼續創作：最近專案。
6. 專案列表與一個精簡「建立專案」入口。

移除：

- `daily-quick-links` 中重複的「安排今天、整理資料、聯絡夥伴」。
- 同一畫面兩個同等權重的「建立新專案」。
- 只把人送往其他功能頁、但沒有狀態價值的快捷卡。

### 4.3 筆記與排程

`/planner` 不刪除，但不再是三個不同產品的混合首頁。

所有權：

- **組排程**：由今天頁承接摘要與主入口；`/planner` 可保留進階清單／月曆管理。
- **專案筆記與決議**：以專案為情境時由專案內承接；群組層資料仍由既有進階頁可達。
- **知識地圖**：由資料中心承接主要入口與導覽名稱。
- **Google Calendar／ICS**：原能力與 callback 不變。

舊 `/planner`、query、hash、anchor 必須能導向或 reveal 正確內容，不可出現 404 或靜默失效。

### 4.4 更多

More sheet 是低頻目的地，不是「底欄塞不下的全部功能」。

第一層建議只顯示：

- 資料中心
- 私訊
- 說明中心
- 進階工具（依角色／裝置／能力顯示）

「進階工具」內可以包含：

- 動畫創作室相容入口
- 外部服務／整合
- MCP 或模型連線
- 共用下載

規則：

- 不因入口收合而刪 route 或取消權限檢查。
- 未安裝／無權限功能不顯示，或明確唯讀，不做死按鈕。
- 將 `mobile-more-sheet__grip` 視為手勢控制，不得直接移除 swipe-to-dismiss；只把它改成標準、低噪音的拖曳把手。
- 移除「底下分頁列放不下的頁面都在這裡」等架構說明。
- sheet 開啟時焦點陷阱、Escape、返回鍵、scroll lock 與 swipe dismissal 必須可靠。

### 4.5 頭像與帳號

手機第一層只保留：

- 身份／角色
- 點數一行摘要與「查看明細」
- 個人設定
- 有權限時才顯示「管理」
- 登出

移入 `/settings` 的安全／隱私區：

- 改密碼
- 通知設定
- 連結手機與電腦／裝置
- 匯出個人資料
- 登出全部裝置

管理入口以 capability 控制，收在一個「管理」群組，不把通訊錄、紀錄、團隊管理永遠攤開。

移除「其他頁面請按最底下更多」這類教學文字，讓選單本身可理解。

### 4.6 頂欄與訊息

頂欄只保留持續有價值的全站狀態：

- 品牌／目前團隊
- 必要待辦或核准狀態
- 點數摘要
- 帳號

要求：

- 無語意的零值徽章隱藏。
- 圖示必須有可理解 label／tooltip／accessible name。
- 點數明細只保留一個權威入口。
- `FloatingDmBubble` 不再全站常駐；全站私訊以 More 或明確訊息入口承接，並保留未讀提示。
- `MessagePanel` 是專案／物件留言，繼續留在情境中。
- AI 助手、私訊、留言三者名稱與 icon 不得互相混用。

## 5. Route 與資料相容層

下列路徑必須保留可達：

- `/dashboard`
- `/dashboard#projects`
- `/planner`
- `/databases`
- `/studio`
- `/community`
- `/chat`
- `/help`
- `/models`
- `/downloads`
- `/settings`

相容方式可使用 route redirect、內部分頁或 reveal event，但必須：

1. 保留 query/hash 中的選取狀態。
2. 使用瀏覽器返回後回到合理位置。
3. 不建立第二份資料或 UI 專用複製表。
4. 不更動既有 ID、ACL、通知、未讀、點數與資料狀態。
5. 重新整理後仍可由持久資料還原。
6. 不以「即將推出」或 placeholder 取代原功能。

## 6. 實作分解：四個可審查 Draft PR

所有實作 PR 都從最新 default branch 開始或採清楚的 stacked base；不得自行 merge。

### PR 1：導覽契約與四項底欄

建議分支：`agent/global-nav-01-contract`

- 更新 `navigationItems.ts` 的目的地所有權。
- `MobileNavigation` 改為今天、專案、AI 助手、更多。
- 保留 `/planner` route 與 deep link。
- More 暫保功能完整，只先調整群組契約。
- 補 active state、a11y、safe area、swipe 與 route regression。
- 先處理／rebase 開放 PR #683 的 `MobileNavigation.test.tsx` 衝突。

### PR 2：今天頁與排程整合

建議分支：`agent/global-nav-02-today-planner`

- 移除 `Launchpad` 重複 quick links。
- 建立單一下一步主操作。
- 將 Schedule 摘要接入今天頁，保留完整 `/planner`。
- 合併重複建立專案 CTA。
- 保留團隊協作與最近專案真實資料。
- 協調 PR #610 對 `Launchpad` 卡片結構的修改，不覆蓋其 a11y 修復。

### PR 3：More、Account、Header 與訊息去重

建議分支：`agent/global-nav-03-shell-dedup`

- More 改為低頻目的地與進階工具。
- Account menu 精簡第一層；安全動作移入 Settings 現有能力。
- 隱藏無語意零值與重複點數入口。
- 移除全站常駐 `FloatingDmBubble`，保留 `/chat`、未讀與通知。
- 專案 `MessagePanel` 不變。
- 驗證 overlay z-index、keyboard、focus trap、back 與 swipe。

### PR 4：資料、說明與舊入口歸位

建議分支：`agent/global-nav-04-destination-consolidation`

- 知識地圖的主要入口歸資料中心。
- 怎麼用與模型指南合併成說明中心導覽。
- 靈感頻道歸 AI 助手／提示詞脈絡。
- 下載與動畫創作室改為進階／情境入口。
- 保留所有既有 routes、權限與真功能。
- 加 route/deep-link compatibility 與 browser evidence。

## 7. 開始前與中斷續跑

實作者必須先檢查：

- `git status -sb`
- `git remote -v`
- `git fetch --all --prune`
- `gh auth status`
- 本計畫 PR 的描述與完整 diff
- 所有會碰 `MobileNavigation`、`Launchpad`、`PlannerPage`、`AccountMenu`、`AppShell` 的 open PR
- repository instructions 與 `AGENTS.md`

建立進度日誌：

`docs/implementation/global-navigation-entry-dedup-progress.md`

至少記錄 base SHA、階段、checkbox、最後成功 commit、分支／PR、測試、baseline failure、introduced failure、下一個精確操作與真正 blocker。

每完成一個可驗證段落：

1. 更新日誌。
2. 檢查 diff。
3. 跑相關測試。
4. 小 commit。
5. push。
6. 更新 Draft PR。
7. 繼續下一段。

中斷恢復時先讀日誌、git status、最近 commits、遠端 branch 與 PR checks，從第一個未完成 checkbox 繼續，不從頭重做。

## 8. 驗證矩陣

每個實作 PR至少執行變更相關 targeted tests，再執行 repository 可用的：

- `npm run typecheck`
- `npm run check:boundaries`
- `npm run check:ui-primitives`
- `npm run check:hooks`
- `npm test`
- `npm run test:client`
- `npm run build`

瀏覽器實測：

- 390×844
- 430×932
- 768×1024
- 1280×800
- 1440×900

保存截圖與量測到：

`docs/evidence/global-navigation-entry-dedup/`

必驗流程：

1. 今天 → 今日安排 → 回到今天。
2. 今天 → 最近專案。
3. 底欄 → 專案列表。
4. AI 助手開啟／關閉，內容不被遮住。
5. More → 資料中心／私訊／說明中心／進階工具。
6. 頭像 → 設定／管理（有權限時）／登出。
7. 舊 `/planner`、`/models`、`/downloads`、`/community`、`/studio` deep links。
8. 私訊未讀、通知與返回。
9. PWA standalone safe area、軟鍵盤、sheet swipe。
10. 讀者／一般成員／管理員不同權限下的可達性。

失敗分類：

- PASS
- BASELINE_EXISTING_FAILURE
- INTRODUCED_BY_THIS_PR
- BLOCKED_BY_ENVIRONMENT

所有 introduced failures 修復後才能進下一層。

## 9. 安全界線

禁止：

- 修改 PR #730 的專案故事工作台核心。
- 刪除真實資料或 schema。
- 為去重而關閉 route、API、ACL 或通知。
- 用 placeholder、假按鈕或未接線轉址代替真功能。
- 把資料中心狀態簡化為錯誤的「有／沒有」。
- 把專案留言和私訊合併為同一資料模型。
- 無相容層的破壞性 migration。
- force push、auto-merge、跳過／弱化測試。
- 大規模重寫無關頁面。
- 宣稱未執行的測試已通過。

只有不可逆資料刪除、無法相容的破壞性 migration、必要 secret 缺失、需求真正互斥、實際付費或對外發布才停下請示。

## 10. Definition of Done

- 手機底欄只有今天、專案、AI 助手、更多。
- 今天頁不再重複「安排今天、整理資料、聯絡夥伴」目的地。
- 今天頁只有一個明確下一步與一個建立專案入口。
- 排程摘要在今天可用，完整排程仍可達。
- 知識地圖以資料中心為主要入口。
- More 不再平鋪所有功能。
- 頭像第一層不需長捲動即可完成主要帳號動作。
- 全站私訊只有一個主要入口；專案留言仍在情境中。
- 無語意零值與重複浮動入口移除。
- 舊 routes、deep links、權限與真實功能全部可達。
- 390px 手機無水平溢位，重要觸控區至少 44px。
- header、bottom nav、AI 助手與 sheet 不遮住主內容。
- 沒有新 schema、第二套資料來源、假按鈕或 placeholder。
- 所有 introduced test failures 已修復。
- 四個 Draft PR、進度日誌與 browser evidence 完整。
