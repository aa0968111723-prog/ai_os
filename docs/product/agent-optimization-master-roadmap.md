# AI 代理完整優化路線圖（Master Roadmap）

> 狀態：Proposed  
> 日期：2026-08-11  
> 來源：深度架構研究 + 視覺化／執行可靠性優化討論  
> 相關：TRUE_AGENT_ROADMAP、AI_AGENT_CAPABILITY_GAP_AUDIT、AGENT_WORKBENCH_UPGRADE、AI代理架構與維運

## 核心問題

1. **視覺化不足** — 使用者感覺不到 AI 正在執行（列表 + status pill，缺少空間感與動作感）
2. **提示詞有時無法真正執行** — missingInformation、step kind 覆蓋不全、失敗解釋弱、waiting 不友善

## 設計原則（紅線）

- 可驗證動作優先，不保存／展示模型私密 CoT
- 花點數／改資料必須使用者確認
- 使用者主權：隨時可停、高風險步驟需確認
- 共享契約零分岔（FE/BE/MCP/Runner）
- 手機 390px 可用
- 成本意識：多輪澄清與模擬需計點

## PR 序列（依優先級）

| 順序 | 文件 | 分支建議 | 優先級 | 一句話目標 |
|------|------|----------|--------|------------|
| **PR-1** | [agent-visual-reliability-p0-plan.md](./agent-visual-reliability-p0-plan.md) | `feat/agent-failure-clarification-hud` | **P0** | 失敗可理解 + 規劃不足先澄清 + HUD 強化 |
| **PR-2** | [agent-pr2-realtime-broadcast.md](./agent-pr2-realtime-broadcast.md) | `feat/agent-realtime-step-broadcast` | P0/P1 | 即時推播，讓進度「感覺在跑」 |
| **PR-3** | [agent-pr3-dag-canvas.md](./agent-pr3-dag-canvas.md) | `feat/agent-dag-canvas` | P1 | 互動式 DAG 畫布，依賴與進度一目了然 |
| **PR-4** | [agent-pr4-edit-step-kinds.md](./agent-pr4-edit-step-kinds.md) | `feat/agent-edit-step-kinds` | P1 | 補齊編輯型步驟，真正能執行創意意圖 |
| **PR-5** | [agent-pr5-theater-mode.md](./agent-pr5-theater-mode.md) | `feat/agent-theater-mode` | P2 | 頁面操演劇場，看得見 AI 在操作 |

## 建議實施順序

1. 合併本文件集（docs PR）
2. 實作 PR-1 → 立刻改善「卡住不知道為什麼」
3. 實作 PR-2 → 立刻改善「感覺沒在跑」
4. PR-3 / PR-4 可並行（UI 與能力擴充）
5. PR-5 作為高衝擊 demo（可搭配白板）

## 測量指標建議

- 提示詞 → 最終成功執行 轉換率
- missingInformation 觸發率與澄清後成功率
- 失敗後「重新規劃」使用率
- HUD 緊急停止使用次數
- 平均 waiting 時間
