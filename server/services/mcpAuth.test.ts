/**
 * MCP 金鑰認證純函式單元測試（per-user 權限）：
 * - looksLikeMcpToken：格式閘門（前綴＋64 hex），把亂碼/env 金鑰擋在查表之外。
 * - envKeyMatches：固定時間比對，長度不同直接 false、不炸。
 * - newMcpTokenPlaintext：前綴正確、每次不同、通得過格式閘門。
 * - archivedWriteReason：封存專案只擋寫入類工具、放行讀取。
 * 這幾條錯了會直接影響「誰能連進來」與「封存案能不能被偷偷扣點」，是 per-user 守衛的邊界。
 */
import { describe, expect, it } from "vitest";
import {
  archivedWriteReason,
  envKeyMatches,
  looksLikeMcpToken,
  newMcpTokenPlaintext,
  MCP_TOKEN_PREFIX,
} from "./mcpAuth";

describe("looksLikeMcpToken：格式閘門", () => {
  it("前綴正確且 64 位 hex → true", () => {
    expect(looksLikeMcpToken(MCP_TOKEN_PREFIX + "a".repeat(64))).toBe(true);
    expect(looksLikeMcpToken(MCP_TOKEN_PREFIX + "0123456789abcdef".repeat(4))).toBe(true);
  });
  it("缺前綴 → false", () => {
    expect(looksLikeMcpToken("a".repeat(64))).toBe(false);
    expect(looksLikeMcpToken("test-mcp-key")).toBe(false); // 舊 env 共用金鑰不該被當個人金鑰
  });
  it("長度不對或含非 hex → false", () => {
    expect(looksLikeMcpToken(MCP_TOKEN_PREFIX + "a".repeat(63))).toBe(false);
    expect(looksLikeMcpToken(MCP_TOKEN_PREFIX + "a".repeat(65))).toBe(false);
    expect(looksLikeMcpToken(MCP_TOKEN_PREFIX + "g".repeat(64))).toBe(false); // g 非 hex
    expect(looksLikeMcpToken(MCP_TOKEN_PREFIX + "A".repeat(64))).toBe(false); // 只收小寫 hex
  });
  it("空字串 → false", () => {
    expect(looksLikeMcpToken("")).toBe(false);
    expect(looksLikeMcpToken(MCP_TOKEN_PREFIX)).toBe(false);
  });
});

describe("newMcpTokenPlaintext：產生的金鑰", () => {
  it("帶正確前綴且通得過格式閘門", () => {
    const t = newMcpTokenPlaintext();
    expect(t.startsWith(MCP_TOKEN_PREFIX)).toBe(true);
    expect(looksLikeMcpToken(t)).toBe(true);
  });
  it("每次不同（隨機）", () => {
    const a = newMcpTokenPlaintext();
    const b = newMcpTokenPlaintext();
    expect(a).not.toBe(b);
  });
});

describe("envKeyMatches：固定時間比對", () => {
  it("相同 → true", () => {
    expect(envKeyMatches("secret-key", "secret-key")).toBe(true);
  });
  it("不同（等長）→ false", () => {
    expect(envKeyMatches("secret-key", "secret-keZ")).toBe(false);
  });
  it("長度不同 → false（且不拋例外）", () => {
    expect(envKeyMatches("short", "a-much-longer-key")).toBe(false);
    expect(envKeyMatches("", "x")).toBe(false);
  });
});

describe("archivedWriteReason：封存專案守衛", () => {
  it("封存專案 + 寫入類工具 → 擋（回人話原因）", () => {
    expect(archivedWriteReason("submit_generation", "archived")).toContain("已封存");
    expect(archivedWriteReason("post_message", "archived")).toContain("已封存");
  });
  it("封存專案 + 讀取類工具 → 放行（null）", () => {
    expect(archivedWriteReason("get_project_context", "archived")).toBeNull();
    expect(archivedWriteReason("list_projects", "archived")).toBeNull();
    expect(archivedWriteReason("find_model", "archived")).toBeNull();
  });
  it("非封存專案 → 一律放行", () => {
    expect(archivedWriteReason("submit_generation", "active")).toBeNull();
    expect(archivedWriteReason("post_message", "active")).toBeNull();
  });
});
