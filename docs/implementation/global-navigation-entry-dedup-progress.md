# 全站導覽與入口去重 — 實作進度

> 中斷後第一件事：讀本檔 → `git status -sb` → `git log --oneline --decorate -20` → 遠端分支與 PR → 從第一個未完成 checkbox 繼續。禁止從頭重做。

## 任務與規格來源

- 產品目標：減少專案外 UX 重複入口，手機底欄只留「今天、專案、AI 助手、更多」，保留全部真功能、資料、權限與舊路徑。
- 規格：Draft PR #732（已於 2026-08-14 合併）`docs/plans/GLOBAL_NAVIGATION_ENTRY_DEDUP_PLAN.md`
- 仍遵守：`docs/product/site-wide-uiux-optimization-plan.md`、`docs/data-hub-current-state-2026-08.md`
- 明確排除：`/p/:id` 故事工作台、PR #730 實作、生成後端、新 schema
- 衝突意識：不得覆蓋 PR #683（MobileNavigation U10 CSS 契約）與 PR #610（Launchpad 專案卡 a11y 解耦）

## Base

| 項 | 值 |
| --- | --- |
| 預設分支 | `claude/healing-migration-ai-os-erewp2` |
| Base SHA | `4e3a782a752c3e2b7f640a832cd531939a677c40`（#732 合入後的 default） |
| #732 | **已合併**（2026-08-14T08:03:31Z），不再以 plan branch 為 base |

## 現在階段

**PR 4 實作完成、準備 targeted tests／Draft PR：資料、說明與舊入口歸位**

## 四個實作 PR checklist

### PR 1 — 導覽契約與四項底欄

- 分支：`cursor/global-nav-01-contract-32e8`
- Base：`claude/healing-migration-ai-os-erewp2` @ `4e3a782a`
- PR：https://github.com/aa0968111723-prog/ai_os/pull/737
- HEAD：`e163cc33181ba9b0a13149f738608c856ee93f30`
- 狀態：已被合併（非本任務自行 merge）

- [x] 手機底欄只留：今日、專案、AI 助手、更多
- [x] 移除「筆記排程」作為底欄一級入口
- [x] 保留 `/planner` route、query、hash 與 deep link
- [x] `/planner` 時 More 為 active
- [x] 更新 `navigationItems.ts` 目的地所有權與 More 群組契約
- [x] 保留中央 AI 助手真實能力
- [x] 保留 PWA safe area、鍵盤 `--kb-inset`、swipe sheet
- [x] 觸控區 ≥ 44×44；底欄改 4 欄
- [x] 納入 #683 U10 CSS 契約測試
- [x] targeted / typecheck / boundaries / ui-primitives / hooks / test / test:client / build

### PR 2 — 今天頁與排程整合

- 分支：`cursor/global-nav-02-today-planner-32e8`（以 PR 1 head `e163cc33` 為 base）
- PR：https://github.com/aa0968111723-prog/ai_os/pull/738（Draft）
- HEAD：`1ef3fddf`
- [x] 移除 daily-quick-links 重複的安排今天／整理資料／聯絡夥伴
- [x] 單一「下一步」主操作
- [x] 今日安排接入既有 `schedule.list`
- [x] 合併重複建立專案 CTA
- [x] `/planner` 完整清單／月曆／Google Calendar／ICS 仍可用
- [x] 套用 #610 Launchpad 專案卡 a11y
- [x] targeted tests PASS
- [x] commit / push / Draft PR
- [x] typecheck / boundaries / ui-primitives / hooks / `npm test` PASS
- [ ] 本機 `test:client` / `build`（CI build 已 SUCCESS；test job 當時仍 IN_PROGRESS）

### PR 3 — More、Account、Header 與訊息去重

