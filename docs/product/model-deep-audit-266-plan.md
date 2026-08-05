# 計畫：266 模型深度研究與長時間實測（大更新）

> 狀態：**待終端分批／多代理執行**（本 PR 為計畫＋操作契約）  
> 分支：`plan/model-deep-audit-266` → base `claude/healing-migration-ai-os-erewp2`  
> 版本：**v2.1**（2026-08-05）— Fal **NT$1,000**、多代理租約鎖、黃金題組、LLM-as-Judge（#421）、**研究完成後回寫站內指南／代理／所有相關面**  
> 單一真相：`shared/models.ts` → `MODELS`（**266**）  
> 工具：`verify-models.ts`、`probe-fal-endpoints.ts`、`audit-model-pricing.ts`、`gen-model-docs.ts`、`e2e-models.py`、`e2e-mcp.py`  
> 配套：#421、`docs/模型底層邏輯與運作流程.md`、`docs/模型指南研究補遺.md`

---

## 0. v2／v2.1 摘要

| 項目 | 內容 |
|------|------|
| Fal 預算 | 台幣 **1000**，softStop **900**，`budget.json` |
| 深度 | 暴露面、黃金題組、Judge、情境一致性 |
| 多代理 | 號段並行；locks 租約；唯一 live-worker |
| **收尾回寫（v2.1）** | 審計結論必須進 **站內模型指南、代理、MCP、情境、測試**，不可只停在 model-audit 資料夾 |

---

## 1. 目標（每模必答）

數值｜底層｜站內點數｜實際呼叫｜輸入｜情境｜API／MCP｜（有 artifact 時）Judge

**非目標：** 266 全高清生成；腳本自動 `verified true`（須人工 PR）。

---

## 2. Fal 台幣預算

`docs/model-audit/budget.json`：`budgetTotal=1000`，`softStop=900`，只計 fal 帳單。  
`--yes` 前檢查；僅 live-worker 可寫 spent；估點≥80 預設少測或跳過。

---

## 3. 腳本鐵律

空輸入 probe 批次；live 單次 `--probe`；無 `--yes` 不付費；禁止 for 多 id live；多代理禁止並行 `--yes`。

---

## 4. 分層 L0–L8

L0 靜態 → L1 連通 → L2 校準 → L3 input 契約 → L4 live → L5 站內扣點 → L6 暴露面／情境 → L7 MCP／文件 → L8 Judge（#421）

---

## 5. 黃金題組

`docs/research/model-golden-set.md`：zh-poster、portrait-solemn、ink-scene、i2v-still、tts-sutra、ocr-zh 等；同題跨模比較。

---

## 6. 多代理租約鎖

`locks/range-*.json`、`live-probe.json`、`probe-coord.json`；產物分片 cards／rows；角色 R／P／L／judge。

---

## 7. 波次 B0–B9

| 波 | 內容 |
|----|------|
| B0–B3 | 骨架、L1、L2、暴露面研究（0～≈0 元） |
| B4–B6 | live、Judge、扣點／MCP 抽樣（吃預算） |
| **B9 回寫上線** | **見 §14** — 研究／實測結論合入站內 |

---

## 8. 完成定義（含回寫）

- [ ] 266 × L0＋L1＋L2  
- [ ] budget ≤ 1000  
- [ ] 代表性 live／broken／需調點清單  
- [ ] **§14 回寫清單已執行或逐項標「暫緩＋理由」**  
- [ ] `npx tsx scripts/gen-model-docs.ts` 後指南與目錄一致  
- [ ] 相關測試／e2e 未因錯 id 紅燈  

---

## 9–13. 報告模板／提示詞／文件對照／風險

（同 v2：cards 模板、多代理 60s 提示詞、budget、locks、單代理提示詞。）

---

## 14. 研究完成後：回寫站內（必做）

審計資料夾 **不是終點**。結論要進產品與代理行為，且 **單一真相仍是 `shared/models.ts`**（文件多由腳本生成）。

### 14.1 回寫總原則

1. **先合入 MODELS／SCENARIO／STYLE／WORKFLOW**，再跑生成腳本與重跑測試。  
2. **一個邏輯修復一個小 PR**（錯 id、調 points、改 recommended、改情境首選分開亦可）。  
3. 不把「未 live」的模強行 `verified: true`。  
4. 回寫 PR 描述連結對應 `cards/<slug>.md` 或 _index 列。  
5. 代理／助手提示詞若寫死模型 id，必須與目錄同步改。

### 14.2 清單：站內模型指南與目錄

