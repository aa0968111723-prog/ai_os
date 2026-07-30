# CA-01 完整設計規劃稿：代理生成火力對齊（Generate Parity）

| 欄位 | 值 |
|------|-----|
| **Document ID** | CA-01-DESIGN-2026-07 |
| **Status** | Accepted for implementation |
| **Date** | 2026-07-30 |
| **PR 類型** | 設計文件（本 PR）；實作 PR 建議分支 `feat/ca-01-agent-generate-parity` |
| **Related** | `docs/product/creative-agent-evolution-roadmap.md`、`docs/AI代理架構與維運.md`、`docs/product/ai-project-roles-concept.md`、`docs/product/fal-balance-and-personal-usage-plan.md` |
| **Progress** | `docs/product/creative-agent-roadmap-progress.md` CA-01 |

---

## 1. 一句定錨

> 讓代理路徑的 `generate`／`voiceover` 與手動「直接生成」**同一火力**（定裝、場景 preset、來源素材、needs 模型），且**扣點只走** `executeGenerationCommand` → `reserveQuota`，外鍵在扣點前 fail-closed。

---

## 2. 背景與問題（已對程式碼）

### 2.1 今日斷層

| 位置 | 現況 | 後果 |
|------|------|------|
| `agentRunner` → `executeGenerationCommand` | 只傳 `modelId`／`prompt`／`sceneId`／`sceneRole` | 無 `characterIds`／`scenePresetIds`／`sourceAssetId`／`sourceUrl` |
| `workflowRunner` | **已傳** characterIds／scenePresetIds／sourceUrl | 代理比工作流弱 |
| `SubmitCoreInput`／`generationCore` | **已支援**上述欄位 | 缺口在規劃→步驟→Runner，不在 Command |
| 閘門 A：`agentPlanning.safeModel` | 經 `selectAiGenerationModel`；`compatible()` 無 source 時拒 needs | 規劃端靜默落到無 needs 預設圖模 |
| 閘門 B：`agentRunner` generate | `if (model.needs) failRun` | 有 source 也無法跑 i2v／圖生圖 |
| `buildCharacterAnchor` | 只過濾錨點字串 | 外鍵 UUID 仍可能寫入 `generations.character_ids` |

### 2.2 雙閘門必須同改

只改 Runner 透傳、不改 safeModel → 規劃階段模型已被換掉。  
只改 safeModel、不改 Runner → needs 在執行期仍被擋。

### 2.3 與「AI 職能組員」的關係

職能敘事（分鏡助理／生成員）若出圖永遠弱於手動台，產品站不住。  
**CA-01 是職能概念的技術前提**，不是 UI 席位表（見 `ai-project-roles-concept.md`）。

---

## 3. 目標資料流

```text
LLM draft（短代號，禁止 UUID）
  characterRefs: ["char1"]
  scenePresetRefs: ["preset1"]
  sourceAssetRef: "asset3"
  modelId: 可能有 needs
        ↓ resolveCompletePlanDraft
AgentStep（真實 UUID）
  characterIds / scenePresetIds / sourceAssetId / sourceUrl
  modelId（needs+source 時保留）
  points = model.points   ← 估點進 run.estPoints
        ↓ 使用者核准（checkQuota(estPoints)）
        ↓ agentRunner
executeGenerationCommand({ ...四欄 })
        ↓
submitGenerationCore
  assertGenerationEntityIds  ← 扣點前 fail-closed
  estimatePointsFor
  reserveQuota               ← 唯一扣點
  送 Fal；失敗退點
```

核准前仍**零副作用**。解析失敗進 `missingInformation`，不落地半套 step。

---

## 4. 扣點不變式（不可違反）

| 規則 | 說明 |
|------|------|
| **單一寫入** | 媒體生成只走 `executeGenerationCommand` → `submitGenerationCore`（TD-02） |
| **單一帳本** | `reserveQuota`／`cost_ledger`；禁止職能／代理平行免扣點 |
| **順序** | `assertGenerationEntityIds` → 估點 → `reserveQuota` → Fal |
| **估點真實** | needs 模型用解析後 `model.points` 加總進 `step.points`／`run.estPoints` |
| **核准預檢** | `approveAgentCore` 用 `checkQuota(run.estPoints)` |
| **冪等** | 固定 `generationId` 佔位；重試不雙扣 |
| **正式站** | 禁止依賴 `E2E_MOCK` 跳過扣點 |

```text
✅ 對：校驗 id → 估點 → reserveQuota → 送 Fal
❌ 錯：先扣點再發現角色不屬於專案
❌ 錯：agent 直呼 submitGenerationCore 繞過 Command
```

