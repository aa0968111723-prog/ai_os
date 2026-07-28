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
| TD-07/07b | PROCESS_ROLE + worker 不提供 SPA | ✅ |
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
| ANIM-02～10 產品域模型 | ANIM-01 adapter 已落地；其餘依賴場景／分鏡產品化 |
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
