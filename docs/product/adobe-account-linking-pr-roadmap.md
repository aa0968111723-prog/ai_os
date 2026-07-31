# Adobe 帳號連結 + 深度修圖／剪輯整合 PR 路線圖

> 目標：使用者自己連結自己的 Adobe 帳號後，AI 可直接在使用者帳號內做修圖與剪輯，減少下載→上傳循環。
> 設計：前後端先做骨架 + Mock 模式，Adobe Developer Console 憑證之後再申請。

## Epic 總覽

| PR | 標題 | 內容重點 |
|----|------|----------|
| PR1 | 資料庫基礎與加密 token | Schema + TokenService |
| PR2 | OAuth 流程 + 前端連結 UI | 連結／撤銷／狀態（Mock 可跑） |
| PR3 | Adobe 服務層（修圖 + 剪輯工具） | Client + Mock + 工具 |
| PR4 | 強化既有剪輯交付管線 | FCPXML / Premiere XML / 剪映草稿支援 Adobe 資產 |
| PR5 | AI 代理 DAG 接入 | 新步驟種類 + 執行器 |
| PR6 | 端到端整合與 UI 完善 | 完整流程 + 文件 + 測試 |
| PR7（可選） | Tauri 本機深度控制 | 真正控制本機 PS / Premiere |

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

---
此文件由 AI 協作規劃，作為實作依據。
