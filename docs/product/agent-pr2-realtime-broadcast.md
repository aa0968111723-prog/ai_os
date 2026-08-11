# PR-2：Realtime Agent UX Hardening

> 優先級：P0/P1  
> 對應：TRUE_AGENT_ROADMAP C1、AgentActivityHud 設計意圖  
> 備註：既有 repository 已有 `notifyAgentProgress`、`agent-step` / `invalidate` 與 polling fallback；本 PR **不重做 realtime 通道**。

## 目標

把既有 realtime 從「有推播」強化成**可靠、可排序、可恢復、可觀測**的代理進度體驗，解決：
- stale / out-of-order event 覆蓋新狀態
- WS 斷線後恢復慢或不知道是否漏事件
- push 與 polling 競態造成 UI 跳回舊狀態
- HUD 只能看粗粒度狀態，缺少 waiting reason / stop acknowledgement / latency evidence

## 終端機指令

```bash
git fetch origin
git checkout -b feat/agent-realtime-ux-hardening origin/main
```

## 既有能力盤點（不要重做）

實作前先驗證並沿用：
- `recordAgentEventSafely` / agent event 持久化
- `notifyAgentProgress`
- realtime 的 `agent-step` / `invalidate`
- client global invalidate → `agentOverview` refresh
- `AgentActivityHud` polling fallback

若現況已能完成其中一項，**只補缺口，不另造第二套 socket / event bus / subscription store**。

## 範圍

**要做：**
- 為 agent progress event 增加可比較的 monotonic `sequence` 或等價 revision；同一 run 舊 sequence 不得覆蓋新狀態。
- realtime payload 至少能安全識別：`runId`、`stepId?`、`projectId`、`eventKey`、`sequence?`、`occurredAt?`。
- client 建立 push / polling merge 規則：以 server revision / sequence 為準，不以「最後抵達」為準。
- WS reconnect 後主動 invalidate / refetch authoritative overview，不能假設斷線期間沒有漏事件。
- duplicate event / reconnect replay 必須 idempotent。
- `AgentActivityHud` 顯示：目前步驟 note、專案名、done/total、waiting kind/reason、停止狀態。
- Stop UX 加 acknowledgement：`停止中…` → authoritative run status 到 `stopped` / terminal 後才算完成。
- 加入 event delivery / refresh latency telemetry（至少可量 p50 / p95）。

**不做：**
- 重新設計另一套 WebSocket 協定或另一個 realtime service
- 完整 Theater（reveal / 合成游標）— 留給 PR-5
- 新 step kinds

## 建議共用事件欄位

```ts
interface AgentProgressSignal {
  schemaVersion: 1;
  runId: string;
  stepId?: string;
  projectId: string;
  eventKey: string;
  sequence?: number;
  occurredAt?: string;
}
```

若 sequence 暫時無法一次落地，可先使用 persisted event 的穩定排序鍵 / revision，但規格必須明確指出 source of truth，不能用 client `Date.now()` 猜順序。

## Push / Polling merge 規則

1. **Persisted server state 是 authoritative source。**
2. Push 是低延遲 signal，可觸發局部更新或 invalidate。
3. Polling / refetch 用來補漏與 reconnect recovery。
4. 若兩份資料可比較 revision：只接受較新 revision。
5. 若暫無 revision：push 只當 invalidate，不直接覆寫完整 run snapshot，直到 authoritative query 回來。
6. project 切換／run 切換後，晚到的舊 run event 必須丟棄。

## 建議修改檔案

- `server/services/realtime.ts` — 只擴充必要欄位 / ordering / replay-safe semantics
- `server/services/realtimeBus.ts` — multi-replica ordering / duplicate tolerance（若需要）
- agent event core / `notifyAgentProgress` producer
- `client/src/realtime.tsx` — stale event drop / reconnect recovery / authoritative invalidate
- `client/src/app/components/AgentActivityHud.tsx`
- `client/src/components/AgentCard.tsx`
- `teamAssistant.agentOverview` DTO / query（waiting detail、revision 如需）

## Failure / reconnect 情境

至少測：
- event 2 比 event 1 先抵達
- 同一 event 收兩次
- WS 斷線 30 秒後重連
- 斷線期間 run 已完成
- polling 舊 snapshot 在 push 新事件之後才回來
- 使用者切到另一 project，上一 project event 晚到
- stop request 已送但 WS 掉線
- multi-replica 兩邊各自發同 run event

## Rollout / rollback

- 新 payload 欄位一律 additive，舊 client 可忽略未知欄位。
- 若引入 ordering logic，建議 feature flag 或 client capability gate；關閉後仍回到既有 invalidate + polling 路徑。
- rollback 不得要求資料 migration 才能讀舊 event。

## 驗收標準

- [ ] 正常網路下步驟狀態變更後 HUD p95 < 2 秒可見。
- [ ] out-of-order / duplicate event 不會讓 HUD 倒退。
- [ ] WS 斷線後仍能靠 polling 更新；重連後會主動 authoritative refetch。
- [ ] late event 不會污染已切換 project / run。
- [ ] waiting_user_input / waiting_confirmation / waiting_permission 都能顯示正確標籤或 reason。
- [ ] 「停」按鈕跨頁可用，並有停止 acknowledgement 狀態。
- [ ] 既有成功路徑與點數結算不變。
- [ ] 單機、Redis / multi-replica 路徑都不重複 side effect。
- [ ] telemetry 能量到 delivery / refresh latency 與 reconnect recovery。
- [ ] typecheck / test / client coverage / build 通過。

## 建議 PR 標題

```text
feat(agent): harden realtime progress ordering, recovery, and HUD state
```
