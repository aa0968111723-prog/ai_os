# ADR-009：Import Boundary（分層依賴規則）

- 狀態：Accepted
- 日期：2026-07-28
- 適用範圍：`client/`、`server/routers/`、`server/services/` 的靜態 import
- 相關：TD-10（`chore(architecture): 加入 ADR 與 import boundary`）

## 決策

Aios 以三層邊界約束依賴方向，避免頁面／Router／Service 互相穿透、商業規則複製或前端 bundle 拉入後端實作：

```text
client  ──HTTP/tRPC──▶  server/routers  ──call──▶  server/services
   │                         │                          │
   │  ✗ 不得 import          │  ✗ 不得 import           │  ✗ 不得 import
   └──── server/*            └──── client/*             └──── routers/*
         （見例外）                                        （見例外）
```

`shared/` 為跨端共用契約（型別、純函式、常數），三層皆可依賴；`shared` 不得反向依賴 `client` 或 `server`。

## 規則

### 1. Client 不得 import `server/*`

- `client/**` 不得以相對路徑或別名 import `server/` 底下任何模組（含 `.ts` 實作與型別）。
- 前端只透過 HTTP／tRPC 與後端通訊；執行期與建置產物不得嵌入 server 原始碼。
- **允許的替代**：
  - 共用型別／常數放在 `shared/`。
  - tRPC 程序呼叫僅經 `client` 端 trpc client（執行期走網路）。

### 2. Server routers 不得 import `client/*`

- `server/routers/**` 不得依賴 React 頁面、hooks 或任何 `client/` 模組。
- Router 職責：輸入驗證、組裝 Policy／Command／service 呼叫、回傳結果。

### 3. Services 不得 import routers（新程式一律禁止）

- `server/services/**` 不得 import `server/routers/**`。
- 正確方向：Router → Service；Runner／MCP／Command 亦只呼叫 Service。
- 若邏輯目前仍掛在 router 檔（例如 helper／core 函式），應逐步抽到 `server/services/*` 或 `shared/*`，而不是讓 service 回頭 import router。

## 既有例外（legacy allowlist）

下列為 **pre-existing** 違規，由 `scripts/check-import-boundaries.mjs` 明確 allowlist。**不得新增**；後續 PR 應逐項移除並從 allowlist 刪除。

### Client → server（tRPC `AppRouter` 型別）

僅為編譯期型別推導，仍耦合 client 編譯圖到 server 樹；理想狀態改為 `shared` 或產生型別檔。

| 檔案 | 匯入 |
|---|---|
| `client/src/api.ts` | `../../server/routers`（`import type { AppRouter }`） |
| `client/src/components/MessagePanel.tsx` | `../../../server/routers` |
| `client/src/pages/AdminPage.tsx` | `../../../server/routers` |
| `client/src/pages/ChatPage.tsx` | `../../../server/routers` |
| `client/src/pages/MembersPage.tsx` | `../../../server/routers` |

### Services → routers（業務 helper 尚未下沉）

| 檔案 | 匯入 | 說明 |
|---|---|---|
| `server/services/agentCore.ts` | `../routers/knowledge`（`buildKnowledgeContext`） | 知識 helper 仍在 router 檔；模型決策已下沉至共用 service |
| `server/services/agentRunner.ts` | `../routers/director`、`../routers/assistant` | 分鏡拆本、scene fill 仍在 router |
| `server/services/agentSplitRecovery.pg.test.ts` | `../routers/director` | 測試沿用 `splitScriptCore` |
| ~~`server/services/generationCore.ts`~~ | ~~`../routers/characters`、`../routers/scenePresets`~~ | ✅ 已下沉 `services/cardAnchors`（角色＋場景錨點） |
| `server/services/messageAssistant.ts` | `../routers/knowledge` | 同上 knowledge helper |
| `server/services/restApi.ts` | `../routers/schedule`（`buildIcs`） | ICS 建置仍在 schedule router |

## 下沉先例：`agentDag` → `shared/`（2026-08-07）

規則 1 列出的「允許的替代」——**純函式下沉到 `shared/`**——的第一個實作案例，記錄於此作為後續同類需求的範本：**不要為了讓前端讀後端邏輯而擴大 allowlist，要把邏輯搬到 `shared/`。**

| 項目 | 內容 |
|---|---|
| 移動 | `server/services/agentDag.ts` → `shared/agentDag.ts`（測試一併移至 `shared/agentDag.test.ts`） |
| 動機 | 前端要把代理步驟依賴畫成時間軸（哪幾步平行、哪幾步被前一步連坐擋住），必須跑與後端同一套 DAG 求解規則 |
| 為何可以搬 | 該模組 **零 import**、純函式、不碰 DB 與執行——完全符合「跨端共用契約」的定義 |
| 更新的引用 | `server/services/agentRunner.ts`、`server/services/taskCore.ts`、`server/services/agentCore.ts` 改為 `../../shared/agentDag` |
| allowlist 變化 | **無**。這正是重點：規則 1 的正解是下沉，不是加例外 |

若日後前端需要其他後端邏輯，先問「這段是不是純函式」；是就搬 `shared/`，不是就先抽純函式再搬，兩者皆非才討論其他方案。

## 強制機制

- 腳本：`scripts/check-import-boundaries.mjs`
- npm：`npm run check:boundaries`
- 行為：掃描 `client/` 與 `server/` 的靜態 `import`／`export … from`／`require`／動態 `import()`；命中禁止邊且不在 allowlist 則 **exit 1**。
- 新增 allowlist 項目必須在本 ADR 同步說明理由與移除條件；預設 PR 審查拒絕擴大 allowlist。

## 驗收

- `npm run check:boundaries` 在乾淨樹上通過（僅 allowlist 內例外）。
- 新程式若跨層 import，腳本必須失敗。
- 本 ADR 與 allowlist 內容一致。

## 後果

### 正面

- 依賴方向可機器檢查，減少「service 倒吃 router」與前端誤拉後端。
- 後續抽 Command／Policy 時邊界更清楚。

### 代價

- 遷移前需維護 allowlist；tRPC `AppRouter` 型別仍暫時穿層。
- 純文字掃描不解析 re-export 圖的全部間接依賴（以直接 import 為主，足以防回歸）。

## 後續工作（非本 PR 範圍）

1. 將 `AppRouter` 型別匯出路徑收斂到不拖入 server 實作的契約（或 codegen）。
2. 把 `buildKnowledgeContext`、`splitScriptCore`、`buildIcs`、character/scene anchor 等 helper 下沉至 `server/services/*` 或 `shared/*`，並清空 services→routers allowlist。
