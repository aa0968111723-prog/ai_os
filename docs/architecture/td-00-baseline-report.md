# TD-00 技術債治理基線報告

> 狀態：**本批技術債主線已落地**（TD-00～10 核心 + ANIM-00/01 + GPU-00/01 + HIGH 批次已關 + 部分 MEDIUM 快修）  
> 日期：2026-07-28  
> 分支：`feat/td-core-policy-command-worker`（PR #155）

## 1. 已落地總表

| ID | 項目 | 狀態 |
|---|---|---|
| TD-00 | 基線報告與政策矩陣測試 | ✅ |
| TD-01 | Policy Engine | ✅ |
| TD-02 | Generation Command（Web/MCP/workflow/agent） | ✅ |
| TD-03 | 專案狀態機 active/paused/archived | ✅ |
| TD-04 | SSRF 回歸 | ✅ |
| TD-05a | auth.me capabilities | ✅ |
| TD-05b | 導覽 capability 閘門 | ✅ |
| TD-06 | AppShell / AppRoutes / Header 拆分 | ✅ |
| TD-07/07b | PROCESS_ROLE + worker 不提供 SPA + readiness 區分 web/worker runner | ✅（見 §5 殘件） |
| TD-08 | schema 領域拆檔 + orphan report | ✅ |
| TD-09 | cost ledger 模型文件與 shared types | ✅（無破壞 migration） |
| TD-10 | import boundary ADR + check script | ✅ |
| ANIM-00 | 動畫純契約與基線測試 | ✅ |
| ANIM-01 | Production / Sequence / Shot adapter | ✅ |
| GPU-00 | CloudInferenceProvider + Beam mock | ✅ |
| GPU-01 | free image PoC `submitCloudMock` | ✅ |
| Commands | schedule / note / task / database write | ✅ |
| HIGH | 封存專案 UI、generateInto kind、prompt max、錄音 cleanup、auth leak、zombie 佔位 generation、UUID、UI refresh | ✅ 本批已關 |
| MEDIUM 快修 | 釘選留言恒在、knowledge purge 清 textVersions、scenePresets readOnly／isError、角色卡 isError、資料庫列 canDelete 對齊建立者 | ✅ 部分 |

## 2. 刻意未一次做完（需獨立 PR／營運）

| 項目 | 原因 |
|---|---|
| PostgreSQL RLS | 獨立大 migration 與跨入口負向測試 |
| 正式監控／備份還原演練 | 需平台帳號與演練窗口 |
| ANIM-02～10 產品域模型 | ANIM-01 adapter + ANIM-02 continuity pure foundation 已落地；DB 版本表與後續依賴場景／分鏡產品化 |
| GPU-02～ 真實 Beam | 需 secret 與部署；本批僅 mock |
| REST 生成入口 | **未部署**（`/api/v1` 僅 databases／CSV／ICS，見 `server/services/restApi.ts`），故延期；日後若新增 REST 生成必須走 `executeGenerationCommand`（不可直呼 core） |
| 細節缺漏 MEDIUM/LOW 全表 | 219 項；HIGH 已關；其餘按路線圖 |

## 3. 驗證命令

```bash
npm run typecheck
npm run check:boundaries
npm run report:orphans   # 無 DATABASE_URL 時 skip exit 0
npm test
npm run test:client
```

## 4. 回退

- Policy／Command 為薄殼，可改回直呼 core
- schema 拆檔為 re-export，回退可合併檔案
- PROCESS_ROLE 預設 `all`，行為與舊部署一致

## 5. TD-07 remaining（刻意未做／低風險殘件）

已落地：

- `PROCESS_ROLE=web|worker|all`（`server/services/processRole.ts`）
- web **不**啟動背景 Runner（generation／workflow／agent／export／feedback／calendar sweep）
- worker **不**掛 SPA 靜態檔；非 API catch-all 回 503 JSON（TD-07b）
- `/api/ready` 回傳 `processRole`；web 的 `components.runner` 為 skipped，不拖垮就緒

刻意未做（需獨立 PR，避免大重寫）：

| 殘件 | 現況 | 建議後續 |
|---|---|---|
| `createApp()` / 完整 bootstrap 拆檔 | 僅有 `server/bootstrap/httpSurface.ts`、`runnerReadiness.ts`；路由仍在 `server/index.ts` | 依 `docs/核心模組拆解計畫.md` 分階段抽出 |
| worker 剝除產品 API（tRPC／REST／upload） | worker 仍掛完整 API 表面（與 monorepo 單映像共用 process 一致）；僅 SPA 關閉 | 部署拆映像後再加 HTTP surface 閘門 |
| 多 replica 同工作去重 | 既有 runner advisory lock／CAS；非本批範圍 | 維運多 replica 時回歸 lease fencing |
