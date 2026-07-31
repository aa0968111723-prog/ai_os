# Adobe 帳號連結 + 深度修圖／剪輯整合 PR 路線圖

> 目標：使用者自己連結自己的 Adobe 帳號後，AI 可直接在使用者帳號內做修圖與剪輯，減少下載→上傳循環。
> 設計：前後端先做骨架 + Mock 模式，Adobe Developer Console 憑證之後再申請。

## Epic 總覽

| PR | 標題 | 內容重點 | 狀態 |
|----|------|----------|------|
| PR1 | 資料庫基礎與加密 token | Schema + TokenService | ✅ 已實作 |
| PR2 | OAuth 流程 + 前端連結 UI | 連結／撤銷／狀態（Mock 可跑） | ✅ 已實作 |
| PR3 | Adobe 服務層（修圖 + 剪輯工具） | Client + Mock + 工具 | ✅ 已實作（real 模式部分能力待憑證） |
| PR4 | 強化既有剪輯交付管線 | FCPXML / Premiere XML / 剪映草稿支援 Adobe 資產 | ⬜ 待辦 |
| PR5 | AI 代理 DAG 接入 | 新步驟種類 + 執行器 | ⬜ 待辦 |
| PR6 | 端到端整合與 UI 完善 | 完整流程 + 文件 + 測試 | ⬜ 待辦 |
| PR7（可選） | Tauri 本機深度控制 | 真正控制本機 PS / Premiere | ⬜ 待辦 |

## 檔案放置規劃

```
shared/adobe.ts
server/db/schema/  (或 integrations.ts 擴充) → externalAccounts
server/services/adobe/
  tokenService.ts
  adobeClient.ts
  mockAdobeClient.ts
  types.ts
server/routers/adobe.ts
client/src/hooks/useAdobeConnection.ts
client/src/components/settings/AdobeConnectButton.tsx
client/src/components/settings/AdobeConnectionStatus.tsx
```

## 環境變數預留

```env
ADOBE_MODE=mock
ADOBE_CLIENT_ID=
ADOBE_CLIENT_SECRET=
ADOBE_REDIRECT_URI=
TOKEN_ENCRYPTION_KEY=
```

## 開發順序

1. PR1 + PR2 → 前端可完整模擬連結流程
2. PR3 → 工具可呼叫（Mock）
3. PR4 → 交付品質提升
4. PR5 → AI 會自己修圖與組時間軸
5. PR6 → 完善上線準備
6. 之後申請 Adobe 憑證，切換 real 模式

詳見各 PR 範圍說明。

## 與現有系統接點

- 現有 MCP Server (`/api/mcp`) 可未來暴露 Adobe 工具
- `server/services/jianying.ts`、exporter 相關加強引用 Adobe 資產
- `shared/plan.ts` + agentRunner 新增步驟
- 點數、ACL、審批機制沿用

## PR1–PR3 實作結果（本次）

### 實際落點（與規劃的差異都在這裡說明）

```
shared/adobe.ts                                   契約：修圖操作／時間軸／連結狀態＋純函式
server/db/schema/integrations.ts → externalAccounts   OAuth 雙 token 表（drizzle/0016_external_accounts.sql）
server/services/adobe/types.ts                    Client 介面與錯誤型別
server/services/adobe/tokenService.ts             加解密、到期判定、落庫與失效標記
server/services/adobe/oauth.ts                    （新增）state 簽章、授權入口、token 交換／刷新／撤銷
server/services/adobe/mockAdobeClient.ts          不出網的完整模擬（含非同步工作生命週期）
server/services/adobe/adobeClient.ts              real 模式：Adobe 非同步工作模式
server/services/adobe/index.ts                    服務層門面（token 解析 → 呼叫 → 使用紀錄）
server/routers/adobe.ts                           tRPC：status／disconnect／listAssets／editPhoto／renderTimeline／job
server/index.ts → /api/integrations/adobe/*       OAuth start＋callback（Express 重導，手動補審計）
client/src/hooks/useAdobeConnection.ts            狀態／撤銷／回跳訊息
client/src/components/settings/AdobeConnectButton.tsx      連結／重新連結／中斷
client/src/components/settings/AdobeConnectionStatus.tsx   狀態與能力顯示
```

- **`externalAccounts` 獨立成表**（而非擴充 `user_integrations`）：Adobe 是 access＋refresh 雙 token
  且需記到期時刻，塞進單憑證的既有表會讓兩種語意混在一起。
- **加密金鑰沿用 `INTEGRATION_TOKEN_SECRET`**（分域前綴 `adobe-token:`／`adobe-state:`），
  未採規劃中的 `TOKEN_ENCRYPTION_KEY`：站方只需顧一把金鑰，也不多一套「金鑰遺失就解不開」的失敗模式。
  輪替方式與既有整合完全相同。

### 現在就能做的事（`ADOBE_MODE=mock`，預設值）

連結 → 看狀態 → 列素材 → 送修圖／時間軸工作 → 輪詢到完成 → 中斷連結，整條流程可跑完，
不需要任何 Adobe 憑證，也不會對外連線。模擬工作有真正的 queued → running → succeeded 生命週期，
成品尺寸依實際操作推導；素材 id 錯誤、對影片送修圖等錯誤路徑同樣走得到。

### real 模式的已知邊界（PR6 補齊）

拿到 Adobe Developer Console 憑證後設 `ADOBE_MODE=real` 即可切換，但目前 real client 只接了
**去背**與**自動調色**兩個端點形狀已確定的操作；裁切／縮放／微調、素材瀏覽、時間軸算圖
一律回明確的「尚未支援」而不是送出猜測的請求（猜錯會動到使用者自己的雲端資產）。
`adobe.status` 的 `capabilities` 誠實回報這些差異，前端據此不顯示做不到的按鈕。
時間軸算圖 Adobe 本就無公開 API——正解是 PR4 的 FCPXML／Premiere XML／剪映草稿交付。

### 尚未進行（PR4–PR7）

交付管線接 Adobe 資產（PR4）、代理 DAG 新步驟與執行器（PR5）、端到端 UI／MCP 工具曝露（PR6）、
Tauri 本機控制（PR7）。本次不動 `shared/plan.ts` 與 agentRunner——步驟種類與副作用要一起上，
拆開會留下「能規劃但跑不動」的步驟。

---
此文件由 AI 協作規劃，作為實作依據。