- 分支：`cursor/global-nav-03-shell-dedup-32e8`（以 PR 2 head `1ef3fddf` 為 base）
- PR：https://github.com/aa0968111723-prog/ai_os/pull/739（Draft）
- HEAD：`392401c5df3990f5cc3a9454715fc3a9714b9e27`
- [x] More 第一層：資料中心、私訊、說明中心、進階工具
- [x] Account 第一層：身份、點數一行、設定、有權限才顯示管理、登出
- [x] 安全／裝置／匯出移入 Settings
- [x] 移除全站常駐 FloatingDmBubble；More 顯示未讀
- [x] 專案 MessagePanel 不變
- [x] Header 隱藏無語意零值；icon 有 accessible name
- [x] More sheet swipe / Escape / 返回 / focus trap 保留
- [x] targeted tests：28 passed
- [x] typecheck / boundaries / ui-primitives / hooks PASS
- [x] commit / push / Draft PR
- [x] `npm test` 2934 passed（PR 3 上已跑）
- [ ] 本機 `test:client` / `build`

### PR 4 — 資料、說明與舊入口歸位

- 分支：`cursor/global-nav-04-destination-consolidation-32e8`（以 PR 3 head `392401c5` 為 base）
- [x] 知識地圖以資料中心為主要入口（同一套 `knowledgeMap.graph` / `KnowledgeMapCard`）
- [x] 怎麼用＋模型指南合併為說明中心（`/help`、`/models` 相容）
- [x] 靈感頻道歸 AI 助手／提示詞脈絡（`/community` 仍是真頁）
- [x] 共用下載歸資料中心（`#hub-downloads`）與進階工具；`/downloads` 仍是真頁
- [x] `/studio` 仍可達，不再是全站一級（頂欄溢位＋More 進階工具）
- [x] `/community` `/models` `/downloads` 相容轉接，不是 404／placeholder
- [x] 不得改 `/p/:id` 故事工作台
- [ ] targeted tests / typecheck / boundaries / ui-primitives / hooks
- [ ] commit / push / Draft PR
- [ ] 全庫 test / test:client / build
- [ ] 手機 20 條流程實際操作與 evidence

## 已完成

- 工作區安全檢查：乾淨、已 fetch、gh 已登入
- PR 1 #737（已合併）、PR 2 #738、PR 3 #739
- PR 4 程式：資料中心知識地圖＋下載卡、說明中心分頁、助手靈感入口、頂欄溢位、舊路徑仍掛真頁

## 未完成

- PR 4 targeted／全庫測試與 Draft PR
- 手機 20 條流程實際操作與 evidence

## 最後成功 commit SHA

- PR 1：`e163cc33181ba9b0a13149f738608c856ee93f30`
- PR 2：`1ef3fddf`
- PR 3：`392401c5df3990f5cc3a9454715fc3a9714b9e27`
- PR 4：尚未 commit

## 分支與 PR 連結

| PR | 分支 | URL | HEAD SHA |
| --- | --- | --- | --- |
| 規格 #732 | `agent/global-navigation-entry-dedup-plan` | https://github.com/aa0968111723-prog/ai_os/pull/732 | 已合併 `4e3a782a` |
| 1 | `cursor/global-nav-01-contract-32e8` | https://github.com/aa0968111723-prog/ai_os/pull/737 | `e163cc33`（已合併） |
| 2 | `cursor/global-nav-02-today-planner-32e8` | https://github.com/aa0968111723-prog/ai_os/pull/738 | `1ef3fddf` |
| 3 | `cursor/global-nav-03-shell-dedup-32e8` | https://github.com/aa0968111723-prog/ai_os/pull/739 | `392401c5` |
| 4 | `cursor/global-nav-04-destination-consolidation-32e8` | — | — |

## 實際測試結果

### PR 3 targeted（改後）

- MobileNavigation / AccountMenu / navigationItems.naming / SettingsPage.security / styles.contract：**28 passed**
- typecheck / boundaries / ui-primitives / hooks：**PASS**
- `npm test`：**2934 passed**

### PR 4 targeted

- 尚未跑

## Baseline failure

- CI `migration` on #732／後續 stacked PR：FAILURE（既有，非本任務引入）→ **BASELINE_EXISTING_FAILURE**

## Introduced failure

- 尚無

## 遇到的問題

- PR 1 #737 已被合併（非本任務自行 merge）。後續 PR 仍保持 Draft、不 merge、不 force push。
- 產品文案沿用既有去處名「今日」。

## 下一個精確操作

1. 跑 PR 4 targeted tests 與靜態檢查
2. commit / push PR 4
3. 開 Draft PR 4（base = PR 3 分支）
4. 跑全庫檢查與手機 20 條流程

## 真正需要人工決策的 blocker

- 無