平台 Fal USD 餘額（超管）與站內點數分離，見 fal-balance 計畫。

---

## 5. 契約變更

### 5.1 `shared/plan.ts` — `planStepSchema` 可選欄

```ts
characterIds: z.array(z.string().uuid()).max(6).optional(),
scenePresetIds: z.array(z.string().uuid()).max(4).optional(),
sourceAssetId: z.string().uuid().optional(),
sourceUrl: z.string().url().max(2_000).optional(),
```

舊 run JSON 缺欄 = `undefined`，必須仍可跑。

### 5.2 Draft schema（`agentPlanning` generate arm）

```ts
{
  kind: "generate",
  prompt: string,
  sceneNo?: number,
  modelId?: string,
  characterRefs?: string[],      // ["char1"] max 6
  scenePresetRefs?: string[],  // ["preset1"] max 4
  sourceAssetRef?: string,     // "asset3"
  sourceUrl?: string,          // 僅無 asset；仍走 core SSRF／needs 守門
}
```

### 5.3 `PlannerAliases` 擴充

| 別名 | 代號慣例 | DB | limit 建議 |
|------|----------|-----|-----------|
| `characters` | char1… | `characters` where projectId | 20 |
| `scenePresets` | preset1… | `scene_presets` where projectId | 20 |
| `assets` | asset1… | `assets` where projectId AND deletedAt IS NULL | 30 |

`referenceFor` 增加 type：`character`／`scene_preset`／`asset`。

### 5.4 `AgentStep`（runner）

與 plan 相同四欄可選；voiceover 路徑不強制帶 characterIds。

---

## 6. 規劃端：`resolveGenerateModel`（取代 safeModel）

| 情況 | 行為 |
|------|------|
| 無 `modelId` | `selectAiGenerationModel` 預設 text-to-image（verified） |
| 無 needs | 既有 select 路徑，保留 preferred |
| 有 needs **且** hasSource | **保留** requested（含 image-to-image／i2v）；不經 `AI_GENERATION_CATEGORIES` 過濾掉 |
| 有 needs **但缺 source** | **不**靜默降級；`missingInformation`，該步不進 steps |
| 無效 modelId | missingInformation |
| 未 verified needs 模型 | missingInformation |

說明：`compatible()` 在無 `sourceKind` 時拒絕任何 `model.needs`；且 `AI_GENERATION_CATEGORIES` 不含 `image-to-image`／`image-to-video`。故 needs+source 必須**直接** `resolveModel` + `modelIsOperationallyReady`，不能只靠 `selectAiGenerationModel`。

---

## 7. 執行端：Runner 閘門與透傳

### 7.1 閘門 B（generate）

```ts
const model = resolveModel(step.modelId ?? "");
if (!model || !modelIsOperationallyReady(model)) {
  return failRun(..., "計畫裡的模型無效或尚未通過正式生成驗證");
}
if (model.needs && !step.sourceAssetId && !step.sourceUrl?.trim()) {
  return failRun(..., "此模型需要來源素材…");
}
// 有 needs + 有 source → 放行
```

### 7.2 透傳（模板：`workflowRunner`）

```ts
await executeGenerationCommand({
  auth, source: "agent", backgroundResume: true,
  id: step.generationId, projectId: run.projectId,
  modelId, prompt, sceneId, sceneRole,
  characterIds: step.characterIds,
  scenePresetIds: step.scenePresetIds,
  sourceAssetId: step.sourceAssetId,
  sourceUrl: step.sourceUrl,
  agentRunId: run.id, reasonPrefix: "AI 代理",
});
```

`generationCommand.ts` **形狀不改**（已透傳 `SubmitCoreInput`）。

---

## 8. `assertGenerationEntityIds`（KD-12）

```ts
export async function assertGenerationEntityIds(
  projectId: string,
  opts: { characterIds?: string[]; scenePresetIds?: string[]; sourceAssetId?: string },
): Promise<void>
```

- 每個 character／scenePreset id：存在且 `projectId` 相符  
- 失敗 → `BAD_REQUEST`，**不** insert generation、**不** `reserveQuota`  
- `sourceAssetId` 沿用 generationCore 既有 group／deletedAt／needs 相容檢查  
- **禁止**「靜默 drop 外鍵仍寫入」；與 anchor 過濾分離  

呼叫點：`submitGenerationCore` 在載入 project 之後、扣點之前（對 **所有** 來源：UI／MCP／agent／workflow 一律受益）。

---

