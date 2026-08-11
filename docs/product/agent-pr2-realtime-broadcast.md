# PR-2：Realtime Agent-Step Broadcast + HUD 即時感

> 優先級：P0/P1  
> 對應：TRUE_AGENT_ROADMAP C1、AgentActivityHud 設計意圖

## 目標

把「背景 4 秒輪詢」升級為「步驟推進即推播」，讓使用者跨頁也能立刻知道 AI 在做什麼。

## 終端機指令

```bash
git checkout -b feat/agent-realtime-step-broadcast origin/claude/healing-migration-ai-os-erewp2
```

## 範圍

**要做：**
- `agentRunner` 每步狀態變更時，透過既有 realtime 通道 broadcast（`agent-step` 訊息型別）
- 前端 AgentActivityHud / AgentCard 改為優先吃推播，輪詢保留為 fallback
- HUD 顯示目前步驟 note、進度分數、專案名、緊急停止

**不做：**
- 完整 Theater（reveal / 合成游標）— 留給 PR-5
- 新 step kinds

## 建議修改檔案

- `server/services/agentRunner.ts` — 掛廣播點（step start / done / failed / waiting）
- realtime 相關（server 廣播 API、client 訂閱）
- `client/src/app/components/AgentActivityHud.tsx`
- `client/src/components/AgentCard.tsx`（進度更新來源）

## 驗收標準

- [ ] 步驟推進後 < 1–2 秒內 HUD 更新（網路正常時）
- [ ] WS 斷線時仍能靠輪詢恢復
- [ ] 「停」按鈕跨頁可用
- [ ] 既有成功路徑與點數結算不變
- [ ] typecheck / test / build 通過

## 建議 PR 標題

```
feat(agent): realtime agent-step broadcast + HUD live progress
```
