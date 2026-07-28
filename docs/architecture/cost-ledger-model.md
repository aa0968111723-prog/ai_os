# TD-09 成本帳本模型（estimated / reserved / actual / settled）

> 狀態：Design + thin types（本 PR 不改行為、不破壞 migration）  
> 對應：`technical-debt-remediation-plan.md` Phase 6／TD-09  
> 實作真相：`server/services/points.ts`、`server/db/schema/generation.ts`（`cost_ledger` / `generations`）  
> 共享型別：`shared/costLedgerTypes.ts`

## 1. 目的

今日「點數」同時承載四種不同語意，報表與 UI 容易混用：

| 語意 | 問題 |
|---|---|
| 目錄預估 | 審核門檻、扣點額、失敗退額共用同一個數字 |
| 額度預留 | `reserveQuota` 立刻寫入負 `delta`，在途與已結算混在同一 SUM |
| 供應商實花 | `points_actual` 完成時寫成 `points_est`，尚非帳單真相 |
| 最終結算 | 失敗退點靠另一列正 `delta`；淨消耗靠 `-SUM(delta)` 推導 |

TD-09 先**文件化 + 純型別**把四個 phase 說清楚，並對齊現有表欄位；後續 PR 才能安全做 true-up、provider 真實成本與報表拆分，而不一次改扣點路徑。

## 2. 四個 phase（契約）

```text
estimated  →  送出前的目錄／參數預估（報價）
reserved   →  已對額度／預算守門並寫入帳本的預留（在途占用）
actual     →  已知的實花（provider 或完成當下寫入的點數）
settled    →  最終歸使用者的淨消耗（成功留下／失敗退光後的結餘）
```

| Phase | 定義 | 現行落點 | 誰寫入 |
|---|---|---|---|
| **estimated** | 提交前算好的點數報價 | `generations.points_est` | `submitGenerationCore` 等（與審核門檻同源） |
| **reserved** | 通過 `reserveQuota` 後、尚未終局時占用的額度 | `cost_ledger` 負 `delta`（常綁 `generation_id`） | `reserveQuota` / `deduct` |
| **actual** | 完成時認定的實花點數 | `generations.points_actual`（nullable） | `advanceGeneration` 成功路徑（現況＝`points_est`） |
| **settled** | 對使用者最終生效的淨消耗 | 推導：`-SUM(cost_ledger.delta)`（可按 gen／user／group）；失敗另有 `points_refunded` 對照 | 成功＝保留負列；失敗＝再插正 `delta` 抵銷 |

### 2.1 符號與聚合口徑（不可改）

與 `points.ts`、`docs/維運手冊.md` §4.3 一致：

- `cost_ledger.delta`：**扣點／預留為負，退點／補點為正**。
- **淨消耗**＝`-SUM(delta)`（額度守門、`quota.my`、consumptionStats 同一口徑）。
- 週／日歸屬：退點列跟隨 **生成建立時間**  
  `coalesce(generations.created_at, cost_ledger.created_at)`，避免跨週退點灌鬆新週。
- 帳本 **append-only**：同一 `generation_id` 可有扣點列 + 退點列；**禁止**對帳本做 unique(generation_id)。
- `points <= 0`（免費路徑）不寫 0 元帳本列、不佔額度。

### 2.2 與 generation 狀態的對照

| `generations.status` | estimated | reserved | actual | settled（推導） |
|---|---|---|---|---|
| `awaiting_approval` | `points_est` | 0（核准前不扣） | null | 0 |
| `rejected` | `points_est` | 0 | null | 0 |
| `queued` / `running` | `points_est` | ≈`points_est`（已 `reserveQuota`） | null | 0（仍在途） |
| `done` | `points_est` | 0（已轉結算） | `points_actual`（現況常＝est） | `points_actual ?? points_est` |
| `failed` | `points_est` | 0 | null | 0（全額退回後） |

說明：

- **核准前不扣點**是產品與資安契約（待核列不得佔額度）；`decideCost` 核准當下才 `reserveQuota`。
- **在途 reserved**：帳本已有負列，故 `used*` / 守門會把在途算進「已用」——這是刻意的防超賣，不是 settled 報表口徑。
- **成功不另插「結算列」**：現況把 reserved 負列直接視為 settled；`points_actual` 只是 generation 側快取。
- **失敗**：同交易 CAS → `failed` + 正 `delta` 退點 + `points_refunded`（見 `failStaleGenerationTx` / `advanceGeneration`）。

## 3. 生命週期（現行）