## 9. `buildPlannerContext` 與規劃 prompt

- 並行查 characters／scenePresets／assets，寫入 `<角色定裝代號>`／`<場景設定代號>`／`<素材代號>`  
- 硬性規則改為：只可使用 member／note／schedule／task／db／**char／preset／asset** 代號  
- generate 欄位表：`prompt、sceneNo?、modelId?、characterRefs?、scenePresetRefs?、sourceAssetRef?、sourceUrl?`；需要來源的模型必須帶 source；生成依模型扣點  

---

## 10. 必改檔案清單

| 檔案 | 職責 |
|------|------|
| `shared/plan.ts` | 契約四欄 |
| `server/services/agentPlanning.ts` | draft、aliases、resolveGenerateModel、resolve generate 分支 |
| `server/services/agentCore.ts` | buildPlannerContext、規劃 prompt |
| `server/services/agentRunner.ts` | AgentStep、閘門 B、Command 透傳 |
| `server/services/generationCore.ts` | assertGenerationEntityIds |
| `server/services/generationCommand.ts` | **不改形狀** |
| `server/services/agentPlanning.test.ts` | 見測試矩陣 |
| （可選）`shared/planTypes.test.ts` | kinds／欄位鎖 |

**非目標（本 PR 不做）**

- notify／checkpoint（CA-05）  
- continuity_snapshot migration（CA-04a）  
- CreationDraft／intent（CA-02／06）  
- VLM 品管（CA-08）  
- 假 AI 成員帳號  
- LangGraph／CrewAI／Temporal  

---

## 11. 測試矩陣

| # | 案例 | 期望 |
|---|------|------|
| 1 | draft `characterRefs:["char1"]` | step.characterIds = 該專案角色 UUID；sourceRefs 含 character |
| 2 | `characterRefs:["char99"]` | missingInformation；不發明 UUID |
| 3 | needs 模型 + `sourceAssetRef` | 保留 modelId；sourceAssetId 寫入 step |
| 4 | needs 模型、無 source | missingInformation；步驟不落地 |
| 5 | 他專案 character UUID 進 Command | BAD_REQUEST；DB 無新 generation；**未扣點** |
| 6 | 舊 run 無新欄 | 行為與今日相同 |
| 7 | grep | agent 路徑無直接 `submitGenerationCore` 繞過 Command |
| 8 | voiceover | 不因 generate 改動回歸 |
| 9 | 額度不足 | 核准或送出 `PRECONDITION_FAILED` |

```bash
npm test -- agentPlanning agentRunner agentCore generationCore
npm run typecheck
scripts/e2e-agent.py
```

---

## 12. 實作順序（建議 2 sessions）

1. 契約 `plan.ts` + `AgentStep`  
2. `PlannerAliases` + `buildPlannerContext` + prompt  
3. `resolveGenerateModel` + generate resolve 分支  
4. Runner 閘門 B + Command 透傳  
5. `assertGenerationEntityIds` 於 generationCore  
6. 單元測試 + typecheck  
7. e2e-agent（可選 staging）  

分支：`feat/ca-01-agent-generate-parity`  
PR 標題建議含 `CA-01`。

---

## 13. 風險與緩解

| 風險 | 緩解 |
|------|------|
| needs 模型燒點暴增 | 缺 source → missing；估點進 summary；核准 checkQuota |
| 外鍵污染 lineage | assertGenerationEntityIds fail-closed |
| 靜默降級掩蓋使用者意圖 | 禁止 safeModel 對 needs 降級 |
| 雙扣點 | 固定 generationId；禁重送成功 id |
| 手機／職能敘事過載 | UI 不在本 PR；遵循 mobile declutter |

---

## 14. 驗收清單（合併前）

- [ ] 端到端（mock）：char + needs + asset → Command 參數齊全  
- [ ] 外鍵攻擊不落 generation、不扣點  
- [ ] 舊計畫無新欄可跑  
- [ ] grep：agent 無繞過 Command 的 submitGenerationCore  
- [ ] 文件／progress：CA-01 notes 更新；passes 僅合併後改 true  

---

## 15. 與路線圖對照

| 本設計 | 承載 |
|--------|------|
| 代理出圖 = 手動台 | **CA-01**（本文件） |
| 任務牆分清來源 | CA-03 |
| 跨模式草稿 | CA-02 |
| 審片／notify | CA-05 |
| 職能敘事 | ai-project-roles-concept L0–L1 |
| 平台 Fal 餘額 | fal-balance 計畫 |

---

*End of CA-01-DESIGN-2026-07*
