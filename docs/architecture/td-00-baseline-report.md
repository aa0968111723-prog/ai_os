# TD-00 技術債治理基線報告

> 狀態：In progress（隨 TD-01～03 首批落地同步建立）  
> 日期：2026-07-28  
> 分支：`feat/td-core-policy-command-worker`

## 1. 目的

在重構擴散前，把「多入口政策／專案狀態／成本門檻」鎖成可失敗測試，並記錄現況。

## 2. 已落地（本批次）

| 項目 | 位置 | 狀態 |
|---|---|---|
| Policy Engine | `server/services/policyEngine.ts` | implemented |
| 政策矩陣測試 | `server/services/policyEngine.test.ts` | implemented |
| 專案狀態機 | `server/services/projectState.ts` | implemented |
| assertProjectNotArchived → 狀態機 | `server/services/projectAcl.ts` | adapted |
| Generation Command | `server/services/generationCommand.ts` | implemented |
| Web 生成／重試 | `server/routers/generation.ts` | wired |
| 分鏡就地生成／配音 | `server/routers/scenes.ts` | wired |
| MCP `submit_generation` | `server/services/mcp.ts` | wired |
| PROCESS_ROLE | `server/services/processRole.ts` + boot | implemented |
| SSRF 回歸補強 | `databaseFiles.test.ts` | extended |
| TD-05a capabilities on auth.me | `policyEngine` + `auth.me` + `client/src/capabilities.ts` | implemented |
| TD-06 AppShell 拆分 | `client/src/app/*` | implemented（partial） |
| TD-07b worker 不提供 SPA | `server/bootstrap/httpSurface.ts` | implemented |
| GPU-00 CloudInferenceProvider | `server/services/cloudInference/*` | implemented（mock only） |

## 3. 多入口覆蓋矩陣

| 入口 | generation.submit 政策 | 狀態機 generate | 備註 |
|---|---|---|---|
| Web / tRPC direct | ✅ Command | ✅ | `executeGenerationCommand` source=web |
| MCP | ✅ Command | ✅ | source=mcp |
| REST `/api/v1` | ⏳ open | ⏳ | 若部署暴露 REST 生成入口需下一 PR 接 Command |
| workflow runner | ✅ Command | ✅ | source=workflow, backgroundResume |
| agent runner | ✅ Command | ✅ | source=agent, backgroundResume |
| approval resume (`decideCost`) | ⏳ open | ✅ 既有 archived 守衛 | 待改 assertProjectAllows(approve) |
| schedule / background | N/A 生成 | ✅ scheduleCore 既有 | |

## 4. 安全回歸（P0）

| 案例 | 測試／程式 | 狀態 |
|---|---|---|
| 字面私網／localhost／metadata | `databaseFiles.test.ts` ssrfGuardError | verified |
| DNS 解析後 isPrivateIp | `databaseFiles.test.ts` isPrivateIp | verified |
| 成本門檻 policy 預判 | `policyEngine.test.ts` | verified（core 仍為最終扣點真相） |
| 封存不得生成 | projectState + generationCore | verified |
| 暫停不得生成 | projectState（UI 尚未全面暴露 paused） | implemented |
| XFF 登入限流 | 既有 rateLimit 測試 | open（本批未重跑 e2e） |

## 5. 後續 PR（不得一次做完）

1. ~~TD-02b / TD-03b / TD-05a / TD-06 partial / TD-07b / GPU-00~~（本分支已落地）
2. **TD-05b**：導覽改吃 `hasCap` / capability，拿掉 `isAdmin\|\|isLeader` 拼湊
3. **TD-06 續**：AppHeader / PrimaryNavigation / notification 子模組
4. **TD-08～10**、ANIM-＊、GPU-01～：見 `technical-debt-remediation-plan.md`

## 6. 成功定義（本批）

- [x] 政策純函式矩陣：跨 source 一致
- [x] 主要人類生成入口走單一 Command
- [x] MCP 生成走同一 Command
- [x] 封存／暫停狀態機可測
- [x] PROCESS_ROLE 可關 Runner
- [x] 全部 runner 入口 Command 化
- [ ] REST 契約測試
- [ ] 全站 e2e 綠燈於 CI

## 7. 風險與回退

- Command 僅封裝既有 `submitGenerationCore`，扣點／fal 行為不變。
- 回退：router 改回直接 `submitGenerationCore` + 舊 assertAccess 即可。
- `PROCESS_ROLE=web` 時背景生成不會推進——多實例部署需至少一個 worker/all。
