# 現階段優先建議（2026-08-05）

> **狀態**：分析入庫（本 PR 僅文件，不改執行碼）  
> **觸發**：研究程式碼與最近 PR 後，回答「現階段要做什麼比較好」  
> **基礎分支**：`claude/healing-migration-ai-os-erewp2`  
> **相關**：  
> - [`creation-workbench-ux-cleanup-plan.md`](./creation-workbench-ux-cleanup-plan.md)（#400，P0–P2 已合）  
> - [`project-context-ux-cleanup-plan.md`](./project-context-ux-cleanup-plan.md)（#402；C0/C1 已合，C2 見 #407）  
> - [`byok-phase2-implementation-plan.md`](./byok-phase2-implementation-plan.md)（待實作）  
> - [`rag-knowledge-base-roadmap.md`](./rag-knowledge-base-roadmap.md)（向量 RAG 非 P0）  
> - [`creative-agent-roadmap-progress.md`](./creative-agent-roadmap-progress.md)（CA-*；禁止 LangGraph runtime）

---

## 1. 一句話結論

**先把正在進行的 UX 與 hotfix 收尾，接著做 BYOK Phase 2；暫緩 InstantID／Diffusers／LangGraph／向量 RAG。**

目前 repo 能量集中在「讓既有強大後端更好用」與「修生產回歸」。大整合方向仍正確，但現在上會與進行中的減噪／定裝一體化衝突，也容易再出現檔案清空類回歸。

---

## 2. 現況盤點（研究日：2026-08-05）

### 2.1 最近主線（約 8/4）

| 類型 | 項目 | 狀態 |
|------|------|------|
| UX | 工作台減噪 P0–P2（#400 → #401/#403） | 已合 |
| UX | 世界觀 C0 減噪（#405） | 已合 |
| UX | 定裝 Tab C1（#406） | 已合 |
| UX | C0–C2 完整堆疊（#407） | **open** |
| Docs | 反創意固著設計約束（#408） | **open** |
| Docs | 「陪你做完」共創引導 Session（#404） | 已合（計畫） |
| Hotfix | GenerationList 還原（#388） | **open** |
| Hotfix | MCP `handleMcp` export（#369） | **open** |
| Fix | Zeabur schema introspect CrashLoop（#397–#399） | 已合 |
| BYOK | Phase 1 存 key／測／開關 | 已上線 |
| BYOK | Phase 2 接 generation + 免平台點 | **僅有計畫文件** |

### 2.2 能力成熟度（與「大整合」相關）

| 能力 | 現況 |
|------|------|
| 角色／場景／道具文字錨點 | 有（`worldview`、`cardAnchors`、生成注入） |
| 角色視覺 identity（InstantID 等） | **無** |
| 專案知識庫全文注入 | 已上線（釘選／preferIds／預算） |
| 向量 RAG | **未做**；路線圖明訂非當前 P0 |
| Agent DAG／冪等／恢復／HITL | 已成熟 |
| LangGraph 等外部 agent runtime | **明確禁止**（見 CA progress tracker） |
| Fal 生成主路徑 | 穩定；開源 Diffusers 備援未接 |
| 個人 fal key（BYOK） | 能存，生成仍走平台 key |

### 2.3 程式碼側觀察

- 後端核心（`agentCore`、`agentRunner`、`generationCore`、`shared/plan.ts`）完整且測試多。
- 前端近期重點在 `creation-workbench` 與 `ProjectPage` 上下文減噪。
- 曾出現 PLACEHOLDER／誤清空回歸（GenerationList、MCP 等），收尾與合併需更謹慎。

---

## 3. 優先順序（建議執行）

### P0 — 本週收尾（穩定性 + 進行中 UX）

1. **合併或收斂 #407**（C0–C2 世界觀減噪／定裝 Tab／揭示回到原處）  
   - 這是目前最完整的「① 上下文 ↔ ② 工作台 ↔ ③ 分鏡」一體化 PR。  
   - 合併前：rebase、確認衝突、跑既有 client 測試與手動 checklist。

2. **合併 #408**（反創意固著設計約束）  
   - 純文件，成本低；作為後續「陪你做完」實作 checklist。

3. **確認 hotfix**  
   - #388 GenerationList：若 main 已恢復完整檔則關閉；否則合併。  
   - #369 MCP：若 Zeabur 建置仍失敗，優先補 `mcp.transport` 還原。

