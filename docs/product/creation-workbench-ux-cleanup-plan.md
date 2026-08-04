# 修復／整理計畫：AI 創作工作台 UX 大整理

> 狀態：**P0 實作中**（計畫已合 #400；`feat/workbench-p0-collapse-advanced`）  
> 分支：`plan/creation-workbench-ux-cleanup` → base `claude/healing-migration-ai-os-erewp2`  
> 觸發：使用者「AI 創作工作台有點難用想大整理」（2026-08-04）

---

## 1. 目標

把「什麼都攤開」改成 **一條主路徑清楚、進階預設收合、結果靠近動作**。

**不做：**

- 不改 `generation.submit` / quota / BYOK 後端契約（BYOK 見 #396）
- 不刪四模式能力（ask / generate / template / plan），只改預設可見性與編排
- 不在 start.sh 或 migration 動刀（開機問題見 #398）

**要做：**

- 降低認知負擔（預設螢幕只看到：模型 → 提示詞 → 點數 → 生成）
- 生成後立刻看到進度／最近結果
- 目標框與提示詞的關係講清楚，減少「兩個大輸入框不知道按哪個」

---

## 2. 現況盤點（程式對照）

| 路徑 | 角色 | 體感問題 |
|------|------|----------|
| `CreationWorkbench.tsx` (~19KB) | 總殼：目標、技能、四 Tab、四 mode 全掛載、資源抽屜 | 入口資訊多；intro + goal + tabs + context 垂直堆疊 |
| `modes/DirectGenerateMode.tsx` (~28KB) | 直接出圖主表單 | **最大痛點**：模型／提示詞／chip／進階／成本／一致性／AiUnderstanding（預覽+消融）／確認面板一次出現 |
| `CreationModeTabs.tsx` | 四模式 | 新手必須先選對模式 |
| `CreationGoalInput.tsx` | 「你想完成什麼」 | 與 `gen-prompt` 職責重疊；送出依 mode 行為不同 |
| `CreationResourceDrawer.tsx` (~20KB) | 生成紀錄、提示詞庫 | 結果離生成鈕太遠 |
| `AiUnderstandingPanel.tsx` (~17KB) | 預覽／覆寫／消融 | 進階能力，不應預設搶主路徑 |
| `AblationPanel` / `PromptFlowMap` / `TokenBudgetStrip` 等 | 可觀測性 | 同左 |
| `creationDraft.ts` | 跨模式草稿 | **保留**；整理不破壞 persistence |
| `generationGates.ts` | 禁用原因／估點 | **保留**；只改顯示位置 |

Anchors（勿無故改壞深連結）：`#sec-ai-hub` `#sec-studio` `#sec-generations` `#sec-assistant` `#sec-agent` `#sec-workflow` `#gen-prompt`。

---

## 3. 目標資訊架構（重整後）

```
┌─ AI 創作工作台 (#sec-ai-hub) ─────────────────────┐
│  模式：[直接出圖*] [一起想] [套用範本] [多步開拍]      │  * 預設或最顯眼
│                                                   │
│  ── 直接出圖主路徑 ──                               │
│  模型選擇                                         │
│  提示詞 (#gen-prompt)  ← 主輸入                    │
│  可選：從「這次想完成什麼」帶入（一鍵，不自動扣點）      │
│  帶入：設定✓ · 角色n · 場景n · 素材n   （一列 chip） │
│  點數：約 N 點 · 剩餘…  （之後接 BYOK 徽章）         │
│  [ 生成（−N 點）]                                  │
│                                                   │
│  ▸ 進階設定（來源圖／雙來源、一致性鎖定）  預設關      │
│  ▸ AI 怎麼理解（預覽、prompt 覆寫、消融）  預設關      │
│                                                   │
│  最近生成（3～5 筆） +「全部紀錄」→ 抽屜             │
└───────────────────────────────────────────────────┘
```

其他三模式：能力保留，面板內各自收斂；不在本計畫重寫 Plan/Template 業務邏輯。

---

## 4. 分階段實作（終端 checklist）

### P0 — 減噪（優先，低風險）

**檔案：** 主要 `DirectGenerateMode.tsx`、必要時 `AiUnderstandingPanel.tsx`

```
[x] P0.1  AiUnderstandingPanel（預覽／消融／覆寫）改為 <details> 或同等「預設關閉」
          標題例：AI 怎麼理解（進階）
[x] P0.2  一致性鎖定區塊併入「進階設定」details（與來源圖同層），預設關
[x] P0.3  生成鈕上方只保留一行 CreationCostSummary（或等價一行字）
          不要在確認前重複大段額度說明
[x] P0.4  確認面板（confirming）邏輯保留；文案可微調，勿改 submit payload
[x] P0.5  更新／補測試：DirectGenerateMode、CreationWorkbench 既有測試不因預設收合紅片
          （查 role/label；必要時改成先 expand 再 assert）
```

