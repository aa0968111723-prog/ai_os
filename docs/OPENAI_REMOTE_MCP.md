# GPT-5.6 Sol × AI-OS Remote MCP

## 目標

AI-OS 原本已經有 `/api/mcp` 與完整 MCP 工具。本整合不重做工具，而是把 OpenAI Responses API 當成「大腦」，讓 GPT-5.6 Sol 透過既有 MCP 讀取與操作 AI-OS。

使用者在 `/mcp` 會看到「GPT 直接做」面板，可以直接說：

- 幫我看現在專案狀態，缺什麼列出來。
- 找到某個專案，把缺的待辦建立起來。
- 看分鏡、素材、排程後幫我整理下一步。
- 把我確認的決策存進專案 Decision Log。

## 部署環境變數

Zeabur 服務至少加入：

```bash
OPENAI_API_KEY=sk-proj-...
PUBLIC_APP_URL=https://ai-os-app.zeabur.app
```

可選：

```bash
# 預設就是 gpt-5.6（目前 alias 指向 GPT-5.6 Sol）
OPENAI_MCP_MODEL=gpt-5.6
```

設定完成後重新部署。

> `OPENAI_API_KEY` 只放部署平台 Secret/環境變數，不可提交到 GitHub，也不可放在前端 VITE_* 變數。

## 實際資料流

```text
使用者 /mcp
  ↓
openaiMcp.ask
  ↓
建立「5 分鐘唯讀 MCP key」
  ↓
OpenAI Responses API / gpt-5.6
  ↓ Remote MCP + x-api-key
AI-OS /api/mcp
  ↓
既有 callTool → ACL / 點數 / 封存 / 核准門檻 / 審計
```

### 寫入時

```text
GPT 準備呼叫寫入工具
  ↓
OpenAI 回 mcp_approval_request（尚未執行）
  ↓
AI-OS UI 逐項顯示「允許一次 / 拒絕」
  ↓
使用者確認
  ↓
只為該次 continuation 建立 5 分鐘可寫 MCP key
  ↓
OpenAI 執行已核准工具
  ↓
請求結束立即 revoke key
```

## 安全不變式

1. **不使用使用者畫面上的長效 `aidmcp_...` 金鑰。** 後端每次只建立短效 key，OpenAI request 結束就撤銷。
2. **初始自主階段一定唯讀。** 即使上游持有短效 header，也不能直接寫入。
3. **所有 MCP write 工具都要求人類核准。** 判定使用既有 `shared/mcpCatalog.ts` 產生的 `readOnlyHint`，沒有另維護第二份工具清單。
4. **核准 continuation 綁目前登入使用者並做 HMAC 簽章與 15 分鐘過期。** 不能拿別人的 response id 來核准。
5. **真正寫入仍走既有 `callTool`。** 所以專案 ACL、組隔離、點數、封存專案守衛、資料驗證與 MCP audit 全部維持原樣。
6. **工具結果可展示，chain-of-thought 不展示。** UI 的「實際工具活動」來自 OpenAI MCP call output，不偽造模型私有推理。

## 計費

- GPT-5.6 Responses API：走 `OPENAI_API_KEY` 所屬 OpenAI 帳單。
- GPT 透過 MCP 送出的 AI-OS 生成任務：仍走 AI-OS 原本的點數、成本門檻與核准流程。
- 單純讀取 AI-OS 專案/資料庫/分鏡等不會額外扣 AI-OS 生成點數。

## 驗收

部署後：

1. 登入 AI-OS → `接上外部 AI` (`/mcp`)。
2. 右下角開啟 **GPT 直接做**。
3. 問：「幫我列出我目前可存取的專案。」
   - 應自動讀取，不跳寫入確認。
4. 再問：「幫我在某專案建立一個待辦：確認最終配樂。」
   - 應顯示 `create_task` 的一次性確認卡，尚未建立。
5. 選「允許一次」並送出。
   - 完成後應回報 MCP 實際結果；到 MCP 近期活動/任務頁可看到真實寫入與審計。
6. 拒絕同類操作時，不應產生資料。