### P1 — 下一個正式功能 PR：BYOK Phase 2

**為什麼現在做這個：**

- Phase 1 已交付，使用者能存 key 但體驗「接了還扣平台點」不完整。  
- 已有完整實作計畫：[`byok-phase2-implementation-plan.md`](./byok-phase2-implementation-plan.md)。  
- 範圍清楚、不引入新 runtime、不碰向量庫／GPU worker。  
- 直接提升付費／重度使用者價值與成本透明度。

**實作請另開分支**（例：`feat/byok-phase2-wire-generation`），嚴格照該文件 checklist，勿與 UX 大 PR 混裝。

### P2 — 產品體驗延續（擇一或小步並行）

| 選項 | 說明 |
|------|------|
| 「陪你做完」G0–G2 | **已合** #416/#419/#422；G3 可選未開 |
| CA-01 Agent generate parity | 代理生成路徑對齊 characters／presets／source／needs；**不**引入 LangGraph |
| Context C3 | 空專案旅程／階段文案（#407 out of scope） |

### P3 — 為「視覺一致性」鋪路（輕量、可選）

在定裝 UX 穩定後，可開**極小** PR：

- 角色卡／定裝 schema 增加 `referenceImages`（路徑陣列）欄位與上傳 UI。  
- **不**接 InstantID／Diffusers／Python worker。  
- 目的：資料與產品契約先就位，之後再做視覺 identity PoC。

---

## 4. 明確暫緩（現階段不要開大 PR）

| 項目 | 原因 |
|------|------|
| InstantID / IP-Adapter / Diffusers worker | 定裝 UX 與生成主路徑尚未完全收斂；引入 Python sidecar 維運成本高 |
| LangGraph / CrewAI 等外部 agent runtime | CA 路線圖明文禁止；現有 DAG 已夠用 |
| 向量 RAG MVP | 文件明訂：量與痛點未達門檻前不開；現行注入 + 釘選優先 |
| 開源影片模型全面備援 | 依賴 GPU 配額與路由策略；應在 BYOK 與主路徑穩定後再做 |
| 大型多代理重構 | 與正在進行的 UX／hotfix 搶同一套 agent／generation 核心 |

這些方向仍保留在中長期願景（見先前整合討論），但**不是現在的 P0/P1**。

---

## 5. 建議的 PR 切法（終端機／代理）

```text
本週
  docs/current-stage-priority-2026-08     ← 本文件（已開）
  合併 #407、#408；關閉或合併 #388/#369

下一個功能
  feat/byok-phase2-wire-generation       ← 嚴格照 byok-phase2-implementation-plan.md

之後（擇一）
  feat/co-create-guided-session-g0       ← #404 + #408 checklist
  feat/ca-01-agent-generate-parity       ← CA progress tracker
  feat/character-reference-images-schema ← 僅欄位 + UI，不接 HF pipeline
```

**一功能一 PR**；有 migration 必跑 `scripts/ci-migration-test.sh`；合併前至少：

```bash
npm run typecheck && npm test && npm run test:client
```

---

## 6. 與「GitHub + Hugging Face 大整合」的關係

先前討論的完整整合（視覺 identity、開源生成、RAG、多代理編排）仍是合理中長期路線，但**必須嵌入本檔優先序**：

1. 先讓使用者能穩定、低認知負荷地用現有定裝與工作台。  
2. 先讓個人 key 真正生效（成本與體驗）。  
3. 再以小步 PoC 引入視覺一致性與（在條件成立時）向量 RAG。  
4. 代理進化走 CA-*，不另起一套 framework。

---

## 7. 驗收（本文件本身）

- [ ] 團隊同意 P0／P1 順序  
- [ ] #407／#408 有明確負責人與合併期限  
- [ ] BYOK Phase 2 實作 PR 開出前，本文件已合入或被引用於 PR 描述  
- [ ] 任何 InstantID／RAG／LangGraph 相關 PR 必須先對照本檔「暫緩」條款並說明為何提前

---

## 8. 維護

- 優先序變更時更新本檔日期與表格，勿另開互相衝突的「總路線圖」而不回寫。  
- 與 `creative-agent-roadmap-progress.md`、`rag-knowledge-base-roadmap.md` 衝突時：**以各主題文件的硬約束為準**（例如禁止 LangGraph、RAG 啟動條件），本檔只排期。