**驗收 P0：** 未展開進階時，生成模式一屏可見「模型 + 提示詞 + 帶入 chip + 成本 + 生成鈕」。

---

### P1 — 主路徑（中風險，仍前端）

**檔案：** `CreationWorkbench.tsx`、`CreationGoalInput.tsx`、`CreationModeTabs.tsx`、`creationDraft.ts`（僅文案／預設 mode 若需要）

```
[ ] P1.1  預設 mode：新專案／空 draft 改為 `generate`（emptyDraft 預設從 ask → generate）
          需確認 deep link / agent-run focus 仍可強制 plan
[ ] P1.2  目標框定位：
          - 選項 A（建議）：generate 模式下 goal 改成「可選輔助」——縮成一行 +「帶入提示詞」
          - 或選項 B：保留大框，但 intro 文案改成「這裡不會扣點，只是帶進下面提示詞」
[ ] P1.3  Tab 文案維持 CREATION_MODES；可把「直接出圖」排第一（陣列順序影響 tab 順序）
[ ] P1.4  CreationContextBar：改為較弱視覺（或收進「前往設定」），避免與 chip 重複導覽
[ ] P1.5  測試：viewportBaseline、CreationWorkbench.test、goal submit 分派仍正確
```

**驗收 P1：** 首次進入工作台，預設在出圖；使用者不必先理解「一起想」才能生成。

---

### P2 — 結果就近（中風險）

**檔案：** `DirectGenerateMode.tsx`、`CreationResourceDrawer.tsx`、可能小元件 `RecentGenerationsStrip.tsx`（新建）

```
[ ] P2.1  送出成功後：除 submitNotice 外，在 #sec-studio 下方顯示「最近生成」3～5 筆
          資料來源：既有 generation.listByProject / paged（與抽屜同一 API，勿重複訂閱過多）
[ ] P2.2  「看進度／全部紀錄」仍可開抽屜 #sec-generations；抽屜改定位為完整歷史
[ ] P2.3  避免與抽屜內 GenerationList 雙份超長列表搶版面（主區精簡、抽屜完整）
[ ] P2.4  測試：送出後 notice + 列表 invalidate 行為
```

**驗收 P2：** 生成後不必翻到頁面最底抽屜也能看到「進行中／剛完成」。

---

### P3 — 計費可讀（可選，依 #396）

```
[ ] P3.1  成本行預留「個人金鑰／平台點數」徽章位（接 BYOK Phase 2 的 usedUserKey）
[ ] P3.2  未接後端前不要假顯示「已用個人 key」
```

---

## 5. 明確不改清單

| 項目 | 原因 |
|------|------|
| `buildGenerationSubmitInput` / `generationGates` 規則 | 計費與權限正確性 |
| `creationDraft` 持久化機制 | 跨 mode／收合不丟稿 |
| 四 mode 全掛載（hidden tabpanel） | 切換不丟 assistant 狀態；可保留 |
| PromptLibrary／Scene 帶入 applyRequest 契約 | 外鏈入工作台 |
| 後端 migration／start.sh | 另案 #398 |

---

## 6. 建議 PR 切法（實作時）

1. `feat/workbench-p0-collapse-advanced` — 只 P0  
2. `feat/workbench-p1-default-generate` — P1  
3. `feat/workbench-p2-recent-strip` — P2  

每段可獨立合併、獨立驗收；避免一顆巨型 PR。

---

## 7. 測試指令

```bash
npm run test:client -- creation-workbench
# 或
npm run test:client -- DirectGenerateMode CreationWorkbench
```

手動：專案頁 → 展開工作台 → 直接出圖主路徑無須點開 details 即可生成；進階／AI 理解預設關閉。

---

## 8. 與其他 PR 的關係

| PR | 關係 |
|----|------|
| #396 BYOK Phase 2 | P3 徽章依賴；不阻塞 P0–P2 |
| #398 schema introspect 開機 | **無關**；服務起不來時本整理仍可先合進 branch 但無法線上驗證 |
| SimpleProjectMode | 簡模式若共用元件，P0 收合應對齊，勿只改完整工作台 |

---

## 9. 回滾

- 純前端：revert 對應 feat PR 即可。
- 若改了 `emptyDraft` 預設 mode：舊 localStorage draft 仍帶自己的 mode，影響僅「無草稿的首次」。
