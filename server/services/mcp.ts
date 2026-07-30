/**
 * EMERGENCY HOTFIX — full mcp.ts was destroyed by PLACEHOLDER.
 * This minimal stub stops the ReferenceError crash so the app can boot.
 * Full restore of the complete mcp.ts (with request_upload_grant wiring) must follow immediately.
 * See artifacts or PR #206 for the correct full content.
 */
import type { Request, Response } from "express";

export async function handleMcpRequest(_req: Request, res: Response) {
  res.status(503).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "MCP temporarily unavailable — emergency restore in progress" },
    id: null,
  });
}

// Re-export nothing for now; the real implementation will be restored in the next commit.