```text
[估價] catalog / estimatePoints
   → generations.points_est = E
   → （可選）status = awaiting_approval（未扣點）

[預留] reserveQuota(user, group, E, reason, generationId?)
   → advisory lock + 重算 used*
   → INSERT cost_ledger { delta: -E, reason, generation_id }
   → 此時 phase 語意：reserved

        ┌─ done ──────────────────────────────────────────┐
        │ points_actual := E（現況）                       │
        │ 不改帳本負列 → settled = E                       │
        └─────────────────────────────────────────────────┘
        ┌─ failed / 送出失敗 / stale sweep ───────────────┐
        │ INSERT cost_ledger { delta: +E, reason: 退回 }  │
        │ points_refunded := E                            │
        │ settled = 0                                     │
        └─────────────────────────────────────────────────┘
```

非生成路徑（助手、導演、知識庫描述等）同樣走 `reserveQuota` + 失敗 `refund`，只是 `generation_id` 常為 null；phase 語意相同，報表以 `reason` / 時間聚合。

## 4. 現況欄位對照（不改 schema 形狀）

### 4.1 `generations`

| 欄位 | Phase 角色 |
|---|---|
| `points_est` | estimated 唯一真相（提交當下） |
| `points_actual` | actual；完成才填；**今日常等於 est** |
| `points_refunded` | 失敗路徑已退金額（與正 delta 對帳用） |

### 4.2 `cost_ledger`

| 欄位 | 語意 |
|---|---|
| `delta` | 有號點數變動（見 §2.1） |
| `reason` | 人話原因（非 enum；非 phase 欄位） |
| `generation_id` | 可空；有則可按生成對帳 |
| `user_id` / `group_id` | 租戶與守門維度 |
| `created_at` | 帳本列時間（週歸屬次選） |

**沒有**獨立的 `phase` / `kind` 欄位。列的「扣 vs 退」只由 **`delta` 符號**判定（見 `shared/costLedgerTypes.ts` 的 `ledgerDirection`）。

## 5. 報表口徑建議（行為不變前提下的讀法）

| 報表問題 | 建議讀法 | 勿混用 |
|---|---|---|
| 使用者還剩多少額度？ | `-SUM(delta)` 對週／日／組／員（含在途 reserved） | 不要只用 `points_actual` |
| 本週「已完成實花」？ | `status=done` 的 `coalesce(points_actual, points_est)`（`insights` 現況） | 不要把 failed 的 est 算進去 |
| 在途預留多少？ | queued/running 且帳本淨額仍為負的 generation 之 `-net` | 不要與 settled 加總重複計 |
| 單筆生成結算？ | `netConsumedPoints(該 gen 的 deltas)` 或 status 推導（`generationCostSnapshot`） | 不要只看最新一列 reason |
| 對 fal 月帳單？ | 全站 `-SUM(delta)` × 點數匯率 vs 帳單 USD（`docs/點數校準報告.md`） | estimated 目錄價 ≠ 帳單 |

純函式快照與標籤：`shared/costLedgerTypes.ts`（前端／後端／測試共用，無 DB 依賴）。

## 6. 刻意不做的事（本 PR 範圍）

- 不新增 migration、不改 `delta` 符號、不改 `reserveQuota` 交易順序。
- 不新增 `cost_ledger.phase` 欄位（避免雙重真相；若未來要加，須 backfill + 寫入路徑雙寫期）。
- 不把 `points_actual` 改成 provider 真實 USD（需計價回寫與 true-up 列，另 PR）。
- 不改 UI 文案主路徑（僅提供 label helper，呼叫端自願採用）。
- 不做 storage / transfer 帳本（見 ANIM-09）。

## 7. 後續 PR 路線（建議）

1. **TD-09b（可選）**：報表／quota UI 改用 `generationCostSnapshot` 顯示「預留中／已結算」。
2. **True-up**：當 `actual ≠ reserved` 時插調整列（仍 append-only；冪等鍵＝generation+kind）。
3. **Provider actual**：完成回呼寫入真實成本 → `points_actual`；差额 true-up。
4. **可選 phase 欄位或 reason 前綴約定**：僅在雙寫穩定後供索引，不得取代 `delta` 符號。
5. **ANIM-09**：shot/production 層加 storage／transfer 維度，複用同一 phase 詞彙。

## 8. 驗收（本 PR）

- [x] 設計文件對齊 `points.ts` 與 `cost_ledger` / `generations` 欄位。
- [x] `shared/costLedgerTypes.ts` 型別 + 純 helper（label、direction、net、snapshot）。
- [x] `shared/costLedgerTypes.test.ts` 覆蓋符號、生命週期快照、標籤。
- [x] schema 僅註解補強（modular `server/db/schema/generation.ts`），無 DDL。
- [x] `npm run typecheck` 與相關 vitest 通過。

## 9. 風險與回退

- **風險**：僅文件與純函式；最大風險是呼叫端誤用 settled 口徑改守門——守門必須繼續用 `-SUM(delta)`。
- **回退**：刪除本文件與 `shared/costLedgerTypes*` 即可；不影響 runtime。
