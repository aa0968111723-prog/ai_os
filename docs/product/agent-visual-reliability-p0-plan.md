# Agent Visual Reliability & Execution Plan (P0)

> 狀態：Proposed  
> 日期：2026-08-11  
> 相關：`docs/TRUE_AGENT_ROADMAP.md`、`docs/AI_AGENT_CAPABILITY_GAP_AUDIT.md`、`docs/AI代理架構與維運.md`、`docs/AGENT_WORKBENCH_UPGRADE.md`

## 目標

解決兩個核心體感問題：
1. **視覺化不足** — 使用者感覺不到 AI 正在執行
2. **提示詞有時無法真正執行** — 規劃後因 missingInformation / 未知引用 / 失敗解釋不足而卡住或失敗，缺少可行動修復路徑

本文件是 **P0 可交付 PR 的執行規格**，可直接交給終端機或 coding agent 實作。

---

## PR 序列總覽

| 順序 | 分支建議 | 標題 | 優先級 |
|------|----------|------|--------|
| **PR-1** | `feat/agent-failure-clarification-hud` | feat(agent): failure explanation + forced clarification on missingInformation + HUD polish | **P0** |
| PR-2 | `feat/agent-realtime-step-broadcast` | feat(agent): realtime agent-step broadcast + HUD 即時感 | P0/P1 |
| PR-3 | `feat/agent-dag-canvas` | feat(agent-ui): interactive DAG canvas + step detail | P1 |
| PR-4 | `feat/agent-edit-step-kinds` | feat(agent): expand edit step kinds (reorder / update / trim) | P1 |
| PR-5 | `feat/agent-theater-mode` | feat(agent): theater mode (reveal / flash / goTo + synthetic cursor) | P2 |

---

## PR-1 詳細執行規格（本 PR 範圍）

### 終端機指令

```bash
git fetch origin
git checkout -b feat/agent-failure-clarification-hud origin/claude/healing-migration-ai-os-erewp2

# 驗證完成後
npm run typecheck
npm test
npm run test:client:coverage
npm run build
npm run audit:high
```

### 範圍

**要做：**
- 規劃結果含明顯 `missingInformation` 或安全降級時，**強制進入 AgentQuestion 澄清**，不直接給殘缺計畫核准。
- 步驟 / run 失敗時，UI 顯示**結構化失敗說明卡**（原因 + 建議 + 一鍵帶原因重新規劃）。
- `AgentActivityHud` 小幅強化：更清楚顯示卡點與等待原因，保留緊急停止。

**不做：**
- Theater Mode、DAG 畫布、新 step kinds、白板、完整 resume 引擎。

### 建議修改檔案

| 檔案 | 改動方向 |
|------|----------|
| `server/services/agentPlanning.ts` | 強化 missingInformation / 未知引用後決策；必要時產生 question payload |
| `server/services/agentCore.ts` | 規劃後需澄清 → 建立 question 並導向 `waiting_user_input`；失敗寫入結構化 error/event |
| `client/src/components/AgentCard.tsx` | 失敗解釋卡；有 active question 時優先顯示澄清 UI |
| `client/src/components/AgentQuestionCard.tsx` | 支援「規劃前強制澄清」文案與流程 |
| `client/src/app/components/AgentActivityHud.tsx` | 顯示更精準的等待／失敗摘要 |
| `shared/agentEvents.ts`（或 event core） | 新增事件種類（如 `run:needs_clarification`、`step:failed_explained`），仍不記錄 CoT |

### 行為紅線

- 不保存、不展示模型私密 chain-of-thought。
- 花點數／改資料的動作仍須使用者確認。
- 失敗解釋只放結構化原因（kind、依賴、引用失敗、權限、點數等）。
- 前後端契約不漂移。
- 手機 390px 可用。

### 驗收標準

- [ ] 規劃有明顯 missingInformation 時，先出現問題卡，而非直接待核准。
- [ ] 步驟／run 失敗時，AgentCard 顯示結構化原因 + 「帶此原因重新規劃」入口。
- [ ] AgentActivityHud 在 waiting / failed 有清楚摘要，「停」按鈕可用。
- [ ] 既有成功路徑行為不變。
- [ ] typecheck / test / build / audit:high 通過。
- [ ] 新增或更新相關 unit / client 測試。

### 建議 PR 標題與 Body

**標題**
```
feat(agent): failure explanation cards + forced clarification on missingInformation + HUD polish
```

**Body**
```markdown
## 問題
使用者有時覺得代理「聽不懂」或「規劃了卻無法真正執行」。常見原因是：
- 規劃結果含 missingInformation / 未知引用 / 日期模糊，卻仍直接進入待核准
- 失敗時只有籠統錯誤，缺少可行動的解釋與修復路徑
- 跨頁時難以立刻知道目前卡在哪、為什麼在等

## 範圍
- 規劃後若缺少關鍵資訊 → 強制進入 AgentQuestion 澄清
- 失敗步驟 / run 顯示結構化失敗說明卡（原因 + 建議 + 重新規劃）
- AgentActivityHud 小幅強化等待／失敗摘要

## 不在範圍
- Theater mode、DAG 畫布、新 step kinds、白板、完整 resume 引擎

## 行為不變證據
- 正常可執行計畫的規劃 → 核准 → Runner 路徑不變
- 不新增自動寫入；確認門檻維持
- 事件仍不記錄 CoT / 完整 prompt

## 多入口檢查
- 網頁 AgentCard
- AgentActivityHud（跨頁）
- 既有 question 流程

## 驗證
```bash
npm run typecheck
npm test
npm run test:client:coverage
npm run build
npm run audit:high
```

## 相關
- docs/product/agent-visual-reliability-p0-plan.md（本規格）
- docs/AI_AGENT_CAPABILITY_GAP_AUDIT.md
- docs/TRUE_AGENT_ROADMAP.md
- docs/AI代理架構與維運.md
```

---

## 後續 PR 簡要

- **PR-2**：agentRunner 推進時 broadcast → 前端 HUD 即時更新（輪詢保留 fallback）。對應 roadmap C1。
- **PR-3**：`shared/agentDag.ts` 做成互動畫布，嵌進 AgentWorkPanel / AgentCard。
- **PR-4**：嚴格依架構文件「新增步驟種類檢查表」擴充 reorder_scenes、update_scene（含 trim 等）。
- **PR-5**：reveal / flashAnchor / goTo + 合成游標 + 全域急停。

---

## 設計原則提醒

1. 可驗證動作優先，拒絕黑盒 CoT。
2. 使用者主權：隨時可停、高風險寫入需確認。
3. 成本意識：多輪澄清會增加規劃成本，需清楚計點。
4. 向後相容：舊計畫與既有 agent_runs 繼續可讀可跑。
5. 測量驅動：記錄「提示詞 → 最終成功執行」轉換率與常見卡住原因。