| 動作 | 路徑／指令 |
|------|------------|
| 修正 id／points／cost／tier／needs／verified／strengths／bestFor／recommended | `shared/models.ts` → `MODELS` |
| 情境首選／替代／why | `SCENARIO_RECIPES`／`SCENARIO_GROUPS`（同檔或關聯 export） |
| 風格 PK 勝負 | `STYLE_SHOWDOWNS` |
| 工作流步驟用模 | `WORKFLOW_PRESETS` |
| **重生人讀指南** | `npx tsx scripts/gen-model-docs.ts` → `docs/模型目錄.md` |
| 清查清單 | `npx tsx scripts/verify-models.ts` → `docs/模型清查清單.md` |
| 點數報告 | `npx tsx scripts/audit-model-pricing.ts` → `docs/點數校準報告.md` |
| 連通報告 | `docs/fal端點連通報告.md`（probe 產出） |
| 研究補遺矛盾項 | 對照 `docs/模型指南研究補遺.md` C 節，關閉或開 fix |

站內「模型指南」UI 若讀 API／MODELS 而非靜態 md，**改 MODELS 即生效**；若有快取，部署後確認。

### 14.3 清單：創作台／分鏡／預設

| 動作 | 說明 |
|------|------|
| 工作台預設 modelId | 與 recommended、L4 成功模對齊 |
| 分鏡可選列表過濾 | 排除 broken／NOT_FOUND；needs 提示 |
| 直接出圖／圖生影片入口 | 暴露面矩陣結論 |
| 空狀態推薦 | 經濟檔＋已 verified 優先 |

### 14.4 清單：代理（Agent）與助手

| 動作 | 說明 |
|------|------|
| 助手 ask／工具「列模型／挑模型」 | 讀同一 MODELS；勿殘留死 id |
| `scenarioPlaybook`／情境手冊 | 模型引用與 SCENARIO_RECIPES 一致 |
| Agent 計畫步驟 generate | 與手動台同火力（CA-01）；needs／定裝 |
| 規劃用 LLM（NIM／any-llm） | 僅在目錄與 check-nim 通過後維持 |
| 系統提示中的範例模型名 | 全文搜尋舊 id 替換 |

### 14.5 清單：MCP

| 動作 | 說明 |
|------|------|
| MCP 可調模型列表 | 與站內 ACL／目錄一致 |
| generate 參數 | modelId 白名單 = MODELS |
| e2e | `scripts/e2e-mcp.py` 迴歸 |

### 14.6 清單：計價與權限

| 動作 | 說明 |
|------|------|
| points 調整 | 依 L2＋Fal 帳單抽樣；另 PR |
| BYOK 路徑 | 若審計發現分叉，文件化並對齊 UI |
| 失敗退點 | 與 generationCore 行為一致（已有則補測試） |

### 14.7 清單：測試與維運

| 動作 | 指令／文件 |
|------|------------|
| 模型 e2e | `e2e-models.py`（mock／真扣點路徑分離） |
| 單元／契約 | models 相關 test |
| 維運手冊 | 每月 L2、verified=false 佇列（`docs/維運手冊.md`） |
| 審計歸檔 | model-audit 保留作證據，不刪 |

### 14.8 回寫 PR 建議拆分

```text
feat/model-audit-fix-ids      → NOT_FOUND／錯 slug
feat/model-audit-points         → 調點與 cost 字串
feat/model-audit-scenarios      → SCENARIO／STYLE／WORKFLOW
feat/model-audit-verified       → 僅人工確認過的 verified true
feat/model-audit-agent-mcp      → 提示詞、playbook、MCP 列表
docs: gen-model-docs 與報告重生（可附在上述 PR）
```

### 14.9 回寫完成檢查（勾選）

```
[ ] MODELS 無已知 404 id
[ ] gen-model-docs 已跑、模型目錄／指南與程式一致
[ ] SCENARIO_RECIPES 的 pickIds 皆 getModel 得到
[ ] 工作台／分鏡預設非 broken
[ ] 助手／agent／MCP 無死 id（搜尋舊 id）
[ ] e2e-models／e2e-mcp 相關綠或已知 skip
[ ] budget 與 broken 清單在 model-audit 可追溯
```

---

## 15. 主代理收尾指令（研究波次結束後貼上）

```text
審計波次已結束。執行 model-deep-audit-266-plan §14 回寫：
1) 匯總 _index：broken、需調點、建議 verified、情境矛盾
2) 開/做 fix PR：先 id／points，再 SCENARIO／STYLE／WORKFLOW
3) 跑 gen-model-docs.ts、verify-models.ts、audit-model-pricing.ts
4) 搜尋並更新助手／agent playbook／MCP 中的死 id
5) 對齊工作台與分鏡預設模型
6) 跑 e2e-models／e2e-mcp 可行範圍
7) 回報 §14.9 勾選狀態；未做項標暫緩理由
禁止：無證據批量 verified true；超過 Fal 預算再 live。
```

---

## 16. 多代理 60s／角色提示詞

同 v2 §10（R／P／L／judge + budget softStop=900）。研究期結束後主代理改跑 §15，不再派無預算 live。
