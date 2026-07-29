# Aios 全站 UI/UX 優化計畫 v1.1 補充規格

| 欄位 | 內容 |
|---|---|
| 文件狀態 | Official Supplement（正式補充版） |
| 版本 | 1.1.1 |
| 日期 | 2026-07-29 |
| 前置文件 | `site-wide-uiux-optimization-plan.md`（PR #166） |
| 適用範圍 | 全站 Web／PWA，手機、平板、桌面 |

> 本文件補充 PR #166 已建立的方向，不推翻 UX-00～UX-08。若兩份文件衝突，以本 v1.1 的「驗證可信度、資訊架構、角色狀態與量化標準」為準。
>
> **產品邊界修正：Aios 沒有獨立「光球」功能。** AI 能力存在於專案內的 AI 創作工作台與既有問 AI／直接生成／製作範本／執行計畫流程，不新增全域光球導覽、按鈕或視覺角色。

---

## 1. 為什麼需要 v1.1

PR #166 已完成全站 UI/UX 主計畫、斷點矩陣、品牌語意、核心流程與分階段 DAG，但仍有四個必須先補齊的執行缺口：

1. 路由巡覽腳本可能登入失敗後仍繼續截圖，產生「所有路由其實都是登入頁」的假基線。
2. 登入區域使用完整 `100dvh`，但它實際位於 AppHeader 與 `.app` 底部 padding 之間，會造成額外垂直捲動。
3. 核心專案頁 `/p/:id`、私訊 `/chat/:peerId` 與角色限制頁缺少真實 fixture，無法完成正式驗收。
4. 原計畫缺少角色導向 IA、完整元件狀態、效能預算與產品漏斗事件。

因此在 UX-01 前插入 **UX-00.1「可信基線修復」** 與 **UX-00.2「真實角色／資料驗證」**。

---

## 2. 修訂後執行順序

```text
UX-00.1 可信基線修復
  ↓
UX-00.2 真實角色／真實專案驗證
  ↓
UX-IA 公開入口與登入後作業台資訊架構
  ↓
UX-01 信任與導流
  ↓
UX-02 Tokens、全域殼與響應式地基
  ↓
UX-03～UX-08 依 PR #166 原計畫執行
```

`UX-07` 仍可在 UX-02 後並行，但不得略過 UX-00.1／00.2 的基線證據。

---

## 3. UX-00.1：可信基線修復

### 3.1 登入驗證必須 fail closed

路由巡覽必須符合：

- 使用 `#login-email`、`#login-pw`，不得依賴模糊 input type selector。
- `TEST_EMAIL`、`TEST_PW` 未設定時直接失敗，不使用假的預設帳密。
- 按登入後必須等待已登入專屬元素，例如帳號選單。
- 登入失敗不得繼續巡覽。
- 任一路由、斷點、內容擷取或截圖失敗，程序必須回非 0。
- 每次執行輸出 `audit-manifest.json`，記錄角色、帳號、路由、實際 URL、viewport、標題與結果。
- 截圖前再次確認登入表單未出現，避免 session 失效後繼續產生假證據。

### 3.2 真實資料路由

巡覽腳本支援：

```env
TEST_PROJECT_ID=<真實可讀專案 UUID>
TEST_PEER_ID=<真實可私訊使用者 UUID>
TEST_ROLE=creator|viewer|leader|admin|ungrouped
```

未設定 fixture 時必須明確警告，不能宣稱核心工作台或私訊已驗收。

### 3.3 登入頁高度

登入頁仍維持單一目標與 safe-area，但高度必須扣除 AppHeader 與外層底部空間，不得在 shell 內再使用完整 `100dvh`。

通過條件：

- 360×800、390×844 無不必要垂直捲軸。
- 登入卡視覺中心接近可用 viewport 中心。
- 軟鍵盤開啟後表單可捲動、送出按鈕可達。
- Email 使用 `type="email"` 與 `autocomplete="email"`。

### 3.4 保留架構理由

UI/UX PR 不應順手移除具有維護價值的工程註解，尤其：

