# 技術債 PR 驗收清單

本清單適用於 `TD-*` 系列 PR。提交者與 Reviewer 應逐項確認；不適用項目必須在 PR 說明中寫明原因。

## 1. 範圍

- [ ] PR 只處理一個主要架構邊界。
- [ ] 若因依賴必須跨邊界（極少見；預設應拆成如 TD-05a／TD-05b），PR 說明已寫清：跨邊界理由、依賴順序、驗收條件與回退方式。
- [ ] PR 說明列出明確的「不在範圍」。
- [ ] 沒有順便修改無關 UI、文案、模型目錄或資料表。
- [ ] 變更可獨立回退，不依賴尚未合併的隱藏提交。

## 2. 行為基線

- [ ] 修改前已有對應測試，或本 PR 先新增可證明舊行為的測試。
- [ ] PR 說明指出哪些行為必須保持不變。
- [ ] 新舊路徑在遷移期有 adapter 或相容層。
- [ ] 若移除舊路徑，已列出並檢查所有 caller。

## 3. 多入口一致性

涉及重要寫入時，必須檢查：

- [ ] Web / tRPC direct
- [ ] REST（若存在）
- [ ] MCP
- [ ] workflow runner
- [ ] agent runner
- [ ] approval resume
- [ ] schedule / background resume

對相同 actor、action、project state 與成本條件：

- [ ] 權限結果一致。
- [ ] 核准需求一致。
- [ ] 額度與扣點結果一致。
- [ ] 稽核與事件結果一致。
- [ ] 錯誤碼與使用者可理解訊息沒有互相矛盾。

## 4. 權限與租戶隔離

- [ ] 不新增新的零散 `isAdmin` / `isLeader` 判斷。
- [ ] 使用統一 Policy / capability helper。
- [ ] team、group、project ownership 都由後端驗證。
- [ ] 前端隱藏入口不被當成安全控制。
- [ ] 跨組、跨團隊與未知資源 ID 有拒絕測試。
- [ ] MCP read-only / scope 限制仍有效。

## 5. 專案生命週期

- [ ] `active` 行為有測試。
- [ ] `paused` 行為有測試。
- [ ] `archived` 行為有測試。
- [ ] archived 不會建立新工作、寫入資源或扣點。
- [ ] 恢復專案是顯式動作並留下稽核。

## 6. 成本、核准與冪等

- [ ] 預估成本在提交前完成。
- [ ] 核准門檻無法被 workflow、agent 或 MCP 繞過。
- [ ] 額度檢查與資料寫入具交易一致性。
- [ ] 外部重試使用 idempotency key 或等效機制。
- [ ] Runner 重啟不會建立重複生成、筆記、排程、任務或事件。
- [ ] 失敗、取消與退款／回補語意明確。

## 7. 安全

- [ ] 使用者輸入有 Zod 或等效 schema 驗證。
- [ ] URL fetch 重新驗證 DNS、解析 IP 與每次 redirect。
- [ ] 不允許 private、loopback、link-local 或 metadata 位址。
- [ ] 不將 token、cookie、prompt、私人 URL 或個資寫入 log。
- [ ] 新增外部整合時有 timeout、大小限制與錯誤清理。
- [ ] 重要安全修復有 PoC 回歸測試。

## 8. 資料庫

- [ ] migration 可在現有資料上執行。
- [ ] 提供 dry-run 或前置資料檢查。
- [ ] nullable / backfill / constraint 的順序安全。
- [ ] 有 rollback 或 forward-fix 說明。
- [ ] 新表／欄位的租戶歸屬清楚。
- [ ] foreign key、unique、check、index 已評估。
- [ ] 大表查詢避免無上限 list 與全欄位載入。

## 9. Worker 與部署

- [ ] 多 replica 不會重複執行工作。
- [ ] 使用 transaction、advisory lock、claim token 或 queue lease。
- [ ] graceful shutdown 能停止領取新工作並排空進行中工作。
- [ ] readiness 不會出現假綠燈。
- [ ] Web 與 Worker 的必要環境變數已文件化。
- [ ] migration 不會在一般 request path 隱性執行。

## 10. 前端

- [ ] UI capability 來自後端真相來源或統一映射。
- [ ] 主要入口沒有被藏進不合理的帳號選單。
- [ ] 管理員、組長、一般成員都有導覽測試。
- [ ] loading、empty、error、forbidden 狀態都有處理。
- [ ] 鍵盤、focus、ARIA 與 reduced motion 沒有退化。
- [ ] 手機與桌面主要流程已驗證。

## 11. 測試命令

至少執行（對齊本 repo `package.json`；`npm test`／`test:client` 已是 `vitest run`，無需再加 `--run`）：

```bash
npm run typecheck
npm test
npm run test:client
npm run build
npm run audit:high
```

等價命令可接受（例如 CI job 內部分步驟、或 `npm run test:all` 覆蓋 server+client），但 PR 說明須列出**實際執行**的指令與結果。

依變更範圍追加：

- [ ] PostgreSQL integration test
- [ ] MCP E2E
- [ ] agent / workflow E2E
- [ ] security regression
- [ ] migration dry-run
- [ ] production-like readiness / shutdown test

## 12. PR 說明必填欄位

```markdown
## 問題
目前哪一條規則分散、重複或可被繞過？

## 範圍
本 PR 只處理什麼？

## 不在範圍
下一個 PR 才處理什麼？

## 行為不變證據
列出測試或前後結果。

## 多入口檢查
Web/tRPC、REST、MCP、workflow、agent、approval resume、schedule/background 哪些已驗證？哪些延期？

## 資料與 migration
是否有 schema 變更、dry-run 與回退？

## 風險與回退
如何快速關閉或回復舊路徑？

## 驗證
實際執行的命令與結果。
```

## 13. 禁止合併條件

出現以下任一狀況時不得合併（§3 多入口為**強制 gate**，非建議項）：

- 涉及重要寫入卻只修 direct path，未檢查 workflow / agent / MCP（及適用時的 REST、approval resume、schedule／background resume），且未在 PR 說明標示延期理由。
- 以「內部呼叫」為理由略過權限或核准。
- 封存專案仍可產生新成本。
- 沒有測試就移除相容路徑。
- migration 無法在真實既有資料上安全執行。
- 新增第二套角色、成本或狀態判斷。
- CI 通過但重要人工驗收仍未完成，且 PR 沒有標示風險。

## 14. 完成定義

技術債 PR 的「完成」不是程式碼搬完，而是：

1. 規則只有一個正式真相來源。
2. 所有入口使用相同規則。
3. 舊路徑有明確遷移或已完整移除。
4. 安全、成本、租戶與生命週期都有回歸測試。
5. 下一位開發者能從文件與 API 看懂不可破壞的契約。