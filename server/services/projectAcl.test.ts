/**
 * projectAcl 純函式守衛的單元測試。
 * assertProjectNotArchived：封存專案不接受「發起新工作」的寫入（生成／代理計畫／排程）——
 * 掛在 core 層，tRPC 與 MCP 兩端一致；尤其擋外部 AI 客戶端拿舊 projectId 對已封存專案持續寫入。
 */
import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { assertProjectNotArchived } from "./projectAcl";

describe("assertProjectNotArchived：封存專案寫入守衛", () => {
  it("封存專案：拋 BAD_REQUEST 並說明還原方式", () => {
    try {
      assertProjectNotArchived({ status: "archived" });
      throw new Error("應該要拋錯");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("BAD_REQUEST");
      expect((err as TRPCError).message).toContain("已封存");
    }
  });

  it("非封存狀態：一律放行（不拋錯）", () => {
    expect(() => assertProjectNotArchived({ status: "active" })).not.toThrow();
    expect(() => assertProjectNotArchived({ status: "draft" })).not.toThrow();
  });
});
