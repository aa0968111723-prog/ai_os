# AI 代理完整優化路線圖（Master Roadmap）

> 狀態：Proposed  
> 日期：2026-08-11  
> 來源：深度架構研究 + 視覺化／執行可靠性優化討論 + PR #625 review 強化  
> 相關：TRUE_AGENT_ROADMAP、AI_AGENT_CAPABILITY_GAP_AUDIT、AGENT_WORKBENCH_UPGRADE、AI代理架構與維運

## 核心問題

1. **視覺化不足** — 使用者感覺不到 AI 正在執行（列表 + status pill，缺少空間感與動作感）
2. **提示詞有時無法真正執行** — missingInformation、step kind 覆蓋不全、失敗解釋弱、waiting 不友善
3. **狀態／事件契約不夠明確** — 規格若沒有 exact predicate、schema、transition，coding agent 容易各自實作出不同版本
4. **既有能力可能被重複實作** — realtime agent-step / invalidate / polling fallback 已存在，後續 PR 應以強化可靠性為主，不重造通道

## 設計原則（紅線）

- 可驗證動作優先，不保存／展示模型私密 CoT
- 花點數／改資料必須使用者確認
- 使用者主權：隨時可停，高風險步驟需確認
- 共享契約零分岔（FE / BE / MCP / Runner）
- 不新增與現有 lifecycle 重疊的 persisted status；優先沿用既有 status contract
- 澄清回答後若會改變計畫內容，必須 **replan → awaiting_approval**，不得直接跳回 running
- 手機 390px 可用；可視化功能同時提供可存取的文字 fallback
- 成本意識：多輪澄清與模擬需計點或至少可被量測
- 所有新功能都要有 backward compatibility、feature flag / rollout、rollback、telemetry
- unknown event / unknown step kind / 失效引用一律 fail-closed，不猜、不假裝成功

## 共用契約（所有後續 PR 必須遵守）

### Clarification lifecycle

規劃階段發現不可安全執行的缺口時，使用：

`planning → needs_clarification → waiting_* → answer_received → replanning → awaiting_approval → running`

其中 `waiting_*` 沿用既有 persisted run status：
- `waiting_user_input`
- `waiting_confirmation`
- `waiting_permission`

不得為同一語義另造 `waiting` / `waiting_user_input_v2` 等第二套 persisted status。若 overview / HUD 需要簡化，可在 presentation layer 映射為共同的「等你回覆」，但原始狀態需保留。

### 結構化 failure / event 基本欄位

所有新增 agent event / failure 至少應能對齊以下安全欄位；不得包含完整 prompt 或 chain-of-thought：

```ts
interface AgentObservableFailure {
  eventId?: string;
  runId: string;
  stepId?: string;
  projectId: string;
  eventType: string;
  status: string;
  reason: {
    code: string;
    category: "missing_input" | "reference" | "permission" | "quota" | "dependency" | "conflict" | "upstream" | "validation" | "unknown";
    userMessage: string;
    retryable: boolean;
    recommendedAction?: "answer" | "replan" | "retry" | "request_permission" | "add_quota" | "contact_support";
  };
  sequence?: number;
  occurredAt?: string;
}
```

現有 `AgentDagProgress.reason: string` 可繼續存在作為顯示摘要；若有 structured reason，string 必須由 structured reason 投影產生，不能反過來解析自由文字當真實狀態。

## PR 序列（依優先級）

| 順序 | 文件 | 分支建議 | 優先級 | 一句話目標 |
|------|------|----------|--------|------------|
| **PR-1** | [agent-visual-reliability-p0-plan.md](./agent-visual-reliability-p0-plan.md) | `feat/agent-failure-clarification-hud` | **P0** | 失敗可理解 + 規劃不足先澄清 + 安全 replan + HUD 強化 |
| **PR-2** | [agent-pr2-realtime-broadcast.md](./agent-pr2-realtime-broadcast.md) | `feat/agent-realtime-ux-hardening` | **P0/P1** | 強化既有 realtime：排序、重連、去舊事件、push/poll merge、可觀測性 |
| **PR-3** | [agent-pr3-dag-canvas.md](./agent-pr3-dag-canvas.md) | `feat/agent-dag-canvas` | P1 | 互動式 DAG 畫布，依賴與進度一目了然且具 fallback |
| **PR-4** | [agent-pr4-edit-step-kinds.md](./agent-pr4-edit-step-kinds.md) | `feat/agent-edit-step-kinds` | P1 | 補齊編輯型步驟，含 revision/conflict/idempotency/rollback |
| **PR-5** | [agent-pr5-theater-mode.md](./agent-pr5-theater-mode.md) | `feat/agent-theater-mode` | P2 | 頁面操演劇場，看得見 AI 在操作但不干擾真人 |

## 建議實施順序

1. 合併本文件集前，先把 review 指出的 contract / lifecycle / branch / Markdown 問題補齊
2. 讓 implementation base branch 的 typecheck / client tests 回到 green，建立可靠基線
3. 實作 PR-1 → 先解決「卡住不知道為什麼」與澄清後安全回到 approval
4. 實作 PR-2 → **強化既有 realtime**，不要重做 agent-step broadcast
5. PR-3 / PR-4 可並行，但都必須沿用 PR-1/2 的共用 event contract
6. PR-5 最後做高衝擊可視化，避免先做表演層再補可靠性

## 每一個 implementation PR 的固定驗收章節

每份後續 PR 都必須明列：

- **Feature flag / rollout**：如何小流量開啟、如何關閉
- **Backward compatibility**：至少一份 pre-change plan fixture + pre-change agent_run fixture
- **Mixed-version / multi-replica**：新舊 replica 同時存在時不應重複 side effect 或遺失狀態
- **Rollback**：關 flag 或 rollback binary 後，舊資料仍可讀
- **Observability**：成功率、失敗分類、等待時間、event lag、reconnect recovery
- **Failure policy**：未知 event / status / step kind fail-closed
- **Stop semantics**：停止請求需有 acknowledgement，pending navigation / reveal / execution 一併取消
- **CI**：typecheck / unit / client / build；動到執行路徑時再加 e2e-agent / PG race tests

## 測量指標建議

- 提示詞 → 最終成功執行轉換率
- missingInformation 觸發率與澄清後成功率
- clarification → replan → approval 成功率
- 失敗後「重新規劃」使用率與成功率
- HUD 緊急停止使用次數與停止 acknowledgement latency
- 平均 / p95 waiting 時間
- realtime event delivery p50 / p95、reconnect recovery time、stale event drop 次數
- duplicate side-effect 防護命中數
- unknown event / unknown step kind fail-closed 次數
