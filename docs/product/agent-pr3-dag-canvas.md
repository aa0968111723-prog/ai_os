# PR-3：Interactive DAG Canvas + Step Detail

> 優先級：P1  
> 對應：shared/agentDag.ts、AgentCard 目前把 dependsOn 壓縮成 chip 的痛點

## 目標

把步驟依賴從文字列表變成**可互動的節點圖**，讓使用者一眼看到並行支線、阻塞點與目前進度。

## 終端機指令

```bash
git checkout -b feat/agent-dag-canvas origin/claude/healing-migration-ai-os-erewp2
```

## 範圍

**要做：**
- 新元件（建議 `AgentDagCanvas`）：節點 = step，邊 = dependsOn
- 即時狀態上色（pending / running / waiting / done / failed / stopped）
- 點擊節點展開 rationale、sourceRefs、outputRefs、實際結果
- 嵌入 AgentWorkPanel 或 AgentCard 可展開區域
- 使用 `shared/agentDag.ts` 純函式（已在 shared，符合 ADR-009）

**不做：**
- Theater 頁面跳轉
- 新 step kinds

## 建議修改檔案

- 新增 `client/src/components/AgentDagCanvas.tsx`（或 features 下）
- `client/src/components/AgentCard.tsx` / `AgentWorkPanel.tsx` — 整合入口
- 必要時 CSS / design tokens
- 測試：契約測試 + 簡單渲染測試

## 驗收標準

- [ ] DAG 模式計畫能正確畫出依賴邊
- [ ] 狀態顏色與 Runner 實際狀態一致
- [ ] 點擊可看 rationale / refs
- [ ] 手機 390px 可用（可橫向捲動或簡化）
- [ ] typecheck / test / build 通過

## 建議 PR 標題

```
feat(agent-ui): interactive DAG canvas for plan steps
```
