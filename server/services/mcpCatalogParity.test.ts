import { describe, expect, it } from "vitest";
import { MCP_TOOLS, isMcpWriteTool, mcpToolAnnotations } from "../../shared/mcpCatalog";
import { TOOLS } from "./mcp";

/**
 * D1（#216 總規）：catalog 為單一真相——協定層 TOOLS 與 shared/mcpCatalog 不可分岔，
 * annotations 由 access 分類推導且四個 hint 顯式輸出（協議層預設偏保守，未給會被視為 true）。
 */
describe("MCP catalog ↔ TOOLS 對齊（D1）", () => {
  it("每個協定層工具都在 catalog；每個 catalog 工具都有協定層定義", () => {
    const toolNames = new Set(TOOLS.map((t) => t.name));
    const catalogNames = new Set(MCP_TOOLS.map((t) => t.name));
    expect([...toolNames].filter((n) => !catalogNames.has(n))).toEqual([]);
    expect([...catalogNames].filter((n) => !toolNames.has(n))).toEqual([]);
  });

  it("annotations 與 access 分類同源：read → readOnlyHint、write → 非唯讀", () => {
    for (const tool of MCP_TOOLS) {
      const a = mcpToolAnnotations(tool.name);
      expect(a).not.toBeNull();
      expect(a!.readOnlyHint).toBe(tool.access === "read");
      expect(a!.readOnlyHint).toBe(!isMcpWriteTool(tool.name));
      // 四個 hint 一律顯式（不留給協議層預設猜）
      expect(typeof a!.destructiveHint).toBe("boolean");
      expect(typeof a!.idempotentHint).toBe("boolean");
      expect(typeof a!.openWorldHint).toBe("boolean");
      expect(a!.title).toBe(tool.title);
    }
  });

  it("破壞性／冪等／外部網路標記符合行為", () => {
    expect(mcpToolAnnotations("stop_agent")?.destructiveHint).toBe(true);
    expect(mcpToolAnnotations("discard_agent")?.destructiveHint).toBe(true);
    expect(mcpToolAnnotations("add_database_rows")?.idempotentHint).toBe(true);
    expect(mcpToolAnnotations("update_database_row")?.idempotentHint).toBe(true);
    expect(mcpToolAnnotations("submit_generation")?.openWorldHint).toBe(true);
    expect(mcpToolAnnotations("plan_agent")?.openWorldHint).toBe(true);
    expect(mcpToolAnnotations("import_drive_file")?.openWorldHint).toBe(true);
    expect(mcpToolAnnotations("get_integrations_status")?.readOnlyHint).toBe(true);
    expect(mcpToolAnnotations("update_schedule_item")?.idempotentHint).toBe(true);
    expect(mcpToolAnnotations("complete_task")?.destructiveHint).toBe(false);
    // 一般寫入不得誤標破壞性；站內讀取不得誤標外部網路
    expect(mcpToolAnnotations("add_schedule_item")?.destructiveHint).toBe(false);
    expect(mcpToolAnnotations("list_notes")?.openWorldHint).toBe(false);
    expect(mcpToolAnnotations("unknown_tool")).toBeNull();
  });
});
