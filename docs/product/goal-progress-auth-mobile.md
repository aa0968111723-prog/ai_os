# Goal progress：Auth session · Mobile declutter · Scene prompt · Fal

> 狀態：活文件（docs-only 快照）  
> 基準分支：`claude/healing-migration-ai-os-erewp2`  
> 更新：2026-07-30（post DESK-01 / MOB-04）

本文件彙整近期已合入目標與下一步，避免「計畫仍寫 Planning、實作卻已上線」的落差。不取代各計畫正文。

## 1. 已完成（merged on default）

| 代號 | 內容 | 合併 PR | 備註 |
|------|------|---------|------|
| **AUTH-01** | Sliding session renew + `logoutAll`（不撤 MCP） | [#188](https://github.com/aa0968111723-prog/ai_os/pull/188)、audit labels [#189](https://github.com/aa0968111723-prog/ai_os/pull/189) | `touchSession` 由前端節流呼叫；剩餘 &lt;7 天延長至 30 天 |
| **AUTH-02** | Session 列表／撤銷、裝置 meta、`lastSeenAt` | [#192](https://github.com/aa0968111723-prog/ai_os/pull/192) | migration `0012_session_device_meta`；不含 ipHash 外露 |
| **AUTH-03** | 單次上傳授權（`aidup_…` Bearer／桌面 handoff，與 cookie 解耦） | [#194](https://github.com/aa0968111723-prog/ai_os/pull/194) | migration `0013` upload grants + upload lineage meta |
| **UX-M1** | 手機專案頁減負 Phase 1（≤820px 收合 + 留言 sheet） | [#191](https://github.com/aa0968111723-prog/ai_os/pull/191) | 計畫：[`mobile-project-page-declutter-plan.md`](./mobile-project-page-declutter-plan.md) → **Phase 1 Implemented** |
| **MOB-03** | 工作台 S 斷點 2×2 tabs + 長任務離開文案 | [#196](https://github.com/aa0968111723-prog/ai_os/pull/196) | workbench 手機版配置與 leave-copy |
| **MOB-04** | 斷點 overflow 驗收 + mobile baseline | [#198](https://github.com/aa0968111723-prog/ai_os/pull/198) | `scripts/e2e-ui/audit-breakpoints.mjs`、`docs/uiux-audit/mobile-baseline.md` |
| **DESK-01** | AssetLibrary 外部軟體 CTA（`hasDesktopBridge` 閘門） | [#199](https://github.com/aa0968111723-prog/ai_os/pull/199) | 有 bridge → 開啟／資料夾；無 bridge → 下載 + 桌面版提示 |
| **Scene prompt UI** | 分鏡每鏡獨立提示詞編輯（API + SceneList UI） | MVP [#187](https://github.com/aa0968111723-prog/ai_os/pull/187)、UI [#190](https://github.com/aa0968111723-prog/ai_os/pull/190) | 跟進 #187 的前端編輯體驗 |
| **Fal Phase A** | `falBilling.ts` + `quota.falAccountBalance` + 管理頁卡片 + 個人 `quota.my` 展示強化 | [#195](https://github.com/aa0968111723-prog/ai_os/pull/195) | 計畫：[`fal-balance-and-personal-usage-plan.md`](./fal-balance-and-personal-usage-plan.md) → **Implemented Phase A** |
| **Fal plan doc** | Fal 餘額 + 個人用量展示計畫（僅文件） | [#185](https://github.com/aa0968111723-prog/ai_os/pull/185) | 計畫正文；狀態已與 Phase A 實作對齊 |
| **Mobile plan doc** | 手機減負計畫（僅文件） | [#186](https://github.com/aa0968111723-prog/ai_os/pull/186) | 已由 UX-M1 實作 |

### Auth session 現況（對照 `docs/auth-design.md`）

設計文件仍描述「sessions：隨機 token、30 天、httpOnly cookie」之基礎模型。後續增量已上線、但**尚未回寫**設計正文：

- **Sliding renew（AUTH-01）**：活躍且剩餘壽命進入窗內 → 延長 `expiresAt` + 刷新 cookie Max-Age。
- **logoutAll（AUTH-01）**：清該使用者全部 sessions 後本機立即換發；**不**撤銷 MCP 金鑰（改密碼仍撤）。
- **list / revoke + device meta（AUTH-02）**：UA／平台等 meta、列表不含 ipHash；撤銷本機等同登出。
- **upload grants（AUTH-03）**：短效 `aidup_…` Bearer，與 cookie session 解耦，供桌面／handoff 單次上傳。

設計正文可之後另開小 PR 補一節「Session 生命週期與裝置管理／上傳授權」；本快照僅記錄狀態。

## 2. 下一步（尚未完成）

| 代號 | 內容 | 狀態 | 建議 |
|------|------|------|------|
| **Fal Phase B** | 部署 `FAL_ADMIN_KEY`、對帳真實 balance | **僅營運**（程式已合入） | 部署 Admin Key 後對照 fal dashboard 驗收；無需 runtime PR |
| **UX-M2 / UX-M3** | 手機三 tab、工作台內再減負 | 可選、未開 | 僅在 Phase 1 / MOB-03 後仍嫌擠時啟動 |

## 3. 開源 PR 分流（非 dependabot · base = default）

| PR | 標題 | mergeable | CI（歷史） | 是否仍相關 | 建議 |
|----|------|-----------|------------|------------|------|
| **#66** | 通訊錄協作：私訊／群組／專案討論 | **CONFLICTING** | 歷史綠 | **部分**——default 已有 1:1 `dm` | **勿強合**；需 rebase 並對齊既有 `dm` |
| **#107** | docs: 核心缺陷審查報告收斂狀態 | **已合** [#107](https://github.com/aa0968111723-prog/ai_os/pull/107) | — | — | — |
| **#3**（draft） | fix(options): 併發首讀 seed 防重複 | **已關閉 superseded** | — | 否 | default `optionsStore.ensureGroupOptions` 已超集 |

原則：**不**強合大型過期 PR；衝突或 draft 先 triage／rebase，CI 綠才考慮。

## 4. 本快照變更範圍

- DESK-01 / MOB-04 → **已完成**
- §2 下一步僅留 Fal Phase B（ops）與可選 UX-M2/M3
- 開源 PR 表對齊 #107 已合、#3 已關

**不含** runtime 行為變更（runtime 就緒判定修復見獨立 fix PR）。
