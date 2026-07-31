# Fable 5 執行規格：#133 Residual × 創作代理短版 × 決策軌跡

> **給 Claude Fable 5 / Claude Code 的工作單**  
> 分支建議：`feat/133-creation-agent-decision-trace`  
> 關聯：Issue #133  
> 原則：最小相容變更、可獨立合併、每階段先 plan 再實作、必須有測試證據  
> **禁止**：一次改完所有 Runner／UI／MCP；禁止要求模型輸出 raw chain-of-thought

---

## 0. 現況基線（已完成，勿重做）

以下已在 default 落地，**只擴充、不重寫**：

| 項目 | 路徑 |
|------|------|
| 完整 Plan 契約 | `shared/plan.ts` |
| notesCore + 冪等 append | `server/services/notesCore.ts` |
| taskCore / scheduleCore | `server/services/taskCore.ts`, `scheduleCore.ts` |
| Runner 新 kind | `server/services/agentRunner.ts`（create_note / schedule / task / wait / approval） |
| 規劃與職能 | `server/services/agentPlanning.ts`, `agentCore.ts` |
| 職能／Playbook | `shared/aiProjectRoles.ts`, `shared/rolePlaybooks.ts` |
| 事件軌跡 | `server/services/agentEventCore.ts`（只記可驗證事實） |
| 工作台入口 | `client/src/features/creation-workbench/modes/PlanMode.tsx`, `AgentCard.tsx` |
| MCP 工具目錄 | `shared/mcpCatalog.ts` |

事件與遙測**刻意不存** raw reasoning（見 `agentEventCore`、`agentPlannerTelemetry`）。維持此原則。

---

## 1. 總目標

1. 補齊 Issue #133 **UI／深連結／成果回寫／規劃上下文** residual。  
2. 產品化 **創作代理短版**（固定短 playbook + 工作台入口）。  
3. 對使用者**公開結構化決策軌跡**（rationale / contextUsed / 事件面板），**不是**模型原始 CoT。  
4. 釐清組代理 × 全站工具與創作主路徑的邊界。

---

## 2. 階段切分（必須依序，可開多個 PR）

### PR-1：決策軌跡 schema + 規劃輸出（後端契約）

**目標**

- 在計畫摘要／步驟上增加給人看的結構化說明欄位。  
- 規劃 prompt 要求輸出這些欄位；**禁止**要求「公開所有思考過程／逐步心智草稿」。

**變更範圍**

1. `shared/plan.ts`  
   - `completePlanSummarySchema` 增加可選：  
     - `rationale?: string`（≤500，繁中，為何這樣排計畫）  
     - `contextUsed?: string[]`（≤30，標籤如「專案世界觀」「筆記摘要」「成員花名冊」）  
   - `planStepSchema` 增加可選：  
     - `rationale?: string`（≤300，為何需要此步）  
   - 更新 `planTypes.test.ts` 接受與拒絕案例。

2. `server/services/agentPlanning.ts` / `agentCore.ts`  
   - 規劃 system／user 指示：必須填 summary.rationale（1–3 句）與關鍵步驟 rationale。  
   - 明確寫：**禁止**輸出 Markdown 思考過程、chain-of-thought、內部推理草稿；只輸出 JSON 契約欄位。  
   - 若供應商有 summarized thinking：可選記錄於**僅管理員可見**或完全不落庫；預設不存。

3. 解析／正規化時保留 rationale／contextUsed 進 `planSummary` 與 steps（不破壞舊 run）。

**驗收**

- [ ] 舊 plan JSON 仍可 parse。  
- [ ] 新欄位有單元測試。  
- [ ] 規劃提示不含「公開所有思考／逐步列出內心推理」類措辭。

**邊界**：不改 Runner 執行語意；不改 MCP。

---

### PR-2：AgentCard／PlanMode — 過程面板 + 深連結 + outputRefs

**目標**

- 使用者可看到：計畫 rationale、缺資訊、風險、事件時間軸、每步產出。  
- 點筆記／排程／任務步驟可深連到對應頁或錨點。

**變更範圍**

1. `client/src/components/AgentCard.tsx`  
   - 核准前／執行中顯示「過程」區塊：  
     - summary.goal / successCriteria / missingInformation / risks / rationale / contextUsed  
     - 既有 agentEvents 列表（若 API 已有則接上；否則用 run 事件摘要）  
   - 步驟列：  
     - 顯示 `step.rationale`（若有）  
     - `outputRefs` / noteId / scheduleItemId / taskId 做成可點 chips  
     - deep link 建議：  
       - note → `/planner` 或既有筆記路由 + `#note-{id}` 或 query  
       - schedule → 排程錨點 `#schedule-{id}`  
       - task → 任務路由  
       - generation → 既有生成紀錄入口  
   - 延續創作者語彙（待你過目／開拍中／等你回覆）。

2. `client/src/features/creation-workbench/modes/PlanMode.tsx`  
   - 必要時露出過程摘要；不破壞 compactComposer。

3. 筆記／排程列表（若有現成頁）  
   - 若 row 有 `planRunId`：顯示「來自計畫」徽章 + 連回工作台 `#sec-agent` 或 run。

**驗收**

- [ ] 有 rationale 的 run 在 UI 可見。  
- [ ] 完成的 create_note 步驟可點到筆記。  
- [ ] 不引入新重依賴；型別與既有 AgentStep 相容。

**邊界**：不做完整重設計；不搬整頁筆記進工作台。

---

### PR-3：創作代理短版 playbook + 入口

