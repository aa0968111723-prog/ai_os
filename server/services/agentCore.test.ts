/**
 * agentCore 入口 UUID 守衛：MCP 直呼 core 無 router zod，非法 id 必須 BAD_REQUEST 而非 DB 500。
 */
import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { readFileSync } from "node:fs";
import { assertUuid } from "./agentCore";

describe("assertUuid（MCP / core 入口）", () => {
  it("合法 UUID 不拋錯", () => {
    expect(() => assertUuid("550e8400-e29b-41d4-a716-446655440000", "專案編號")).not.toThrow();
  });

  it("非法字串拋 BAD_REQUEST 中文訊息", () => {
    try {
      assertUuid("abc", "代理計畫編號");
      throw new Error("應該要拋錯");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("BAD_REQUEST");
      expect((err as TRPCError).message).toBe("代理計畫編號格式不正確");
    }
  });

  it("空字串與非 UUID 也擋", () => {
    expect(() => assertUuid("", "專案編號")).toThrow(TRPCError);
    expect(() => assertUuid("not-a-uuid", "專案編號")).toThrow(TRPCError);
  });
});

describe("agentCore source：各入口呼叫 assertUuid", () => {
  const source = readFileSync(new URL("./agentCore.ts", import.meta.url), "utf8");

  it("plan / list 驗 projectId；approve / discard / stop / get 驗 runId", () => {
    expect(source).toContain('assertUuid(input.projectId, "專案編號")');
    expect(source).toContain('assertUuid(projectId, "專案編號")');
    expect(source).toContain('assertUuid(input.runId, "代理計畫編號")');
    expect(source).toContain('assertUuid(runId, "代理計畫編號")');
    // 六個對外 core 都有守衛
    const calls = source.match(/assertUuid\(/g) ?? [];
    // export function assertUuid 定義 1 次 + 6 次呼叫
    expect(calls.length).toBeGreaterThanOrEqual(7);
  });
});