- lazy route 的首屏效能理由。
- `ProjectPage key={params.id}` 防止跨專案殘留狀態的理由。
- 未分組使用者仍可使用 Help、MCP、整合與私訊的帳號層級理由。

---

## 4. UX-00.2：角色與情境驗收矩陣

### 4.1 必備測試角色

| 角色 | 必測流程 |
|---|---|
| 新邀請成員 | 邀請、登入、FirstRun、開範例或建立第一個專案 |
| 一般創作者 | 作業台、專案三幕、四模式工作台、生成確認、結果查看 |
| Viewer | 唯讀提示、禁用操作、不可扣點、不可修改 |
| 組長 | 跨專案待核、核准、退回、組員卡點與點數監控 |
| 管理員 | 成員、模型、整合、全站設定與異常狀態 |
| 未分組帳號 | Help、MCP、整合、私訊與等待分組空狀態 |

### 4.2 必備資料情境

每個核心頁至少驗證：

- Loading
- Empty
- Populated
- Partial data
- Error
- Permission denied
- Offline／network retry
- Quota exhausted
- Long text／long filename
- 1、10、100 筆清單密度

### 4.3 AI 工作狀態

全站統一狀態模型：

```text
Draft → Confirming → Queued → Running → Needs review
      → Approved / Rejected / Failed / Cancelled
```

每個狀態必須有：

- 清楚標籤與非純色辨識。
- 下一步操作。
- 等待或成本說明。
- live region（重要進度、完成、失敗）。
- 重新整理後仍可恢復正確狀態。

---

## 5. 資訊架構補充：公開入口、登入、作業台分離

Aios 長期目標 IA 明確分成三層：

### 5.1 公開首頁 `/`

維持純入口，不放登入後專案卡或大型工具選單：

- Aios 品牌 Logo 與一句產品定位。
- 說明這是一套 AI 創作與專案協作作業系統。
- 單一主 CTA：**進入創作作業系統**。
- 不直接展開聊天或 AI 工作台。
- 不顯示 Sidebar。
- 不新增 Aios 現況不存在的「光球」入口或角色。

### 5.2 登入頁 `/login`

只負責身分驗證、邀請制說明與必要錯誤處理。

### 5.3 登入後作業台 `/dashboard`

頁面主軸是「今天要做什麼」，不是「系統有哪些功能」。優先順序：

1. 目前專案與下一步。
2. 繼續上次工作。
3. 待辦／待核。
4. 最近成果。
5. 快速開始。
6. 系統工具與管理入口置於次層。

AI 操作入口維持在專案內的 AI 創作工作台，不新增全站浮動 AI 角色。

> 本文件只確立目標 IA；路由搬移、舊 `/` 深鏈相容與登入後 redirect 應另開 UX-IA PR，避免與基線修復混在同一部署。

---

## 6. 每頁一個主要行動

每頁首屏只允許一個明確主 CTA。次要操作使用 tonal／ghost／link，不得多顆實心主按鈕並排。

進階功能預設收合：

- 模型選擇
- Seed
- JSON／原始參數
- Debug 資訊
- 低頻權限與技術設定

統一置於「進階設定」，且收合不影響主流程完成。

---

## 7. 完整元件狀態規格

所有共用元件至少定義：

```text
Default / Hover / Focus-visible / Pressed / Selected
Disabled / Loading / Empty / Error / Success
Read-only / Permission denied / Offline / Quota exhausted
```

### 7.1 按鈕

- 手機／平板主互動區 ≥ 44×44px。
- Loading 時保持寬度、顯示進度文字、避免重複送出。
- Disabled 必須同時說明原因，不能只變灰。
- 扣點按鈕在確認前顯示估點，確認後才送出。

### 7.2 Modal／Sheet／Drawer

- 手機：底部 Sheet 或全寬 Modal；避開 safe-area。
- 平板：置中，建議 max-width 480～560px。
- 桌面：置中 Modal 或右側 Drawer，依任務保持一致。
- 必須有 focus trap、Esc、關閉後焦點歸還。
- 背景使用 inert，不能只靠遮罩。