**目標**

- 固定短骨架：快速可交付影音／圖文，而非完整專案排程長計畫。

**變更範圍**

1. `shared/rolePlaybooks.ts` 新增：

```ts
{
  id: "playbook.creation.short.v1",
  roleId: "role.storyboard", // 或新增 role.creation；優先複用 storyboard/generate
  version: "1",
  title: "創作代理（短版）：腳本→分鏡→定裝生成→可選配音／送審",
  goalTemplate: "依專案世界觀與現有腳本／分鏡，產出可審的一版影音或圖文",
  plannerHint:
    "短版創作：優先 split_script? → create_scene? → generate（必帶定裝／來源）→ voiceover? → submit_approval?。" +
    "除非使用者明確要求排程／物資／多人分工，否則不要預設 create_schedule 或大量 create_task。" +
    "缺日期／缺腳本 → missingInformation，禁止臆測。" +
    "summary.rationale 用 1–3 句說明為何這條短路徑足夠。",
  suggestedKinds: ["split_script", "create_scene", "generate", "voiceover", "submit_approval"],
}
```

2. 工作台入口（`creation-workbench` 相關）  
   - 「創作代理」或「快速開拍」：預填短版 goal／playbook，導向 PlanMode + AgentCard。  
   - 與「完整多步計畫」（長版）文案區隔清楚。

3. `shared/aiProjectRoles.ts`（可選）  
   - 若需要獨立職能 `role.creation`：title「創作代理」、kindHints 對齊短版；否則在 UI 用 playbook id 即可。

**驗收**

- [ ] playbook 有測試或既有 playbook 測試覆蓋新 id。  
- [ ] 短版提示明確限制 schedule／大量 human task。  
- [ ] 長版 #133 路徑不受影響。

---

### PR-4：規劃上下文對齊全站狀態（輕量）

**目標**

- 規劃前注入與 MCP `get_project_status` 同級的摘要（分鏡／生成／排程／待辦／筆記數），供短版與長版共用。

**變更範圍**

1. `agentCore` / `agentPlanning` 組 prompt 處：  
   - 確保有專案全貌摘要（可重用既有 service，避免重複查詢邏輯分叉）。  
   - `contextUsed` 應能反映實際注入的區塊名稱。

2. 文件一句：組級 MCP 工具服務創作代理讀寫，但**執行仍只走 agent_run + Runner**，不開第二條扣點路徑。

**驗收**

- [ ] 無專案脈絡時 missingInformation 會出現。  
- [ ] 不顯著增加 token（摘要有截斷）。

**邊界**：不實作新的 multi-agent runtime；不把 feedbackAgent 混進創作主路徑。

---

### PR-5：冪等與重啟測試補強（排程／任務）

**目標**

- 對齊 #133 驗收情境三：Runner 重啟不重複建立 schedule／task。

**變更範圍**

1. 檢查 `create_schedule` / `create_task` 是否與 `appendNoteOnceCore` 同等使用 `executeAgentEffectOnce`。  
2. 不足則補 effect 包裝 + `*.pg.test.ts` 或既有 idempotency 測試風格。  
3. 封存專案、跨組 assignee 負向測試若缺則補。

**驗收**

- [ ] 重播同一 effectId 不產生第二筆排程／任務。  
- [ ] CI 可跑相關測試。

---

## 3. 明確不做（Out of scope）

- 要求任何模型「公開所有原始思考過程」或存 raw CoT。  
- 重寫 agentRunner 狀態機。  
- 新的獨立 multi-agent 進程或假 AI 帳號。  
- 一次合併 PR-1～PR-5 為單一巨大 runtime PR。  
- 自動對外寄信／大量通知（#133 原文已排除）。  
- PostgreSQL RLS / 資安 residual / 備份演練（另案）。

---

## 4. Fable 5 工作方式（強制）

```
目標：依 docs/product/FABLE5-執行規格-133-創作代理-決策軌跡.md 實作 PR-1（先只做 PR-1）。
為什麼：#133 核心已落地；需要可給使用者看的結構化決策說明，且不觸發 reasoning_extraction。

邊界：
- 只做 PR-1 範圍
- 不要重構無關模組
- 不要在 prompt 要求輸出 chain-of-thought
- 保持舊 plan JSON 相容

方法：
1. 先讀 shared/plan.ts、agentPlanning.ts、agentCore 規劃段、planTypes.test.ts
2. 產出簡短實作計劃與風險
3. 等確認或自行在邊界內實作
4. 跑相關單元測試
5. 回報：變更檔案、測試證據、剩餘風險
```

完成 PR-1 後，用同一文件把「PR-1」改成「PR-2」再跑下一輪。

---

## 5. 完成定義（整包）

- [ ] 使用者可在 UI 看到計畫 rationale、缺資訊、風險、事件與步驟產出連結  
- [ ] 創作代理短版 playbook + 入口可用，且預設不灌排程長計畫  
- [ ] 規劃 JSON 含結構化 rationale／contextUsed；無 raw CoT 落庫  
- [ ] 筆記／排程／任務步驟深連結可用  
- [ ] 排程／任務 effect 重播安全  
- [ ] Issue #133 更新 residual 狀態（本 PR 文件可當依據）

---

## 6. 參考

- Issue #133 本文  
- `docs/AI代理成熟度與測試報告.md`  
- `shared/mcpCatalog.ts`（全站工具表面）  
- 決策軌跡原則：可驗證事實 + 結構化說明；不是模型內部 token
