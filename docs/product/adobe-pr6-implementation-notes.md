# Adobe PR6 實作筆記

## 已完成
- `shared/mcpCatalog.ts`：新增 6 個 adobe_* 工具（status / list_assets / edit_photo / job / export_timeline / render_timeline）

## 待完成（本 PR）
1. `shared/auditWording.ts`：補 `mcp.adobe_*` 人話標籤
2. `server/services/mcp.ts`：TOOLS 定義 + runTool 分支（呼叫既有 adobe services）
3. `client/src/components/AgentCard.tsx`：支援三個 adobe kind + adobeJobId 顯示
4. 手動按鈕：`AdobePhotoEditButton` / `AdobeTimelineExportButton`
5. 測試（mock）
6. roadmap 更新

## 依賴
PR5 的 agentPlanning / agentCore / agentRunner 三檔仍需從 artifacts 本機套用到 `feat/adobe-pr5-agent-dag` 後再 merge 或 cherry-pick。

## 設計原則
- 業務邏輯全部重用 `server/services/adobe/*`
- 未連結 → 清楚錯誤
- export_timeline 純本機，不需連結
- 不扣站內點數
