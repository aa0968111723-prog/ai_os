import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { assertMcpProjectScope, mcpUnchanged } from "./mcpWriteExpansion";

describe("MCP write honesty helpers", () => {
  it("marks empty patches as unchanged so agents cannot claim a write", () => {
    expect(mcpUnchanged({ characterId: "c1", name: "小華" })).toEqual({
      characterId: "c1",
      name: "小華",
      unchanged: true,
    });
  });

  it("allows same-project updates and omitted projectId", () => {
    expect(() => assertMcpProjectScope("proj-a", undefined, "角色卡")).not.toThrow();
    expect(() => assertMcpProjectScope("proj-a", "proj-a", "角色卡")).not.toThrow();
    expect(() => assertMcpProjectScope("proj-a", "", "角色卡")).not.toThrow();
  });

  it("rejects same-group cross-project id writes (小華 in A vs B)", () => {
    try {
      assertMcpProjectScope("proj-a", "proj-b", "角色卡");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("FORBIDDEN");
      expect((error as TRPCError).message).toContain("角色卡不屬於這個專案");
    }
  });
});
