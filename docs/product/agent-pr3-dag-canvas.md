# PR-3：Interactive DAG Canvas + Step Detail

> 優先級：P1  
> 對應：shared/agentDag.ts、AgentCard 目前把 dependsOn 壓縮成 chip 的痛點

## 目標

把步驟依賴從文字列表變成**可互動的節點圖**，讓使用者一眼看到並行支線、阻塞點與目前進度；同時確保大型 DAG、非法 DAG、手機與無障礙情境都不會失效。

## 終端機指令

```bash
git fetch origin
git checkout -b feat/agent-dag-canvas origin/main
```

## 範圍

**要做：**
- 新元件（建議 `AgentDagCanvas`）：節點 = step，邊 = dependsOn
- 即時狀態呈現（pending / running / waiting / done / failed / stopped）
- 點擊節點展開 rationale、sourceRefs、outputRefs、observable result / failure reason
- 嵌入 AgentWorkPanel 或 AgentCard 可展開區域
- 使用 `shared/agentDag.ts` 純函式與既有共享契約，不在 UI 重寫 DAG 邏輯
- 新增 invalid-DAG fallback：cycle、missing dependency、duplicate id 時不能白屏
- 新增 large-DAG 策略：100+ steps 時仍可操作
- 提供文字版 / list fallback，鍵盤與 screen reader 可完整取得同等資訊

**不做：**
- Theater 頁面跳轉
- 新 step kinds
- 不把模型私密 CoT 當 rationale；只顯示既有可公開 rationale / observable evidence

## DAG validation contract

Canvas render 前必須先跑 shared validation / normalization。至少處理：

```text
valid
missing_dependency
cycle_detected
duplicate_step_id
empty_plan
unsupported_status
```

失敗策略：
- `missing_dependency` / `cycle_detected`：顯示「計畫結構有問題」+ 文字步驟列表 + 重新規劃入口，不嘗試猜圖。
- `duplicate_step_id`：fail-closed，不讓錯誤節點互相覆蓋。
- `unsupported_status`：以 unknown 視覺呈現，但原始值保留在 detail；不可當 done。

## Large DAG 策略

100+ steps 必須避免一次渲染所有昂貴 detail：
- 預設只畫節點與邊，detail lazy render
- 可按 phase / branch collapse
- viewport culling / virtualization（若使用的 graph lib 支援）
- layout 計算不可在每個 realtime event 全量重跑；只有 graph topology 變更才重 layout
- status change 只 patch 對應 node

效能目標建議：
- 100 steps / 200 edges：初次可互動 < 1s（一般桌機開發環境作相對基準）
- 單一 status update 不觸發全圖重新 layout

## Accessibility / mobile

- 每個 node 可 keyboard focus
- Enter / Space 打開 detail
- Arrow key 或 Tab 能在 nodes 間移動（選一種一致策略）
- node accessible name 至少包含：step label + status + dependency count
- 不只靠顏色表示狀態；需 icon / text
- 提供「切換文字流程」入口，screen reader 可讀完整 dependency / status
- 手機 390px：預設簡化為可橫向捲動或 branch list，不強迫縮到看不清
- reduced-motion 時不做大幅自動平移 / zoom animation

## 建議修改檔案

- 新增 `client/src/components/AgentDagCanvas.tsx`（或 features 下）
- 可新增 `AgentDagListFallback.tsx`
- `client/src/components/AgentCard.tsx` / `AgentWorkPanel.tsx` — 整合入口
- `shared/agentDag.ts` — 若缺 validation / normalization，優先在 shared 補純函式
- 必要時 CSS / design tokens
- 測試：shared contract + rendering + a11y + large graph smoke

## Realtime integration

- 只消費 PR-1/PR-2 的共享 status / observable event contract。
- status update 只更新 node state，不自己訂閱第二套 realtime channel。
- reconnect 後以 authoritative run snapshot 重建圖，避免只靠增量事件造成缺節點。

## Rollout / rollback

- Canvas 以 UI feature flag / progressive disclosure 開啟；關閉時回到既有 list / AgentWorkPanel。
- 不改 persisted plan schema，或只做 additive field；rollback 後 plan 仍可被舊 UI 讀。
- graph library 若新增 dependency，要檢查 bundle size；可 lazy-load Canvas，避免拖慢所有頁面首屏。

## 驗收標準

- [ ] DAG 模式計畫能正確畫出依賴邊與並行 branch。
- [ ] 狀態與 Runner authoritative snapshot 一致，realtime 更新不重排整張圖。
- [ ] 點擊 / 鍵盤可看 rationale / refs / observable result。
- [ ] cycle / missing dependency / duplicate id 不白屏，改走 fail-closed fallback。
- [ ] 100+ steps smoke test 可操作，不因每次 status update 全量 layout。
- [ ] 手機 390px 可用。
- [ ] screen reader / keyboard 有完整文字 fallback；不只靠顏色。
- [ ] reduced-motion 友善。
- [ ] feature flag 關閉可回原 UI。
- [ ] typecheck / test / client coverage / build 通過。

## 建議 PR 標題

```text
feat(agent-ui): interactive DAG canvas with scale and accessibility fallbacks
```
