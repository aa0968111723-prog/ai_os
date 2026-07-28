# ANIM-00 動畫產線基線報告

> 狀態：Baseline locked（純函式契約）  
> 日期：2026-07-28  
> 分支：`feat/td-core-policy-command-worker`  
> 上位：`ai-animation-production-remediation-plan.md` §13

## 1. 目的

在改 Production／Shot 資料模型與大型 migration 之前，用**可失敗的單元測試**鎖住動畫產線不可變契約。範圍刻意避開全 e2e，聚焦 pure helpers 與既有 Policy／State 核心。

## 2. 本批交付

| 產物 | 路徑 | 說明 |
|---|---|---|
| 領域純函式 | `shared/animationContracts.ts` | 時間真相、軟刪過濾、分鏡重排、選版、匯出冪等鍵 |
| 契約測試 | `shared/animationContracts.test.ts` | ANIM-00 命名的 vitest 套件 |
| 多入口政策延伸 | `server/services/policyEngine.test.ts` | 「鏡頭生成」跨 web／MCP／workflow／agent 一致 |
| 本報告 | `docs/architecture/anim-00-baseline.md` | 已驗證 vs 仍 open |

## 3. 已驗證（verified）

| §13 項目 | 驗證方式 | 狀態 |
|---|---|---|
| 分鏡順序唯一／可重排；缺漏補尾 | `computeSceneReorder`／`assignContiguousOrderIndices`／`swapAdjacentOrder` | verified（純邏輯；DB 鎖仍靠 `scenes.reorder` 實作） |
| 軟刪分鏡不進正常列表 | `excludeSoftDeleted`／`listActiveOrderedScenes` | verified（filter helper；SQL `isNull(deletedAt)` 口徑與之對齊，未重跑整合） |
| 粗剪總長 = 有效鏡頭時長和 | `sumDurationFrames`＋`sumLegacyDurationSec`（現行 3 秒下限） | verified（frame 真相 + legacy exporter 相容） |
| 時間真相：frames 為準、sec 衍生 | `durationFromFrames`／`durationFromSec`／`secToFrames` | verified |
| 現用版本 (shotId, role) 至多一 selected；Shot 指標為真相 | `findDuplicateSelectedVersions`／`applySelectAssetVersion`／`reconcileSelectionStatus` | verified（純模擬；DB partial unique index 屬 ANIM-04） |
| 音訊只改 narration、圖影只改 visual | `selectionPatchForAssetKind` | verified（對齊 `scenes` setFromGeneration 角色判斷） |
| 跨 shot／role／project 選版拒絕 | `applySelectAssetVersion` error codes | verified |
| 匯出同專案同素材選擇鍵重用進行中 job | `exportAssetSelectionKey`／`findReusableExportJob` | verified（對齊 `exportJobs.create`；無 DB 併發測試） |
| 相同內容身份 ↔ 相同交付意圖 | `exportContentIdentity` | verified（契約指紋；實作 hash 仍 open） |
| Direct／workflow／agent／MCP 同政策與成本門檻 | policyEngine ANIM-00 區塊 + 既有 multi-entry matrix | verified |
| 封存／暫停不得鏡頭生成；封存仍可 export | `projectStateAllows` 於 ANIM-00 案例 | verified |

## 4. 仍 open（需後續 PR 或整合／e2e）

| 項目 | 原因 | 建議 |
|---|---|---|
| 並發新增／移動下 orderIndex 唯一 | 依賴 advisory lock + transaction；純函式無法替代 | 既有 `scenes` router 路徑；可加 pg 測試（ANIM-01 前後） |
| 軟刪素材不進粗剪／交付包（SQL JOIN） | SQL 重：`isNull(assets.deletedAt)` 於 list／export | 文件化 open；filter helper 已鎖應用層約定 |
| 粗剪 UI：自動換鏡、reduced motion、404 降級 | 前端行為，非 pure server 契約 | client／e2e（既有 exporter 單元測覆蓋時間軸格式） |
| 素材 404 預覽降級 vs 交付失敗 | 需 runner／HTTP 整合 | ANIM-06／export runner |
| 生成 idempotency：不重複扣點／candidate／選版 | 部分在 cloudInference mock、generationCore；未統一 animation 命名 | ANIM-03 + generation 契約 |
| timeout／取消／Worker 重啟／stale lease fencing | runner 層 | TD-07／ANIM-07 回歸 |
| 已交付 Production 改修訂不覆蓋 | 尚無 Production revision 模型 | ANIM-01／交付狀態機 |
| REST 生成入口走 Command | TD-00 已標 open | 上位 TD 續作 |
| DB partial unique index on selected (shotId, role) | 需 migration | ANIM-04 |
| 正式 Timeline 全面改 frame 儲存 | 現行 exporter 仍以 durationSec + 最少 3s | ANIM-06；`legacySceneDurationSec` 標為相容鎖 |

## 5. 與現況程式對照

| 契約 | 現況錨點 |
|---|---|
| 分鏡 list／reorder／軟刪 | `server/routers/scenes.ts`（`isNull(deletedAt)`、duplicate orderedIds 拒絕、缺漏補尾） |
| 選版角色（audio→narration） | `scenes` setFromGeneration patch |
| 匯出防重複 | `server/routers/exportJobs.ts` `assetKey` + advisory lock |
| 時間軸 30fps | `server/services/exporter.ts` `TIMELINE_FPS`／`sceneDur` |
| 生成 Command + 政策 | `generationCommand.ts` + `policyEngine.ts` + `projectState.ts` |

## 6. 成功定義（本批）

- [x] `shared/animationContracts.ts` 純規則可被 shared／server 共用
- [x] vitest 覆蓋順序、軟刪過濾、frames 真相、選版唯一、匯出鍵
- [x] policyEngine 延伸 animation 命名多入口案例
- [x] 本報告列出 verified vs open
- [x] 無產品行為變更（僅測試與純函式模組）

## 7. 後續

1. ~~ANIM-01：Production／Sequence／Shot adapter 引用 `animationContracts`，不先破壞 scenes API。~~ **已完成** → 見 `anim-01-adapter.md`（`shared/animationDomain.ts`）。  
2. 將 `exportJobs.assetKey` 改為 import `exportAssetSelectionKey`（小 refactor，可隨 ANIM 或 TD 順手）。  
3. 補 pg／e2e 覆蓋 open 表（併發 order、export job 原子重用、生成冪等）。  
4. ANIM-02：角色與風格聖經版本化（掛入 Shot.characterRefs 等）。
