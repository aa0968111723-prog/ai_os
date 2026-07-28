# AI 代理成熟度與測試報告

> 評估日期：2026-07-28
> 範圍：Issue #133 PR A–E 的完整計畫、筆記／排程、人類任務、AI 規劃、DAG、事件與成果。
> 定位：產品候選版（Release Candidate），不是未經營運驗證就宣稱「零缺陷」。

## 結論

程式碼成熟度評分為 **88/100**。系統已從線性生成助手提升為具備結構化計畫、正式人類任務、等待恢復、冪等副作用、DAG、可稽核事件、成果與健康度的專案代理。

達到正式營運仍需要部署環境證據：真實供應商 canary、容量／壓力測試、備份還原演練與 SLO 告警連線。這些不能由單次 PR 或 mock 測試假裝完成。

## 評分

| 面向 | 分數 | 證據 |
|---|---:|---|
| 架構與模組邊界 | 9/10 | shared contract；planning/core/runner/task/event 分層；路由薄殼 |
| 資料模型與 migration | 9/10 | 0006–0009；真 PostgreSQL migrate/check/併發；查詢索引 |
| 權限與專案隔離 | 9/10 | 共用 core、代號解析、每步重驗 ACL、封存與 AI 資料庫權限 |
| 冪等與恢復 | 9/10 | effect receipt、固定 UUID、generation placeholder、split crash matrix、task/run lock |
| 可觀測與稽核 | 9/10 | append-only event、唯一 event key、分頁、健康／阻塞／成果 |
| 自動化測試 | 9/10 | unit、client、real PostgreSQL fault tests、全新 DB E2E、container build |
| 效能與擴張 | 8/10 | DAG provider concurrency、batch runner、advisory lock、索引、清單上限；尚缺正式壓測 |
| UX 與可理解性 | 8/10 | 摘要／軌跡／健康／成果皆收合，明示等待與錯誤；尚缺 CI 真瀏覽器視覺回歸 |
| 維護性與文件 | 9/10 | 擴充檢查表、生命週期／失敗語義、MCP 同契約、分 PR 回退 |
| 正式營運準備 | 8/10 | SLO/事故文件、migration gate、終局通知；需真環境告警與還原證據 |

## 測試矩陣

| 類別 | 覆蓋 |
|---|---|
| 完整計畫 schema | 重複 id、未知／自依賴、循環、里程碑、日期順序 |
| AI 安全解析 | 成員／筆記／排程／任務／資料庫代號、未知引用、模糊日期、模型 fallback |
| DAG | 獨立分支、等待不凍結、生成並行提交、失效依賴 fail-closed、舊計畫線性相容 |
| 人類任務 | 負責人／角色核准、精準 wake、非 current branch、拒絕、重複完成 |
| 真 PostgreSQL | migration、drift/hash、兩 migrator、effect transaction、task concurrency、event dedupe |
| Runner | 生成／拆分鏡 crash recovery、停止競態、權限撤銷、終局訊息 |
| 前端 | 元件與契約測試、型別檢查、production build |
| E2E | 登入→建案→完整規劃→核准→背景完成→事件→成果／健康→放棄 |
| 容器 | non-root 正式映像與 healthcheck |

本機最終前端覆蓋率：Statements 90.44%、Branches 85.02%、Functions 93.75%、Lines 93.91%。正式判定仍以 GitHub CI 保存的 coverage artifact 為準。

CI 必須通過：

```text
npm run audit:high
npm run typecheck
npm test
npm run test:client:coverage
npm run build
scripts/ci-migration-test.sh
scripts/e2e-agent.py
docker build
```

## 已封閉的主要風險

- Runner 重啟後重複建立筆記、排程、任務、分鏡或重複追加。
- 完成任務喚醒錯誤 run／step，或兩人同時完成造成雙重恢復。
- 一個等待分支凍結整份計畫。
- LLM 幻覺 UUID、人名、資料庫、日期或模型後直接產生副作用。
- stop 被 Runner 完成寫回覆蓋。
- 背景 Runner 繞過專案 ACL、封存、額度或資料庫 AI 權限。
- 只顯示「處理中」而沒有來源、動作、等待、成果與失敗原因。
- active run 與免費待核計畫無界堆積、核心查詢缺索引。

## 上線前仍須完成

1. 在 staging 使用真 NVIDIA／Fal／Google 憑證跑低成本 canary，保存 request-id、費用與回滾證據。
2. 以預期尖峰至少 2 倍執行 30–60 分鐘壓測；量測 API p95/p99、DB pool、Runner lag、lock wait 與事件寫入量。
3. 完成 PostgreSQL + Volume 成對還原演練，證明實際 RPO/RTO。
4. 把 `/api/ready`、5xx、Runner stale、provider error、DB/Volume 容量接到值班通知。
5. 依組織法遵決定 `agent_events` 保存年限與冷歸檔，不在未決策前自動刪除稽核事實。
6. 將 `scripts/e2e-ui/verify-agent.mjs` 接入可保存 screenshot 的真瀏覽器視覺回歸環境。

完成以上營運證據後，可依 `docs/SLO與事故應變.md` 將狀態由 Release Candidate 升為正式營運。