### 7.3 空狀態

統一公式：

```text
現況 → 常見原因（可省）→ 主行動 → 次行動
```

不得只顯示「尚無資料」。

---

## 8. 設計 Token 補充

除 PR #166 既有品牌色，正式設計系統還需鎖定：

- Typography：字級、字重、行高、最大行長。
- Spacing：4／8pt 節奏，禁止散落任意魔法數字。
- Radius：小控制、中卡片、大浮層。
- Elevation：卡片、sticky、dropdown、modal 四階。
- Icon：14／16／20／24px 使用規則。
- Motion：fast／base／slow 與 reduced-motion 替代。
- Z-index：內容 < sticky < dropdown < drawer/modal < toast < 全域阻斷通知。
- Semantic colors：primary、gold、success、danger、collab 各守單一語意。

新增元件前優先使用既有 token，不得直接寫未說明的色碼、陰影與 z-index。

---

## 9. 效能預算

| 指標 | 目標 |
|---|---|
| LCP | ≤ 2.5 秒 |
| CLS | ≤ 0.1 |
| INP | ≤ 200ms |
| 路由切換 | 立即有 skeleton／pending feedback |
| 圖片 | 固定尺寸、lazy load、避免版面跳動 |
| 重頁面 | 維持 route-level code splitting |

每個 UI PR 若增加主 bundle，必須在描述說明原因與回退方式。

---

## 10. 產品事件與成功漏斗

只記錄產品行為，不收集提示詞全文、文件內容或敏感個資。

建議事件：

```text
invite_opened
login_completed
first_project_opened
creation_mode_selected
generation_confirmed
generation_completed
result_opened
review_submitted
review_approved
delivery_exported
```

核心漏斗：

```text
登入 → 進專案 → 開工作台 → 確認生成 → 看見成果 → 分享／交付
```

分角色觀察：新手首次成功、創作者日常完成、組長待核處理時間、失敗後重試率。

---

## 11. 每個 UI PR 的強制證據

```markdown
## 使用者故事
## 改動頁面
## 角色與權限
## 元件狀態
## 文案摘要（舊 → 新）
## 裝置驗收
- [ ] 360×800
- [ ] 390×844
- [ ] 768×1024
- [ ] 1280×800
- [ ] 1440×900
## 真實資料 fixture
- [ ] project
- [ ] peer（若涉及 Chat）
- [ ] populated / empty / error / permission
## 截圖與 audit-manifest.json
## 效能影響
## 測試指令與結果
## 回退方式
## 非目標
```

宣稱「全路由通過」時，`audit-manifest.json` 不得有 failed；未提供 project／peer fixture 時必須標記未驗收，不可用空狀態代替。

---

## 12. 本補充 PR 的範圍

本 PR 僅完成 UX-00.1：

- 修正登入欄位語意與 shell 內高度。
- 修正全路由巡覽登入 selector。
- 登入必須被確認後才開始巡覽。
- 任一路由／斷點失敗時整體失敗。
- 增加真實 project／peer fixture 與 manifest。
- 恢復 AppRoutes 中重要的架構理由註解。
- 新增本 v1.1 補充規格。

不在本 PR：

- `/`、`/login`、`/dashboard` 路由搬移。
- 全站換膚。
- 工作台重構。
- 新資料模型或後端生成引擎。
- 產品事件實作。

---

## 13. 驗收

- [ ] `npm run check`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] 缺少 TEST_EMAIL／TEST_PW 時 audit script 非 0 結束
- [ ] 錯誤帳密時不產生受保護路由成功證據
- [ ] 正確帳密時可辨識帳號選單並開始巡覽
- [ ] 任一錯誤路由／viewport 使整體非 0
- [ ] 有 TEST_PROJECT_ID 時 `/p/:id` 納入 manifest
- [ ] 有 TEST_PEER_ID 時 `/chat/:peerId` 納入 manifest
- [ ] 360／390 登入頁無多餘 shell 高度造成的永久捲軸
