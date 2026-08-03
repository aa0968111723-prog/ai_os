/**
 * MCP 伺服器介面 — 再匯出。
 * 實作本體見 mcp.transport.ts（含 handleMcp + TOOLS）。
 * 修復 #364 佔位檔導致 `No matching export for import handleMcp` 建置失敗。
 */
export { handleMcp, TOOLS } from "./mcp.transport";
